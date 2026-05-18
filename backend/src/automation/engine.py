"""
Energy priority automation engine.

Priority chain (every 5-minute cycle):
  1. Home devices  — always served first (passively handled by Tesla Gateway)
  2. Powerwall     — charge to 100% before anything else
  3. Car / HVAC    — order set by priority_car_before_hvac setting (default: car first)
  4. HVAC / Car    — the lower-priority device
  5. Grid export   — everything left over goes to the grid

Manual overrides in settings can bypass priorities (e.g. force-charge car).
"""
import time
import logging
from typing import Optional

from clients import tesla_client, nest_client
from utils.solar_eta import compute_solar_etas
from models.energy_data import (
    EnergyReading, save_reading, get_latest_reading, get_automation_state,
    save_automation_state, get_settings, save_settings,
)

logger = logging.getLogger(__name__)

# Minimum amps Tesla will accept for charging (240V circuit → ~1380W at 6A)
MIN_CHARGE_AMPS = 6
VOLTS = 240


def watts_to_amps(watts: float) -> int:
    return max(MIN_CHARGE_AMPS, int(watts / VOLTS))


def run(notify_fn=None) -> dict:
    """
    Main automation cycle. Called every 5 minutes by Lambda.
    notify_fn: optional callable(event_type, message) for push notifications.
    Returns summary dict for logging.
    """
    settings = get_settings()
    prev_state = get_automation_state()

    if settings["overrides"].get("automation_paused"):
        logger.info("Automation paused by user override")
        return {"skipped": "automation_paused"}

    # ── 1. Fetch current state ────────────────────────────────────────────────
    # Tesla API is called every 3rd cycle (every 15 min) to stay within the
    # $10/month free tier. Light cycles use the last DynamoDB reading for
    # energy data and prev_state for car state — both free to read.
    cycle_count = int(prev_state.get("cycle_count", 0))
    is_full_cycle = (cycle_count % 3 == 0)
    logger.info(f"Cycle {cycle_count} — {'FULL (Tesla API)' if is_full_cycle else 'LIGHT (cached)'}")

    try:
        site_id = tesla_client.get_energy_site_id()
        if is_full_cycle:
            energy = tesla_client.get_energy_data(site_id)
        else:
            latest = get_latest_reading()
            if latest:
                energy = {
                    "solar_power_w": float(latest["solar_power_w"]),
                    "battery_power_w": float(latest["battery_power_w"]),
                    "load_power_w": float(latest["load_power_w"]),
                    "grid_power_w": float(latest["grid_power_w"]),
                    "battery_percentage": float(latest["battery_percentage"]),
                    "grid_status": "Active",
                }
            else:
                energy = tesla_client.get_energy_data(site_id)
    except Exception as e:
        logger.error(f"Tesla energy data unavailable — aborting cycle: {e}")
        return {"skipped": "tesla_energy_unavailable"}

    try:
        vehicle_id = tesla_client.get_vehicle_id()
    except Exception as e:
        logger.error(f"Tesla vehicle ID unavailable — aborting cycle: {e}")
        return {"skipped": "tesla_vehicle_unavailable"}

    car_unavailable = False
    prev_car_plugged = prev_state.get("car_plugged", False)
    prev_car_level = int(prev_state.get("car_battery_level", 0))
    prev_car_full = prev_car_level >= int(settings["car_charge_limit_percent"])

    if not is_full_cycle:
        # Light cycle — use prev_state for car (no Tesla vehicle API call)
        car = {
            "battery_level": prev_car_level,
            "charge_limit_soc": settings["car_charge_limit_percent"],
            "charging_state": prev_state.get("car_charging_state", "Disconnected"),
            "charge_rate_mph": 0,
            "charge_power_w": float(prev_state.get("car_charge_power_w", 0)),
            "minutes_to_full_charge": 0,
            "plugged_in": prev_car_plugged,
        }
    else:
        try:
            car = tesla_client.get_vehicle_charge_state(vehicle_id)
        except RuntimeError as e:
            if "asleep" in str(e):
                if prev_car_plugged and not prev_car_full:
                    logger.info("Vehicle asleep but plugged in and not full — waking to charge")
                    try:
                        tesla_client._wake_vehicle(vehicle_id, timeout_s=45)
                        car = tesla_client.get_vehicle_charge_state(vehicle_id)
                    except Exception as wake_e:
                        logger.warning(f"Wake failed — using prev state as plugged: {wake_e}")
                        car = {
                            "battery_level": prev_car_level,
                            "charge_limit_soc": settings["car_charge_limit_percent"],
                            "charging_state": "Stopped",
                            "charge_rate_mph": 0,
                            "charge_power_w": 0,
                            "minutes_to_full_charge": 0,
                            "plugged_in": True,
                        }
                else:
                    logger.info("Vehicle asleep and disconnected or full — skipping wake")
                    car = {
                        "battery_level": prev_car_level,
                        "charge_limit_soc": settings["car_charge_limit_percent"],
                        "charging_state": "Disconnected",
                        "charge_rate_mph": 0,
                        "charge_power_w": 0,
                        "minutes_to_full_charge": 0,
                        "plugged_in": False,
                    }
            else:
                raise
        except Exception as e:
            logger.warning(f"Car data unavailable (skipping car actions): {e}")
            car_unavailable = True
            car = {
                "battery_level": prev_car_level,
                "charge_limit_soc": settings["car_charge_limit_percent"],
                "charging_state": prev_state.get("car_charging_state", "Unavailable"),
                "charge_rate_mph": 0,
                "charge_power_w": 0,
                "minutes_to_full_charge": 0,
                "plugged_in": False,
            }

    hvac_unavailable = False
    try:
        thermostat_ids = nest_client.get_thermostat_ids()
        all_hvac_states = [
            {"id": t_id, "index": i, **nest_client.get_thermostat_state(t_id)}
            for i, t_id in enumerate(thermostat_ids)
        ]
    except Exception as e:
        logger.warning(f"Nest data unavailable (skipping HVAC actions): {e}")
        hvac_unavailable = True
        all_hvac_states = prev_state.get("thermostats", [])

    hvac = all_hvac_states[0] if all_hvac_states else {
        "hvac_status": "OFF", "connectivity": "OFFLINE",
        "mode": "OFF", "current_temp_f": 0, "cool_setpoint_f": 76,
    }

    solar_w = energy["solar_power_w"]
    load_w = energy["load_power_w"]
    battery_pct = energy["battery_percentage"]
    battery_power_w = energy["battery_power_w"]

    # ── 2. Calculate raw surplus ─────────────────────────────────────────────
    # Always start with actual solar minus home load.
    # The "powerwall" step in the priority loop acts as a gate — if powerwall
    # is not yet full and it appears before car/hvac, surplus is set to 0 for
    # everything ranked below it.
    powerwall_full = battery_pct >= settings["powerwall_full_threshold"]
    surplus_w = solar_w - load_w
    if car["charging_state"] == "Charging":
        surplus_w += car["charge_power_w"]

    actions_taken = []
    notifications = []

    # ── 3. Prepare device state ───────────────────────────────────────────────
    force_car = settings["overrides"].get("car_force_charge", False)
    trip_mode = settings["overrides"].get("car_trip_mode", False)
    trip_target = int(settings["overrides"].get("car_trip_target_percent", 100))
    car_plugged = car["plugged_in"]
    car_full = car["battery_level"] >= settings["car_charge_limit_percent"]
    trip_target_reached = car["battery_level"] >= trip_target
    we_started_charging = prev_state.get("we_started_charging", False)
    is_currently_charging = car["charging_state"] == "Charging"
    force_hvac = settings["overrides"].get("hvac_force_on", False)
    hvac_online = hvac["connectivity"] == "ONLINE"

    # Auto-disable trip mode once target is reached
    if trip_mode and trip_target_reached:
        settings["overrides"]["car_trip_mode"] = False
        save_settings(settings)
        trip_mode = False
        actions_taken.append("trip_mode_auto_disabled")
        if settings["notifications"]["car_fully_charged"]:
            notifications.append(("car_fully_charged", f"Trip ready! Tesla charged to {car['battery_level']}% — trip mode disabled"))

    # ── 4. Run priority cycle ─────────────────────────────────────────────────
    # "powerwall" acts as a gate: if not full and ranked here, surplus = 0 for all steps below it
    priority_order = settings.get("priority_order", ["powerwall", "car", "hvac"])

    for step in priority_order:

        if step == "powerwall":
            # Powerwall charges passively via Tesla Gateway — no API call needed.
            # If not yet full, only the actual grid export is available to lower-ranked items.
            # Grid export means the Powerwall is already taking what it can and the rest is
            # genuinely going to waste — redirect that to car/HVAC instead of blocking everything.
            if not powerwall_full:
                grid_export_w = max(0, -energy["grid_power_w"])
                surplus_w = grid_export_w

        elif step == "car":
            if car_unavailable:
                continue
            externally_started = is_currently_charging and not we_started_charging and not trip_mode and not force_car

            if car_plugged and not car_full:
                if externally_started and surplus_w < settings["min_surplus_for_car_w"]:
                    # Car was started externally but priority rules say it shouldn't be charging
                    # (e.g. powerwall is first in priority and not full, so surplus_w was set to 0)
                    if is_currently_charging:
                        tesla_client.stop_charging(vehicle_id)
                        actions_taken.append("car_charge_stopped_priority")
                        we_started_charging = False
                        if settings["notifications"]["car_charging_stopped"]:
                            notifications.append(("car_charging_stopped", "Car charging paused — powerwall charging first"))
                elif externally_started:
                    # External charging — optimize amps to use full solar surplus
                    # but don't take ownership of start/stop
                    if surplus_w >= settings["min_surplus_for_car_w"]:
                        target_amps = watts_to_amps(surplus_w)
                        tesla_client.set_charge_amps(vehicle_id, target_amps)
                        surplus_w = max(0, surplus_w - target_amps * VOLTS)
                        actions_taken.append(f"car_amps_optimized_{target_amps}")
                    else:
                        surplus_w = max(0, surplus_w - int(car.get("charge_power_w", 0)))
                    actions_taken.append("car_charging_external_respect")
                elif trip_mode:
                    # Trip mode: charge to target % using grid, full speed
                    tesla_client.set_charge_limit(vehicle_id, trip_target)
                    tesla_client.set_charge_amps(vehicle_id, 48)
                    if not is_currently_charging:
                        tesla_client.start_charging(vehicle_id)
                        actions_taken.append("car_charge_started_trip_mode")
                        if settings["notifications"]["car_charging_started"]:
                            notifications.append(("car_charging_started", f"Trip mode: charging to {trip_target}% (grid + solar)"))
                    we_started_charging = True
                elif force_car:
                    # Manual override: charge regardless of solar
                    if not is_currently_charging:
                        tesla_client.start_charging(vehicle_id)
                        actions_taken.append("car_charge_started_override")
                        if settings["notifications"]["car_charging_started"]:
                            notifications.append(("car_charging_started", "Car charging started (manual override)"))
                    we_started_charging = True
                elif surplus_w >= settings["min_surplus_for_car_w"]:
                    # Solar surplus — throttle amps to match surplus
                    target_amps = watts_to_amps(surplus_w)
                    tesla_client.set_charge_limit(vehicle_id, settings["car_charge_limit_percent"])
                    if not is_currently_charging:
                        tesla_client.start_charging(vehicle_id)
                        actions_taken.append("car_charge_started_solar")
                        if settings["notifications"]["car_charging_started"]:
                            notifications.append(("car_charging_started", f"Car charging started on solar ({surplus_w:.0f}W surplus)"))
                    tesla_client.set_charge_amps(vehicle_id, target_amps)
                    actions_taken.append(f"car_amps_set_{target_amps}")
                    surplus_w -= target_amps * VOLTS
                    we_started_charging = True
                else:
                    # Not enough solar — only stop if WE started it
                    if is_currently_charging and we_started_charging:
                        tesla_client.stop_charging(vehicle_id)
                        actions_taken.append("car_charge_stopped_insufficient_solar")
                        we_started_charging = False
                        if settings["notifications"]["car_charging_stopped"]:
                            notifications.append(("car_charging_stopped", "Car charging paused — waiting for more solar"))
            else:
                # Car disconnected or full
                we_started_charging = False

        elif step == "hvac":
            if hvac_unavailable:
                continue
            if hvac_online:
                for i, t_state in enumerate(all_hvac_states):
                    t_id = t_state["id"]
                    # Each additional thermostat requires proportionally more surplus (T1=1×, T2=2×)
                    required_surplus = settings["min_surplus_for_hvac_w"] * (i + 1)
                    active_setpoint = float(settings["hvac_cool_setpoint_f"])

                    # Turn OFF decision: check if HVAC is pulling from grid OR Powerwall.
                    # surplus_w includes HVAC's own draw so it can't be used here.
                    # battery_power_w > 0 means Powerwall is discharging.
                    grid_w = energy["grid_power_w"]
                    hvac_needs_non_solar = grid_w > 500 or battery_power_w > 500

                    car_needs_surplus = not car_unavailable and car_plugged and not car_full

                    if force_hvac:
                        if t_state["mode"] == "OFF":
                            nest_client.set_thermostat_mode(t_id, "COOL")
                        nest_client.set_cool_setpoint(t_id, active_setpoint)
                        actions_taken.append("hvac_on_override")
                        if settings["notifications"]["hvac_solar_activated"]:
                            notifications.append(("hvac_solar_activated", f"T{i+1} turned on (manual override)"))
                    elif car_needs_surplus:
                        # Car is plugged in and not full — all surplus goes to car first.
                        # Shut HVAC off if we started it; don't start it if it's off.
                        if prev_state.get("hvac_was_solar_activated") and t_state["mode"] != "OFF":
                            nest_client.set_thermostat_mode(t_id, "OFF")
                            actions_taken.append("hvac_off_car_priority")
                    elif surplus_w >= required_surplus:
                        if t_state["mode"] == "OFF":
                            nest_client.set_thermostat_mode(t_id, "COOL")
                            actions_taken.append("hvac_on_solar")
                            if settings["notifications"]["hvac_solar_activated"]:
                                notifications.append(("hvac_solar_activated", f"T{i+1} activated on solar surplus ({surplus_w:.0f}W)"))
                        nest_client.set_cool_setpoint(t_id, active_setpoint)
                        if "hvac_on_solar" not in actions_taken:
                            actions_taken.append("hvac_setpoint_active")
                    elif hvac_needs_non_solar:
                        if prev_state.get("hvac_was_solar_activated") and t_state["mode"] != "OFF":
                            nest_client.set_thermostat_mode(t_id, "OFF")
                            actions_taken.append("hvac_off_insufficient_solar")

    # ── 5. Car full notification ──────────────────────────────────────────────
    was_charging = prev_state.get("car_was_charging", False)
    if was_charging and car_full and not trip_mode:
        if settings["notifications"]["car_fully_charged"]:
            notifications.append(("car_fully_charged", f"Tesla is fully charged ({car['battery_level']}%)"))

    # ── 6. Powerwall low alert ────────────────────────────────────────────────
    low_threshold = settings["notifications"]["powerwall_low_threshold"]
    was_low = prev_state.get("powerwall_was_low", False)
    is_low = battery_pct <= low_threshold
    if is_low and not was_low and settings["notifications"]["powerwall_low"]:
        notifications.append(("powerwall_low", f"Powerwall is low ({battery_pct:.0f}%)"))

    # ── 7. Solar low alert ────────────────────────────────────────────────────
    solar_threshold = settings["notifications"]["solar_low_threshold_w"]
    was_solar_low = prev_state.get("solar_was_low", False)
    is_solar_low = solar_w < solar_threshold and solar_w > 0
    if is_solar_low and not was_solar_low and settings["notifications"]["solar_low"]:
        notifications.append(("solar_low", f"Solar production is low ({solar_w:.0f}W)"))

    # ── 8. Estimate cost savings ──────────────────────────────────────────────
    RATE_PER_KWH = 0.35
    solar_used_locally = max(0, solar_w - max(0, energy["grid_power_w"] * -1))
    cost_savings = (solar_used_locally / 1000) * RATE_PER_KWH * (5 / 60)

    # ── 9. Persist reading (reflect post-action car state) ────────────────────
    car_started = any(a in actions_taken for a in [
        "car_charge_started_solar", "car_charge_started_override", "car_charge_started_trip_mode"
    ])
    car_stopped = any(a in actions_taken for a in ["car_charge_stopped_insufficient_solar", "car_charge_stopped_priority"])

    actual_car_charging_state = car["charging_state"]
    actual_car_charge_power_w = car["charge_power_w"]
    if car_stopped:
        actual_car_charging_state = "Stopped"
        actual_car_charge_power_w = 0
    elif car_started:
        actual_car_charging_state = "Charging"

    reading = EnergyReading(
        timestamp=int(time.time()),
        solar_power_w=solar_w,
        battery_power_w=battery_power_w,
        load_power_w=load_w,
        home_load_w=max(0.0, load_w - actual_car_charge_power_w),
        grid_power_w=energy["grid_power_w"],
        battery_percentage=battery_pct,
        car_battery_level=car["battery_level"],
        car_charging_state=actual_car_charging_state,
        car_charge_power_w=actual_car_charge_power_w,
        hvac_status=hvac["hvac_status"],
        hvac_current_temp_f=hvac["current_temp_f"],
        hvac_setpoint_f=hvac["cool_setpoint_f"],
        hvac_mode=hvac["mode"],
        solar_surplus_w=surplus_w,
        cost_savings_usd=cost_savings,
    )
    save_reading(reading)

    # ── 10. Update event timestamps ───────────────────────────────────────────
    now = int(time.time())
    car_charge_started_at = prev_state.get("car_charge_started_at")
    car_charge_stopped_at = prev_state.get("car_charge_stopped_at")
    hvac_activated_at = prev_state.get("hvac_activated_at")
    hvac_deactivated_at = prev_state.get("hvac_deactivated_at")

    if car_started:
        car_charge_started_at = now
        car_charge_stopped_at = None   # new session clears the old stop time
    if car_stopped:
        car_charge_stopped_at = now

    hvac_started = any(a in actions_taken for a in ["hvac_on_solar", "hvac_on_override"])
    hvac_stopped = "hvac_off_insufficient_solar" in actions_taken

    if hvac_started:
        hvac_activated_at = now
        hvac_deactivated_at = None
    if hvac_stopped:
        hvac_deactivated_at = now

    # ── 11. Compute weather-aware charging ETAs ───────────────────────────────
    home_load_w = max(0.0, load_w - actual_car_charge_power_w)
    etas = compute_solar_etas(
        solar_w=solar_w,
        load_w=home_load_w,
        battery_pct=battery_pct,
        car_battery_level=car["battery_level"],
        car_plugged_in=car_plugged,
        car_limit_pct=settings["car_charge_limit_percent"],
        settings=settings,
    )

    # ── 12. Persist state for next cycle ──────────────────────────────────────
    save_automation_state({
        "car_was_charging": is_currently_charging,
        "we_started_charging": we_started_charging,
        "car_battery_level": car["battery_level"],
        "car_charging_state": car["charging_state"],
        "car_plugged": car["plugged_in"],
        "car_charge_power_w": car["charge_power_w"],
        "cycle_count": (cycle_count + 1) % 99,
        "hvac_was_solar_activated": "hvac_on_solar" in actions_taken or prev_state.get("hvac_was_solar_activated", False),
        "powerwall_was_low": is_low,
        "solar_was_low": is_solar_low,
        "last_run": now,
        "thermostats": all_hvac_states,
        "car_charge_started_at": car_charge_started_at,
        "car_charge_stopped_at": car_charge_stopped_at,
        "hvac_activated_at": hvac_activated_at,
        "hvac_deactivated_at": hvac_deactivated_at,
        "powerwall_full_eta": etas["powerwall_full_eta"],
        "car_full_eta": etas["car_full_eta"],
    })

    # ── 13. Fire notifications ────────────────────────────────────────────────
    if notify_fn:
        for event_type, message in notifications:
            try:
                notify_fn(event_type, message)
            except Exception as e:
                logger.warning(f"Notification failed: {e}")

    return {
        "actions": actions_taken,
        "solar_w": solar_w,
        "surplus_w": surplus_w,
        "battery_pct": battery_pct,
        "car_level": int(car["battery_level"]),
        "car_state": car["charging_state"],
        "hvac_status": hvac["hvac_status"],
    }
