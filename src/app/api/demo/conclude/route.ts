import { NextResponse } from "next/server";
import { commitCallConclusion } from "@/lib/demo-engine/ticket-service";
import { ConversationSession } from "@/lib/demo-engine/types";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const session: ConversationSession = body.session;
    if (!session) {
      return NextResponse.json({ error: "Session is required" }, { status: 400 });
    }

    const fullName = session.lead.name?.value || "Valued Customer";
    const firstName = fullName.split(" ")[0];
    const phone = session.lead.phone?.value || "5550000000";
    const address = session.lead.address?.value || "100 Main St, Austin 78701";

    // Parse city and postal code from address if possible
    let city = "Austin";
    let zip = "78701";
    const zipMatch = address.match(/\b\d{5}\b/);
    if (zipMatch) zip = zipMatch[0];
    const parts = address.split(",");
    if (parts.length >= 2) {
      city = parts[1].replace(/\b\d{5}\b/, "").trim() || city;
    }

    // Determine category
    const category = session.trade || "HVAC";

    // Scheduled date & arrival window
    let scheduledDate = new Date().toISOString().split("T")[0];
    let arrivalWindow = "09:00 AM - 12:00 PM";
    const timingVal = session.lead.timing?.value || "";
    const dateMatch = timingVal.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (dateMatch) scheduledDate = dateMatch[1];
    if (timingVal.includes(" - ")) {
      const windowMatch = timingVal.match(/\b(\d{2}:\d{2}\s+(?:AM|PM)\s*-\s*\d{2}:\d{2}\s+(?:AM|PM))\b/i);
      if (windowMatch) arrivalWindow = windowMatch[1];
    }

    // Call mood & type
    let callerMood: "pleasant" | "neutral" | "anxious" | "angry" | "dissatisfied" = "neutral";
    const rawTag = session.moodDiagnostics?.sentimentTag;
    if (rawTag === "angry") callerMood = "angry";
    else if (rawTag === "happy") callerMood = "pleasant";

    let callType: any = body.callType || "standard_booking";
    if (session.safety?.status === "CRITICAL") {
      callType = "emergency";
    } else if (session.state === "ESCALATED") {
      callType = "human_escalation";
    }

    const summary =
      body.summary ||
      `Customer ${firstName} booked ${category} service for ${scheduledDate}. Issue: ${session.lead.problem?.value || "Routine diagnostic"}.`;

    const action =
      body.actionRequired ||
      (callType === "emergency"
        ? "EMERGENCY DISPATCH: Urgent on-site technician required within 60 mins"
        : `Assign technician to arrival window ${arrivalWindow}.`);

    const fullTranscript = session.conversationHistory
      .map((t) => `${t.role}: ${t.content}`)
      .join("\n");

    const result = await commitCallConclusion({
      businessId: session.businessId || session.tenantId || "b0000000-0000-0000-0000-000000000001",
      customer: {
        id: session.customerId || undefined,
        fullLegalName: fullName,
        firstName,
        mobileNumber: phone,
        serviceAddress: address,
        city,
        postalCode: zip,
      },
      ticket: session.ticketId
        ? {
            ticketId: session.ticketId,
            serviceCategory: category,
            reportedIssue: session.lead.problem?.value || "Service requested",
            scheduledDate,
            arrivalWindow,
            bookingStatus: "confirmed",
            isAfterHours: Boolean(body.isAfterHours),
            fullName,
            phoneNumber: phone,
            fullAddress: address,
            customerStatus: session.returningCustomer ? "Existing Customer" : "New Customer",
            priority: callType === "emergency" ? "Emergency (Life/Safety)" : "Normal",
            mood: callerMood === "angry" ? "Angry" : callerMood === "pleasant" ? "Happy" : "Neutral",
            callerStyle: session.callerStyle || "Calm",
            contextSummary: summary,
            contextOfCall: summary,
          }
        : undefined,
      callRecord: {
        ticketId: session.ticketId || undefined,
        customerMobile: phone,
        callerMood,
        whyCustomerIsUpset: session.moodDiagnostics?.whyCustomerIsUpset || null,
        summaryForBusinessOwner: summary,
        actionRequiredByTeam: action,
        callTranscript: fullTranscript,
        smsConfirmationSent: true,
        callType,
      },
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("API /demo/conclude Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
