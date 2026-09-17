"use client";

import { useState, useRef, useEffect } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import {
  Mic, MicOff, PhoneOff, AlertTriangle, Send, PhoneCall,
  CheckCircle2, User, Radio, Activity, Loader2, ChevronDown, ChevronUp, Smartphone,
  RefreshCw, Building2, Zap, MessageSquare, Check, Sparkles, LayoutDashboard
} from "lucide-react";
import {
  Trade, ConversationSession, EngineResponse, makeEmptySession
} from "@/lib/demo-engine/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: "CUSTOMER" | "REGENT";
  content: string;
  fromVoice?: boolean;
  sentimentState?: "empathetic" | "urgent" | "calm" | "warm";
  callerStyle?: "rushed" | "elderly_confused" | "angry_frustrated" | "neutral";
};

type AppState =
  | "READY" | "REQUESTING_PERMISSION" | "CONNECTING" | "LISTENING"
  | "NO_INPUT" | "PROCESSING" | "REGENT_SPEAKING" | "ESCALATION"
  | "COMPLETE" | "ERROR";

// ─── Diagnostic Row ───────────────────────────────────────────────────────────

function DiagRow({
  label, value, ok, dim
}: { label: string; value: string; ok: boolean; dim?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className={dim ? "text-slate-600" : "text-slate-500"}>{label}</span>
      <span className={ok ? "text-green-400" : "text-red-400"}
        style={{ maxWidth: "60%", textAlign: "right", wordBreak: "break-all", fontSize: "10px" }}>
        {value}
      </span>
    </div>
  );
}

function FieldDiagRow({ label, value, status }: { label: string; value: string | null; status: string }) {
  const settled = ["VALID", "CAPTURED", "CONFIRMED", "CORRECTED"].includes(status);
  const invalid = ["INVALID", "AMBIGUOUS"].includes(status);
  const refused = ["REFUSED", "NOT_APPLICABLE"].includes(status);
  const color = settled ? "text-green-400" : invalid ? "text-red-400" : refused ? "text-yellow-400" : "text-slate-500";
  return (
    <div className="flex justify-between gap-1 text-[10px]">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`${color} text-right truncate max-w-[55%]`} title={value ?? status}>
        {value ? `${value} [${status}]` : status}
      </span>
    </div>
  );
}

function FormattedMessageContent({
  content,
  role,
}: {
  content: string;
  role: string;
}) {
  const lines = content.split("\n");
  const isCustomer = role === "CUSTOMER";

  return (
    <div className="text-sm md:text-base leading-relaxed space-y-1.5">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} className="h-1.5" />;
        }

        const isBullet =
          trimmed.startsWith("- ") ||
          trimmed.startsWith("• ") ||
          trimmed.startsWith("* ");
        const lineText = isBullet ? trimmed.replace(/^[-•*]\s*/, "") : trimmed;

        // Parse **bold** parts
        const parts = lineText.split(/(\*\*.*?\*\*)/g);

        const renderedText = (
          <span>
            {parts.map((part, pIdx) => {
              if (part.startsWith("**") && part.endsWith("**")) {
                const boldText = part.slice(2, -2);
                return (
                  <strong
                    key={pIdx}
                    className={`font-semibold ${
                      isCustomer ? "text-bone" : "text-obsidian"
                    }`}
                  >
                    {boldText}
                  </strong>
                );
              }
              return <span key={pIdx}>{part}</span>;
            })}
          </span>
        );

        if (isBullet) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-2">
              <span
                className={`font-bold mt-0.5 ${
                  isCustomer ? "text-cyan-400" : "text-blue-600"
                }`}
              >
                •
              </span>
              <div className="flex-1">{renderedText}</div>
            </div>
          );
        }

        return <div key={idx}>{renderedText}</div>;
      })}
    </div>
  );
}

// ─── Multi-Tenant Configurations ──────────────────────────────────────────────

export interface TenantMeta {
  id: string;
  name: string;
  agentName: string;
  trade: Trade;
  coveredZips: string[];
  excludedServices: string;
  fee: string;
  phone: string;
}

export const SEED_TENANTS: TenantMeta[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Apex Heating & Air",
    agentName: "Regent",
    trade: "HVAC",
    coveredZips: ["78701", "78702", "78703", "78704", "78705"],
    excludedServices: "Commercial chillers, ammonia refrigeration, or window units",
    fee: "$150 dispatch fee applies after 6:00 PM and on weekends",
    phone: "+1 (555) 234-5001",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Metro Flow Plumbing",
    agentName: "Piper",
    trade: "PLUMBING",
    coveredZips: ["78701", "78702", "78704", "78745"],
    excludedServices: "Septic tank pumping, municipal main sewer line excavations",
    fee: "$189 emergency after-hours dispatch fee",
    phone: "+1 (555) 345-6002",
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    name: "VoltGuard Electrical",
    agentName: "Sparky",
    trade: "ELECTRICAL",
    coveredZips: ["78701", "78702", "78703", "78750", "78759"],
    excludedServices: "High-voltage industrial grid distribution, solar farm inverters",
    fee: "$175 emergency after-hours dispatch fee",
    phone: "+1 (555) 456-7003",
  },
];

// ─── Ghosted Technician Day-Of Dispatch Simulator (Mocked iPhone) ─────────────

function DayOfDispatchSimulator({
  selectedTenant,
}: {
  selectedTenant: TenantMeta;
}) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadTickets = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/demo/day-of-sms?tenantId=${selectedTenant.id}`);
      const data = await res.json();
      if (data.tickets && data.tickets.length > 0) {
        setTickets(data.tickets);
      } else {
        // Fallback demo ticket for immediate visual demonstration
        setTickets([
          {
            ticketId: "TK-20260912-1001",
            tenantId: selectedTenant.id,
            businessName: selectedTenant.name,
            firstName: "Alex",
            customerMobile: "+1 (555) 234-5678",
            scheduledDate: "Today",
            arrivalWindow: "09:00 AM - 12:00 PM",
            serviceCategory: selectedTenant.trade,
            reportedIssue: "Service Call Attendance Check",
            dayOfSmsConfirmed: false,
            smsMessage: `Hi Alex, your ${selectedTenant.name} tech is scheduled to arrive between 09:00 AM - 12:00 PM today. Please reply YES to confirm someone is home.`,
          },
        ]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, [selectedTenant.id]);

  const currentTicket = tickets[activeIdx] || tickets[0];

  const handleConfirmYes = async () => {
    if (!currentTicket) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/demo/day-of-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: currentTicket.ticketId, reply: "YES" }),
      });
      const data = await res.json();
      if (data.success) {
        setTickets((prev) =>
          prev.map((t, i) =>
            i === activeIdx ? { ...t, dayOfSmsConfirmed: true } : t
          )
        );
      }
    } catch (e) {
      console.error("Error confirming attendance:", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-900 text-white rounded-xl border border-slate-700/80 shadow-md p-3 flex flex-col items-center">
      {/* Simulator Card Header */}
      <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
        <div className="flex items-center gap-1.5">
          <Smartphone className="w-4 h-4 text-sky-400" />
          <span className="font-bold uppercase tracking-wider text-[11px] text-slate-200">
            iPhone Dispatch Simulator
          </span>
        </div>
        <button
          onClick={loadTickets}
          disabled={loading}
          className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
          title="Refresh Today's Tickets"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Ticket selector chips if multiple tickets exist */}
      {tickets.length > 1 && (
        <div className="w-full flex gap-1 overflow-x-auto pb-2 mb-2">
          {tickets.map((t, idx) => (
            <button
              key={t.ticketId}
              onClick={() => setActiveIdx(idx)}
              className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors ${
                idx === activeIdx
                  ? "bg-sky-600 text-white font-bold"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              #{t.ticketId} {t.dayOfSmsConfirmed ? "✓" : "⏳"}
            </button>
          ))}
        </div>
      )}

      {/* Realistic Mocked iPhone Housing */}
      <div className="w-full max-w-[310px] bg-black rounded-[2.2rem] border-[5px] border-slate-700 shadow-2xl overflow-hidden flex flex-col relative font-sans">
        {/* Dynamic Island / Notch */}
        <div className="h-5 bg-black flex justify-center items-center pt-1 shrink-0 relative z-20">
          <div className="w-20 h-3.5 bg-slate-900 rounded-full flex items-center justify-end px-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-800" />
          </div>
        </div>

        {/* iOS Status Bar */}
        <div className="px-4 py-0.5 flex justify-between items-center text-[10px] text-slate-300 font-medium shrink-0">
          <span>9:41</span>
          <div className="flex items-center gap-1">
            <span className="text-[9px]">5G</span>
            <div className="w-4 h-2 border border-slate-300 rounded-2xs p-0.5 flex items-center">
              <div className="h-full w-full bg-white rounded-3xs" />
            </div>
          </div>
        </div>

        {/* iOS Messages App Header */}
        <div className="px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 flex flex-col items-center shrink-0">
          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center font-bold text-xs text-white shadow-xs mb-0.5">
            {selectedTenant.name.charAt(0)}
          </div>
          <span className="font-semibold text-xs text-slate-100 flex items-center gap-1">
            {currentTicket?.businessName || selectedTenant.name}
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500 text-black text-[7px] flex items-center justify-center font-bold">✓</span>
          </span>
          <span className="text-[9px] text-slate-400">Automated Dispatch Carrier SMS</span>
        </div>

        {/* Messages Body */}
        <div className="p-3 space-y-2.5 bg-slate-950 flex-1 min-h-[200px] max-h-[230px] overflow-y-auto flex flex-col justify-end text-[11px]">
          <div className="text-center my-0.5">
            <span className="text-[9px] text-slate-500 font-medium">Today 7:00 AM • 2 hrs to Arrival</span>
          </div>

          {/* Incoming Dispatch Reminder Bubble */}
          <div className="self-start max-w-[85%] bg-slate-800 text-slate-100 rounded-2xl rounded-tl-sm p-2.5 shadow-xs leading-relaxed">
            {currentTicket?.smsMessage ||
              `Hi ${currentTicket?.firstName || "Alex"}, your ${selectedTenant.name} tech is scheduled to arrive between ${currentTicket?.arrivalWindow || "09:00 AM - 12:00 PM"} today. Please reply YES to confirm someone is home.`}
          </div>

          {/* Outgoing & Confirmation Bubbles */}
          {currentTicket?.dayOfSmsConfirmed ? (
            <>
              <div className="self-end max-w-[70%] bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3 py-1.5 shadow-xs font-semibold">
                YES
              </div>
              <div className="self-end text-[9px] text-slate-400 pr-1 -mt-1">
                Delivered
              </div>
              <div className="self-start max-w-[85%] bg-slate-800 text-slate-100 rounded-2xl rounded-tl-sm p-2.5 shadow-xs leading-relaxed mt-1">
                <span className="text-emerald-400 font-bold">✓ Attendance Confirmed!</span> Technician van is en route as scheduled.
              </div>
            </>
          ) : (
            <div className="text-center pt-1">
              <span className="text-[10px] text-amber-400 font-mono bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded-full">
                ⚠️ Awaiting Customer &apos;YES&apos;
              </span>
            </div>
          )}
        </div>

        {/* Action / Input Footer */}
        <div className="p-2.5 bg-slate-900 border-t border-slate-800 flex flex-col gap-2 shrink-0">
          {currentTicket?.dayOfSmsConfirmed ? (
            <div className="py-2 px-3 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-center">
              <span className="text-[10px] font-bold text-emerald-300 flex items-center justify-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                day_of_sms_confirmed = TRUE
              </span>
              <p className="text-[9px] text-emerald-400/80 mt-0.5">Ghosted technician safeguard cleared</p>
            </div>
          ) : (
            <button
              onClick={handleConfirmYes}
              disabled={submitting}
              className="w-full py-2 bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-sky-600/30 transition-all scale-100 hover:scale-[1.02] active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-3 h-3" />
              {submitting ? "Confirming..." : "Simulate Customer: Reply 'YES'"}
            </button>
          )}
        </div>

        {/* Home Bar Indicator */}
        <div className="h-3.5 bg-black flex justify-center items-center pb-1 shrink-0">
          <div className="w-24 h-1 bg-slate-600 rounded-full" />
        </div>
      </div>

      {/* Ticket Details Sub-badge */}
      {currentTicket && (
        <div className="w-full mt-2 pt-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-400">
          <span>Ticket: #{currentTicket.ticketId}</span>
          <span>Window: {currentTicket.arrivalWindow}</span>
          <span className={currentTicket.dayOfSmsConfirmed ? "text-emerald-400 font-bold" : "text-amber-400 font-semibold"}>
            {currentTicket.dayOfSmsConfirmed ? "CONFIRMED" : "PENDING"}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── SMS Confirmation Dispatch Simulator ──────────────────────────────────────

function SmsDispatchSimulator({
  session,
  trade,
}: {
  session: ConversationSession | null;
  trade: Trade | null;
}) {
  const getBizName = (t: Trade | null) => {
    switch (t) {
      case "HVAC":
        return "Apex Heating & Air";
      case "PLUMBING":
        return "Apex Plumbing Pros";
      case "ELECTRICAL":
        return "Apex Electrical Services";
      default:
        return "Apex Home Services";
    }
  };

  const businessName = getBizName(trade);
  const fullName = session?.lead.name?.value || "Valued Customer";
  const firstName = fullName.split(" ")[0];
  const rawPhone = (session?.lead.phone?.value || "").replace(/\D/g, "");
  const formattedPhone =
    rawPhone.length === 10
      ? `+1 (${rawPhone.slice(0, 3)}) ${rawPhone.slice(3, 6)}-${rawPhone.slice(6)}`
      : "+1 (555) 234-5678";

  const isConfirmed = Boolean(session?.ticketId || session?.state === "CONFIRMED");
  const ticketId = session?.ticketId || (isConfirmed ? "TKT-20260912-7F2A" : "TKT-PENDING");

  let scheduledDateStr = "Monday, Sep 14, 2026";
  let arrivalWindowStr = "09:00 AM - 12:00 PM";
  const timingVal = session?.lead.timing?.value || "";

  if (timingVal) {
    const winMatch = timingVal.match(
      /\b(\d{2}:\d{2}\s+(?:AM|PM)\s*-\s*\d{2}:\d{2}\s+(?:AM|PM))\b/i
    );
    if (winMatch) {
      arrivalWindowStr = winMatch[1];
    } else if (timingVal.toLowerCase().includes("afternoon")) {
      arrivalWindowStr = "01:00 PM - 04:00 PM";
    } else if (timingVal.toLowerCase().includes("morning")) {
      arrivalWindowStr = "09:00 AM - 12:00 PM";
    }

    const dateMatch = timingVal.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (dateMatch) {
      const [y, m, d] = dateMatch[1].split("-").map((n) => parseInt(n, 10));
      const targetDate = new Date(y, m - 1, d);
      scheduledDateStr = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(targetDate);
    }
  }

  const reportedIssue = session?.lead.problem?.value
    ? `${session.lead.problem.value.slice(0, 26)}${
        session.lead.problem.value.length > 26 ? "..." : ""
      }`
    : `${trade || "HVAC"} Diagnostic & Repair`;

  return (
    <div className="bg-slate-900 text-white rounded-xl border border-slate-700/80 shadow-md overflow-hidden flex flex-col">
      {/* Header with Carrier Gateway badge */}
      <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
            SMS DISPATCH SIMULATOR
          </span>
        </div>

        {/* Animated Badge */}
        {isConfirmed ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/60 text-[10px] font-semibold text-emerald-300 shadow-sm animate-pulse">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Status: 200 OK — SMS Dispatched via Carrier Gateway</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-[10px] font-medium text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span>Carrier Gateway: Standing By</span>
          </div>
        )}
      </div>

      {/* Visual Text Bubble Preview */}
      <div className="p-4 bg-slate-900/90 font-mono text-xs space-y-2">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider flex justify-between">
          <span>Carrier Preview</span>
          <span>Gateway: Direct SMS</span>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-950 p-3.5 shadow-inner">
          <div className="text-[11px] text-slate-400 pb-2 mb-2 border-b border-slate-800/80 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">TO:</span>
              <span className="text-slate-200 font-semibold">{formattedPhone}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">FROM:</span>
              <span className="text-slate-200">{businessName} Service Desk</span>
            </div>
          </div>

          <div className="space-y-1.5 text-slate-100 text-[11px] leading-relaxed pt-0.5">
            <p className="font-bold text-emerald-400">
              Hi {firstName}, your service booking is confirmed!
            </p>
            <p>
              <span className="text-slate-400">Ticket ID:</span> #{ticketId}
            </p>
            <p>
              <span className="text-slate-400">Service:</span> {reportedIssue}
            </p>
            <p>
              <span className="text-slate-400">Date:</span> {scheduledDateStr}
            </p>
            <p>
              <span className="text-slate-400">Arrival Window:</span>{" "}
              <span className="text-amber-300 font-semibold">{arrivalWindowStr}</span>
            </p>
            <p className="text-[10px] text-slate-400 pt-2 border-t border-slate-800/80 mt-2 italic">
              Reply CANCEL or HELP. Tech will call 15 mins prior.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DemoPage() {
  const [viewMode, setViewMode] = useState<"VOICE_ORB" | "DISPATCH_CONSOLE">("VOICE_ORB");
  const [isCallActive, setIsCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [trade, setTrade] = useState<Trade | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<TenantMeta>(SEED_TENANTS[0]);
  const [rightTab, setRightTab] = useState<"LEAD" | "DAY_OF_SMS" | "BOOKING_SMS">("LEAD");
  const [appState, setAppState] = useState<AppState>("READY");
  const [messages, setMessages] = useState<Message[]>([]);
  const [session, setSession] = useState<ConversationSession | null>(null);
  const [textInput, setTextInput] = useState("");
  const [partialText, setPartialText] = useState("");
  const [noSpeechWarn, setNoSpeechWarn] = useState(false);
  const [micPermission, setMicPerm] = useState<"PENDING" | "GRANTED" | "DENIED">("PENDING");
  const [diagConn, setDiagConn] = useState("CLOSED");
  const [diagPartials, setDiagPartials] = useState(0);
  const [diagCommitted, setDiagCommitted] = useState(0);
  const [diagSession, setDiagSession] = useState("");
  const [diagOpen, setDiagOpen] = useState(false);

  // Refs
  const isCallActiveRef = useRef(false);
  const isMutedRef = useRef(false);
  const isInterruptedRef = useRef(false);
  const tradeRef = useRef<Trade | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const sessionRef = useRef<ConversationSession | null>(null);
  const appStateRef = useRef<AppState>("READY");
  const noSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef({ sttCommit: 0, llmStart: 0, ttsStart: 0, firstAudio: 0 });

  function triggerBargeIn() {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    // 1. Cut off audio playback and append trailing ellipsis to interrupted assistant turn
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role === "REGENT" && !last.content.endsWith("...")) {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          content: last.content.trim().replace(/[\.\s]+$/, "") + "...",
        };
        return updated;
      }
      return prev;
    });
    // 2. Snap badge instantly to Listening...
    setAppState("LISTENING");
    // 3. Flag next LLM prompt to include [System: User interrupted your previous message.]
    isInterruptedRef.current = true;
  }

  useEffect(() => {
    tradeRef.current = trade;
    messagesRef.current = messages;
    sessionRef.current = session;
    appStateRef.current = appState;
    isCallActiveRef.current = isCallActive;
    isMutedRef.current = isMuted;
  });

  // Stable callback refs
  const cbSessionStarted = useRef<() => void>(() => {});
  const cbPartialTranscript = useRef<(data: { text: string }) => void>(() => {});
  const cbCommittedTranscript = useRef<(data: { text: string }) => void>(() => {});
  const cbDisconnect = useRef<() => void>(() => {});
  const cbError = useRef<(err: Error | Event) => void>(() => {});
  const processedRef = useRef<Set<string>>(new Set());
  const sessionIdRef = useRef("");

  useEffect(() => {
    cbSessionStarted.current = () => {
      setAppState("LISTENING");
      setNoSpeechWarn(false);
      currentAudioRef.current?.pause();
      currentAudioRef.current = null;
      resetNoSpeechTimer();
    };

    cbPartialTranscript.current = (data) => {
      if (isMutedRef.current) return;
      setPartialText(data.text);
      setDiagPartials(p => p + 1);
      resetNoSpeechTimer();
      // Barge-in: if user starts speaking while Regent audio is playing
      if (appStateRef.current === "REGENT_SPEAKING" || currentAudioRef.current) {
        triggerBargeIn();
      }
    };

    cbCommittedTranscript.current = (data) => {
      const text = (data.text || "").trim();
      if (!text) return;
      if (isMutedRef.current) return;
      setPartialText("");
      const key = `${sessionIdRef.current}|${text}`;
      if (processedRef.current.has(key)) return;
      processedRef.current.add(key);
      setDiagCommitted(c => c + 1);
      metricsRef.current.sttCommit = performance.now();
      if (scribe.isConnected) {
        scribe.mute();
      }
      handleUserInput(text, true);
    };

    cbDisconnect.current = () => {
      setDiagConn("CLOSED");
      // If call is actively in progress, user is not muted, and not processing or speaking, auto-reconnect
      if (
        isCallActiveRef.current &&
        !isMutedRef.current &&
        appStateRef.current === "LISTENING"
      ) {
        setTimeout(() => {
          if (
            isCallActiveRef.current &&
            !isMutedRef.current &&
            appStateRef.current === "LISTENING" &&
            !scribe.isConnected &&
            scribe.status !== "connecting"
          ) {
            startListening();
          }
        }, 300);
      } else if (!isCallActiveRef.current) {
        setAppState(prev => (prev === "LISTENING" || prev === "CONNECTING") ? "READY" : prev);
      }
    };

    cbError.current = (err) => {
      console.error("[Scribe] Error:", err);
      setDiagConn("ERROR");
      setAppState("ERROR");
    };
  });

  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    onSessionStarted: () => cbSessionStarted.current(),
    onPartialTranscript: (data) => cbPartialTranscript.current(data),
    onCommittedTranscript: (data) => cbCommittedTranscript.current(data),
    onConnect: () => { setDiagConn("OPEN"); setMicPerm("GRANTED"); },
    onDisconnect: () => cbDisconnect.current(),
    onError: (err) => cbError.current(err),
    onAuthError: (e) => { console.error("[Scribe] Auth:", e.error); setAppState("ERROR"); },
  });

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages, partialText]);

  useEffect(() => {
    return () => {
      clearNoSpeechTimer();
      scribe.disconnect();
      currentAudioRef.current?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetNoSpeechTimer() {
    if (noSpeechTimerRef.current) clearTimeout(noSpeechTimerRef.current);
    noSpeechTimerRef.current = setTimeout(() => {
      setNoSpeechWarn(true);
      setAppState(prev => {
        if (prev === "LISTENING") {
          scribe.disconnect();
          handleUserInput("[SILENCE]", false);
          return "PROCESSING";
        }
        return prev;
      });
    }, 20_000);
  }

  function clearNoSpeechTimer() {
    if (noSpeechTimerRef.current) { clearTimeout(noSpeechTimerRef.current); noSpeechTimerRef.current = null; }
    setNoSpeechWarn(false);
  }

  function cleanupVoice() {
    clearNoSpeechTimer();
    scribe.disconnect();
    sessionIdRef.current = Date.now().toString();
    processedRef.current = new Set();
    setPartialText("");
    setDiagConn("CLOSED");
    setDiagPartials(0);
    setDiagCommitted(0);
    setDiagSession("");
  }

  async function startListening() {
    if (scribe.isConnected || scribe.status === "connecting") return;
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    const newSession = Date.now().toString();
    sessionIdRef.current = newSession;
    processedRef.current = new Set();
    setAppState("REQUESTING_PERMISSION");
    setPartialText("");
    setNoSpeechWarn(false);
    setDiagSession(newSession.slice(-6));
    setDiagPartials(0);
    setDiagCommitted(0);
    try {
      const res = await fetch("/api/demo/scribe-token");
      if (!res.ok) throw new Error(`Token endpoint: ${res.status}`);
      const { token } = await res.json();
      if (!token) throw new Error("Invalid token");
      setAppState("CONNECTING");
      setDiagConn("CONNECTING");
      await scribe.connect({ token });
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || String(err).includes("Permission")) setMicPerm("DENIED");
      setAppState("ERROR");
      setDiagConn("CLOSED");
    }
  }

  function toggleMute() {
    if (isMuted) {
      setIsMuted(false);
      isMutedRef.current = false;
      if (scribe.isConnected) {
        scribe.unmute();
      } else if (isCallActiveRef.current && appStateRef.current !== "REGENT_SPEAKING" && appStateRef.current !== "PROCESSING") {
        startListening();
      }
    } else {
      setIsMuted(true);
      isMutedRef.current = true;
      if (scribe.isConnected) {
        scribe.mute();
      }
    }
  }

  function stopListening() { cleanupVoice(); setAppState("READY"); }

  function toggleListening() {
    if (isCallActiveRef.current) {
      toggleMute();
    } else {
      handleStartCall();
    }
  }

  function handleUserInput(text: string, fromVoice = false) {
    if (!text.trim()) return;
    // Block input when the call has officially ended — must start a new call
    const terminalStates: AppState[] = ["COMPLETE", "ESCALATION"];
    if (terminalStates.includes(appStateRef.current)) return;
    // Also block if session is in a closed/ended state
    const sessionState = sessionRef.current?.state;
    if (sessionState === "CLOSED" || sessionState === "END") return;
    if (fromVoice) metricsRef.current.sttCommit = performance.now();

    // Barge-in: if Regent is speaking or playing audio when user submits input, trigger interrupt
    if (appStateRef.current === "REGENT_SPEAKING" || currentAudioRef.current) {
      triggerBargeIn();
    }

    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    clearNoSpeechTimer();
    setTextInput("");
    setNoSpeechWarn(false);
    setAppState("PROCESSING");
    setMessages(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, role: "CUSTOMER", content: text, fromVoice }]);
    processUtterance(text);
  }

  async function processUtterance(utterance: string) {
    try {
      metricsRef.current.llmStart = performance.now();
      const currentSession = sessionRef.current;
      if (!currentSession) throw new Error("No session");

      const wasInterrupted = isInterruptedRef.current;
      isInterruptedRef.current = false;

      const res = await fetch("/api/demo/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: currentSession,
          utterance,
          isInterrupted: wasInterrupted,
        }),
      });

      if (!res.ok) throw new Error("API Error");
      const data: EngineResponse = await res.json();

      // Update session from response
      setSession(data.session);
      sessionRef.current = data.session;

      const sentimentToSpeak = data.sentimentState || data.session.sentimentState || "warm";

      setMessages(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        role: "REGENT",
        content: data.response,
        sentimentState: sentimentToSpeak,
        callerStyle: data.callerStyle || data.session.callerStyle || "neutral",
      }]);

      if (data.safety?.status === "CRITICAL" || data.shouldTransfer) {
        setAppState("ESCALATION");
        speakText(data.response, sentimentToSpeak, false);
      } else if (data.session.state === "END" || data.session.state === "CLOSED" || data.complete) {
        setIsCallActive(false);
        isCallActiveRef.current = false;
        cleanupVoice();
        setAppState("COMPLETE");
        speakText(data.response, sentimentToSpeak, true);
      } else {
        setAppState("REGENT_SPEAKING");
        speakText(data.response, sentimentToSpeak, false);
      }

      // Trigger call conclusion pipeline when ticket is confirmed or call completes
      if (
        data.session.ticketId ||
        data.session.state === "CONFIRMED" ||
        data.session.state === "CLOSED" ||
        data.session.state === "ESCALATED"
      ) {
        fetch("/api/demo/conclude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: data.session }),
        }).catch(console.error);
      }
    } catch (err) {
      console.error("[Regent]", err);
      setMessages(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        role: "REGENT",
        content: "Sorry, I had trouble processing that. Could you try again?",
      }]);
      setAppState("READY");
    }
  }

  async function speakText(text: string, sentimentState: string = "warm", isFinalTurn: boolean = false) {
    try {
      metricsRef.current.ttsStart = performance.now();
      const res = await fetch("/api/demo/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          sentimentState,
        }),
      });
      if (!res.ok) throw new Error("TTS failed");
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      audio.onplay = () => {
        metricsRef.current.firstAudio = performance.now();
        const commit = metricsRef.current.sttCommit;
        if (commit > 0) console.log(`[Metrics] TTFA: ${(metricsRef.current.firstAudio - commit).toFixed(0)}ms`);
      };
      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        if (isFinalTurn || !isCallActiveRef.current) {
          setAppState("COMPLETE");
          cleanupVoice();
          return;
        }
        if (isCallActiveRef.current) {
          setAppState("LISTENING");
          if (!isMutedRef.current) {
            if (scribe.isConnected) {
              scribe.unmute();
            } else if (scribe.status !== "connecting") {
              startListening();
            }
          }
        } else {
          setAppState("READY");
        }
      };
      audio.play();
    } catch {
      if (isFinalTurn) {
        setAppState("COMPLETE");
      } else {
        setAppState(isCallActiveRef.current ? "LISTENING" : "READY");
      }
    }
  }

  async function handleStartCall() {
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    cleanupVoice();

    setIsCallActive(true);
    isCallActiveRef.current = true;
    setIsMuted(false);
    isMutedRef.current = false;

    const freshSession = makeEmptySession(selectedTenant.trade);
    freshSession.tenantId = selectedTenant.id;
    setSession(freshSession);
    sessionRef.current = freshSession;
    setMessages([]);
    messagesRef.current = [];
    setNoSpeechWarn(false);
    setAppState("PROCESSING");

    try {
      // Pre-warm listening on the initial user gesture so microphone is connected and ready
      startListening();

      // Turn 0: Call /api/demo/respond with empty utterance to trigger Turn-0 deterministic TCPA compliance greeting
      const res = await fetch("/api/demo/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: freshSession, utterance: "" }),
      });
      const data: EngineResponse = await res.json();
      setSession(data.session);
      sessionRef.current = data.session;
      const greeting: Message = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        role: "REGENT",
        content: data.response,
        sentimentState: "warm",
        callerStyle: "neutral",
      };
      setMessages([greeting]);
      messagesRef.current = [greeting];
      setAppState("REGENT_SPEAKING");
      speakText(data.response, "warm");
    } catch {
      setAppState("READY");
    }
  }

  function handleEndCall() {
    setIsCallActive(false);
    isCallActiveRef.current = false;
    setIsMuted(false);
    isMutedRef.current = false;
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    cleanupVoice();

    // Trigger call conclusion pipeline on call wrap
    if (sessionRef.current && sessionRef.current.conversationHistory.length > 0) {
      fetch("/api/demo/conclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: sessionRef.current }),
      }).catch(console.error);
    }

    setAppState("READY");
    const freshSession = makeEmptySession(selectedTenant.trade);
    freshSession.tenantId = selectedTenant.id;
    setSession(freshSession);
    sessionRef.current = freshSession;
    setMessages([]);
    messagesRef.current = [];
    setNoSpeechWarn(false);
  }

  // ── Derived UI ────────────────────────────────────────────────────────────
  const micActive = appState === "LISTENING";
  const micBusy = appState === "CONNECTING" || appState === "REQUESTING_PERMISSION" || appState === "PROCESSING";
  const canMic = messages.length > 0 && !micBusy && appState !== "ESCALATION" && appState !== "COMPLETE";

  const stateColor: Record<AppState, string> = {
    READY: "text-slate-400", REQUESTING_PERMISSION: "text-yellow-400",
    CONNECTING: "text-blue-400", LISTENING: "text-green-400",
    NO_INPUT: "text-yellow-400", PROCESSING: "text-blue-400",
    REGENT_SPEAKING: "text-indigo-400", ESCALATION: "text-red-400",
    COMPLETE: "text-green-400", ERROR: "text-red-400",
  };

  const scenarioShortcuts = [
    { label: "AC Install", text: "Hi I am Ayush and I need a AC installation service from your end." },
    { label: "AC Not Cooling", text: "My AC completely stopped working and it's 90 degrees inside." },
    { label: "⚡ Barge-In", text: "Wait, hold on a second, actually can we schedule for Friday afternoon instead?" },
    { label: "Strike 1: Trivia", text: "Who is the president of the United States?" },
    { label: "Strike 2: Joke", text: "Tell me a joke" },
    { label: "Rushed Caller", text: "I have no time to chat, hurry up!" },
    { label: "Elderly/Confused", text: "I'm a senior citizen and I'm confused, could you speak slower?" },
    { label: "Flooded House", text: "A pipe burst and my basement is flooding with water!" },
    { label: "Request Human", text: "I just want to talk to a real person right now." },
  ];

  // ── Multi-Tenant Contractor Selection Landing ──────────────────────────────
  if (!trade) {
    return (
      <div className="w-full min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center bg-bone px-6 py-12 text-obsidian">
        <div className="max-w-4xl w-full text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-regent/10 border border-regent/30 text-regent text-xs font-bold uppercase tracking-wider mb-4">
            <Building2 className="w-3.5 h-3.5" />
            Enterprise Multi-Tenant AI Platform
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4">
            Select Your Business
          </h1>
          <p className="text-text-secondary-light max-w-2xl mx-auto mb-10 text-base">
            Each contractor runs an independent AI agent with custom covered ZIP codes, excluded service rules, and emergency after-hours dispatch fees.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            {SEED_TENANTS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setSelectedTenant(t);
                  setTrade(t.trade);
                }}
                className="p-6 border-2 border-slate/20 rounded-2xl hover:border-regent bg-white shadow-sm hover:shadow-lg transition-all flex flex-col justify-between group cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-mono bg-slate/10 px-2 py-0.5 rounded font-bold uppercase tracking-wider text-slate-600">
                      {t.trade}
                    </span>
                    <span className="text-xs text-regent font-semibold group-hover:underline">
                      AI: {t.agentName}
                    </span>
                  </div>
                  <h3 className="font-bold text-xl group-hover:text-regent transition-colors mb-2 text-obsidian">
                    {t.name}
                  </h3>
                  <div className="space-y-2 text-xs text-text-secondary-light">
                    <p>
                      <strong className="text-obsidian">Covered ZIPs:</strong>{" "}
                      {t.coveredZips.join(", ")}
                    </p>
                    <p>
                      <strong className="text-obsidian">Restrictions:</strong>{" "}
                      {t.excludedServices}
                    </p>
                    <p>
                      <strong className="text-obsidian">After-Hours:</strong>{" "}
                      {t.fee}
                    </p>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate/10 flex items-center justify-between text-xs font-bold text-regent">
                  <span>Launch Business Receptionist</span>
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Main layout ───────────────────────────────────────────────────────────
  return (
    <div className="w-full min-h-[calc(100vh-4rem)] bg-bone text-obsidian flex flex-col">

      {/* Global Unified Header & View Switcher */}
      <div className="w-full bg-obsidian text-bone px-4 py-3 flex flex-wrap justify-between items-center gap-3 border-b border-slate-800 shrink-0">
        {/* Left: Contractor info */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-regent flex items-center justify-center rounded-lg font-black text-white text-base shadow-sm">
            {selectedTenant.agentName.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm sm:text-base leading-none tracking-tight">
                {selectedTenant.name}
              </h3>
              <span className="text-[10px] font-mono bg-regent/20 text-regent border border-regent/40 px-1.5 py-0.5 rounded font-bold">
                {selectedTenant.trade}
              </span>
            </div>
            <span className="text-xs text-text-secondary-dark flex items-center gap-1 mt-0.5">
              AI Assistant: <strong className="text-bone">{selectedTenant.agentName}</strong>
            </span>
          </div>
        </div>

        {/* Center: View Switcher Toggle */}
        <div className="flex bg-slate-800/90 p-1 rounded-xl border border-slate-700/80 shadow-inner">
          <button
            id="toggle-view-voice-orb"
            onClick={() => setViewMode("VOICE_ORB")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === "VOICE_ORB"
                ? "bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-md shadow-sky-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Voice Orb View</span>
          </button>
          <button
            id="toggle-view-dispatch-console"
            onClick={() => setViewMode("DISPATCH_CONSOLE")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === "DISPATCH_CONSOLE"
                ? "bg-regent text-white shadow-md shadow-regent/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Dispatch Console View</span>
          </button>
        </div>

        {/* Right: Tenant selector + Barge-In + Status */}
        <div className="flex items-center gap-2">
          {/* Multi-Tenant Switcher */}
          <select
            value={selectedTenant.id}
            onChange={(e) => {
              const found = SEED_TENANTS.find((t) => t.id === e.target.value);
              if (found) {
                setSelectedTenant(found);
                setTrade(found.trade);
                handleEndCall();
              }
            }}
            className="bg-slate-800 text-slate-200 border border-slate-700 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-regent font-medium cursor-pointer"
          >
            {SEED_TENANTS.map((t) => (
              <option key={t.id} value={t.id}>
                🏢 {t.name} ({t.agentName})
              </option>
            ))}
          </select>

          {/* Barge-In Interactive Interrupt Button */}
          <button
            id="barge-in-interrupt-btn"
            onClick={triggerBargeIn}
            disabled={appState !== "REGENT_SPEAKING" && !currentAudioRef.current}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              appState === "REGENT_SPEAKING"
                ? "bg-amber-400 hover:bg-amber-300 text-black shadow-lg shadow-amber-400/40 scale-105 animate-pulse"
                : "bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed opacity-60"
            }`}
            title="Full Duplex Barge-In: Cut off Regent audio playback mid-sentence"
          >
            <Zap className="w-3.5 h-3.5 fill-current text-amber-500" />
            <span className="hidden sm:inline">Interrupt Regent</span>
          </button>

          {/* Status indicator */}
          <div className={`flex items-center gap-1.5 text-xs font-bold uppercase ${stateColor[appState]}`}>
            {appState === "LISTENING" && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
              </span>
            )}
            {micActive && <Radio className="w-3 h-3 animate-pulse" />}
            {appState === "PROCESSING" && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{isMuted ? "MUTED" : appState.replace(/_/g, " ")}</span>
          </div>
        </div>
      </div>

      {/* VIEW CONTENT AREA */}
      {viewMode === "VOICE_ORB" ? (
        /* VOICE ORB VIEW (Celestial glowing sphere with hands-free duplex voice loop) */
        <div className="flex-1 flex flex-col justify-between items-center p-6 bg-gradient-to-b from-white via-bone/30 to-bone/60 select-none overflow-y-auto min-h-[calc(100vh-8.5rem)]">
          {/* Top Trade Pill */}
          <div className="pt-2 text-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium border border-slate-200">
              <Sparkles className="w-3 h-3 text-sky-500" />
              <span>{selectedTenant.name} &bull; {selectedTenant.agentName} ({selectedTenant.trade})</span>
            </span>
          </div>

          {/* Center Orb & Speaking Caption */}
          <div className="flex flex-col items-center justify-center my-auto py-8">
            <div
              onClick={() => {
                if (!isCallActive) handleStartCall();
                else toggleMute();
              }}
              className={`voice-orb w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 cursor-pointer transition-transform duration-300 hover:scale-105 ${
                !isCallActive
                  ? "idle opacity-90 hover:opacity-100"
                  : isMuted
                  ? "muted"
                  : appState === "REGENT_SPEAKING"
                  ? "speaking"
                  : appState === "LISTENING"
                  ? "listening"
                  : appState === "PROCESSING"
                  ? "processing"
                  : "idle"
              }`}
              title={!isCallActive ? "Click to start call" : isMuted ? "Click to unmute mic" : "Click to mute mic"}
            />

            {/* Status caption matching user image ("Speaking...") */}
            <div className="mt-8 text-center min-h-[4rem]">
              <p className="text-base sm:text-lg font-medium text-slate-600 tracking-wide">
                {!isCallActive ? (
                  "Ready to talk..."
                ) : isMuted ? (
                  <span className="text-red-500 font-semibold flex items-center justify-center gap-1.5">
                    <MicOff className="w-4 h-4" /> Microphone Muted
                  </span>
                ) : appState === "REGENT_SPEAKING" ? (
                  <span className="text-sky-600 font-semibold flex items-center justify-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />
                    Speaking...
                  </span>
                ) : appState === "LISTENING" ? (
                  <span className="text-emerald-600 font-semibold flex items-center justify-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Listening... (Hands-free active)
                  </span>
                ) : appState === "PROCESSING" ? (
                  <span className="text-indigo-600 font-semibold flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                    Thinking...
                  </span>
                ) : (
                  "Connected..."
                )}
              </p>

              {/* Live Speech Subtitle */}
              {partialText && (
                <div className="mt-3 max-w-lg mx-auto px-4 py-2 bg-emerald-50 border border-emerald-200/80 rounded-full text-xs text-emerald-800 shadow-xs">
                  <span className="font-bold mr-1.5">You:</span>
                  <span className="italic">{partialText}</span>
                </div>
              )}

              {!partialText && messages.length > 0 && messages[messages.length - 1].role === "REGENT" && (
                <p className="mt-2 max-w-md mx-auto text-xs text-slate-400 line-clamp-2 px-4">
                  &ldquo;{messages[messages.length - 1].content}&rdquo;
                </p>
              )}
            </div>
          </div>

          {/* Bottom Floating Control Pill (matching user screenshot) */}
          <div className="w-full max-w-xl mx-auto px-4 pb-4 flex flex-col items-center gap-3">
            <div className="w-full flex items-center gap-3">
              {/* Rounded Pill Text Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleUserInput(textInput);
                }}
                className="flex-1 relative flex items-center"
              >
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Or send a message..."
                  disabled={!isCallActive || appState === "PROCESSING"}
                  className="w-full bg-white border border-slate-300/90 rounded-full pl-5 pr-11 py-3.5 text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition-all disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!textInput.trim() || appState === "PROCESSING"}
                  className="absolute right-3.5 p-1.5 text-slate-400 hover:text-sky-600 disabled:opacity-30 transition-colors cursor-pointer"
                  title="Send message"
                >
                  <Send className="w-4 h-4 fill-current rotate-45 -translate-y-0.5" />
                </button>
              </form>

              {/* Circular Black Mute / Unmute Button (Exact Match to user screenshot) */}
              {isCallActive ? (
                <>
                  <button
                    id="orb-mute-btn"
                    onClick={toggleMute}
                    className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 shadow-lg transition-all cursor-pointer ${
                      isMuted
                        ? "bg-slate-900 text-red-400 ring-2 ring-red-400/50 hover:bg-black"
                        : "bg-black text-white hover:bg-slate-800 active:scale-95"
                    }`}
                    title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                  >
                    {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>

                  {/* Circular Red End Call Button */}
                  <button
                    id="orb-end-call-btn"
                    onClick={handleEndCall}
                    className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shrink-0 shadow-lg active:scale-95 transition-all cursor-pointer"
                    title="End Call"
                  >
                    <PhoneOff className="w-5 h-5" />
                  </button>
                </>
              ) : (
                <button
                  id="orb-start-call-btn"
                  onClick={handleStartCall}
                  className="px-6 py-3.5 rounded-full bg-black text-white text-sm font-bold shadow-lg hover:bg-slate-800 active:scale-95 transition-all flex items-center gap-2 shrink-0 cursor-pointer"
                >
                  <PhoneCall className="w-4 h-4 text-emerald-400" />
                  <span>Start Call</span>
                </button>
              )}
            </div>

            {/* Quick Test Scenario Chips */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">
                Quick Scenarios:
              </span>
              {scenarioShortcuts.slice(0, 5).map((s, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (!isCallActive) {
                      handleStartCall().then(() => {
                        setTimeout(() => handleUserInput(s.text), 1500);
                      });
                    } else {
                      handleUserInput(s.text);
                    }
                  }}
                  disabled={appState === "PROCESSING"}
                  className="text-[11px] bg-white hover:bg-slate-100 text-slate-700 font-medium px-3 py-1 rounded-full border border-slate-200 shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Collapsible Transcript Drawer */}
            {messages.length > 0 && (
              <details className="w-full max-w-xl text-xs bg-white border border-slate-200 rounded-xl overflow-hidden mt-1 shadow-2xs">
                <summary className="px-4 py-2 cursor-pointer font-medium text-slate-600 hover:text-slate-900 flex items-center justify-between select-none">
                  <span>View Call Transcript ({messages.length} messages)</span>
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </summary>
                <div className="p-4 space-y-2.5 max-h-48 overflow-y-auto border-t border-slate-100 bg-slate-50/50">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`text-xs ${m.role === "CUSTOMER" ? "text-right" : "text-left"}`}
                    >
                      <span className="font-bold text-slate-500 uppercase text-[10px] mr-1">
                        {m.role === "CUSTOMER" ? "You:" : `${selectedTenant.agentName}:`}
                      </span>
                      <span className={m.role === "CUSTOMER" ? "text-slate-800" : "text-sky-700 font-medium"}>
                        {m.content}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      ) : (
        /* DISPATCH CONSOLE VIEW (Operational 2-column view) */
        <div className="flex-1 flex flex-col lg:flex-row p-4 gap-4 overflow-hidden">
          {/* LEFT — Transcript */}
          <div className="flex-1 flex flex-col bg-white border border-slate/20 rounded-xl overflow-hidden shadow-sm h-[calc(100vh-8.5rem)]">
            {/* Header */}
            <div className="bg-slate-900 text-bone px-4 py-2.5 flex justify-between items-center border-b border-slate-800 shrink-0">
              <span className="text-xs font-mono font-bold tracking-wider uppercase text-slate-300 flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-regent" />
                Conversation Transcript ({messages.length} turns)
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {isCallActive ? (isMuted ? "🔴 Mic Muted" : "🟢 Hands-Free Voice Active") : "⚪ Call Idle"}
              </span>
            </div>

            {/* Messages */}
            <div ref={transcriptRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate/5">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
                  <PhoneCall className="w-12 h-12 text-slate/40" />
                  <h4 className="font-bold text-xl text-obsidian">Ready to answer</h4>
                  <p className="text-sm text-text-secondary-light">
                    Click &quot;Start Call&quot; to simulate a customer calling your missed-call number.
                  </p>
                  <button onClick={handleStartCall}
                    className="mt-4 px-8 py-3 bg-regent text-bone font-bold rounded hover:bg-regent/90 transition-colors cursor-pointer">
                    Start Call
                  </button>
                </div>
              ) : (
                messages.map(m => (
                  <div key={m.id} className={`flex ${m.role === "CUSTOMER" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl p-4 ${
                      m.role === "CUSTOMER"
                        ? "bg-obsidian text-bone rounded-tr-sm"
                        : "bg-white border border-slate/20 text-obsidian rounded-tl-sm shadow-sm"
                    }`}>
                      <div className={`text-[10px] uppercase font-bold mb-1.5 flex items-center justify-between gap-2 ${
                        m.role === "CUSTOMER" ? "text-text-secondary-dark" : "text-text-secondary-light"
                      }`}>
                        <span className="flex items-center gap-1">
                          {m.role}
                          {m.fromVoice && <Mic className="w-2.5 h-2.5 text-regent" />}
                        </span>

                        {/* Emotional Voice Prosody Badge */}
                        {m.role === "REGENT" && m.sentimentState && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-bold border tracking-wider flex items-center gap-1 shrink-0 ${
                              m.sentimentState === "urgent"
                                ? "bg-red-50 text-red-700 border-red-300 animate-pulse"
                                : m.sentimentState === "empathetic"
                                ? "bg-pink-50 text-pink-700 border-pink-300"
                                : m.sentimentState === "calm"
                                ? "bg-teal-50 text-teal-700 border-teal-300"
                                : "bg-amber-50 text-amber-700 border-amber-300"
                            }`}
                          >
                            {m.sentimentState === "urgent" && "⚡ URGENT PROSODY"}
                            {m.sentimentState === "empathetic" && "❤️ EMPATHETIC PROSODY"}
                            {m.sentimentState === "calm" && "🌿 CALM PROSODY"}
                            {m.sentimentState === "warm" && "☀️ WARM PROSODY"}
                          </span>
                        )}

                        {/* Caller Adaptation Style Tag */}
                        {m.role === "CUSTOMER" && m.callerStyle && m.callerStyle !== "neutral" && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            {m.callerStyle === "rushed" && "Rushed Caller"}
                            {m.callerStyle === "elderly_confused" && "Confused/Elderly"}
                            {m.callerStyle === "angry_frustrated" && "Angry/Frustrated"}
                          </span>
                        )}
                      </div>
                      <FormattedMessageContent content={m.content} role={m.role} />
                    </div>
                  </div>
                ))
              )}

              {partialText && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl p-4 bg-obsidian/60 text-bone/70 rounded-tr-sm border border-green-400/30">
                    <span className="text-[10px] uppercase font-bold mb-1 flex items-center gap-1 text-green-400">
                      <Radio className="w-2.5 h-2.5 animate-pulse" /> SPEAKING...
                    </span>
                    <p className="text-sm leading-relaxed italic">{partialText}</p>
                  </div>
                </div>
              )}

              {appState === "PROCESSING" && (
                <div className="flex justify-start">
                  <div className="bg-white border border-slate/20 rounded-2xl rounded-tl-sm p-4 shadow-sm">
                    <span className="flex gap-1 items-center h-5">
                      <span className="w-2 h-2 bg-slate/40 rounded-full animate-bounce" />
                      <span className="w-2 h-2 bg-slate/40 rounded-full animate-bounce [animation-delay:75ms]" />
                      <span className="w-2 h-2 bg-slate/40 rounded-full animate-bounce [animation-delay:150ms]" />
                    </span>
                  </div>
                </div>
              )}

              {noSpeechWarn && (
                <div className="flex justify-start">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-2xl rounded-tl-sm p-3 text-sm text-yellow-800 max-w-[80%]">
                    I didn&apos;t hear anything — try speaking again, or type your request below.
                  </div>
                </div>
              )}
            </div>

            {/* Input bar */}
            {messages.length > 0 && (
              <div className="p-4 bg-white border-t border-slate/20 shrink-0">
                {appState === "ESCALATION" || appState === "COMPLETE" ? (
                  <button onClick={handleEndCall}
                    className="w-full py-3 bg-obsidian text-bone rounded font-bold hover:bg-obsidian/90 transition-colors cursor-pointer">
                    Start New Call
                  </button>
                ) : (
                  <div className="space-y-3">
                    {appState === "ERROR" && (
                      <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2">
                        I&apos;m having trouble listening. Try the mic again, or type your message below.
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button id="mic-toggle-btn" onClick={toggleMute} disabled={!isCallActive}
                        title={isMuted ? "Unmute mic" : "Mute mic (Hands-free active)"}
                        className={`p-3 rounded-full flex-shrink-0 transition-all duration-200 cursor-pointer ${
                          isMuted
                            ? "bg-slate-900 text-red-400 ring-2 ring-red-400"
                            : appState === "LISTENING"
                            ? "bg-green-500 text-white shadow-lg shadow-green-200 scale-110"
                            : "bg-slate/10 text-obsidian hover:bg-slate/20"
                        }`}>
                        {micBusy ? <Loader2 className="w-6 h-6 animate-spin" />
                        : isMuted ? <MicOff className="w-6 h-6" />
                        : <Mic className="w-6 h-6" />}
                      </button>
                      <form onSubmit={e => { e.preventDefault(); handleUserInput(textInput); }} className="flex-1 flex gap-2">
                        <input id="text-input" type="text" value={textInput}
                          onChange={e => setTextInput(e.target.value)}
                          placeholder="Type your message or just speak freely..."
                          disabled={appState === "PROCESSING"}
                          className="flex-1 bg-slate/5 border border-slate/20 rounded-full px-4 text-sm focus:outline-none focus:border-regent disabled:opacity-50" />
                        <button type="submit" id="send-btn"
                          disabled={!textInput.trim() || appState === "PROCESSING"}
                          className="p-3 bg-regent text-bone rounded-full disabled:opacity-50 cursor-pointer">
                          <Send className="w-5 h-5" />
                        </button>
                      </form>
                      <button id="end-call-btn" onClick={handleEndCall}
                        className="p-3 bg-emergency/10 text-emergency rounded-full hover:bg-emergency/20 transition-colors flex-shrink-0 cursor-pointer"
                        title="End Call">
                        <PhoneOff className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-slate/10">
                      <span className="text-xs text-text-secondary-light flex items-center font-semibold uppercase tracking-wider mr-2">
                        Try:
                      </span>
                      {scenarioShortcuts.map((s, i) => (
                        <button key={i} onClick={() => handleUserInput(s.text)}
                          disabled={appState === "PROCESSING"}
                          className="text-xs bg-slate/10 hover:bg-slate/20 text-obsidian px-3 py-1.5 rounded transition-colors disabled:opacity-50 cursor-pointer">
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT — Tabbed Card: Lead Capture | Day-Of Dispatch (iPhone) | Booking SMS */}
          <div className="w-full lg:w-96 flex flex-col gap-3">
            {/* Tab Navigation Controls */}
            <div className="flex bg-slate-200 p-1 rounded-xl gap-1 shrink-0 border border-slate-300">
              <button
                onClick={() => setRightTab("LEAD")}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  rightTab === "LEAD"
                    ? "bg-white text-obsidian shadow-xs"
                    : "text-slate-600 hover:text-obsidian"
                }`}
              >
                Lead Capture
              </button>
              <button
                id="tab-day-of-sms"
                onClick={() => setRightTab("DAY_OF_SMS")}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  rightTab === "DAY_OF_SMS"
                    ? "bg-sky-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-obsidian"
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Day-Of Dispatch</span>
              </button>
              <button
                onClick={() => setRightTab("BOOKING_SMS")}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  rightTab === "BOOKING_SMS"
                    ? "bg-white text-obsidian shadow-xs"
                    : "text-slate-600 hover:text-obsidian"
                }`}
              >
                Booking SMS
              </button>
            </div>

            {/* Tab 1: Live Lead Capture */}
            {rightTab === "LEAD" && (
              <div className="bg-white border border-slate/20 rounded-xl shadow-sm overflow-hidden flex-1 max-h-[calc(60vh)] flex flex-col">
                <div className="bg-obsidian text-bone p-4 border-b border-slate/20 flex justify-between items-center shrink-0">
                  <h4 className="font-bold text-sm">LIVE LEAD CAPTURE</h4>
                  {appState === "COMPLETE" && <span className="text-xs bg-regent text-bone px-2 py-1 rounded font-bold">CAPTURED</span>}
                  {appState === "ESCALATION" && <span className="text-xs bg-emergency text-bone px-2 py-1 rounded font-bold">ESCALATED</span>}
                </div>

                <div className="p-4 space-y-3 overflow-y-auto flex-1 bg-[#EBE8E0]/30">
                  {/* Request context */}
                  {session && (
                    <div className="bg-white p-3 rounded-lg border border-slate/20 shadow-sm space-y-1.5">
                      <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider">Request</span>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                        <span className="text-slate-400">Trade:</span>
                        <span className="font-bold">{session.trade ?? "—"}</span>
                        <span className="text-slate-400">Type:</span>
                        <span className="font-medium">{session.requestType ?? "—"}</span>
                        <span className="text-slate-400">Service:</span>
                        <span className="font-medium text-regent">{session.primaryService ?? "—"}</span>
                        {session.additionalServices.length > 0 && <>
                          <span className="text-slate-400">Also:</span>
                          <span className="font-medium text-xs">{session.additionalServices.join(", ")}</span>
                        </>}
                      </div>
                    </div>
                  )}

                  {/* Lead details table */}
                  <div className="bg-white p-3 rounded-lg border border-slate/20 shadow-sm space-y-2">
                    <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider">Contact Information</span>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between py-1 border-b border-slate/10">
                        <span className="text-slate-400">Name:</span>
                        <span className="font-medium text-obsidian">{session?.lead.name?.value || "—"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate/10">
                        <span className="text-slate-400">Phone:</span>
                        <span className="font-medium text-obsidian">{session?.lead.phone?.value || "—"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate/10">
                        <span className="text-slate-400">Address:</span>
                        <span className="font-medium text-obsidian text-right max-w-[65%] truncate">{session?.lead.address?.value || "—"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate/10">
                        <span className="text-slate-400">ZIP Code:</span>
                        <span className="font-medium text-obsidian">
                          {(session?.lead as any)?.zip?.value || session?.lead.address?.value?.match(/\b\d{5}\b/)?.[0] || "—"}
                        </span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-400">Timing:</span>
                        <span className="font-medium text-obsidian text-right max-w-[65%] truncate">{session?.lead.timing?.value || "—"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Operational Status */}
                  {session && (
                    <div className="bg-white p-3 rounded-lg border border-slate/20 shadow-sm space-y-2 text-xs">
                      <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider">Operational Checks</span>
                      <div className="flex justify-between py-0.5">
                        <span className="text-slate-400">ZIP In Area:</span>
                        {(() => {
                          const zipVal = (session.lead as any)?.zip?.value || session.lead.address?.value?.match(/\b\d{5}\b/)?.[0] || "";
                          const isCovered = zipVal && selectedTenant.coveredZips.includes(zipVal);
                          return (
                            <span className={isCovered ? "text-emerald-600 font-bold" : "text-slate-500"}>
                              {zipVal ? (isCovered ? "✓ Covered" : "✗ Out of area") : "—"}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex justify-between py-0.5">
                        <span className="text-slate-400">Safety Status:</span>
                        <span className={session.safety.status === "CRITICAL" ? "text-red-600 font-bold" : "text-emerald-600 font-medium"}>
                          {session.safety.status}
                        </span>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <span className="text-slate-400">Dispatch Fee:</span>
                        <span className="text-slate-700 font-medium">{(session as any).dispatchFeeQuote || selectedTenant.fee}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 2: iPhone Day-Of Dispatch Simulator */}
            {rightTab === "DAY_OF_SMS" && (
              <DayOfDispatchSimulator selectedTenant={selectedTenant} />
            )}

            {/* Tab 3: Booking SMS Confirmation Simulator */}
            {rightTab === "BOOKING_SMS" && (
              <SmsDispatchSimulator session={session} trade={trade} />
            )}

            {/* Diagnostics Accordion */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <button
                onClick={() => setDiagOpen(!diagOpen)}
                className="w-full px-4 py-2.5 bg-slate-950 flex justify-between items-center text-xs font-mono text-slate-300 hover:text-white cursor-pointer"
              >
                <span className="flex items-center gap-1.5 font-bold">
                  <Activity className="w-3.5 h-3.5 text-regent" />
                  ENGINE & AUDIO DIAGNOSTICS
                </span>
                {diagOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {diagOpen && session && (
                <div className="p-3 space-y-2 text-xs font-mono bg-slate-950/80 max-h-60 overflow-y-auto">
                  {/* Field State */}
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Field State</p>
                    {(Object.entries(session.lead) as [string, any][]).map(([k, v]) => (
                      <FieldDiagRow key={k} label={k} value={v?.value ?? null} status={v?.status ?? "—"} />
                    ))}
                  </div>

                  {/* Missing */}
                  <div className="border-t border-white/10 pt-2">
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Missing Required</p>
                    {session.missingFields.length === 0
                      ? <span className="text-green-400 text-[10px]">None ✓</span>
                      : session.missingFields.map(f => (
                          <div key={f} className="text-red-400 text-[10px]">• {f}</div>
                        ))
                    }
                  </div>

                  {/* Next action reason */}
                  <div className="border-t border-white/10 pt-2">
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Next Action Reason</p>
                    <p className="text-yellow-300 text-[10px] leading-relaxed">{session.diagnosticReason || "—"}</p>
                  </div>

                  {/* Question Ledger */}
                  {session.questionLedger.length > 0 && (
                    <div className="border-t border-white/10 pt-2">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Question Ledger</p>
                      {session.questionLedger.slice(-5).map(e => (
                        <div key={e.questionId} className="flex justify-between text-[9px] gap-1">
                          <span className="text-slate-500">{e.field}</span>
                          <span className={e.status === "ANSWERED" ? "text-green-400" : "text-yellow-400"}>
                            {e.status} (T{e.turnAsked}→{e.answerTurn ?? "?"})</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Corrections */}
                  {session.corrections.length > 0 && (
                    <div className="border-t border-white/10 pt-2">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Corrections</p>
                      {session.corrections.slice(-3).map((c, i) => (
                        <div key={i} className="text-[9px] text-orange-300">
                          {c.field}: "{c.oldValue}" → "{c.newValue}"
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Safety */}
                  <div className="border-t border-white/10 pt-2">
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Safety</p>
                    <DiagRow label="Status" value={session.safety.status} ok={session.safety.status === "NORMAL"} />
                  </div>

                  {/* Microphone / Scribe */}
                  <div className="border-t border-white/10 pt-2">
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Microphone / Scribe</p>
                    <DiagRow label="Permission" value={micPermission} ok={micPermission === "GRANTED"} />
                    <DiagRow label="SDK Status" value={scribe.status.toUpperCase()} ok={scribe.isConnected} />
                    <DiagRow label="Connection" value={diagConn} ok={diagConn === "OPEN"} />
                    <DiagRow label="Session" value={diagSession || "—"} ok={!!diagSession} />
                    <DiagRow label="Partials" value={String(diagPartials)} ok />
                    <DiagRow label="Committed" value={String(diagCommitted)} ok />
                  </div>

                  {/* App state */}
                  <div className="border-t border-white/10 pt-2">
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">App</p>
                    <DiagRow label="App State" value={appState} ok={appState !== "ERROR"} />
                  </div>

                  {partialText && (
                    <div className="border-t border-white/10 pt-2">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Live Partial</p>
                      <p className="text-green-400 text-[10px] leading-relaxed line-clamp-3">{partialText}</p>
                    </div>
                  )}
                </div>
              )}

              {!diagOpen && (
                <div className="px-4 py-2 text-[10px] font-mono flex gap-4">
                  <span className="text-slate-500">State: <span className="text-white">{session?.state ?? "—"}</span></span>
                  <span className="text-slate-500">Action: <span className="text-yellow-300">{session?.currentAction ?? "—"}</span></span>
                  <span className="text-slate-500">Missing: <span className={session && session.missingFields.length === 0 ? "text-green-400" : "text-red-400"}>{session?.missingFields.length ?? "—"}</span></span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}