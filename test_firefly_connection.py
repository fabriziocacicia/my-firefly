import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path

def load_env_file(dotenv_path=None):
    """Load variables from .env file into os.environ (zero external dependencies)."""
    if dotenv_path is None:
        dotenv_path = Path(__file__).resolve().parent / ".env"
    else:
        dotenv_path = Path(dotenv_path)

    if not dotenv_path.is_file():
        return

    try:
        with open(dotenv_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip()
                    # Strip matching single or double quotes
                    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                        val = val[1:-1]
                    if key and key not in os.environ:
                        os.environ[key] = val
    except Exception:
        pass

# Automatically load environment variables from .env
load_env_file()

FIREFLY_URL = os.getenv("FIREFLY_URL", "http://localhost:8080").rstrip("/")
FIREFLY_TOKEN = os.getenv("FIREFLY_TOKEN", "")

def check_connection():
    if not FIREFLY_TOKEN:
        print("❌ Error: FIREFLY_TOKEN is not set.")
        print("Please set your personal access token in the script or via the FIREFLY_TOKEN environment variable.")
        print("In Firefly III: Options/Profile -> OAuth -> Personal Access Tokens -> Create Token.")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {FIREFLY_TOKEN}",
        "Accept": "application/vnd.api+json",
        "User-Agent": "FireflyCompanionApp/0.1"
    }

    # 1. Test /api/v1/about endpoint
    about_url = f"{FIREFLY_URL}/api/v1/about"
    print(f"Connecting to Firefly III at: {about_url} ...")
    
    req = urllib.request.Request(about_url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
            about_data = data.get("data", {})
            # /api/v1/about returns fields directly under data (unlike standard JSON:API resource objects)
            version = about_data.get("version") or about_data.get("attributes", {}).get("version", "unknown")
            os_info = about_data.get("os", "")
            php_ver = about_data.get("php_version", "")
            details = [f"v{version}"]
            if php_ver:
                details.append(f"PHP {php_ver}")
            if os_info:
                details.append(f"OS: {os_info}")
            print(f"✅ Connection successful! Connected to Firefly III: {', '.join(details)}")
    except urllib.error.HTTPError as e:
        print(f"❌ HTTP Error {e.code}: {e.reason}")
        if e.code == 401:
            print("   -> Authentication failed. Check if your Personal Access Token is valid.")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"❌ Network/URL Error: {e.reason}")
        print(f"   -> Could not reach {FIREFLY_URL}. Ensure Firefly is running and the port/host is correct.")
        sys.exit(1)

    # 2. Test fetching expense accounts (stores/supermarkets)
    accounts_url = f"{FIREFLY_URL}/api/v1/accounts?type=expense&limit=10"
    print(f"\nFetching sample expense accounts from {accounts_url} ...")
    req = urllib.request.Request(accounts_url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
            accounts = data.get("data", [])
            print(f"✅ Found {len(accounts)} expense accounts (sample):")
            for acc in accounts:
                attr = acc.get("attributes", {})
                name = attr.get("name")
                acc_id = acc.get("id")
                print(f"   - [ID: {acc_id}] {name}")
    except Exception as e:
        print(f"⚠️ Could not fetch expense accounts: {e}")

if __name__ == "__main__":
    check_connection()
