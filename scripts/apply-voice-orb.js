const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'src', 'app', 'demo', 'page.tsx');
let code = fs.readFileSync(targetPath, 'utf8').replace(/\r\n/g, '\n');

// 1. Add Sparkles and LayoutDashboard to lucide-react import
code = code.replace(
  '  RefreshCw, Building2, Zap, MessageSquare, Check\n} from "lucide-react";',
  '  RefreshCw, Building2, Zap, MessageSquare, Check, Sparkles, LayoutDashboard\n} from "lucide-react";'
);

// 2. Add state & refs in DemoPage
const stateSearch = '  const [diagOpen, setDiagOpen] = useState(false);';
const stateAddition = `  const [diagOpen, setDiagOpen] = useState(false);

  // View Switching & Hands-Free Audio State
  const [viewMode, setViewMode] = useState<"VOICE_ORB" | "DISPATCH_CONSOLE">("VOICE_ORB");
  const [callActive, setCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showTranscriptDrawer, setShowTranscriptDrawer] = useState(false);

  // Refs
  const isCallActiveRef = useRef(false);
  const isMutedRef = useRef(false);`;

code = code.replace(stateSearch, stateAddition);

// 3. Update useEffect refs sync
const refSyncSearch = `  useEffect(() => {
    tradeRef.current = trade;
    messagesRef.current = messages;
    sessionRef.current = session;
    appStateRef.current = appState;
  });`;

const refSyncReplacement = `  useEffect(() => {
    tradeRef.current = trade;
    messagesRef.current = messages;
    sessionRef.current = session;
    appStateRef.current = appState;
    isCallActiveRef.current = callActive;
    isMutedRef.current = isMuted;
  });`;

code = code.replace(refSyncSearch, refSyncReplacement);

// 4. Update cbPartialTranscript
const partialSearch = `    cbPartialTranscript.current = (data) => {
      setPartialText(data.text);
      setDiagPartials(p => p + 1);
      resetNoSpeechTimer();
      // Barge-in: if user starts speaking while Regent audio is playing
      if (appStateRef.current === "REGENT_SPEAKING" || currentAudioRef.current) {
        triggerBargeIn();
      }
    };`;

const partialReplacement = `    cbPartialTranscript.current = (data) => {
      if (isMutedRef.current) return;
      // Barge-in: if user starts speaking while Regent audio is playing
      if (appStateRef.current === "REGENT_SPEAKING" || currentAudioRef.current) {
        if (data.text && data.text.trim().length > 2) {
          triggerBargeIn();
        } else {
          return;
        }
      }
      setPartialText(data.text);
      setDiagPartials(p => p + 1);
      resetNoSpeechTimer();
    };`;

code = code.replace(partialSearch, partialReplacement);

// 5. Update cbCommittedTranscript
const commitSearch = `    cbCommittedTranscript.current = (data) => {
      const text = (data.text || "").trim();
      if (!text) return;
      if (appStateRef.current === "PROCESSING" || appStateRef.current === "COMPLETE" || appStateRef.current === "ESCALATION") {
        return;
      }
      setPartialText("");
      const key = \`\${sessionIdRef.current}|\${text}\`;
      if (processedRef.current.has(key)) return;
      processedRef.current.add(key);
      setDiagCommitted(c => c + 1);
      metricsRef.current.sttCommit = performance.now();
      handleUserInput(text, true);
    };`;

const commitReplacement = `    cbCommittedTranscript.current = (data) => {
      if (isMutedRef.current) return;
      const text = (data.text || "").trim();
      if (!text) return;
      if (
        appStateRef.current === "PROCESSING" ||
        appStateRef.current === "COMPLETE" ||
        appStateRef.current === "ESCALATION" ||
        appStateRef.current === "REGENT_SPEAKING"
      ) {
        return;
      }
      setPartialText("");
      const key = \`\${sessionIdRef.current}|\${text}\`;
      if (processedRef.current.has(key)) return;
      processedRef.current.add(key);
      setDiagCommitted(c => c + 1);
      metricsRef.current.sttCommit = performance.now();
      handleUserInput(text, true);
    };`;

code = code.replace(commitSearch, commitReplacement);

// 6. Update cbDisconnect
const discSearch = `    cbDisconnect.current = () => {
      setDiagConn("CLOSED");
      setAppState(prev => (prev === "LISTENING" || prev === "CONNECTING") ? "READY" : prev);
    };`;

const discReplacement = `    cbDisconnect.current = () => {
      setDiagConn("CLOSED");
      if (!isCallActiveRef.current) {
        setAppState(prev => (prev === "LISTENING" || prev === "CONNECTING") ? "READY" : prev);
      } else if (appStateRef.current === "LISTENING" && !isMutedRef.current) {
        // Auto-reconnect Scribe seamlessly if disconnected during active call
        startListening();
      }
    };`;

code = code.replace(discSearch, discReplacement);

// 7. Add toggleMute right after toggleListening
const toggleListeningSearch = `  function toggleListening() {
    const s = appStateRef.current;
    if (s === "LISTENING" || s === "NO_INPUT") stopListening();
    else if (s === "READY" || s === "REGENT_SPEAKING" || s === "ERROR") startListening();
  }`;

const toggleListeningReplacement = `  function toggleListening() {
    const s = appStateRef.current;
    if (s === "LISTENING" || s === "NO_INPUT") stopListening();
    else if (s === "READY" || s === "REGENT_SPEAKING" || s === "ERROR") startListening();
  }

  function toggleMute() {
    if (isMuted) {
      setIsMuted(false);
      isMutedRef.current = false;
      try {
        scribe.unmute();
      } catch (e) {
        console.warn("[Scribe] Unmute failed:", e);
      }
    } else {
      setIsMuted(true);
      isMutedRef.current = true;
      try {
        scribe.mute();
      } catch (e) {
        console.warn("[Scribe] Mute failed:", e);
      }
    }
  }`;

code = code.replace(toggleListeningSearch, toggleListeningReplacement);

// 8. Update audio.onended
const audioEndedSearch = `      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        setAppState(prev => {
          if (prev === "REGENT_SPEAKING") {
            if (!scribe.isConnected) {
              startListening();
            }
            return "LISTENING";
          }
          return prev;
        });
      };`;

const audioEndedReplacement = `      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        if (!isCallActiveRef.current) {
          setAppState("READY");
          return;
        }
        setAppState("LISTENING");
        if (!isMutedRef.current) {
          if (!scribe.isConnected && scribe.status !== "connecting") {
            startListening();
          }
        }
      };`;

code = code.replace(audioEndedSearch, audioEndedReplacement);

// 9. Update handleStartCall
const startCallSearch = `  async function handleStartCall() {
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    cleanupVoice();

    const freshSession = makeEmptySession(selectedTenant.trade);
    freshSession.tenantId = selectedTenant.id;
    setSession(freshSession);
    sessionRef.current = freshSession;
    setMessages([]);
    messagesRef.current = [];
    setNoSpeechWarn(false);
    setAppState("PROCESSING");`;

const startCallReplacement = `  async function handleStartCall() {
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    cleanupVoice();
    setCallActive(true);
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
    setAppState("PROCESSING");`;

code = code.replace(startCallSearch, startCallReplacement);

// Also in handleStartCall catch block
const startCallCatch = `    } catch {
      setAppState("READY");
    }
  }`;

const startCallCatchReplacement = `    } catch {
      setAppState("READY");
      setCallActive(false);
      isCallActiveRef.current = false;
    }
  }`;

code = code.replace(startCallCatch, startCallCatchReplacement);

// 10. Update handleEndCall
const endCallSearch = `  function handleEndCall() {
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    cleanupVoice();

    // Trigger call conclusion pipeline on call wrap`;

const endCallReplacement = `  function handleEndCall() {
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    cleanupVoice();
    setCallActive(false);
    isCallActiveRef.current = false;
    setIsMuted(false);
    isMutedRef.current = false;

    // Trigger call conclusion pipeline on call wrap`;

code = code.replace(endCallSearch, endCallReplacement);

// 11. Now replace the Main layout return JSX
const layoutStart = '  // ── Main layout ───────────────────────────────────────────────────────────\n  return (';
const layoutIdx = code.indexOf(layoutStart);
if (layoutIdx === -1) {
  throw new Error("layoutStart not found");
}

const voiceOrbViewCode = `      {/* ─── VIEW 1: VOICE ORB VIEW (Minimalist Celestial Siri/ElevenLabs Style) ─── */}
      {viewMode === "VOICE_ORB" && (
        <div className="flex-1 flex flex-col items-center justify-between py-6 px-4 max-w-3xl mx-auto w-full min-h-[calc(100vh-10rem)]">
          
          {/* Tenant Sub-Badge */}
          <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md px-4 py-1.5 rounded-full border border-slate-200/80 shadow-xs text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-bold text-slate-800">{selectedTenant.name}</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-600 font-medium">AI Receptionist: {selectedTenant.agentName}</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-500 font-mono text-[11px] font-semibold">{selectedTenant.trade}</span>
          </div>

          {/* Center Area: Celestial Glowing Spherical Orb + Status */}
          <div className="flex flex-col items-center justify-center my-auto py-6">
            {/* Voice Orb */}
            <div
              id="voice-orb-element"
              onClick={() => {
                if (!callActive) handleStartCall();
              }}
              className={\`group relative select-none cursor-pointer transition-transform duration-500 \${
                !callActive ? "hover:scale-105 active:scale-95" : ""
              }\`}
              title={!callActive ? "Click to start voice call" : isMuted ? "Microphone Muted" : "Active Call with Regent"}
            >
              <div
                className={\`w-56 h-56 sm:w-64 sm:h-64 voice-orb \${
                  isMuted
                    ? "muted"
                    : appState === "REGENT_SPEAKING"
                    ? "speaking"
                    : appState === "LISTENING"
                    ? "listening"
                    : appState === "PROCESSING"
                    ? "processing"
                    : "idle"
                }\`}
              />
            </div>

            {/* Status Caption directly below the Orb (matches user screenshot) */}
            <div className="mt-8 flex flex-col items-center text-center">
              <span className="text-xl sm:text-2xl font-normal text-slate-600 tracking-tight transition-all duration-300">
                {!callActive
                  ? "Ready to Talk"
                  : isMuted
                  ? "Microphone Muted"
                  : appState === "REGENT_SPEAKING"
                  ? "Speaking..."
                  : appState === "LISTENING"
                  ? "Listening..."
                  : appState === "PROCESSING"
                  ? "Thinking..."
                  : appState === "COMPLETE"
                  ? "Call Completed"
                  : appState === "ESCALATION"
                  ? "Transferring Call..."
                  : "Connected"}
              </span>

              {/* Live Subtitle: Partial transcription while user is speaking */}
              {partialText && (
                <div className="mt-3 px-4 py-1.5 rounded-full bg-emerald-50 text-emerald-800 text-xs sm:text-sm font-medium animate-pulse max-w-md truncate border border-emerald-200 shadow-2xs">
                  &ldquo;{partialText}&rdquo;
                </div>
              )}

              {/* Regent latest reply subtitle (when Regent is speaking and no partial text) */}
              {!partialText && appState === "REGENT_SPEAKING" && messages.length > 0 && (
                <p className="mt-3 text-xs sm:text-sm text-slate-500 max-w-md line-clamp-2 px-4 italic leading-relaxed">
                  &ldquo;{messages[messages.length - 1].content}&rdquo;
                </p>
              )}

              {!callActive && (
                <p className="mt-2 text-xs text-slate-400">
                  Click the orb or press &quot;Start Call&quot; below to begin hands-free conversation
                </p>
              )}
            </div>
          </div>

          {/* Bottom Bar: Pill Input + Circular Mute + Circular End Call */}
          <div className="w-full max-w-xl flex flex-col gap-3">
            {!callActive ? (
              <button
                onClick={handleStartCall}
                className="w-full py-3.5 bg-gradient-to-r from-regent via-emerald-800 to-regent text-white font-bold text-sm sm:text-base rounded-full shadow-lg shadow-regent/25 hover:shadow-xl hover:scale-[1.01] active:scale-98 transition-all flex items-center justify-center gap-2.5 cursor-pointer"
              >
                <PhoneCall className="w-5 h-5" />
                <span>Start Hands-Free Voice Call</span>
              </button>
            ) : (
              <div className="flex items-center gap-2.5 sm:gap-3 w-full">
                {/* Pill text input with Send icon inside (matches user screenshot) */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (textInput.trim() && appState !== "PROCESSING") {
                      handleUserInput(textInput);
                    }
                  }}
                  className="flex-1 flex items-center bg-white border border-slate-200/90 rounded-full px-5 py-3 shadow-xs hover:border-slate-300 focus-within:border-regent/60 focus-within:ring-2 focus-within:ring-regent/10 transition-all"
                >
                  <input
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Or send a message..."
                    disabled={appState === "PROCESSING"}
                    className="w-full bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!textInput.trim() || appState === "PROCESSING"}
                    className="text-slate-400 hover:text-slate-700 disabled:opacity-30 p-1 cursor-pointer transition-colors"
                    title="Send text message"
                  >
                    <Send className="w-4 h-4 fill-slate-400" />
                  </button>
                </form>

                {/* Circular Solid Black Mute/Unmute Mic Button (matches user screenshot) */}
                <button
                  onClick={toggleMute}
                  className={\`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-md active:scale-95 cursor-pointer shrink-0 \${
                    isMuted
                      ? "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30"
                      : "bg-black hover:bg-neutral-800 text-white"
                  }\`}
                  title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                >
                  {isMuted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
                </button>

                {/* Circular Red End Call Button */}
                <button
                  onClick={handleEndCall}
                  className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-all shadow-md active:scale-95 cursor-pointer shrink-0 shadow-red-600/30"
                  title="End Call"
                >
                  <PhoneOff className="w-5 h-5 text-white" />
                </button>
              </div>
            )}

            {/* Scenario Quick Test Chips */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mr-1">
                Quick test:
              </span>
              {scenarioShortcuts.slice(0, 5).map((s, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (!callActive) {
                      handleStartCall().then(() => {
                        setTimeout(() => handleUserInput(s.text), 1200);
                      });
                    } else {
                      handleUserInput(s.text);
                    }
                  }}
                  disabled={appState === "PROCESSING"}
                  className="text-[11px] bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/80 px-2.5 py-1 rounded-full shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
                >
                  {s.label}
                </button>
              ))}

              {/* Toggle Transcript Drawer */}
              {messages.length > 0 && (
                <button
                  onClick={() => setShowTranscriptDrawer(!showTranscriptDrawer)}
                  className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1 rounded-full transition-all flex items-center gap-1 cursor-pointer font-medium"
                >
                  <MessageSquare className="w-3 h-3" />
                  <span>{showTranscriptDrawer ? "Hide Transcript" : \`Transcript (\${messages.length})\`}</span>
                </button>
              )}
            </div>

            {/* Collapsible Transcript Drawer for Voice Orb View */}
            {showTranscriptDrawer && messages.length > 0 && (
              <div className="mt-2 p-3 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-md max-h-48 overflow-y-auto space-y-2 text-xs">
                {messages.map((m) => (
                  <div key={m.id} className={\`flex \${m.role === "CUSTOMER" ? "justify-end" : "justify-start"}\`}>
                    <div className={\`p-2 rounded-xl max-w-[85%] \${
                      m.role === "CUSTOMER"
                        ? "bg-obsidian text-bone"
                        : "bg-slate-100 text-slate-800"
                    }\`}>
                      <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">{m.role}</span>
                      <p className="leading-relaxed">{m.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}`;

// We need the entire Dispatch Console view as the original, wrapped in viewMode === "DISPATCH_CONSOLE"
// Let's grab the original JSX body from code.slice(layoutIdx)
const origLayoutCode = code.slice(layoutIdx);

// In origLayoutCode, find:
// <div className="w-full min-h-[calc(100vh-4rem)] bg-bone text-obsidian flex flex-col lg:flex-row p-4 gap-4">
// We will replace the outer wrapper and wrap the existing columns inside:
// {viewMode === "DISPATCH_CONSOLE" && (
//   <div className="flex-1 flex flex-col lg:flex-row gap-4">
//      ...left column...
//      ...right column...
//   </div>
// )}

// Also in the Left column of Dispatch console, update the mic button to handle callActive ? toggleMute : toggleListening
let newLayoutCode = origLayoutCode.replace(
  '<div className="w-full min-h-[calc(100vh-4rem)] bg-bone text-obsidian flex flex-col lg:flex-row p-4 gap-4">',
  `<div className="w-full min-h-[calc(100vh-4rem)] bg-bone text-obsidian flex flex-col p-3 sm:p-4 gap-3">

      {/* ─── Global Top Navigation Bar & Interface Switcher ─────────────────── */}
      <header className="bg-obsidian text-bone p-3 sm:px-5 sm:py-3 rounded-xl flex flex-wrap justify-between items-center gap-3 shrink-0 shadow-sm border border-slate-800">
        {/* Left: Tenant Branding */}
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
              AI Receptionist: <strong className="text-bone">{selectedTenant.agentName}</strong>
            </span>
          </div>
        </div>

        {/* Center: View Switcher Segmented Control */}
        <div className="flex items-center bg-slate-900/90 p-1 rounded-xl border border-slate-800 shadow-inner">
          <button
            id="view-toggle-voice-orb"
            onClick={() => setViewMode("VOICE_ORB")}
            className={\`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer \${
              viewMode === "VOICE_ORB"
                ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }\`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Voice Orb View</span>
          </button>
          <button
            id="view-toggle-dispatch-console"
            onClick={() => setViewMode("DISPATCH_CONSOLE")}
            className={\`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer \${
              viewMode === "DISPATCH_CONSOLE"
                ? "bg-gradient-to-r from-regent to-emerald-700 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }\`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Dispatch Console View</span>
          </button>
        </div>

        {/* Right: Tenant Select + Barge In + Status */}
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
            className={\`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer \${
              appState === "REGENT_SPEAKING"
                ? "bg-amber-400 hover:bg-amber-300 text-black shadow-lg shadow-amber-400/40 scale-105 animate-pulse"
                : "bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed opacity-60"
            }\`}
            title="Full Duplex Barge-In: Cut off Regent audio playback mid-sentence"
          >
            <Zap className="w-3.5 h-3.5 fill-current text-amber-500" />
            <span className="hidden sm:inline">Interrupt Regent</span>
          </button>

          {/* Status indicator */}
          <div className={\`flex items-center gap-1.5 text-xs font-bold uppercase \${stateColor[appState]}\`}>
            {appState === "LISTENING" && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
              </span>
            )}
            {micActive && !isMuted && <Radio className="w-3 h-3 animate-pulse text-green-400" />}
            {isMuted && <span className="text-[10px] text-amber-400 font-mono">[MUTED]</span>}
            {appState === "PROCESSING" && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{appState.replace(/_/g, " ")}</span>
          </div>
        </div>
      </header>

${voiceOrbViewCode}

      {/* ─── VIEW 2: DISPATCH CONSOLE VIEW (Diagnostic & Operations Dashboard) ── */}
      {viewMode === "DISPATCH_CONSOLE" && (
        <div className="flex-1 flex flex-col lg:flex-row gap-4">`
);

// Close viewMode === "DISPATCH_CONSOLE" before the final </div>\n  );
newLayoutCode = newLayoutCode.replace(
  '      </div>\n    </div>\n  );\n}',
  '      </div>\n        </div>\n      )}\n    </div>\n  );\n}'
);

// Update Left column mic button in Dispatch Console
const oldConsoleMicBtn = `<button id="mic-toggle-btn" onClick={toggleListening} disabled={!canMic}
                    title={micActive ? "Stop listening" : "Start listening"}
                    className={\`p-3 rounded-full flex-shrink-0 transition-all duration-200 \${
                      micActive ? "bg-green-500 text-white shadow-lg shadow-green-200 scale-110"
                      : appState === "ERROR" ? "bg-red-100 text-red-500 hover:bg-red-200"
                      : micBusy ? "bg-slate/10 text-slate/40 cursor-not-allowed"
                      : "bg-slate/10 text-obsidian hover:bg-slate/20"
                    }\`}>
                    {micBusy ? <Loader2 className="w-6 h-6 animate-spin" />
                    : micActive ? <MicOff className="w-6 h-6" />
                    : <Mic className="w-6 h-6" />}
                  </button>`;

const newConsoleMicBtn = `<button id="mic-toggle-btn" 
                    onClick={callActive ? toggleMute : toggleListening} 
                    disabled={!canMic && !callActive}
                    title={callActive ? (isMuted ? "Unmute microphone" : "Mute microphone") : (micActive ? "Stop listening" : "Start listening")}
                    className={\`p-3 rounded-full flex-shrink-0 transition-all duration-200 cursor-pointer \${
                      isMuted
                        ? "bg-amber-500 text-white shadow-lg shadow-amber-200"
                        : micActive
                        ? "bg-green-500 text-white shadow-lg shadow-green-200 scale-105"
                        : appState === "ERROR"
                        ? "bg-red-100 text-red-500 hover:bg-red-200"
                        : micBusy
                        ? "bg-slate/10 text-slate/40 cursor-not-allowed"
                        : "bg-slate/10 text-obsidian hover:bg-slate/20"
                    }\`}>
                    {micBusy ? <Loader2 className="w-6 h-6 animate-spin" />
                    : isMuted ? <MicOff className="w-6 h-6 text-white" />
                    : <Mic className="w-6 h-6" />}
                  </button>`;

newLayoutCode = newLayoutCode.replace(oldConsoleMicBtn, newConsoleMicBtn);

// Also change placeholder in Dispatch console to mention hands-free
newLayoutCode = newLayoutCode.replace(
  'placeholder="Type your message or use the mic..."',
  'placeholder="Type your message or simply speak hands-free..."'
);

code = code.slice(0, layoutIdx) + newLayoutCode;

fs.writeFileSync(targetPath, code, 'utf8');
console.log("Successfully applied Voice Orb interface and hands-free updates!");
