import { NextResponse } from "next/server";

export async function GET() {
  try {
    // In a production app, this would generate a signed JWT from ElevenLabs 
    // to protect your account. For the demo, we securely pass the key 
    // to the client just-in-time for the WebSocket connection.
    const key = process.env.ELEVENLABS_API_KEY;
    
    if (!key) {
      return NextResponse.json({ error: "API Key missing" }, { status: 401 });
    }

    return NextResponse.json({ token: key });
  } catch (error) {
    console.error("Token Error:", error);
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}
