"""
Run this once to authorize your Google Nest account and store tokens in AWS SSM.
Usage: python3.12 scripts/nest_auth.py
"""
import json
import time
import webbrowser
import urllib.parse
import threading
import boto3
import requests
from http.server import HTTPServer, BaseHTTPRequestHandler

CLIENT_ID = input("Enter your Google OAuth Client ID: ").strip()
CLIENT_SECRET = input("Enter your Google OAuth Client Secret: ").strip()
PROJECT_ID = input("Enter your Nest Device Access Project ID: ").strip()

REDIRECT_URI = "http://localhost:8080"
AUTH_URL = "https://nestservices.google.com/partnerconnections/{}/auth".format(PROJECT_ID)
TOKEN_URL = "https://oauth2.googleapis.com/token"

auth_code = None

class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if "code" in params:
            auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h2>Authorization successful! You can close this tab.</h2>")
        else:
            self.send_response(400)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress server logs

params = {
    "redirect_uri": REDIRECT_URI,
    "access_type": "offline",
    "response_type": "code",
    "scope": "https://www.googleapis.com/auth/sdm.service",
    "client_id": CLIENT_ID,
}

url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"

server = HTTPServer(("localhost", 8080), CallbackHandler)
thread = threading.Thread(target=server.serve_forever)
thread.daemon = True
thread.start()

print("\nOpening Google Nest authorization in your browser...")
print("After approving, the code will be captured automatically.")
webbrowser.open(url)

print("Waiting for authorization...")
while auth_code is None:
    time.sleep(1)

server.shutdown()
print("Authorization code received.")

print("Exchanging code for tokens...")
resp = requests.post(TOKEN_URL, data={
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "code": auth_code,
    "redirect_uri": REDIRECT_URI,
    "grant_type": "authorization_code",
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
    Name="/energyapp/nest/tokens",
    Value=json.dumps(tokens),
    Type="SecureString",
    Overwrite=True,
)

print("\nNest tokens saved to AWS SSM successfully!")
print("Google Nest authorization complete.")
