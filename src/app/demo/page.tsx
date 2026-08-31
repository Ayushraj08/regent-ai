"use client";

import { useState, useRef, useEffect } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import {
  Mic, MicOff, PhoneOff, AlertTriangle, Send, PhoneCall,
  CheckCircle2, User, Radio, Activity, Loader2
} from "lucide-react";
import { Trade, ConversationState, Lead, EngineResponse } from "@/lib/demo-engine/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: "CUSTOMER" | "REGENT";
  content: string;
  fromVoice?: boolean;
};

type AppState =
  | "READY"
  | "REQUESTING_PERMISSION"
  | "CONNECTING"
  | "LISTENING"
  | "NO_INPUT"
  | "PROCESSING"
  | "REGENT_SPEAKING"
  | "ESCALATION"
  | "COMPLETE"
  | "ERROR";

const emptyField = { value: null, status: "MISSING" as const, confidence: 0, turn: 0 };

function makeEmptyLead(trade: Trade | null): Lead {
  return {
    name: { ...emptyField },
    phone: { ...emptyField },
    address: { ...emptyField },
    requestType: { ...emptyField },
    service: { ...emptyField },
    problem: { ...emptyField },
    urgency: { ...emptyField },
    trade,
  };
}

// ─── Diagnostic row ───────────────────────────────────────────────────────────

function DiagRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={ok ? "text-green-400" : "text-red-400"}>{value}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DemoPage() {
  // ── React state (UI) ──────────────────────────────────────────────────────
  const [trade, setTrade]                 = useState<Trade | null>(null);
  const [appState, setAppState]           = useState<AppState>("READY");
  const [messages, setMessages]           = useState<Message[]>([]);
  const [lead, setLead]                   = useState<Lead>(makeEmptyLead(null));
  const [conversationState, setConvState] = useState<ConversationState>("START");
  const [textInput, setTextInput]         = useState("");
  const [partialText, setPartialText]     = useState("");
  const [noSpeechWarn, setNoSpeechWarn]   = useState(false);
  const [micPermission, setMicPerm]       = useState<"PENDING"|"GRANTED"|"DENIED">("PENDING");
  const [diagConn, setDiagConn]           = useState("CLOSED");
  const [diagPartials, setDiagPartials]   = useState(0);
  const [diagCommitted, setDiagCommitted] = useState(0);
  const [diagSession, setDiagSession]     = useState("");

  // ── Mutable refs (read inside callbacks without stale-closure risk) ────────
  //    Rule: every value that a stable callback needs to READ must live here.
  //    React state is only for values the JSX needs to render.
  const tradeRef          = useRef<Trade | null>(null);
  const messagesRef       = useRef<Message[]>([]);
  const leadRef           = useRef<Lead>(makeEmptyLead(null));
  const convStateRef      = useRef<ConversationState>("START");
  const sessionIdRef      = useRef("");
  const turnCountRef      = useRef(0);
  const processedRef      = useRef<Set<string>>(new Set());
  const appStateRef       = useRef<AppState>("READY");
  const noSpeechTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAudioRef   = useRef<HTMLAudioElement | null>(null);
  const transcriptRef     = useRef<HTMLDivElement>(null);
  const metricsRef        = useRef({ sttCommit: 0, llmStart: 0, ttsStart: 0, firstAudio: 0 });

  // Keep refs in sync with state on every render — no deps needed, always fresh.
  useEffect(() => {
    tradeRef.current     = trade;
    messagesRef.current  = messages;
    leadRef.current      = lead;
    convStateRef.current = conversationState;
    appStateRef.current  = appState;
  });

  // ── Stable callback refs — avoids stale closures in useScribe ────────────
  //    The actual implementations are assigned in the "always-fresh" useEffect above.
  const cbSessionStarted     = useRef<() => void>(() => {});
  const cbPartialTranscript  = useRef<(data: { text: string }) => void>(() => {});
  const cbCommittedTranscript = useRef<(data: { text: string }) => void>(() => {});
  const cbDisconnect         = useRef<() => void>(() => {});
  const cbError              = useRef<(err: Error | Event) => void>(() => {});

  // Assign the latest implementations every render
  useEffect(() => {
    cbSessionStarted.current = () => {
      console.log("[Scribe] Session started");
      setAppState("LISTENING");
      setNoSpeechWarn(false);
      
      // Immediately interrupt any playing TTS (19O)
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      
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

      // Deduplication — one committed transcript = one Regent turn
      const key = `${sessionIdRef.current}|${text}`;
      if (processedRef.current.has(key)) {
        console.warn("[Scribe] Duplicate committed — skipped:", text);
        return;
      }
      processedRef.current.add(key);
      setDiagCommitted(c => c + 1);

      metricsRef.current.sttCommit = performance.now();
      // Disconnect Scribe so we don't capture the next utterance while Regent processes
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
  }); // no deps — runs every render so refs always hold latest closures

  // ── useScribe — SDK owns the microphone + WebSocket completely ────────────
  //    Callbacks forward to refs so they always call the latest implementation.
  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    microphone: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    onSessionStarted:      ()     => cbSessionStarted.current(),
    onPartialTranscript:   (data) => cbPartialTranscript.current(data),
    onCommittedTranscript: (data) => cbCommittedTranscript.current(data),
    onConnect:             ()     => { setDiagConn("OPEN"); setMicPerm("GRANTED"); },
    onDisconnect:          ()     => cbDisconnect.current(),
    onError:               (err)  => cbError.current(err),
    onAuthError:           (e)    => { console.error("[Scribe] Auth:", e.error); setAppState("ERROR"); },
  });

  // ── Auto-scroll transcript ────────────────────────────────────────────────
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages, partialText]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearNoSpeechTimer();
      scribe.disconnect();
      currentAudioRef.current?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── No-speech timer ───────────────────────────────────────────────────────
  function resetNoSpeechTimer() {
    if (noSpeechTimerRef.current) clearTimeout(noSpeechTimerRef.current);
    noSpeechTimerRef.current = setTimeout(() => {
      setNoSpeechWarn(true);
      // Send a silent turn to the engine for graceful recovery (19P, 19AE)
      setAppState(prev => {
        if (prev === "LISTENING") {
          // Temporarily disable the microphone while Regent processes silence
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

  // ── Full voice session teardown ───────────────────────────────────────────
  function cleanupVoice() {
    clearNoSpeechTimer();
    scribe.disconnect();
    // Bump session ID — any in-flight callbacks carrying the old ID are ignored
    sessionIdRef.current = Date.now().toString();
    processedRef.current = new Set();
    setPartialText("");
    setDiagConn("CLOSED");
    setDiagPartials(0);
    setDiagCommitted(0);
    setDiagSession("");
  }

  // ── Start listening ───────────────────────────────────────────────────────
  async function startListening() {
    if (scribe.isConnected || scribe.status === "connecting") {
      console.warn("[Voice] Already connecting — ignoring");
      return;
    }

    currentAudioRef.current?.pause();
    currentAudioRef.current = null;

    const newSession = Date.now().toString();
    sessionIdRef.current = newSession;
    processedRef.current = new Set();
    turnCountRef.current = 0;

    setAppState("REQUESTING_PERMISSION");
    setPartialText("");
    setNoSpeechWarn(false);
    setDiagSession(newSession.slice(-6));
    setDiagPartials(0);
    setDiagCommitted(0);

    try {
      // 1. Fetch single-use token from server (never exposes the API key)
      const res = await fetch("/api/demo/scribe-token");
      if (!res.ok) throw new Error(`Token endpoint: ${res.status}`);
      const { token } = await res.json();
      if (!token || typeof token !== "string") throw new Error("Invalid token received");

      setAppState("CONNECTING");
      setDiagConn("CONNECTING");

      // 2. Connect — the SDK requests mic permission, opens AudioWorklet + WebSocket
      await scribe.connect({ token });
      // onConnect → setDiagConn("OPEN"), setMicPerm("GRANTED")
      // onSessionStarted → setAppState("LISTENING"), starts no-speech timer
    } catch (err: any) {
      console.error("[Voice] Start error:", err);
      if (err?.name === "NotAllowedError" || String(err).includes("Permission")) {
        setMicPerm("DENIED");
      }
      setAppState("ERROR");
      setDiagConn("CLOSED");
    }
  }

  // ── Stop listening ────────────────────────────────────────────────────────
  function stopListening() {
    cleanupVoice();
    setAppState("READY");
  }

  // ── Toggle mic button ────────────────────────────────────────────────────
  function toggleListening() {
    const s = appStateRef.current;
    if (s === "LISTENING" || s === "NO_INPUT") {
      stopListening();
    } else if (s === "READY" || s === "REGENT_SPEAKING" || s === "ERROR") {
      startListening();
    }
  }

  // ── Text / voice input handler ────────────────────────────────────────────
  //    Uses refs for all state values — no stale closure risk.
  function handleUserInput(text: string, fromVoice = false) {
    if (!text.trim()) return;
    if (fromVoice) metricsRef.current.sttCommit = performance.now();

    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    clearNoSpeechTimer();

    setTextInput("");
    setNoSpeechWarn(false);
    setAppState("PROCESSING");
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: "CUSTOMER",
      content: text,
      fromVoice,
    }]);

    // Read latest state from refs (not stale closure)
    processUtterance(text);
  }

  // ── Regent engine call ────────────────────────────────────────────────────
  async function processUtterance(utterance: string) {
    try {
      metricsRef.current.llmStart = performance.now();

      // Read latest values from refs — these are always fresh
      const history = messagesRef.current.map(m => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/demo/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: convStateRef.current,
          trade: tradeRef.current,
          lead: leadRef.current,
          utterance,
          conversationHistory: history,
          turnCount: turnCountRef.current,
        }),
      });

      if (!res.ok) throw new Error("API Error");
      const data: EngineResponse = await res.json();
      turnCountRef.current++;

      // Merge extracted fields
      setLead(prev => {
        const merged = { ...prev };
        for (const [k, v] of Object.entries(data.extracted)) {
          if (v !== null && v !== undefined) (merged as any)[k] = v;
        }
        return merged;
      });
      setConvState(data.state);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: "REGENT",
        content: data.response,
      }]);

      if (data.safety.status === "CRITICAL" || data.shouldTransfer) {
        setAppState("ESCALATION");
        speakText(data.response);
      } else if (data.state === "END") {
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
        content: "I'm having a little trouble right now. Could you try again, or type your message?",
      }]);
      setAppState("READY");
    }
  }

  // ── TTS — Rachel voice (warm, professional, American English) ─────────────
  async function speakText(text: string) {
    try {
      metricsRef.current.ttsStart = performance.now();
      const res = await fetch("/api/demo/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId: "EXAVITQu4vr4xnSDxMaL", // Bella — free default voice
        }),
      });
      if (!res.ok) throw new Error("TTS failed");

      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      audio.onplay = () => {
        metricsRef.current.firstAudio = performance.now();
        const commit = metricsRef.current.sttCommit;
        if (commit > 0) {
          console.log(`[Metrics] TTFA: ${(metricsRef.current.firstAudio - commit).toFixed(0)}ms | LLM: ${(metricsRef.current.ttsStart - metricsRef.current.llmStart).toFixed(0)}ms | TTS: ${(metricsRef.current.firstAudio - metricsRef.current.ttsStart).toFixed(0)}ms`);
        }
      };
      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        setAppState(prev => prev === "REGENT_SPEAKING" ? "READY" : prev);
      };
      audio.play();
    } catch (err) {
      console.error("[TTS]", err);
      setAppState("READY");
    }
  }

  // ── Call lifecycle ────────────────────────────────────────────────────────
  async function handleStartCall() {
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    cleanupVoice();

    const freshLead = makeEmptyLead(trade);
    setLead(freshLead);
    leadRef.current = freshLead;
    setConvState("START");
    convStateRef.current = "START";
    setMessages([]);
    messagesRef.current = [];
    turnCountRef.current = 0;
    setNoSpeechWarn(false);
    setAppState("PROCESSING");

    try {
      const res = await fetch("/api/demo/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: "START",
          trade,
          lead: freshLead,
          utterance: "Hello",
          conversationHistory: [],
          turnCount: 0,
        }),
      });
      const data: EngineResponse = await res.json();
      setConvState(data.state);
      convStateRef.current = data.state;
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
    setConvState("START");
    convStateRef.current = "START";
    setMessages([]);
    messagesRef.current = [];
    setLead(makeEmptyLead(trade));
    setNoSpeechWarn(false);
    turnCountRef.current = 0;
  }

  // ── Derived UI values ────────────────────────────────────────────────────
  const micActive = appState === "LISTENING";
  const micBusy   = appState === "CONNECTING" || appState === "REQUESTING_PERMISSION" || appState === "PROCESSING";
  const canMic    = messages.length > 0 && !micBusy && appState !== "ESCALATION" && appState !== "COMPLETE";

  const stateColor: Record<AppState, string> = {
    READY: "text-slate-400", REQUESTING_PERMISSION: "text-yellow-400",
    CONNECTING: "text-blue-400", LISTENING: "text-green-400",
    NO_INPUT: "text-yellow-400", PROCESSING: "text-blue-400",
    REGENT_SPEAKING: "text-indigo-400", ESCALATION: "text-red-400",
    COMPLETE: "text-green-400", ERROR: "text-red-400",
  };

  const scenarioShortcuts = [
    { label: "AC Not Cooling", text: "My AC completely stopped working and it's 90 degrees inside." },
    { label: "Smell Gas",      text: "I smell gas coming from the furnace area." },
    { label: "Request Human",  text: "I just want to talk to a real person right now." },
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
                onClick={() => { setTrade(t); setLead(prev => ({ ...prev, trade: t })); }}
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

  // ── Main layout ──────────────────────────────────────────────────────────
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

          {/* Live partial transcript */}
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

          {/* Regent thinking */}
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

          {/* No-speech warning */}
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
                  {/* Mic button */}
                  <button id="mic-toggle-btn" onClick={toggleListening} disabled={!canMic}
                    title={micActive ? "Stop listening" : "Start listening"}
                    className={`p-3 rounded-full flex-shrink-0 transition-all duration-200 ${
                      micActive  ? "bg-green-500 text-white shadow-lg shadow-green-200 scale-110"
                    : appState === "ERROR" ? "bg-red-100 text-red-500 hover:bg-red-200"
                    : micBusy   ? "bg-slate/10 text-slate/40 cursor-not-allowed"
                    :              "bg-slate/10 text-obsidian hover:bg-slate/20"
                    }`}>
                    {micBusy    ? <Loader2 className="w-6 h-6 animate-spin" />
                    : micActive ? <MicOff className="w-6 h-6" />
                    :             <Mic className="w-6 h-6" />}
                  </button>

                  {/* Text input */}
                  <form onSubmit={e => { e.preventDefault(); handleUserInput(textInput); }} className="flex-1 flex gap-2">
                    <input id="text-input" type="text" value={textInput}
                      onChange={e => setTextInput(e.target.value)}
                      placeholder="Type your message or use the mic..."
                      disabled={appState === "PROCESSING"}
                      className="flex-1 bg-slate/5 border border-slate/20 rounded-full px-4 text-sm focus:outline-none focus:border-regent" />
                    <button type="submit" id="send-btn"
                      disabled={!textInput.trim() || appState === "PROCESSING"}
                      className="p-3 bg-regent text-bone rounded-full disabled:opacity-50">
                      <Send className="w-5 h-5" />
                    </button>
                  </form>

                  {/* End call */}
                  <button id="end-call-btn" onClick={handleEndCall}
                    className="p-3 bg-emergency/10 text-emergency rounded-full hover:bg-emergency/20 transition-colors flex-shrink-0"
                    title="End Call">
                    <PhoneOff className="w-5 h-5" />
                  </button>
                </div>

                {/* Scenario shortcuts */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate/10">
                  <span className="text-xs text-text-secondary-light flex items-center font-semibold uppercase tracking-wider mr-2">
                    Try a scenario:
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
        <div className="bg-white border border-slate/20 rounded-xl shadow-sm overflow-hidden flex-1 max-h-[calc(60vh)] flex flex-col">
          <div className="bg-obsidian text-bone p-4 border-b border-slate/20 flex justify-between items-center shrink-0">
            <h4 className="font-bold text-sm">LIVE LEAD CAPTURE</h4>
            {appState === "COMPLETE"   && <span className="text-xs bg-regent text-bone px-2 py-1 rounded font-bold">CAPTURED</span>}
            {appState === "ESCALATION" && <span className="text-xs bg-emergency text-bone px-2 py-1 rounded font-bold">ESCALATED</span>}
          </div>

          <div className="p-4 space-y-4 overflow-y-auto flex-1 bg-[#EBE8E0]/30">
            <div className="bg-white p-3 rounded-lg border border-slate/20 shadow-sm space-y-3">
              <div className="flex items-start gap-2">
                <div className="p-1.5 bg-slate/5 rounded-full"><User className="w-4 h-4 text-slate" /></div>
                <div className="flex-1">
                  <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider mb-0.5">Name</span>
                  {lead.name?.value
                    ? <span className="font-bold text-obsidian">{lead.name.value}</span>
                    : <span className="text-slate/40 italic text-sm">Awaiting...</span>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate/10">
                <div>
                  <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider mb-0.5">Phone</span>
                  {lead.phone?.value
                    ? <span className="font-medium text-obsidian text-sm">{lead.phone.value}</span>
                    : <span className="text-slate/40 italic text-xs">Demo caller ID</span>}
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider mb-0.5">Urgency</span>
                  {lead.urgency?.value
                    ? <span className={`font-bold text-sm ${lead.urgency.value === "CRITICAL" ? "text-emergency" : lead.urgency.value === "HIGH" ? "text-amber-600" : "text-obsidian"}`}>{lead.urgency.value}</span>
                    : <span className="text-slate/40 italic text-xs">Pending</span>}
                </div>
              </div>
            </div>

            <div className="bg-white p-3 rounded-lg border border-slate/20 shadow-sm">
              <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider mb-0.5">Address</span>
              {lead.address?.value
                ? <span className="font-medium text-obsidian text-sm">{lead.address.value}</span>
                : <span className="text-slate/40 italic text-sm">Awaiting...</span>}
            </div>

            <div className="bg-white p-3 rounded-lg border border-slate/20 shadow-sm space-y-2">
              <div>
                <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider mb-0.5">Service</span>
                {lead.service?.value
                  ? <span className="font-medium text-obsidian text-sm">{lead.service.value}</span>
                  : <span className="text-slate/40 italic text-sm">Awaiting...</span>}
              </div>
              <div className="bg-slate/5 p-2 rounded border border-slate/10">
                <span className="block text-[10px] uppercase font-bold text-text-secondary-light tracking-wider mb-0.5">Problem</span>
                {lead.problem?.value
                  ? <p className="font-medium text-obsidian text-sm">{lead.problem.value}</p>
                  : <span className="text-slate/40 italic text-sm">Awaiting...</span>}
              </div>
            </div>

            {appState === "COMPLETE" && (
              <div className="bg-regent/10 border border-regent/30 p-3 rounded-lg text-center">
                <CheckCircle2 className="w-7 h-7 text-regent mx-auto mb-1" />
                <h4 className="font-bold text-regent text-sm">CALLBACK REQUIRED</h4>
                <p className="text-xs text-regent/80 mt-0.5">Lead captured — team notified.</p>
                {lead.ticketId && <p className="text-xs font-mono mt-1 text-regent">{lead.ticketId}</p>}
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

        {/* Diagnostic panel */}
        <div className="bg-obsidian text-bone rounded-xl border border-slate/20 shadow-sm overflow-hidden">
          <div className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Diagnostic</span>
          </div>
          <div className="p-4 space-y-3 text-xs font-mono">
            <div>
              <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Microphone</p>
              <DiagRow label="Permission" value={micPermission} ok={micPermission === "GRANTED"} />
              <DiagRow label="SDK Status"  value={scribe.status.toUpperCase()} ok={scribe.isConnected} />
              <DiagRow label="Muted"       value={scribe.isMuted ? "YES" : "NO"} ok={!scribe.isMuted} />
            </div>
            <div className="border-t border-white/10 pt-3">
              <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Scribe</p>
              <DiagRow label="Connection" value={diagConn}                              ok={diagConn === "OPEN"} />
              <DiagRow label="Session"    value={diagSession || "—"}                    ok={!!diagSession} />
              <DiagRow label="Partials"   value={String(diagPartials)}                  ok />
              <DiagRow label="Committed"  value={String(diagCommitted)}                 ok />
            </div>
            <div className="border-t border-white/10 pt-3">
              <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Regent</p>
              <DiagRow label="App State"  value={appState}          ok={appState !== "ERROR"} />
              <DiagRow label="Conv State" value={conversationState} ok />
              <DiagRow label="Turn"       value={String(turnCountRef.current)} ok />
            </div>
            {partialText && (
              <div className="border-t border-white/10 pt-2">
                <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Live Partial</p>
                <p className="text-green-400 text-[10px] leading-relaxed line-clamp-3">{partialText}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
