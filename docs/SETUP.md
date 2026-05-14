# EnergyApp — Complete Setup Guide

Follow these steps **in order**. Each section must be completed before moving to the next.
Estimated total time: ~2–3 hours.

---

## Prerequisites

Install these tools on your Mac first:

```bash
# Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# AWS CLI
brew install awscli

# AWS SAM CLI (deploys Lambda functions)
brew tap aws/tap && brew install aws-sam-cli

# Node.js (for the frontend)
brew install node

# Expo CLI
npm install -g expo-cli eas-cli

# Python 3.12
brew install python@3.12
```

---

## Step 1 — AWS Account Setup

1. Go to https://aws.amazon.com and sign in to your existing account
2. In the top right, click your name → **Security credentials**
3. Under **Access keys**, click **Create access key**
4. Download the CSV — you'll need the key ID and secret

Configure the AWS CLI:
```bash
aws configure
# Enter: your Access Key ID
# Enter: your Secret Access Key
# Enter: us-west-2   (closest region to Torrance, CA)
# Enter: json
```

---

## Step 2 — Tesla Developer Account & Fleet API

### 2a. Register as a Tesla Developer
1. Go to https://developer.tesla.com
2. Click **Sign In** and log in with your Tesla account (harrytcs@gmail.com)
3. Click **Create Application**
4. Fill in:
   - **Application Name**: EnergyApp
   - **Application Description**: Personal solar & car automation
   - **Purpose**: Personal use
   - **Allowed Origin**: `https://auth.tesla.com/void/callback`
5. Save your **Client ID** and **Client Secret**

### 2b. Authorize your Tesla account
Run this Python script once to get your OAuth tokens:

```bash
cd /Users/humapathy/Documents/Personal/EnergyApp/backend
pip3 install requests
python3 scripts/tesla_auth.py
```

> This script will open a browser, have you log in to Tesla, and save your tokens to AWS SSM automatically.

### 2c. Store credentials in AWS SSM
```bash
# Replace YOUR_CLIENT_ID with the one from step 2a
aws ssm put-parameter \
  --name "/energyapp/tesla/client_id" \
  --value "YOUR_CLIENT_ID" \
  --type "SecureString"
```

---

## Step 3 — Google Nest Developer Account

### 3a. Create a Google Cloud project
1. Go to https://console.cloud.google.com
2. Click **New Project** → Name it "EnergyApp" → **Create**
3. In the left menu, go to **APIs & Services → Library**
4. Search for **Smart Device Management API** → Enable it

### 3b. Create OAuth credentials
1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth Client ID**
3. Choose **Web application**
4. Under **Authorized redirect URIs**, add: `https://nestservices.google.com/partnerconnections/YOUR_PROJECT_ID/auth`
5. Save your **Client ID** and **Client Secret**

### 3c. Create a Device Access project
1. Go to https://console.nest.google.com/device-access
2. Click **Create project** (one-time $5 fee from Google)
3. Name it "EnergyApp"
4. Enter your OAuth Client ID from step 3b
5. Enable **Events** → **Create project**
6. Save your **Project ID**

### 3d. Authorize your Nest account
```bash
python3 scripts/nest_auth.py
```

### 3e. Store credentials in AWS SSM
```bash
aws ssm put-parameter --name "/energyapp/nest/client_id" --value "YOUR_CLIENT_ID" --type "SecureString"
aws ssm put-parameter --name "/energyapp/nest/client_secret" --value "YOUR_CLIENT_SECRET" --type "SecureString"
aws ssm put-parameter --name "/energyapp/nest/project_id" --value "YOUR_PROJECT_ID" --type "SecureString"
```

---

## Step 4 — Deploy the Backend

```bash
cd /Users/humapathy/Documents/Personal/EnergyApp/backend

# Install Python dependencies into the Lambda layer
mkdir -p layer/python
pip3 install -r requirements.txt -t layer/python/

# Build and deploy (takes ~5 minutes first time)
sam build
sam deploy --guided
```

When prompted:
- **Stack name**: energyapp
- **Region**: us-west-2
- **Confirm changes**: Y
- **Allow SAM to create IAM roles**: Y
- **Save arguments to samconfig.toml**: Y

After deploy, copy the **Outputs** shown — you'll need:
- `ApiUrl` → your API Gateway URL
- `UserPoolId` → Cognito user pool ID
- `UserPoolClientId` → Cognito app client ID

---

## Step 5 — Set Up the Frontend

```bash
cd /Users/humapathy/Documents/Personal/EnergyApp/frontend

# Install dependencies
npm install

# Copy the env file and fill in your values from Step 4
cp .env.example .env
# Edit .env with the values from SAM deploy outputs
```

### Run locally (web browser):
```bash
npx expo start --web
```

### Run on iPhone:
1. Install **Expo Go** from the App Store
2. Run `npx expo start`
3. Scan the QR code with your iPhone camera

### Build for App Store (when ready):
```bash
# One-time: create an Expo account at expo.dev
eas login
eas build --platform ios
eas build --platform android
```

---

## Step 6 — Push Notifications

1. Go to https://expo.dev → create a free account
2. Run `eas credentials` to set up push notification certificates
3. In your app, the notification registration happens automatically on first login

---

## Step 7 — Verify Everything Works

1. Open the web app at http://localhost:8081
2. Create an account (the email verification code will be sent to your email)
3. Go to **Dashboard** — you should see live data within a few seconds
4. Check **Settings** → confirm automation is enabled
5. Watch the **Car** tab — within 5 minutes, the automation engine will run and adjust charging based on solar

---

## Troubleshooting

**No data on dashboard:**
- Check Lambda logs: `aws logs tail /aws/lambda/energyapp-automation --follow`
- Verify Tesla and Nest tokens are stored: `aws ssm get-parameters-by-path --path "/energyapp" --with-decryption`

**Car not charging on solar:**
- Make sure your car is plugged in
- Check that Powerwall is above 98% (the "full" threshold)
- Check current solar surplus on the Dashboard

**Lambda automation errors:**
- Wake-up timeout is common — the car sometimes takes >30s to wake. This is normal.
- Token expiry: re-run `python3 scripts/tesla_auth.py` to refresh

---

## Monthly AWS Cost Estimate

| Service | Usage | Cost |
|---------|-------|------|
| Lambda | ~8,760 invocations/month (every 5 min) | Free tier |
| DynamoDB | ~50k reads + writes/month | Free tier |
| API Gateway | ~10k requests/month | Free tier |
| Cognito | 1 user | Free tier |
| SSM Parameters | 5 secure params | $0.50/month |
| CloudWatch Logs | Minimal | Free tier |
| **Total** | | **~$0.50/month** |
