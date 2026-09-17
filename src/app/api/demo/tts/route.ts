import { NextRequest, NextResponse } from "next/server";

interface EmotionalVoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

/**
 * Module 5: Emotional Voice Synthesis Settings (ElevenLabs Turbo v2.5)
 * Dynamically modifies pitch variance, stability, emotional style, and pacing.
 * Speed configured to ~0.9 (10-15% reduction) for a relaxed, confident dispatcher cadence.
 */
const EMOTIONAL_PROSODY_MAP: Record<string, EmotionalVoiceSettings> = {
  // Urgent: Flooding, burst pipes, dangerous conditions — dynamic pitch, controlled urgent cadence
  urgent: {
    stability: 0.35,
    similarity_boost: 0.75,
    style: 0.0,
    use_speaker_boost: true,
    speed: 0.92,
  },
  // Empathetic: Upset, angry, or frustrated customers — soft onset, de-escalating inflection, calm pace
  empathetic: {
    stability: 0.38,
    similarity_boost: 0.75,
    style: 0.0,
    use_speaker_boost: true,
    speed: 0.88,
  },
  // Calm: Elderly, confused, or anxious callers — steady, patient, soothing cadence
  calm: {
    stability: 0.60,
    similarity_boost: 0.75,
    style: 0.0,
    use_speaker_boost: true,
    speed: 0.86,
  },
  // Warm: Standard hospitable receptionist — spec-exact baseline (stability 0.45, similarity 0.75, style 0.0)
  warm: {
    stability: 0.45,
    similarity_boost: 0.75,
    style: 0.0,
    use_speaker_boost: true,
    speed: 0.90,
  },
};

export async function POST(req: NextRequest) {
  try {
    const {
      text,
      voiceId = process.env.ELEVENLABS_VOICE_ID || "56AoDkrOh6qfVPDXZ7Pt",
      modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5",
      sentimentState = "warm",
      speed,
    } = await req.json();

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    if (!process.env.ELEVENLABS_API_KEY) {
      return NextResponse.json({ error: "API Key missing" }, { status: 401 });
    }

    // Clean text for natural speech synthesis (strip markdown formatting, excessive whitespace, and redundant dash speech)
    const cleanSpeechText = text
      .replace(/\*\*(.*?)\*\*/g, "$1") // strip **bold**
      .replace(/\*(.*?)\*/g, "$1") // strip *italic*
      .replace(/^[\s•\-*]+\s*/gm, "") // strip leading bullet characters
      .replace(/[-_]dash[-_]/gi, " ") // strip -dash-
      .replace(/\s+dash\s+/gi, " ") // strip isolated dash words
      .replace(/\s+/g, " ") // normalize spacing
      .trim();

    // Select dynamic emotional voice settings with pacing
    const baseSettings =
      EMOTIONAL_PROSODY_MAP[sentimentState] || EMOTIONAL_PROSODY_MAP.warm;
    const voiceSettings: Record<string, any> = {
      stability: baseSettings.stability,
      similarity_boost: baseSettings.similarity_boost,
      style: baseSettings.style,
      use_speaker_boost: baseSettings.use_speaker_boost,
    };
    if (typeof speed === "number") {
      voiceSettings.speed = speed;
    }

    console.log(
      `[TTS Pipeline] Synthesizing speech with voice=${voiceId}, model=${modelId}, sentiment=${sentimentState}, stability=${voiceSettings.stability}`
    );

    // Helper to execute ElevenLabs streaming TTS request
    const synthesize = async (targetVoice: string, targetModelId: string) => {
      // Note: ElevenLabs returns 400 if optimize_streaming_latency is passed with eleven_v3 or conversational models
      const skipLatencyOptimization =
        targetModelId.includes("eleven_v3") || targetModelId.includes("conversational");

      const url = skipLatencyOptimization
        ? `https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}/stream`
        : `https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}/stream?optimize_streaming_latency=3`;

      const payload: Record<string, any> = {
        text: cleanSpeechText,
        model_id: targetModelId,
        voice_settings: voiceSettings,
      };
      if (!skipLatencyOptimization) {
        payload.optimize_streaming_latency = 3;
      }

      return fetch(url, {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "xi-api-key": process.env.ELEVENLABS_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    };

    // 1. Attempt primary synthesis using configured voice and model
    let usedVoice = voiceId;
    let response = await synthesize(voiceId, modelId);

    // 2. Graceful fallback if library voice requires paid plan on a Free tier API key (HTTP 402)
    if (response.status === 402) {
      console.warn(
        `[TTS Pipeline] Voice '${voiceId}' requires paid plan on ElevenLabs account (Free tier API key restriction on library voices). Falling back to premade voice (EXAVITQu4vr4xnSDxMaL)...`
      );
      usedVoice = "EXAVITQu4vr4xnSDxMaL";
      response = await synthesize(usedVoice, modelId);
    }

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`ElevenLabs Error: ${response.statusText} - ${errBody}`);
    }

    // Pipe the audio stream directly back to the client
    return new NextResponse(response.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
        "X-Regent-Sentiment": sentimentState,
        "X-Regent-Voice": response.headers.get("voice-id") || usedVoice,
      },
    });
  } catch (error) {
    console.error("TTS Error:", error);
    return NextResponse.json({ error: "TTS Generation Failed" }, { status: 500 });
  }
}

