"use client";

import { useState, useRef, useEffect } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import {
  Mic, MicOff, PhoneOff, AlertTriangle, Send, PhoneCall,
  CheckCircle2, User, Radio, Activity, Loader2, ChevronDown, ChevronUp
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function DemoPage() {
  const [trade, setTrade] = useState<Trade | null>(null);
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
  const tradeRef = useRef<Trade | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const sessionRef = useRef<ConversationSession | null>(null);
  const appStateRef = useRef<AppState>("READY");
  const noSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef({ sttCommit: 0, llmStart: 0, ttsStart: 0, firstAudio: 0 });

  useEffect(() => {
    tradeRef.current = trade;
    messagesRef.current = messages;
    sessionRef.current = session;
    appStateRef.current = appState;
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
      setPartialText(data.text);
      setDiagPartials(p => p + 1);
      resetNoSpeechTimer();
    };

    cbCommittedTranscript.current = (data) => {
      const text = (data.text || "").trim();
      if (!text) return;
      setPartialText("");
      const key = `${sessionIdRef.current}|${text}`;
      if (processedRef.current.has(key)) return;
      processedRef.current.add(key);
      setDiagCommitted(c => c + 1);
      metricsRef.current.sttCommit = performance.now();
      scribe.disconnect();
      handleUserInput(text, true);
    };

    cbDisconnect.current = () => {
      setDiagConn("CLOSED");
      setAppState(prev => (prev === "LISTENING" || prev === "CONNECTING") ? "READY" : prev);
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

  function stopListening() { cleanupVoice(); setAppState("READY"); }

  function toggleListening() {
    const s = appStateRef.current;
    if (s === "LISTENING" || s === "NO_INPUT") stopListening();
    else if (s === "READY" || s === "REGENT_SPEAKING" || s === "ERROR") startListening();
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
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    clearNoSpeechTimer();
    setTextInput("");
    setNoSpeechWarn(false);
    setAppState("PROCESSING");
    setMessages(prev => [...prev, { id: Date.now().toString(), role: "CUSTOMER", content: text, fromVoice }]);
    processUtterance(text);
  }

  async function processUtterance(utterance: string) {
    try {
      metricsRef.current.llmStart = performance.now();
      const currentSession = sessionRef.current;
      if (!currentSession) throw new Error("No session");

      const res = await fetch("/api/demo/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: currentSession, utterance }),
      });

      if (!res.ok) throw new Error("API Error");
      const data: EngineResponse = await res.json();

      // Update session from response
      setSession(data.session);
      sessionRef.current = data.session;

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: "REGENT",
        content: data.response,
      }]);

      if (data.safety?.status === "CRITICAL" || data.shouldTransfer) {
        setAppState("ESCALATION");
        speakText(data.response);
      } else if (data.session.state === "END" || data.session.state === "CLOSED") {
        setAppState("COMPLETE");
        speakText(data.response);
      } else {
        setAppState("REGENT_SPEAKING");
        speakText(data.response);
      }
    } catch (err) {
      console.error("[Regent]", err);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: "REGENT",
        content: "Sorry, I had trouble processing that. Could you try again?",
      }]);
      setAppState("READY");
    }
  }

  async function speakText(text: string) {
    try {
      metricsRef.current.ttsStart = performance.now();
      const res = await fetch("/api/demo/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId: "EXAVITQu4vr4xnSDxMaL" }),
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
        setAppState(prev => prev === "REGENT_SPEAKING" ? "READY" : prev);
      };
      audio.play();
    } catch {
      setAppState("READY");
    }
  }

  async function handleStartCall() {
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    cleanupVoice();

    const freshSession = makeEmptySession(trade);
    setSession(freshSession);
    sessionRef.current = freshSession;
    setMessages([]);
    messagesRef.current = [];
    setNoSpeechWarn(false);
    setAppState("PROCESSING");

    try {
      const res = await fetch("/api/demo/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: freshSession, utterance: "Hello" }),
      });
      const data: EngineResponse = await res.json();
      setSession(data.session);
      sessionRef.current = data.session;
      const greeting: Message = { id: Date.now().toString(), role: "REGENT", content: data.response };
      setMessages([greeting]);
      messagesRef.current = [greeting];
      setAppState("REGENT_SPEAKING");
      speakText(data.response);
    } catch {
      setAppState("READY");
    }
  }

  function handleEndCall() {
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    cleanupVoice();
    setAppState("READY");
    const freshSession = makeEmptySession(trade);
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
    { label: "Smell Gas", text: "I smell gas coming from the furnace area." },
    { label: "Request Human", text: "I just want to talk to a real person right now." },
  ];

  // ── Trade selector ────────────────────────────────────────────────────────
  if (!trade) {
    return (
      <div className="w-full min-h-[calc(100vh-4rem)] flex flex-col items-center bg-bone px-6 py-12 text-obsidian">
        <div className="max-w-3xl w-full text-center">
          <h1 className="text-4xl font-bold tracking-tight mb-4">Interactive Regent Demo</h1>
          <p className="text-text-secondary-light mb-12">
            Experience how Regent handles a missed call in real-time. Choose your industry to begin.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(["HVAC", "PLUMBING", "ELECTRICAL"] as Trade[]).map((t) => (
              <button key={t}
                onClick={() => { setTrade(t); }}
                className="p-8 border-2 border-slate/20 rounded-xl hover:border-regent bg-white shadow-sm transition-all flex flex-col items-center justify-center group"
              >
                <span className="font-bold text-xl group-hover:text-regent">{t}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Main layout ───────────────────────────────────────────────────────────
  return (
    <div className="w-full min-h-[calc(100vh-4rem)] bg-bone text-obsidian flex flex-col lg:flex-row p-4 gap-4">

      {/* LEFT — Transcript */}
      <div className="flex-1 flex flex-col bg-white border border-slate/20 rounded-xl overflow-hidden shadow-sm h-[calc(100vh-6rem)]">

        {/* Header */}
        <div className="bg-obsidian text-bone p-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-regent flex items-center justify-center rounded-sm font-bold">R</div>
            <div>
              <h3 className="font-bold leading-none">REGENT ENGINE</h3>
              <span className="text-xs text-text-secondary-dark">{trade} Configuration</span>
            </div>
          </div>
          <div className={`flex items-center gap-2 text-xs font-bold uppercase ${stateColor[appState]}`}>
            {appState === "LISTENING" && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
              </span>
            )}
            {micActive && <Radio className="w-3 h-3 animate-pulse" />}
            {appState === "PROCESSING" && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{appState.replace(/_/g, " ")}</span>
          </div>
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
                className="mt-4 px-8 py-3 bg-regent text-bone font-bold rounded hover:bg-regent/90 transition-colors">
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
                  <span className={`text-[10px] uppercase font-bold mb-1 flex items-center gap-1 ${
                    m.role === "CUSTOMER" ? "text-text-secondary-dark" : "text-text-secondary-light"
                  }`}>
                    {m.role}
                    {m.fromVoice && <Mic className="w-2.5 h-2.5" />}
                  </span>
                  <p className="text-sm md:text-base leading-relaxed">{m.content}</p>
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
                className="w-full py-3 bg-obsidian text-bone rounded font-bold hover:bg-obsidian/90 transition-colors">
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
                  <button id="mic-toggle-btn" onClick={toggleListening} disabled={!canMic}
                    title={micActive ? "Stop listening" : "Start listening"}
                    className={`p-3 rounded-full flex-shrink-0 transition-all duration-200 ${
                      micActive ? "bg-green-500 text-white shadow-lg shadow-green-200 scale-110"
                      : appState === "ERROR" ? "bg-red-100 text-red-500 hover:bg-red-200"
                      : micBusy ? "bg-slate/10 text-slate/40 cursor-not-allowed"
                      : "bg-slate/10 text-obsidian hover:bg-slate/20"
                    }`}>
                    {micBusy ? <Loader2 className="w-6 h-6 animate-spin" />
                    : micActive ? <MicOff className="w-6 h-6" />
                    : <Mic className="w-6 h-6" />}
                  </button>
                  <form onSubmit={e => { e.preventDefault(); handleUserInput(textInput); }} className="flex-1 flex gap-2">
                    <input id="text-input" type="text" value={textInput}
                      onChange={e => setTextInput(e.target.value)}
                      placeholder="Type your message or use the mic..."
                      disabled={appState === "PROCESSING"}
                      className="flex-1 bg-slate/5 border border-slate/20 rounded-full px-4 text-sm focus:outline-none focus:border-regent disabled:opacity-50" />
                    <button type="submit" id="send-btn"
                      disabled={!textInput.trim() || appState === "PROCESSING"}
                      className="p-3 bg-regent text-bone rounded-full disabled:opacity-50">
                      <Send className="w-5 h-5" />
                    </button>
                  </form>
                  <button id="end-call-btn" onClick={handleEndCall}
                    className="p-3 bg-emergency/10 text-emergency rounded-full hover:bg-emergency/20 transition-colors flex-shrink-0"
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
                      className="text-xs bg-slate/10 hover:bg-slate/20 text-obsidian px-3 py-1.5 rounded transition-colors disabled:opacity-50">
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT — Lead card + Diagnostic */}
      <div className="w-full lg:w-96 flex flex-col gap-4">

        {/* Lead card */}
        <div className="bg-white border border-slate/20 rounded-xl shadow-sm overflow-hidden flex-1 max-h-[calc(55vh)] flex flex-col">
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

            {/* Contact */}
            <div className="bg-white p-3 rounded-lg border border-slate/20 shadow-sm space-y-2">
              <div className="flex items-start gap-2">
                <div className="p-1.5 bg-slate/5 rounded-full"><User className="w-4 h-4 text-slate" /></div>
                <div className="flex-1">
                  <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider mb-0.5">Name</span>
                  {session?.lead.name?.value
                    ? <span className="font-bold text-obsidian">{session.lead.name.value}</span>
                    : <span className="text-slate/40 italic text-sm">Awaiting...</span>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate/10">
                <div>
                  <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider mb-0.5">Phone</span>
                  {session?.lead.phone?.value
                    ? <span className="font-medium text-obsidian text-sm">{session.lead.phone.value}</span>
                    : <span className="text-slate/40 italic text-xs">Demo caller ID</span>}
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider mb-0.5">Urgency</span>
                  {session?.lead.urgency?.value
                    ? <span className={`font-bold text-sm ${session.lead.urgency.value === "CRITICAL" ? "text-emergency" : session.lead.urgency.value === "HIGH" ? "text-amber-600" : "text-obsidian"}`}>{session.lead.urgency.value}</span>
                    : <span className="text-slate/40 italic text-xs">Pending</span>}
                </div>
              </div>
            </div>

            <div className="bg-white p-3 rounded-lg border border-slate/20 shadow-sm">
              <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider mb-0.5">Address</span>
              {session?.lead.address?.value
                ? <span className="font-medium text-obsidian text-sm">{session.lead.address.value}</span>
                : <span className="text-slate/40 italic text-sm">Awaiting...</span>}
            </div>

            {session?.lead.problem?.value && (
              <div className="bg-slate/5 p-2 rounded border border-slate/10">
                <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider mb-0.5">Problem</span>
                <p className="font-medium text-obsidian text-sm">{session.lead.problem.value}</p>
              </div>
            )}

            {appState === "COMPLETE" && (
              <div className="bg-regent/10 border border-regent/30 p-3 rounded-lg text-center">
                <CheckCircle2 className="w-7 h-7 text-regent mx-auto mb-1" />
                <h4 className="font-bold text-regent text-sm">CALLBACK REQUIRED</h4>
                <p className="text-xs text-regent/80 mt-0.5">Lead captured — team notified.</p>
                {session?.ticketId && <p className="text-xs font-mono mt-1 text-regent">{session.ticketId}</p>}
              </div>
            )}

            {appState === "ESCALATION" && (
              <div className="bg-emergency/10 border border-emergency/30 p-3 rounded-lg text-center">
                <AlertTriangle className="w-7 h-7 text-emergency mx-auto mb-1" />
                <h4 className="font-bold text-emergency text-sm">ESCALATION</h4>
                <p className="text-xs text-emergency/80 mt-0.5">Intake halted — safety or human transfer.</p>
              </div>
            )}
          </div>
        </div>

        {/* ── DEV DIAGNOSTIC PANEL (development-only) ── */}
        {process.env.NODE_ENV !== "production" && (
          <div className="bg-obsidian text-bone rounded-xl border border-slate/20 shadow-sm overflow-hidden">
            <button
              onClick={() => setDiagOpen(o => !o)}
              className="w-full px-4 py-2 border-b border-white/10 flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Dev Diagnostic</span>
              </div>
              {diagOpen ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
            </button>

            {diagOpen && session && (
              <div className="p-3 space-y-3 text-xs font-mono overflow-y-auto max-h-[50vh]">

                {/* Intent / Action */}
                <div>
                  <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Conversation</p>
                  <DiagRow label="State" value={session.state} ok={session.state !== "ESCALATED"} />
                  <DiagRow label="Intent" value={session.intent ?? "—"} ok={!!session.intent} />
                  <DiagRow label="Action" value={session.currentAction} ok={session.currentAction !== "CLARIFY_FIELD"} />
                  <DiagRow label="Turn" value={String(session.turnCount)} ok />
                  <DiagRow label="Behavior" value={session.customerBehavior} ok={session.customerBehavior !== "ANGRY"} />
                </div>

                {/* Service */}
                <div className="border-t border-white/10 pt-2">
                  <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Service Recognition</p>
                  <DiagRow label="Trade" value={session.trade ?? "—"} ok={!!session.trade} />
                  <DiagRow label="RequestType" value={session.requestType ?? "—"} ok={!!session.requestType} />
                  <DiagRow label="Primary Service" value={session.primaryService ?? "—"} ok={!!session.primaryService} />
                  {session.additionalServices.length > 0 && (
                    <DiagRow label="Additional" value={session.additionalServices.join(", ")} ok />
                  )}
                </div>

                {/* Fields */}
                <div className="border-t border-white/10 pt-2">
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
        )}
      </div>
    </div>
  );
}
