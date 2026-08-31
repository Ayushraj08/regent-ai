import urllib.request
import json

url = 'https://api.github.com/search/code?q=wss://api.elevenlabs.io/v1/speech-to-text/realtime'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        print(f"Found {data['total_count']} files")
        for item in data['items'][:3]:
            print(f"Repo: {item['repository']['full_name']}, Path: {item['path']}")
except Exception as e:
    print(f"Error: {e}")
