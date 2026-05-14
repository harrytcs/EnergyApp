"""
Lambda handler for the dashboard API.
GET /dashboard  — returns latest snapshot + 24h history
"""
import json
import time
import logging
from decimal import Decimal
from models.energy_data import get_latest_reading, get_readings, get_settings, get_automation_state
from clients import nest_client

logger = logging.getLogger()
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Type": "application/json",
}


def _decimal_default(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    return str(obj)


def _build_response(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps(body, default=_decimal_default)}


def handler(event, context):
    try:
        query = event.get("queryStringParameters") or {}
        hours = int(query.get("hours", 24))
        hours = min(hours, 168)  # cap at 7 days

        latest = get_latest_reading()
        history = get_readings(hours_back=hours)
        settings = get_settings()
        automation_state = get_automation_state()
        try:
            thermostat_ids = nest_client.get_thermostat_ids()
            thermostats = [
                {"id": t_id, "index": i, **nest_client.get_thermostat_state(t_id)}
                for i, t_id in enumerate(thermostat_ids)
            ]
        except Exception as e:
            logger.warning(f"Live thermostat fetch failed, using cached: {e}")
            thermostats = automation_state.get("thermostats", [])
        events = {
            "car_charge_started_at": automation_state.get("car_charge_started_at"),
            "car_charge_stopped_at": automation_state.get("car_charge_stopped_at"),
            "hvac_activated_at": automation_state.get("hvac_activated_at"),
            "hvac_deactivated_at": automation_state.get("hvac_deactivated_at"),
            "last_automation_run": automation_state.get("last_run"),
            "powerwall_full_eta": automation_state.get("powerwall_full_eta"),
            "car_full_eta": automation_state.get("car_full_eta"),
        }

        # Aggregate cost savings over requested period
        total_savings = sum(
            float(r.get("cost_savings_usd", 0)) for r in history
        )

        # Compute daily solar total (kWh) from 5-min readings
        # Each reading covers 5 min = 1/12 hour
        solar_kwh = sum(
            float(r.get("solar_power_w", 0)) / 1000 / 12 for r in history
        )
        grid_imported_kwh = sum(
            max(0, float(r.get("grid_power_w", 0))) / 1000 / 12 for r in history
        )
        grid_exported_kwh = sum(
            max(0, -float(r.get("grid_power_w", 0))) / 1000 / 12 for r in history
        )

        return _build_response(200, {
            "latest": latest,
            "history": history,
            "summary": {
                "period_hours": hours,
                "solar_kwh": round(solar_kwh, 2),
                "grid_imported_kwh": round(grid_imported_kwh, 2),
                "grid_exported_kwh": round(grid_exported_kwh, 2),
                "cost_savings_usd": round(total_savings, 2),
            },
            "settings": {
                "automation_enabled": settings["automation_enabled"],
                "overrides": settings["overrides"],
                "car_charge_limit_percent": settings["car_charge_limit_percent"],
            },
            "thermostats": thermostats,
            "events": events,
            "generated_at": int(time.time()),
        })
    except Exception as e:
        logger.error(f"Dashboard error: {e}", exc_info=True)
        return _build_response(500, {"error": str(e)})
