"""
Lambda handler for historical data queries.
GET /history?hours=24&metric=solar_power_w  — returns time-series for charting
"""
import json
import logging
from decimal import Decimal
from models.energy_data import get_readings

logger = logging.getLogger()
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Type": "application/json",
}

VALID_METRICS = [
    "solar_power_w", "battery_power_w", "load_power_w", "grid_power_w",
    "battery_percentage", "car_battery_level", "car_charge_power_w",
    "hvac_current_temp_f", "solar_surplus_w", "cost_savings_usd",
]


def _decimal_default(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    return str(obj)


def _response(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps(body, default=_decimal_default)}


def handler(event, context):
    try:
        query = event.get("queryStringParameters") or {}
        hours = min(int(query.get("hours", 24)), 168)
        metrics = query.get("metrics", "solar_power_w,battery_percentage,load_power_w").split(",")
        metrics = [m for m in metrics if m in VALID_METRICS]

        if not metrics:
            return _response(400, {"error": f"No valid metrics. Valid: {VALID_METRICS}"})

        readings = get_readings(hours_back=hours)

        # Return compact time-series: {metric: [values], timestamps: [...]}
        timestamps = [int(r["timestamp"]) for r in readings]
        series = {
            metric: [float(r.get(metric, 0)) for r in readings]
            for metric in metrics
        }

        return _response(200, {
            "timestamps": timestamps,
            "series": series,
            "count": len(readings),
            "hours": hours,
        })

    except Exception as e:
        logger.error(f"History error: {e}", exc_info=True)
        return _response(500, {"error": str(e)})
