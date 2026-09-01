import { NextResponse } from "next/server";
import { EngineRequestSchema } from "@/lib/demo-engine/types";
import { processDemoUtterance } from "@/lib/demo-engine/state-machine";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsedRequest = EngineRequestSchema.parse(body);

    const response = await processDemoUtterance(parsedRequest);

    return NextResponse.json(response);
  } catch (error) {
    console.error("API /demo/respond Error:", error);
    return NextResponse.json(
      { error: "Failed to process utterance", details: String(error) },
      { status: 500 }
    );
  }
}
