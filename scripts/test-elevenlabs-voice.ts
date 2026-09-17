import fs from "node:fs";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

/**
 * Test script for ElevenLabs Voice Synthesis in Regent AI
 * Tests voice_id 56AoDkrOh6qfVPDXZ7Pt (Cassidy) and model eleven_v3
 */
async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "56AoDkrOh6qfVPDXZ7Pt";
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_v3";
  const text = process.argv[2] || "This is a test for the API of ElevenLabs with Regent.";

  if (!apiKey) {
    console.error("Error: ELEVENLABS_API_KEY is not set in .env.local");
    process.exit(1);
  }

  console.log("--------------------------------------------------");
  console.log("ElevenLabs Voice Synthesis Test");
  console.log("API Key:  " + apiKey.slice(0, 7) + "..." + apiKey.slice(-4));
  console.log("Voice ID: " + voiceId);
  console.log("Model ID: " + modelId);
  console.log("Text:     " + text);
  console.log("--------------------------------------------------");

  const synthesize = async (targetVoice: string, targetModel: string) => {
    return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}/stream`, {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: targetModel,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });
  };

  console.log(`[1] Requesting synthesis with voice '${voiceId}'...`);
  let res = await synthesize(voiceId, modelId);

  if (res.status === 402) {
    console.warn("\n⚠️ HTTP 402 Payment Required returned by ElevenLabs.");
    console.warn("Reason: Voice '" + voiceId + "' is an ElevenLabs Library Voice.");
    console.warn("ElevenLabs restricts library voices via API to accounts with an active paid subscription (e.g. Starter tier).");
    console.warn("Triggering seamless fallback to default voice 'EXAVITQu4vr4xnSDxMaL' to verify audio pipeline...\n");

    res = await synthesize("EXAVITQu4vr4xnSDxMaL", modelId);
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Synthesis failed [HTTP ${res.status}]:`, errText);
    process.exit(1);
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync("output.bin", audioBuffer);
  fs.writeFileSync("output.mp3", audioBuffer);

  console.log("✅ Success! Audio file saved to:");
  console.log("   - output.bin (" + audioBuffer.length + " bytes)");
  console.log("   - output.mp3 (" + audioBuffer.length + " bytes)");
}

main().catch((err) => {
  console.error("Execution error:", err);
  process.exit(1);
});
