import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { text, voiceId = "EXAVITQu4vr4xnSDxMaL" } = await req.json(); // Bella voice as default

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    if (!process.env.ELEVENLABS_API_KEY) {
      return NextResponse.json({ error: "API Key missing" }, { status: 401 });
    }

    // Clean text for natural speech synthesis (strip markdown asterisks, raw bullets, and multiple dots)
    const cleanSpeechText = text
      .replace(/\*\*(.*?)\*\*/g, "$1") // strip **bold**
      .replace(/\*(.*?)\*/g, "$1") // strip *italic*
      .replace(/^[\s•\-*]+\s*/gm, "") // strip leading bullet characters
      .replace(/\.{3,}/g, ".") // strip long ellipsis
      .replace(/\s+/g, " ") // normalize spacing
      .trim();

    // Call ElevenLabs TTS Streaming API
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: cleanSpeechText,
          model_id: "eleven_turbo_v2_5", // low latency model
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs Error: ${response.statusText}`);
    }

    // Pipe the audio stream directly back to the client
    return new NextResponse(response.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error) {
    console.error("TTS Error:", error);
    return NextResponse.json({ error: "TTS Generation Failed" }, { status: 500 });
  }
}
