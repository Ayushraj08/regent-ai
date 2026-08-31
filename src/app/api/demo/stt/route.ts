import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("file") as Blob;

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    if (!process.env.ELEVENLABS_API_KEY) {
      return NextResponse.json({ error: "API Key missing" }, { status: 401 });
    }

    const elevenLabsFormData = new FormData();
    elevenLabsFormData.append("file", audioFile, "audio.webm");
    elevenLabsFormData.append("model_id", "scribe_v1"); // Scribe model

    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
      },
      body: elevenLabsFormData,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("ElevenLabs STT Error:", errText);
      throw new Error(`ElevenLabs Error: ${response.statusText}`);
    }

    const data = await response.json();
    
    return NextResponse.json({ text: data.text });
  } catch (error) {
    console.error("STT Error:", error);
    return NextResponse.json({ error: "STT Transcription Failed" }, { status: 500 });
  }
}
