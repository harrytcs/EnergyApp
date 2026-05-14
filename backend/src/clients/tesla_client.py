"""
Tesla Fleet API client.
Handles OAuth2 token refresh, energy site data, and vehicle control.
"""
import os
import json
import logging
import socket
import subprocess
import time
import boto3
import requests
import urllib3
from typing import Optional

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
_log = logging.getLogger(__name__)

TESLA_AUTH_URL = "https://auth.tesla.com/oauth2/v3/token"
TESLA_API_BASE = "https://fleet-api.prd.na.vn.cloud.tesla.com/api/1"
REGION = "na"  # North America

ssm = boto3.client("ssm")


def _get_param(name: str) -> str:
    resp = ssm.get_parameter(Name=name, WithDecryption=True)
    return resp["Parameter"]["Value"]


def _get_tokens() -> dict:
    raw = _get_param("/energyapp/tesla/tokens")
    return json.loads(raw)


def _save_tokens(tokens: dict) -> None:
    ssm.put_parameter(
        Name="/energyapp/tesla/tokens",
        Value=json.dumps(tokens),
        Type="SecureString",
        Overwrite=True,
    )


def _refresh_access_token() -> str:
    tokens = _get_tokens()
    if tokens.get("expires_at", 0) - time.time() > 300:
        return tokens["access_token"]

    resp = requests.post(
        TESLA_AUTH_URL,
        json={
            "grant_type": "refresh_token",
            "client_id": _get_param("/energyapp/tesla/client_id"),
            "client_secret": _get_param("/energyapp/tesla/client_secret"),
            "refresh_token": tokens["refresh_token"],
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    tokens["access_token"] = data["access_token"]
    tokens["refresh_token"] = data.get("refresh_token", tokens["refresh_token"])
    tokens["expires_at"] = time.time() + data.get("expires_in", 3600) - 60
    _save_tokens(tokens)
    return tokens["access_token"]


def _headers() -> dict:
    return {"Authorization": f"Bearer {_refresh_access_token()}"}


_CACHED_SITE_ID_PARAM = "/energyapp/tesla/cached_site_id"
_CACHED_VEHICLE_ID_PARAM = "/energyapp/tesla/cached_vehicle_id"


# ── Energy Site ──────────────────────────────────────────────────────────────

def get_energy_site_id() -> str:
    try:
        return _get_param(_CACHED_SITE_ID_PARAM)
    except ssm.exceptions.ParameterNotFound:
        pass
    resp = requests.get(f"{TESLA_API_BASE}/products", headers=_headers(), timeout=15)
    resp.raise_for_status()
    for product in resp.json().get("response", []):
        if product.get("resource_type") == "battery":
            site_id = str(product["energy_site_id"])
            ssm.put_parameter(Name=_CACHED_SITE_ID_PARAM, Value=site_id, Type="String", Overwrite=True)
            return site_id
    raise ValueError("No Tesla energy site found on this account")


def _parse_smart_breaker_history(smart_breaker: list, year: int) -> list:
    """
    Parse SmartBreakerEnergyLogs (Tesla Smart Electrical Panel response) into
    monthly energy totals. Each entry represents one circuit for one month.
    We log names for debugging and aggregate solar/grid circuits by label.
    """
    from collections import defaultdict
    names_seen = set()
    by_month: dict = defaultdict(lambda: {"solar_to_home_kwh": 0.0, "grid_imported_kwh": 0.0})
    for entry in smart_breaker:
        ts = entry.get("timestamp", entry.get("month", ""))
        try:
            month = int(str(ts)[5:7])
        except (ValueError, IndexError):
            continue
        name = (entry.get("name") or entry.get("circuit_name") or "").lower()
        names_seen.add(name)
        solar = float(entry.get("consumer_energy_imported_from_solar", entry.get("solar_energy_exported", 0)) or 0)
        grid = float(entry.get("consumer_energy_imported_from_grid", entry.get("grid_energy_imported", 0)) or 0)
        if "solar" in name:
            by_month[month]["solar_to_home_kwh"] += solar
        if "grid" in name or solar == 0:
            by_month[month]["grid_imported_kwh"] += grid
    _log.info(f"SmartBreakerEnergyLogs circuit names seen: {names_seen}")
    results = []
    for month, totals in sorted(by_month.items()):
        results.append({"year": year, "month": month,
                        "solar_to_home_kwh": round(totals["solar_to_home_kwh"], 1),
                        "grid_imported_kwh": round(totals["grid_imported_kwh"], 1)})
    return results


def get_energy_history_monthly(site_id: str, year: int) -> list:
    """
    Fetch monthly energy totals for a given year from Tesla's calendar_history API.
    Returns list of dicts with: year, month, solar_to_home_kwh, grid_imported_kwh.
    Tesla fields used:
      consumer_energy_imported_from_solar  → solar used at home (kWh)
      consumer_energy_imported_from_grid   → grid drawn to home (kWh)
    """
    resp = requests.get(
        f"{TESLA_API_BASE}/energy_sites/{site_id}/calendar_history",
        headers=_headers(),
        params={
            "kind": "energy",
            "period": "month",
            "start_date": f"{year}-01-01T00:00:00Z",
            "end_date": f"{year}-12-31T23:59:59Z",
            "time_zone": "America/Los_Angeles",
        },
        timeout=20,
    )
    resp.raise_for_status()
    raw = resp.json()
    _log.info(f"Tesla calendar_history raw keys: {list(raw.keys())}")
    response_body = raw.get("response", {})
    _log.info(f"Tesla calendar_history response keys: {list(response_body.keys()) if isinstance(response_body, dict) else type(response_body)}")
    time_series = response_body.get("time_series", [])
    smart_breaker = response_body.get("SmartBreakerEnergyLogs", [])
    _log.info(f"Tesla calendar_history: time_series={len(time_series)}, SmartBreakerEnergyLogs={len(smart_breaker) if isinstance(smart_breaker, list) else type(smart_breaker)}")
    if smart_breaker and isinstance(smart_breaker, list):
        _log.info(f"SmartBreakerEnergyLogs first entry: {smart_breaker[0]}")
    if not time_series and smart_breaker:
        return _parse_smart_breaker_history(smart_breaker, year)
    results = []
    for entry in time_series:
        ts = entry.get("timestamp", "")
        try:
            month = int(ts[5:7])
        except (ValueError, IndexError):
            continue
        results.append({
            "year": year,
            "month": month,
            "solar_to_home_kwh": round(float(entry.get("consumer_energy_imported_from_solar", 0)), 1),
            "grid_imported_kwh": round(float(entry.get("consumer_energy_imported_from_grid", 0)), 1),
        })
    return results


def get_energy_data(site_id: str) -> dict:
    """
    Returns:
        solar_power_w: current solar generation in watts
        battery_power_w: positive = charging, negative = discharging
        load_power_w: current home consumption in watts (excludes car if on separate circuit)
        grid_power_w: positive = importing, negative = exporting
        battery_percentage: 0-100
        grid_status: 'Active' | 'Inactive'
    """
    resp = requests.get(
        f"{TESLA_API_BASE}/energy_sites/{site_id}/live_status",
        headers=_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    d = resp.json()["response"]
    return {
        "solar_power_w": d.get("solar_power", 0),
        "battery_power_w": d.get("battery_power", 0),
        "load_power_w": d.get("load_power", 0),
        "grid_power_w": d.get("grid_power", 0),
        "battery_percentage": d.get("percentage_charged", 0),
        "grid_status": d.get("grid_status", "Unknown"),
        "timestamp": d.get("timestamp"),
    }


def get_battery_config(site_id: str) -> dict:
    resp = requests.get(
        f"{TESLA_API_BASE}/energy_sites/{site_id}/site_info",
        headers=_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    d = resp.json()["response"]
    return {
        "backup_reserve_percent": d.get("backup_reserve_percent", 20),
        "operation_mode": d.get("default_real_mode", "self_consumption"),
    }


def set_battery_reserve(site_id: str, reserve_percent: int) -> None:
    requests.post(
        f"{TESLA_API_BASE}/energy_sites/{site_id}/backup",
        headers=_headers(),
        json={"backup_reserve_percent": reserve_percent},
        timeout=15,
    ).raise_for_status()


# ── Vehicle ──────────────────────────────────────────────────────────────────

def get_vehicle_id() -> str:
    try:
        return _get_param(_CACHED_VEHICLE_ID_PARAM)
    except ssm.exceptions.ParameterNotFound:
        pass
    resp = requests.get(f"{TESLA_API_BASE}/vehicles", headers=_headers(), timeout=15)
    resp.raise_for_status()
    vehicles = resp.json().get("response", [])
    if not vehicles:
        raise ValueError("No Tesla vehicles found on this account")
    vehicle_id = str(vehicles[0]["id"])
    ssm.put_parameter(Name=_CACHED_VEHICLE_ID_PARAM, Value=vehicle_id, Type="String", Overwrite=True)
    return vehicle_id


def get_vehicle_vin() -> str:
    """Return VIN — required by tesla-http-proxy (proxy rejects numeric Fleet API IDs)."""
    cached = _get_param("/energyapp/tesla/vehicle_vin") if _vin_cached() else None
    if cached:
        return cached
    resp = requests.get(f"{TESLA_API_BASE}/vehicles", headers=_headers(), timeout=15)
    resp.raise_for_status()
    vehicles = resp.json().get("response", [])
    if not vehicles:
        raise ValueError("No Tesla vehicles found on this account")
    vin = vehicles[0]["vin"]
    ssm.put_parameter(Name="/energyapp/tesla/vehicle_vin", Value=vin, Type="String", Overwrite=True)
    return vin


def _vin_cached() -> bool:
    try:
        ssm.get_parameter(Name="/energyapp/tesla/vehicle_vin")
        return True
    except ssm.exceptions.ParameterNotFound:
        return False


def get_vehicle_charge_state(vehicle_id: str) -> dict:
    """Return charge state WITHOUT waking the vehicle.
    Raises RuntimeError('asleep') if vehicle is asleep — caller should use prev state."""
    resp = requests.get(
        f"{TESLA_API_BASE}/vehicles/{vehicle_id}/vehicle_data",
        headers=_headers(),
        params={"endpoints": "charge_state"},
        timeout=30,
    )
    if resp.status_code in (408, 504):
        raise RuntimeError("asleep")
    resp.raise_for_status()
    cs = resp.json()["response"]["charge_state"]
    return {
        "battery_level": cs.get("battery_level", 0),
        "charge_limit_soc": cs.get("charge_limit_soc", 80),
        "charging_state": cs.get("charging_state", "Disconnected"),
        "charge_rate_mph": cs.get("charge_rate", 0),
        "charge_power_w": cs.get("charger_power", 0) * 1000,
        "minutes_to_full_charge": cs.get("minutes_to_full_charge", 0),
        "plugged_in": cs.get("charging_state") != "Disconnected",
    }


def _wake_vehicle(vehicle_id: str, timeout_s: int = 30) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        resp = requests.get(
            f"{TESLA_API_BASE}/vehicles/{vehicle_id}",
            headers=_headers(),
            timeout=15,
        )
        state = resp.json().get("response", {}).get("state", "offline")
        if state == "online":
            return
        requests.post(
            f"{TESLA_API_BASE}/vehicles/{vehicle_id}/wake_up",
            headers=_headers(),
            timeout=15,
        )
        time.sleep(5)



_PROXY_SRC = "/var/task/bin/tesla-http-proxy"
_PROXY_BIN = "/tmp/tesla-http-proxy"
_CMD_KEY_FILE = "/tmp/tesla_cmd_key.pem"
_TLS_KEY_FILE = "/tmp/tesla_tls_key.pem"
_TLS_CERT_FILE = "/tmp/tesla_tls_cert.pem"


def _ensure_proxy_files() -> None:
    if not os.path.exists(_PROXY_BIN):
        import shutil
        shutil.copy2(_PROXY_SRC, _PROXY_BIN)
        os.chmod(_PROXY_BIN, 0o755)
    if not os.path.exists(_CMD_KEY_FILE):
        with open(_CMD_KEY_FILE, "w") as f:
            f.write(_get_param("/energyapp/tesla/private_key"))
    if not os.path.exists(_TLS_KEY_FILE):
        with open(_TLS_KEY_FILE, "w") as f:
            f.write(_get_param("/energyapp/tesla/proxy_tls_key"))
    if not os.path.exists(_TLS_CERT_FILE):
        with open(_TLS_CERT_FILE, "w") as f:
            f.write(_get_param("/energyapp/tesla/proxy_tls_cert"))


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def _vehicle_command(vehicle_id: str, command: str, body: dict = None) -> bool:
    """Send a vehicle command via the Tesla HTTP proxy subprocess (TVCP signing)."""
    _ensure_proxy_files()
    vin = get_vehicle_vin()

    port = _free_port()
    proxy = subprocess.Popen(
        [_PROXY_BIN,
         "-key-file", _CMD_KEY_FILE,
         "-tls-key", _TLS_KEY_FILE,
         "-cert", _TLS_CERT_FILE,
         "-port", str(port),
         "-host", "127.0.0.1"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        time.sleep(1)
        resp = requests.post(
            f"https://127.0.0.1:{port}/api/1/vehicles/{vin}/command/{command}",
            headers=_headers(),
            json=body or {},
            timeout=30,
            verify=False,
        )
        if resp.status_code == 403:
            _log.warning(f"Vehicle command '{command}' denied (403)")
            return False
        resp.raise_for_status()
        return resp.json().get("response", {}).get("result", True)
    except Exception as e:
        _log.error(f"Vehicle command '{command}' failed: {e}")
        stderr_out = proxy.stderr.read().decode(errors="replace") if proxy.stderr else ""
        if stderr_out:
            _log.error(f"Proxy stderr: {stderr_out[:500]}")
        return False
    finally:
        proxy.terminate()
        proxy.wait(timeout=5)


def start_charging(vehicle_id: str) -> bool:
    return _vehicle_command(vehicle_id, "charge_start")


def stop_charging(vehicle_id: str) -> bool:
    return _vehicle_command(vehicle_id, "charge_stop")


def set_charge_amps(vehicle_id: str, amps: int) -> bool:
    return _vehicle_command(vehicle_id, "set_charging_amps", {"charging_amps": max(0, min(amps, 48))})


def set_charge_limit(vehicle_id: str, limit_percent: int) -> bool:
    return _vehicle_command(vehicle_id, "set_charge_limit", {"percent": limit_percent})
