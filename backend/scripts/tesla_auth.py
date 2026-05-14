"""
Run this once to authorize your Tesla account and store tokens in AWS SSM.
Usage: python3 scripts/tesla_auth.py
"""
import json
import time
import webbrowser
import urllib.parse
import http.server
import threading
import boto3
import requests

CLIENT_ID = input("Enter your Tesla Client ID: ").strip()
CLIENT_SECRET = input("Enter your Tesla Client Secret: ").strip()
REDIRECT_URI = "https://auth.tesla.com/void/callback"
AUTH_URL = "https://auth.tesla.com/oauth2/v3/authorize"
TOKEN_URL = "https://auth.tesla.com/oauth2/v3/token"

params = {
    "response_type": "code",
    "client_id": CLIENT_ID,
    "redirect_uri": REDIRECT_URI,
    "scope": "openid email offline_access vehicle_device_data vehicle_cmds vehicle_charging_manage energy_device_data energy_cmds",
    "state": "energyapp",
    "prompt": "consent",
}

url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"
print("\nOpening Tesla login in your browser...")
print("After logging in, copy the full redirect URL (starts with https://auth.tesla.com/void/callback?code=...)")
webbrowser.open(url)

redirect = input("\nPaste the full redirect URL here: ").strip()
code = urllib.parse.parse_qs(urllib.parse.urlparse(redirect).query)["code"][0]

print("Exchanging code for tokens...")
resp = requests.post(TOKEN_URL, json={
    "grant_type": "authorization_code",
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "code": code,
    "redirect_uri": REDIRECT_URI,
    "audience": "https://fleet-api.prd.na.vn.cloud.tesla.com",
})
resp.raise_for_status()
data = resp.json()

tokens = {
    "access_token": data["access_token"],
    "refresh_token": data["refresh_token"],
    "expires_at": time.time() + data.get("expires_in", 3600) - 60,
}

ssm = boto3.client("ssm")
ssm.put_parameter(
    Name="/energyapp/tesla/tokens",
    Value=json.dumps(tokens),
    Type="SecureString",
    Overwrite=True,
)
ssm.put_parameter(
    Name="/energyapp/tesla/client_id",
    Value=CLIENT_ID,
    Type="SecureString",
    Overwrite=True,
)
ssm.put_parameter(
    Name="/energyapp/tesla/client_secret",
    Value=CLIENT_SECRET,
    Type="SecureString",
    Overwrite=True,
)

print("\nTokens saved to AWS SSM successfully!")
print("Tesla authorization complete.")
