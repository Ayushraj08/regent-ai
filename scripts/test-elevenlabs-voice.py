import os
import sys
import json
import urllib.request
import urllib.error

def load_env(path=".env.local"):
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

load_env(".env.local")

api_key = os.getenv("ELEVENLABS_API_KEY")
voice_id = os.getenv("ELEVENLABS_VOICE_ID", "56AoDkrOh6qfVPDXZ7Pt")
model_id = os.getenv("ELEVENLABS_MODEL_ID", "eleven_v3")
text = sys.argv[1] if len(sys.argv) > 1 else "This is a test for the API of ElevenLabs with Regent."

if not api_key:
    print("Error: ELEVENLABS_API_KEY not configured in .env.local")
    sys.exit(1)

print("--------------------------------------------------")
print("ElevenLabs Python Voice Synthesis Test")
print(f"API Key:  {api_key[:7]}...{api_key[-4:]}")
print(f"Voice ID: {voice_id}")
print(f"Model ID: {model_id}")
print(f"Text:     {text}")
print("--------------------------------------------------")

def call_tts(target_voice, target_model):
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{target_voice}"
    payload = {
        "text": text,
        "model_id": target_model,
        "voice_settings": {
            "stability": 0.45,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True
        }
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read(), None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, None, body
    except Exception as e:
        return 500, None, str(e)

print(f"[1] Requesting synthesis with voice '{voice_id}'...")
status, audio_bytes, err = call_tts(voice_id, model_id)

if status == 402:
    print("\n[!] HTTP 402 Payment Required returned by ElevenLabs.")
    print(f"Reason: Voice '{voice_id}' is an ElevenLabs Library Voice.")
    print("ElevenLabs restricts library voices via API to accounts with an active paid subscription (e.g. Starter tier).")
    print("Triggering seamless fallback to default voice 'EXAVITQu4vr4xnSDxMaL' to verify audio pipeline...\n")
    status, audio_bytes, err = call_tts("EXAVITQu4vr4xnSDxMaL", model_id)

if status == 200 and audio_bytes:
    with open("output.bin", "wb") as f:
        f.write(audio_bytes)
    with open("output.mp3", "wb") as f:
        f.write(audio_bytes)
    print(f"[OK] Success! Audio file saved to:")
    print(f"   - output.bin ({len(audio_bytes)} bytes)")
    print(f"   - output.mp3 ({len(audio_bytes)} bytes)")
else:
    print(f"Synthesis failed [HTTP {status}]: {err}")
    sys.exit(1)
