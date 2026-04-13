import json
import requests

API_KEY = "fc058946-3b9e-4abb-aef5-02732102776e".strip()
VEHICLE_ID = 2076182

headers = {
    "x-api-key": API_KEY,
    "Accept": "application/json",
}

urls = [
    f"https://api.gomotive.com/v1/vehicles/{VEHICLE_ID}",
    f"https://api.gomotive.com/v2/vehicle_locations/{VEHICLE_ID}",
    f"https://api.gomotive.com/v3/vehicle_locations/{VEHICLE_ID}",
]

for url in urls:
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        print("\nURL:", url)
        print("STATUS:", resp.status_code)
        print("CONTENT-TYPE:", resp.headers.get("Content-Type"))
        print(resp.text[:3000])
    except Exception as e:
        print("ERROR:", url, e)

    