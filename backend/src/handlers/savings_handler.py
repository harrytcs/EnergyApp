"""
GET /savings
Returns MTD, YTD, and monthly breakdown of solar-to-home usage and grid draw.

Data sources:
  - Current + recent months: DynamoDB 5-min readings (90-day TTL, ~precise)
  - Historical (Jul 2025 - Feb 2026): seeded from Tesla app + SCE bills
    solar_to_home_kwh = Solar production - To Grid (what was used locally)
    grid_imported_kwh = From Grid
DynamoDB data takes priority over seeded data for any month where readings exist.
"""
import json
import logging
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Attr
from models.energy_data import readings_table

logger = logging.getLogger()
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Type": "application/json",
}
RATE_PER_KWH = 0.25  # SCE TOU-D-PRIME average buy rate (from contract docs)
INTERVAL_H = 5 / 60   # each reading = 5 minutes

# Historical data from Tesla app + SCE bills (Jul 2025 - Feb 2026)
# solar_to_home_kwh = Solar(kWh) - To Grid(kWh)
# grid_imported_kwh = From Grid(kWh)
SEEDED_MONTHS = [
    {"year": 2025, "month": 7,  "solar_to_home_kwh": 404.2, "grid_imported_kwh": 186.7},
    {"year": 2025, "month": 8,  "solar_to_home_kwh": 271.2, "grid_imported_kwh": 880.1},
    {"year": 2025, "month": 9,  "solar_to_home_kwh": 523.5, "grid_imported_kwh": 621.4},
    {"year": 2025, "month": 10, "solar_to_home_kwh": 657.1, "grid_imported_kwh": 420.2},
    {"year": 2025, "month": 11, "solar_to_home_kwh": 464.9, "grid_imported_kwh": 708.2},
    {"year": 2025, "month": 12, "solar_to_home_kwh": 450.3, "grid_imported_kwh": 483.5},
    {"year": 2026, "month": 1,  "solar_to_home_kwh": 529.6, "grid_imported_kwh": 533.0},
    {"year": 2026, "month": 2,  "solar_to_home_kwh": 576.9, "grid_imported_kwh": 415.8},
]


def _response(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps(body)}


def handler(event, context):
    try:
        now_dt = datetime.now(timezone.utc)
        current_year = now_dt.year
        current_month = now_dt.month

        year_start = int(datetime(current_year, 1, 1, tzinfo=timezone.utc).timestamp())
        mtd_start = int(datetime(current_year, current_month, 1, tzinfo=timezone.utc).timestamp())

        # ── 1. Scan all DynamoDB readings this year (90-day TTL) ─────────────
        items = []
        kwargs = {"FilterExpression": Attr("timestamp").gte(year_start)}
        while True:
            resp = readings_table().scan(**kwargs)
            items.extend(resp.get("Items", []))
            if "LastEvaluatedKey" not in resp:
                break
            kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

        logger.info(f"DynamoDB: {len(items)} readings this year")

        # ── 2. Group DynamoDB readings by (year, month) ───────────────────────
        by_month: dict = {}
        mtd_solar = 0.0
        mtd_grid = 0.0

        for item in items:
            ts = int(item.get("timestamp", 0))
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            key = (dt.year, dt.month)
            solar_w = float(item.get("solar_power_w", 0))
            grid_w = float(item.get("grid_power_w", 0))
            solar_to_home = max(0.0, solar_w - max(0.0, -grid_w)) * INTERVAL_H / 1000
            grid_import = max(0.0, grid_w) * INTERVAL_H / 1000

            if key not in by_month:
                by_month[key] = {"solar_to_home_kwh": 0.0, "grid_imported_kwh": 0.0}
            by_month[key]["solar_to_home_kwh"] += solar_to_home
            by_month[key]["grid_imported_kwh"] += grid_import

            if ts >= mtd_start:
                mtd_solar += solar_to_home
                mtd_grid += grid_import

        # ── 3. Fill gaps with seeded historical data ──────────────────────────
        for seed in SEEDED_MONTHS:
            key = (seed["year"], seed["month"])
            if key not in by_month:
                by_month[key] = {
                    "solar_to_home_kwh": seed["solar_to_home_kwh"],
                    "grid_imported_kwh": seed["grid_imported_kwh"],
                }

        # ── 4. MTD from DynamoDB ──────────────────────────────────────────────
        mtd = {
            "solar_to_home_kwh": round(mtd_solar, 1),
            "grid_imported_kwh": round(mtd_grid, 1),
            "savings_usd": round(mtd_solar * RATE_PER_KWH, 2),
        }

        # ── 5. YTD = current year only ────────────────────────────────────────
        ytd_solar = sum(v["solar_to_home_kwh"] for (y, _), v in by_month.items() if y == current_year)
        ytd_grid = sum(v["grid_imported_kwh"] for (y, _), v in by_month.items() if y == current_year)
        ytd = {
            "solar_to_home_kwh": round(ytd_solar, 1),
            "grid_imported_kwh": round(ytd_grid, 1),
            "savings_usd": round(ytd_solar * RATE_PER_KWH, 2),
        }

        # ── 6. All months sorted for chart ────────────────────────────────────
        monthly = sorted([
            {
                "year": y,
                "month": m,
                "solar_to_home_kwh": round(v["solar_to_home_kwh"], 1),
                "grid_imported_kwh": round(v["grid_imported_kwh"], 1),
                "savings_usd": round(v["solar_to_home_kwh"] * RATE_PER_KWH, 2),
            }
            for (y, m), v in by_month.items()
        ], key=lambda x: (x["year"], x["month"]))

        return _response(200, {"mtd": mtd, "ytd": ytd, "monthly": monthly})

    except Exception as e:
        logger.error(f"Savings error: {e}", exc_info=True)
        return _response(500, {"error": str(e)})
