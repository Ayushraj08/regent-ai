import { NextResponse } from "next/server";

export async function GET() {
  try {
    const key = process.env.ELEVENLABS_API_KEY;

    if (!key) {
      console.error("[scribe-token] ELEVENLABS_API_KEY is not configured");
      return NextResponse.json(
        { error: "Voice authentication is not configured." },
        { status: 401 }
      );
    }

    // Request a single-use token from ElevenLabs for Scribe Realtime.
    // This token is short-lived and single-use — the permanent API key is never
    // exposed to the browser.
    const res = await fetch(
      "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      // Log server-side only — never surface ElevenLabs error details to the browser
      const body = await res.text().catch(() => "");
      console.error(`[scribe-token] ElevenLabs returned ${res.status}`, body);
      return NextResponse.json(
        { error: "Could not create voice session. Please try again." },
        { status: 502 }
      );
    }

    const data = await res.json();

    // ElevenLabs returns: { token: "..." }
    const token: string | undefined = data?.token ?? data?.token_id;

    if (!token || typeof token !== "string") {
      console.error("[scribe-token] Unexpected ElevenLabs response shape:", Object.keys(data));
      return NextResponse.json(
        { error: "Unexpected voice session response." },
        { status: 502 }
      );
    }

    // Return only the temporary token — never the API key
    return NextResponse.json({ token });
  } catch (error) {
    console.error("[scribe-token] Internal error:", error);
    return NextResponse.json(
      { error: "Internal server error generating voice session." },
      { status: 500 }
    );
  }
}
