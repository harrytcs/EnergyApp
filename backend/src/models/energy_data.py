"""
DynamoDB data models for storing energy readings and app state.
"""
import time
from dataclasses import dataclass, asdict
from typing import Optional
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")


# ── Tables ───────────────────────────────────────────────────────────────────

def readings_table():
    return dynamodb.Table("energyapp_readings")


def settings_table():
    return dynamodb.Table("energyapp_settings")


def state_table():
    return dynamodb.Table("energyapp_state")


# ── Reading model ─────────────────────────────────────────────────────────────

@dataclass
class EnergyReading:
    timestamp: int          # Unix epoch seconds (partition key)
    solar_power_w: float
    battery_power_w: float  # Tesla convention: negative=charging, positive=discharging
    load_power_w: float      # total load including car (from Tesla Gateway)
    home_load_w: float       # load_power_w minus car charging — pure house consumption
    grid_power_w: float      # positive=importing, negative=exporting
    battery_percentage: float
    car_battery_level: int
    car_charging_state: str
    car_charge_power_w: float
    hvac_status: str
    hvac_current_temp_f: float
    hvac_setpoint_f: float
    hvac_mode: str
    solar_surplus_w: float  # solar - load - battery_charging (when positive)
    cost_savings_usd: float # estimated savings vs grid import at TOU rate


def _to_dynamo(v):
    if isinstance(v, float):
        return Decimal(str(round(v, 4)))
    if isinstance(v, dict):
        return {k: _to_dynamo(val) for k, val in v.items()}
    if isinstance(v, list):
        return [_to_dynamo(i) for i in v]
    return v


def save_reading(reading: EnergyReading) -> None:
    readings_table().put_item(Item={
        "timestamp": reading.timestamp,
        "date": time.strftime("%Y-%m-%d", time.gmtime(reading.timestamp)),
        **{k: _to_dynamo(v) for k, v in asdict(reading).items() if k != "timestamp"},
    })


def get_readings(hours_back: int = 24) -> list:
    from boto3.dynamodb.conditions import Attr
    since = int(time.time()) - hours_back * 3600
    items = []
    kwargs = {
        "FilterExpression": Attr("timestamp").gte(since),
        "Limit": 1000,
    }
    while True:
        resp = readings_table().scan(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return sorted(items, key=lambda x: int(x["timestamp"]), reverse=True)


def get_latest_reading() -> Optional[dict]:
    from boto3.dynamodb.conditions import Attr
    # Look back 2 hours; no Limit so DynamoDB evaluates all matching items
    since = int(time.time()) - 7200
    items = []
    kwargs = {"FilterExpression": Attr("timestamp").gte(since)}
    while True:
        resp = readings_table().scan(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    if not items:
        return None
    return max(items, key=lambda x: int(x["timestamp"]))


# ── Settings model ────────────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    "automation_enabled": True,
    "car_charge_limit_percent": 90,
    "hvac_cool_setpoint_f": 76.0,
    "hvac_heat_setpoint_f": 68.0,
    "min_surplus_for_car_w": 1500,      # don't start car charging below this surplus
    "min_surplus_for_hvac_w": 1000,     # don't start HVAC below this surplus
    "powerwall_full_threshold": 98,     # treat as full above this %
    "priority_order": ["powerwall", "car", "hvac"],  # order surplus is allocated
    "latitude": None,
    "longitude": None,
    "notifications": {
        "car_charging_started": True,
        "car_charging_stopped": True,
        "car_fully_charged": True,
        "powerwall_low": True,
        "powerwall_low_threshold": 20,
        "hvac_solar_activated": True,
        "solar_low": True,
        "solar_low_threshold_w": 200,
    },
    "overrides": {
        "car_force_charge": False,
        "hvac_force_on": False,
        "automation_paused": False,
        "car_trip_mode": False,
        "car_trip_target_percent": 100,
    },
}


def get_settings(user_id: str = "default") -> dict:
    resp = settings_table().get_item(Key={"user_id": user_id})
    item = resp.get("Item")
    if not item and user_id == "default":
        # Single-user app: fall back to the first stored settings item (Cognito sub key)
        scan = settings_table().scan(Limit=1)
        items = scan.get("Items", [])
        item = items[0] if items else None
    if not item:
        return DEFAULT_SETTINGS.copy()
    return {**DEFAULT_SETTINGS, **item.get("settings", {})}


def save_settings(settings: dict, user_id: str = "default") -> None:
    settings_table().put_item(Item={"user_id": user_id, "settings": settings})


# ── Automation state ──────────────────────────────────────────────────────────

def get_automation_state() -> dict:
    resp = state_table().get_item(Key={"state_key": "current"})
    return resp.get("Item", {})


def save_automation_state(state: dict) -> None:
    state_table().put_item(Item=_to_dynamo({"state_key": "current", **state}))
