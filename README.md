# EnergyApp

A fully automated home energy management system that orchestrates solar production, Tesla Powerwall, Tesla vehicle charging, and Nest thermostats — running 24/7 on AWS for ~$0.50/month.

> **Built entirely with Claude AI** — every line of code was generated through natural language prompts. No prior software development experience required.

---

## What It Does

Solar panels, a Powerwall, a Tesla car, and Nest thermostats don't talk to each other by default. EnergyApp connects them all and makes automated decisions every 5 minutes:

- **Charges the Tesla on solar surplus** — starts charging when surplus exceeds the car's minimum draw, throttles amps to match available solar, stops when solar drops
- **Runs HVAC on solar surplus** — activates Nest thermostats only when enough surplus remains after the car's needs are met
- **Protects the Powerwall** — never lets HVAC or car charging drain the battery; Powerwall charges passively first
- **Enforces a strict priority chain** — home loads → Powerwall → car → HVAC → grid export
- **Monitors everything in real time** — live dashboard shows power flow, savings, and system health

---

## Hardware Requirements

| Device | Purpose |
|--------|---------|
| Solar panels (any inverter) | Energy source |
| Tesla Powerwall | Home battery + gateway |
| Tesla vehicle | Managed charging target |
| Google Nest thermostat(s) | Managed HVAC target |
| Enphase (or Tesla solar) | Solar production data |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AWS (free tier)                       │
│                                                         │
│  EventBridge (every 5 min)                              │
│       │                                                 │
│       ▼                                                 │
│  Lambda: Automation Engine                              │
│       │                                                 │
│       ├── Tesla Fleet API ──► Powerwall live status     │
│       ├── Tesla Fleet API ──► Vehicle charge state      │
│       ├── Nest SDM API    ──► Thermostat state          │
│       │                                                 │
│       ├── Priority logic (car → HVAC → export)          │
│       │                                                 │
│       ├── Tesla Fleet API ──► Set charge amps / start   │
│       ├── Nest SDM API    ──► Set mode / setpoint       │
│       │                                                 │
│       └── DynamoDB ◄──────── Save reading + state       │
│                                                         │
│  Lambda: REST API  ◄──── API Gateway ◄──── Frontend     │
│       └── DynamoDB (readings, settings, state)          │
│                                                         │
│  Cognito ──► JWT auth for all API calls                 │
└─────────────────────────────────────────────────────────┘

Frontend (React Native / Expo)
  ├── Web app hosted on Netlify
  ├── iOS / Android via Expo Go
  └── Real-time dashboard, controls, savings tracking
```

---

## Tech Stack

### Backend (AWS)
| Component | Technology |
|-----------|-----------|
| Automation engine | AWS Lambda (Python 3.12) |
| Scheduling | Amazon EventBridge (every 5 min) |
| Data storage | Amazon DynamoDB (time-series readings) |
| Secrets | AWS SSM Parameter Store (all API keys) |
| API | Amazon API Gateway (HTTP API) |
| Auth | Amazon Cognito (JWT) |
| Notifications | Amazon SNS |
| Infrastructure | AWS SAM (CloudFormation) |

### Frontend
| Component | Technology |
|-----------|-----------|
| Framework | React Native (Expo SDK 51) |
| Routing | Expo Router |
| Charts | react-native-gifted-charts |
| Auth | AWS Amplify + Cognito |
| Hosting (web) | Netlify |

### External APIs
| API | Purpose |
|-----|---------|
| Tesla Fleet API | Powerwall live status, vehicle charge state, charging commands |
| Google Nest SDM API | Thermostat state, mode control, setpoint control |
| Enphase Enlighten API | Solar production data |

---

## Priority Chain

Every 5-minute cycle the engine evaluates surplus solar and acts in this order:

```
1. Home loads        — always served first (handled passively by Tesla Gateway)
2. Powerwall         — charges to 100% before anything else runs
3. Car charging      — gets all remaining surplus; throttles amps to match
4. HVAC              — activates only when enough surplus remains after car
5. Grid export       — whatever is left flows to the grid
```

**Key rules:**
- Car gets priority over HVAC — when the car is plugged in and not full, HVAC is shut off
- HVAC never runs on Powerwall — shuts off if grid draw or battery discharge is detected
- Car charging amps are adjusted dynamically every cycle to track solar production
- Manual overrides are available via the Settings screen for any device

---

## Project Structure

```
EnergyApp/
├── backend/
│   ├── src/
│   │   ├── automation/
│   │   │   └── engine.py          # Core priority logic (runs every 5 min)
│   │   ├── clients/
│   │   │   ├── tesla_client.py    # Tesla Fleet API + vehicle command proxy
│   │   │   └── nest_client.py     # Google Nest SDM API
│   │   ├── handlers/
│   │   │   ├── automation_handler.py
│   │   │   ├── dashboard_handler.py
│   │   │   ├── history_handler.py
│   │   │   ├── savings_handler.py
│   │   │   └── settings_handler.py
│   │   ├── models/
│   │   │   └── energy_data.py     # DynamoDB models + read/write helpers
│   │   └── utils/
│   │       └── solar_eta.py       # ETA calculations (Powerwall full, car full)
│   ├── scripts/
│   │   ├── tesla_auth.py          # One-time Tesla OAuth token setup
│   │   └── nest_auth.py           # One-time Nest OAuth token setup
│   ├── template.yaml              # AWS SAM infrastructure definition
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── (auth)/login.tsx
│   │   └── (tabs)/
│   │       ├── index.tsx          # Dashboard — live power flow + metrics
│   │       ├── car.tsx            # Tesla charging controls + history
│   │       ├── hvac.tsx           # Thermostat status + override
│   │       ├── powerwall.tsx      # Battery status + history
│   │       ├── solar.tsx          # Solar production + history
│   │       └── settings.tsx       # Automation settings + overrides
│   ├── components/
│   │   ├── PowerFlowDiagram.tsx   # Animated live power flow visualization
│   │   └── MetricCard.tsx
│   ├── services/
│   │   ├── api.ts                 # All API calls to backend
│   │   └── auth.ts                # Cognito sign-in/sign-up
│   └── constants/theme.ts
├── docs/
│   └── SETUP.md                   # Detailed step-by-step setup guide
└── .gitignore
```

---

## Setup

See **[docs/SETUP.md](docs/SETUP.md)** for the full step-by-step guide (~2-3 hours).

### High-level steps:

**1. Prerequisites**
```bash
brew install awscli aws-sam-cli node python@3.12
npm install -g expo-cli eas-cli
aws configure   # enter your AWS credentials
```

**2. Store secrets in AWS SSM**
```bash
# Tesla
aws ssm put-parameter --name "/energyapp/tesla/client_id" --value "YOUR_ID" --type "SecureString"
aws ssm put-parameter --name "/energyapp/tesla/client_secret" --value "YOUR_SECRET" --type "SecureString"

# Nest
aws ssm put-parameter --name "/energyapp/nest/client_id" --value "YOUR_ID" --type "SecureString"
aws ssm put-parameter --name "/energyapp/nest/client_secret" --value "YOUR_SECRET" --type "SecureString"
aws ssm put-parameter --name "/energyapp/nest/project_id" --value "YOUR_PROJECT_ID" --type "SecureString"
```

**3. Authorize OAuth (one-time)**
```bash
python3 backend/scripts/tesla_auth.py   # opens browser to authorize Tesla
python3 backend/scripts/nest_auth.py    # opens browser to authorize Nest
```

**4. Install Python dependencies and deploy backend**
```bash
cd backend
pip3 install -r requirements.txt -t src/
sam build && sam deploy --guided
```

**5. Configure and run frontend**
```bash
cd frontend
npm install
cp .env.example .env
# Fill in .env with the API URL and Cognito IDs from sam deploy outputs
npx expo start --web
```

---

## Configuration

All settings are stored in DynamoDB and controllable via the Settings screen in the app:

| Setting | Default | Description |
|---------|---------|-------------|
| `min_surplus_for_car_w` | 1400W | Minimum solar surplus to start car charging |
| `min_surplus_for_hvac_w` | 2000W | Minimum surplus to activate first thermostat |
| `car_charge_limit_percent` | 80% | Daily charge limit (set higher for trips) |
| `powerwall_full_threshold` | 98% | % at which Powerwall is considered "full" |
| `hvac_cool_setpoint_f` | 70°F | Thermostat target when activated by solar |
| `priority_order` | `[powerwall, car, hvac]` | Order of priority (adjustable) |

**Manual overrides** (toggleable in the app):
- **Force car charge** — charges at full speed regardless of solar
- **Trip mode** — charges to a custom % using grid power
- **Force HVAC on** — runs thermostats regardless of solar
- **Automation paused** — suspends all automation

---

## Monthly Cost

| Service | Est. Usage | Cost |
|---------|-----------|------|
| Lambda | ~8,760 invocations/month | Free tier |
| DynamoDB | ~50k reads + writes | Free tier |
| API Gateway | ~10k requests | Free tier |
| Cognito | 1 user | Free tier |
| SSM Parameter Store | 5 secure params | ~$0.50 |
| CloudWatch Logs | Minimal | Free tier |
| Tesla Fleet API | ~100 wakes/month (car charging days) | ~$2–5 |
| **Total** | | **~$2.50–5.50/month** |

> Tesla Fleet API is the only real cost. The automation avoids waking the car for read-only checks — the vehicle is only woken when a charging command is needed.

---

## Dashboard Screenshots

The dashboard shows:
- **Live power flow diagram** — animated arrows showing solar → home → battery → car → grid
- **6 metric tiles** — Solar (kW), Powerwall (%), Home Load (kW), Tesla (%), HVAC per thermostat
- **Today's summary** — solar used at home, grid draw, current surplus
- **Savings tracker** — MTD and YTD dollar savings with monthly bar chart
- **Stale data warning** — alerts when automation hasn't run in 15+ minutes

---

## Development Notes

**Running automation manually (test a single cycle):**
```bash
aws lambda invoke \
  --function-name energyapp-automation \
  --log-type Tail \
  response.json && cat response.json
```

**Tailing live Lambda logs:**
```bash
aws logs tail /aws/lambda/energyapp-automation --follow
```

**Redeploying after code changes:**
```bash
cd backend
sam build && sam deploy --no-confirm-changeset
```

**Resetting Tesla/Nest OAuth tokens:**
```bash
python3 backend/scripts/tesla_auth.py
python3 backend/scripts/nest_auth.py
```

> **Note on Nest OAuth:** Google OAuth tokens in "Testing" mode expire after 7 days. To prevent this, publish your Google OAuth app to "Production" in the Google Auth Platform console. No review is required for personal-use apps.

---

## Built With Claude AI

This project was built entirely through conversation with [Claude](https://claude.ai) — no prior Python, React Native, or AWS experience was used. The architecture, code, debugging, and deployment were all guided by describing the desired behavior in plain English.

Every file in this repository was written by Claude based on natural language descriptions of what the system should do.
