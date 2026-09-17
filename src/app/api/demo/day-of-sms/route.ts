import { NextResponse } from "next/server";
import {
  getPendingDayOfSmsTickets,
  confirmDayOfSms,
  getAllTenantProfiles,
} from "@/lib/demo-engine/ticket-service";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || undefined;

    const tickets = await getPendingDayOfSmsTickets(tenantId);
    const tenants = await getAllTenantProfiles();

    return NextResponse.json({
      success: true,
      tickets,
      tenants,
    });
  } catch (error) {
    console.error("API /demo/day-of-sms GET Error:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { ticketId, reply } = body;

    if (!ticketId) {
      return NextResponse.json(
        { success: false, error: "ticketId is required" },
        { status: 400 }
      );
    }

    const cleanReply = (reply || "").trim().toUpperCase();
    if (cleanReply !== "YES") {
      return NextResponse.json(
        {
          success: false,
          error: "Customer must reply 'YES' to confirm arrival window attendance.",
        },
        { status: 400 }
      );
    }

    const result = await confirmDayOfSms(ticketId);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "Failed to update ticket" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      ticketId,
      dayOfSmsConfirmed: true,
      message: "Customer confirmed attendance. Technician dispatch dispatched to proceed.",
    });
  } catch (error) {
    console.error("API /demo/day-of-sms POST Error:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
