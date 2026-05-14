"""
Google Nest Smart Device Management (SDM) API client.
Controls and reads the Nest thermostat.
"""
import json
import time
import boto3
import requests
from typing import Optional

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
SDM_BASE = "https://smartdevicemanagement.googleapis.com/v1"

ssm = boto3.client("ssm")


def _get_param(name: str) -> str:
    resp = ssm.get_parameter(Name=name, WithDecryption=True)
    return resp["Parameter"]["Value"]


def _get_tokens() -> dict:
    raw = _get_param("/energyapp/nest/tokens")
    return json.loads(raw)


def _save_tokens(tokens: dict) -> None:
    ssm.put_parameter(
        Name="/energyapp/nest/tokens",
        Value=json.dumps(tokens),
        Type="SecureString",
        Overwrite=True,
    )


def _refresh_access_token() -> str:
    tokens = _get_tokens()
    if tokens.get("expires_at", 0) - time.time() > 300:
        return tokens["access_token"]

    resp = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": _get_param("/energyapp/nest/client_id"),
            "client_secret": _get_param("/energyapp/nest/client_secret"),
            "refresh_token": tokens["refresh_token"],
            "grant_type": "refresh_token",
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    tokens["access_token"] = data["access_token"]
    tokens["expires_at"] = time.time() + data.get("expires_in", 3600) - 60
    _save_tokens(tokens)
    return tokens["access_token"]


def _headers() -> dict:
    return {"Authorization": f"Bearer {_refresh_access_token()}"}


def _project_id() -> str:
    return _get_param("/energyapp/nest/project_id")


def _get_devices() -> list:
    project_id = _project_id()
    resp = requests.get(
        f"{SDM_BASE}/enterprises/{project_id}/devices",
        headers=_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json().get("devices", [])


def get_thermostat_ids() -> list:
    """Returns thermostat device names sorted by room display name for consistent ordering."""
    devices = _get_devices()
    thermostats = [
        device for device in devices
        if "sdm.devices.types.THERMOSTAT" in device.get("type", "")
    ]
    # Sort by room display name so ordering is stable and meaningful
    def _room_name(device):
        relations = device.get("parentRelations", [])
        return relations[0].get("displayName", "") if relations else ""
    thermostats.sort(key=_room_name)
    import logging as _lg
    _lg.getLogger(__name__).info(f"Thermostat order: {[(_room_name(d), d['name'][-8:]) for d in thermostats]}")
    return [d["name"] for d in thermostats]


def get_thermostat_id() -> str:
    """Returns the first thermostat (kept for backwards compatibility)."""
    ids = get_thermostat_ids()
    if not ids:
        raise ValueError("No Nest thermostat found on this account")
    return ids[0]


def get_thermostat_state(device_name: str) -> dict:
    """
    Returns:
        current_temp_c: current temperature in Celsius
        current_temp_f: current temperature in Fahrenheit
        heat_setpoint_f: heating setpoint
        cool_setpoint_f: cooling setpoint
        mode: 'HEAT' | 'COOL' | 'HEATCOOL' | 'OFF'
        hvac_status: 'HEATING' | 'COOLING' | 'OFF'
        humidity_percent: relative humidity
        connectivity: 'ONLINE' | 'OFFLINE'
    """
    project_id = _project_id()
    resp = requests.get(
        f"{SDM_BASE}/enterprises/{project_id}/devices/{device_name.split('/')[-1]}",
        headers=_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    traits = data.get("traits", {})
    relations = data.get("parentRelations", [])
    room_name = relations[0].get("displayName", "") if relations else ""

    temp_c = traits.get("sdm.devices.traits.Temperature", {}).get("ambientTemperatureCelsius", 0)
    humidity = traits.get("sdm.devices.traits.Humidity", {}).get("ambientHumidityPercent", 0)
    mode_trait = traits.get("sdm.devices.traits.ThermostatMode", {})
    hvac_trait = traits.get("sdm.devices.traits.ThermostatHvac", {})
    setpoint_trait = traits.get("sdm.devices.traits.ThermostatTemperatureSetpoint", {})
    connectivity = traits.get("sdm.devices.traits.Connectivity", {}).get("status", "OFFLINE")

    def c_to_f(c):
        return round(c * 9 / 5 + 32, 1)

    return {
        "room_name": room_name,
        "current_temp_c": round(temp_c, 1),
        "current_temp_f": c_to_f(temp_c),
        "heat_setpoint_f": c_to_f(setpoint_trait.get("heatCelsius", 18)),
        "cool_setpoint_f": c_to_f(setpoint_trait.get("coolCelsius", 26)),
        "mode": mode_trait.get("mode", "OFF"),
        "hvac_status": hvac_trait.get("status", "OFF"),
        "humidity_percent": round(humidity),
        "connectivity": connectivity,
    }


def set_thermostat_mode(device_name: str, mode: str) -> None:
    """mode: 'HEAT' | 'COOL' | 'HEATCOOL' | 'OFF'"""
    project_id = _project_id()
    device_id = device_name.split("/")[-1]
    requests.post(
        f"{SDM_BASE}/enterprises/{project_id}/devices/{device_id}:executeCommand",
        headers=_headers(),
        json={
            "command": "sdm.devices.commands.ThermostatMode.SetMode",
            "params": {"mode": mode},
        },
        timeout=15,
    ).raise_for_status()


def set_cool_setpoint(device_name: str, temp_f: float) -> None:
    """Set cooling setpoint in Fahrenheit."""
    project_id = _project_id()
    device_id = device_name.split("/")[-1]
    temp_c = (float(temp_f) - 32) * 5 / 9
    requests.post(
        f"{SDM_BASE}/enterprises/{project_id}/devices/{device_id}:executeCommand",
        headers=_headers(),
        json={
            "command": "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool",
            "params": {"coolCelsius": round(temp_c, 1)},
        },
        timeout=15,
    ).raise_for_status()


def set_heat_setpoint(device_name: str, temp_f: float) -> None:
    """Set heating setpoint in Fahrenheit."""
    project_id = _project_id()
    device_id = device_name.split("/")[-1]
    temp_c = (temp_f - 32) * 5 / 9
    requests.post(
        f"{SDM_BASE}/enterprises/{project_id}/devices/{device_id}:executeCommand",
        headers=_headers(),
        json={
            "command": "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat",
            "params": {"heatCelsius": round(temp_c, 1)},
        },
        timeout=15,
    ).raise_for_status()
