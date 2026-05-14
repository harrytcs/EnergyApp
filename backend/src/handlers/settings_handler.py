"""
Lambda handler for settings API.
GET  /settings       — fetch user settings
PUT  /settings       — update user settings (notifications, overrides, thresholds)
POST /settings/override — apply a manual override (car force charge, hvac force on, etc.)
"""
import json
import logging
from decimal import Decimal
from models.energy_data import get_settings, save_settings

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


def _to_decimal(obj):
    """Recursively convert floats/ints to Decimal for DynamoDB storage."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_decimal(v) for v in obj]
    return obj


def _response(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps(body, default=_decimal_default)}


def _user_id(event: dict) -> str:
    authorizer = event.get("requestContext", {}).get("authorizer", {})
    # HTTP API v2 puts claims under jwt.claims; v1 puts them directly under authorizer
    claims = authorizer.get("jwt", {}).get("claims") or authorizer.get("claims") or {}
    return claims.get("sub", "default")


def handler(event, context):
    # HTTP API v2 puts method/path inside requestContext.http; v1 puts them at root
    http_ctx = event.get("requestContext", {}).get("http", {})
    method = event.get("httpMethod") or http_ctx.get("method", "GET")
    path = event.get("path") or http_ctx.get("path", "/settings")

    try:
        user_id = _user_id(event)
        settings = get_settings(user_id)

        if method == "GET":
            return _response(200, settings)

        if method == "PUT":
            body = json.loads(event.get("body") or "{}")
            # Deep merge — only update keys that are sent
            for key, value in body.items():
                if key in settings and isinstance(settings[key], dict) and isinstance(value, dict):
                    settings[key].update(value)
                else:
                    settings[key] = value
            save_settings(_to_decimal(settings), user_id)
            return _response(200, settings)

        if method == "POST" and path.endswith("/override"):
            body = json.loads(event.get("body") or "{}")
            override_type = body.get("type")
            enabled = body.get("enabled", False)

            valid_overrides = ["car_force_charge", "hvac_force_on", "automation_paused"]
            if override_type not in valid_overrides:
                return _response(400, {"error": f"Invalid override type. Valid: {valid_overrides}"})

            settings["overrides"][override_type] = enabled
            save_settings(_to_decimal(settings), user_id)
            return _response(200, {
                "message": f"Override '{override_type}' set to {enabled}",
                "overrides": settings["overrides"],
            })

        return _response(405, {"error": "Method not allowed"})

    except Exception as e:
        logger.error(f"Settings error: {e}", exc_info=True)
        return _response(500, {"error": str(e)})
