"""
Weather-aware solar ETA computation.

Uses Open-Meteo (free, no API key) to get today's hourly solar irradiance
forecast. Calibrates against current measured output to account for panel
efficiency, shading, and system losses. Integrates forward in 15-min steps
to estimate when the powerwall and car will finish charging.
"""
import time
import logging
import requests

_log = logging.getLogger(__name__)

POWERWALL_KWH = 13.5    # Powerwall 3 usable capacity (kWh)
CAR_KWH = 75.0          # Model 3 Long Range 2018 usable capacity (kWh)
POWERWALL_MAX_CHARGE_W = 11500  # Powerwall 3 max AC charge rate
CAR_MAX_CHARGE_W = 11520        # 48A @ 240V
STEP_MIN = 15                   # simulation step size (minutes)
LOOKAHEAD_H = 14                # max hours to look ahead


def compute_solar_etas(
    solar_w: float,
    load_w: float,
    battery_pct: float,
    car_battery_level: int,
    car_plugged_in: bool,
    car_limit_pct: int,
    settings: dict,
) -> dict:
    """Returns powerwall_full_eta and car_full_eta as Unix timestamps (or None)."""
    lat = settings.get("latitude")
    lon = settings.get("longitude")
    if not lat or not lon:
        return {"powerwall_full_eta": None, "car_full_eta": None}
    try:
        return _compute(solar_w, load_w, battery_pct, car_battery_level,
                        car_plugged_in, car_limit_pct, lat, lon, settings)
    except Exception as e:
        _log.warning(f"Solar ETA failed: {e}")
        return {"powerwall_full_eta": None, "car_full_eta": None}


def _compute(solar_w, load_w, battery_pct, car_battery_level,
             car_plugged_in, car_limit_pct, lat, lon, settings):
    resp = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "hourly": "shortwave_radiation",
            "timezone": "auto",
            "forecast_days": 1,
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()

    hourly_irr = data["hourly"]["shortwave_radiation"]   # 24 values, local time
    utc_offset_s = data.get("utc_offset_seconds", 0)

    now_unix = time.time()
    local_now = now_unix + utc_offset_s
    current_hour = int((local_now % 86400) / 3600)

    # Calibrate: how much solar power do we get per W/m² of irradiance?
    current_irr = hourly_irr[min(current_hour, 23)]
    panel_factor = None
    if current_irr > 50 and solar_w > 0:
        raw_factor = solar_w / current_irr
        panel_factor = max(0.5, min(raw_factor, 15.0))   # clamp to sane range
    _log.info(f"Solar ETA: irr_now={current_irr:.0f} W/m², factor={panel_factor}")

    pw_full_pct = float(settings.get("powerwall_full_threshold", 98))
    pw_wh = battery_pct / 100 * POWERWALL_KWH * 1000
    pw_target_wh = pw_full_pct / 100 * POWERWALL_KWH * 1000
    pw_already_full = battery_pct >= pw_full_pct

    car_limit_pct_f = float(car_limit_pct)
    car_wh = car_battery_level / 100 * CAR_KWH * 1000
    car_target_wh = car_limit_pct_f / 100 * CAR_KWH * 1000
    car_already_full = car_battery_level >= car_limit_pct_f

    sim_pw_wh = pw_wh
    sim_car_wh = car_wh
    pw_full_eta = None
    car_full_eta = None

    t = now_unix
    steps = int(LOOKAHEAD_H * 60 / STEP_MIN)
    for _ in range(steps):
        t += STEP_MIN * 60
        local_t = t + utc_offset_s
        h = min(int((local_t % 86400) / 3600), 23)

        irr = hourly_irr[h]
        projected_solar = (irr * panel_factor) if (panel_factor and irr > 0) else 0.0
        surplus = max(0.0, projected_solar - load_w)

        # Priority 1: charge powerwall
        if not pw_already_full and sim_pw_wh < pw_target_wh:
            charge = min(surplus, POWERWALL_MAX_CHARGE_W)
            sim_pw_wh += charge * (STEP_MIN / 60)
            surplus -= charge
            if sim_pw_wh >= pw_target_wh and pw_full_eta is None:
                pw_full_eta = int(t)

        pw_satisfied = pw_already_full or (sim_pw_wh >= pw_target_wh)

        # Priority 2: charge car (only once powerwall is satisfied)
        if car_plugged_in and not car_already_full and pw_satisfied:
            charge = min(surplus, CAR_MAX_CHARGE_W)
            sim_car_wh += charge * (STEP_MIN / 60)
            if sim_car_wh >= car_target_wh and car_full_eta is None:
                car_full_eta = int(t)

        # Stop early once both are found
        done_pw = pw_already_full or pw_full_eta is not None
        done_car = car_already_full or car_full_eta is not None or not car_plugged_in
        if done_pw and done_car:
            break

    return {
        "powerwall_full_eta": None if pw_already_full else pw_full_eta,
        "car_full_eta": None if car_already_full else car_full_eta,
    }
