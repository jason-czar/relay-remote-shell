import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, RotateCcw, X, Clipboard, ClipboardPaste,
  Wifi, Loader2, ChevronUp, ChevronDown, Maximize2, Minimize2,
  ZoomIn, ZoomOut, Info, Terminal as TerminalIcon, Clock, Cpu,
  Activity
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface RelayMessage {
  type: string;
  id?: string;
  data?: unknown;
}

const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20];

export default function TerminalSession() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const [searchParams] = useSearchParams();
  const resumeSessionId = searchParams.get("session");
  const { user } = useAuth();
  const navigate = useNavigate();

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const devRef = useRef<Tables<"devices"> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const intentionalCloseRef = useRef(false);
  const isHiddenRef = useRef(false);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingSentAtRef = useRef<number>(0);

  const [device, setDevice] = useState<Tables<"devices"> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [latency, setLatency] = useState<number | null>(null);
  const [bgReconnecting, setBgReconnecting] = useState(false);
  const [fontSizeIdx, setFontSizeIdx] = useState(() => {
    const saved = localStorage.getItem("terminal-font-size-idx");
    return saved ? parseInt(saved, 10) : (window.innerWidth < 640 ? 2 : 4);
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [sessionStarted, setSessionStarted] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState("0:00");
  const [ctrlActive, setCtrlActive] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [vpStyle, setVpStyle] = useState<React.CSSProperties>({});

  // ── Session storage for iOS app-switch persistence ───────────────────
  const sessionStorageKey = deviceId ? `relay-session-${deviceId}` : null;
  const persistSessionId = useCallback((id: string) => {
    if (sessionStorageKey) {
      sessionStorage.setItem(sessionStorageKey, id);
      localStorage.setItem(sessionStorageKey, id); // survives tab discard on iOS
    }
  }, [sessionStorageKey]);
  const getPersistedSessionId = useCallback((): string | null => {
    if (!sessionStorageKey) return null;
    // Prefer sessionStorage (same tab); fall back to localStorage (after reload)
    return sessionStorage.getItem(sessionStorageKey) ?? localStorage.getItem(sessionStorageKey);
  }, [sessionStorageKey]);
  const clearPersistedSessionId = useCallback(() => {
    if (sessionStorageKey) {
      sessionStorage.removeItem(sessionStorageKey);
      localStorage.removeItem(sessionStorageKey);
    }
  }, [sessionStorageKey]);

  // ── Elapsed timer ────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionStarted) return;
    const id = setInterval(() => {
      const diff = Math.floor((Date.now() - sessionStarted.getTime()) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setElapsed(`${m}:${s.toString().padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(id);
  }, [sessionStarted]);

  // ── Font size change ─────────────────────────────────────────────────
  const changeFontSize = useCallback((delta: number) => {
    setFontSizeIdx((prev) => {
      const next = Math.max(0, Math.min(FONT_SIZES.length - 1, prev + delta));
      localStorage.setItem("terminal-font-size-idx", String(next));
      if (termRef.current) {
        termRef.current.options.fontSize = FONT_SIZES[next];
        fitRef.current?.fit();
      }
      return next;
    });
  }, []);

  // ── Fullscreen ───────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ── Cleanup ──────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    intentionalCloseRef.current = true;
    if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (wsRef.current) {
      if (sessionIdRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "session_end",
          data: { session_id: sessionIdRef.current, reason: "user_disconnect" },
        }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    if (termRef.current) { termRef.current.dispose(); termRef.current = null; }
    fitRef.current = null;
  }, []);

  const endSessionInDb = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try {
      await supabase.functions.invoke("end-session", { body: { session_id: sessionIdRef.current } });
    } catch { /* best effort */ }
  }, []);

  // ── Terminal init ────────────────────────────────────────────────────
  useEffect(() => {
    if (!deviceId || !user || !terminalContainerRef.current) return;

    const fontSize = FONT_SIZES[fontSizeIdx];
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize,
      lineHeight: 1.5,
      letterSpacing: 0.5,
      scrollback: 5000,
      allowTransparency: true,
      theme: {
        background: "#0a0e1a",
        foreground: "#c8d8c8",
        cursor: "#39ff8f",
        cursorAccent: "#0a0e1a",
        selectionBackground: "#39ff8f28",
        selectionForeground: "#e8f8e8",
        black: "#0d1117",
        red: "#ff5555",
        green: "#39ff8f",
        yellow: "#ffb86c",
        blue: "#6fa8ff",
        magenta: "#bd93f9",
        cyan: "#8be9fd",
        white: "#d8e8d8",
        brightBlack: "#4a5568",
        brightRed: "#ff7b7b",
        brightGreen: "#69ffaf",
        brightYellow: "#ffd080",
        brightBlue: "#90c0ff",
        brightMagenta: "#d0b0ff",
        brightCyan: "#a8f0ff",
        brightWhite: "#f0f8f0",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalContainerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const handleNativePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text");
      if (text && wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        e.preventDefault();
        wsRef.current.send(JSON.stringify({
          type: "stdin",
          data: { session_id: sessionIdRef.current, data_b64: btoa(unescape(encodeURIComponent(text))) },
        }));
      }
    };
    terminalContainerRef.current.addEventListener("paste", handleNativePaste);

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        wsRef.current.send(JSON.stringify({
          type: "resize",
          data: { session_id: sessionIdRef.current, cols: term.cols, rows: term.rows },
        }));
      }
    });
    resizeObserver.observe(terminalContainerRef.current);

    const init = async () => {
      const { data: dev } = await supabase.from("devices").select("*").eq("id", deviceId).single();
      devRef.current = dev;
      setDevice(dev);

      let sessionId = resumeSessionId ?? getPersistedSessionId();

      if (sessionId) {
        const { data: existing } = await supabase.from("sessions").select("id, status").eq("id", sessionId).single();
        if (!existing || existing.status !== "active") {
          sessionId = null;
          clearPersistedSessionId();
        } else {
          term.writeln(`\x1b[33m⟳ Resuming session ${sessionId.slice(0, 8)}...\x1b[0m`);
        }
      }

      if (!sessionId) {
        const { data: activeSessions } = await supabase
          .from("sessions").select("id")
          .eq("device_id", deviceId).eq("user_id", user!.id).eq("status", "active")
          .order("started_at", { ascending: false }).limit(1);
        if (activeSessions?.length) {
          sessionId = activeSessions[0].id;
          term.writeln(`\x1b[33m⟳ Resuming active session ${sessionId.slice(0, 8)}...\x1b[0m`);
        }
      }

      if (!sessionId) {
        const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", { body: { device_id: deviceId } });
        if (sesErr || !sesData?.session_id) {
          const errMsg = sesData?.error || sesErr?.message || "Unknown error";
          term.writeln(`\x1b[31m✗ Failed to create session: ${errMsg}\x1b[0m`);
          setConnectionStatus("offline");
          return;
        }
        sessionId = sesData.session_id;
        setSessionStarted(new Date());
      }

      sessionIdRef.current = sessionId;
      persistSessionId(sessionId!);

      // Welcome banner
      term.writeln(`\x1b[2m╔═══════════════════════════════╗\x1b[0m`);
      term.writeln(`\x1b[2m║\x1b[0m  \x1b[1;32mPrivaClaw Terminal\x1b[0m              \x1b[2m║\x1b[0m`);
      term.writeln(`\x1b[2m╚═══════════════════════════════╝\x1b[0m`);
      term.writeln(`\x1b[2mDevice :\x1b[0m \x1b[36m${dev?.name ?? deviceId}\x1b[0m`);
      term.writeln(`\x1b[2mSession:\x1b[0m \x1b[90m${sessionId!.slice(0, 8)}\x1b[0m`);
      term.writeln(`\x1b[2mDir    :\x1b[0m \x1b[90m${dev?.workdir ?? "~"}\x1b[0m`);
      term.writeln("");

      connectWebSocket(term, dev, sessionId!);
    };

    init();

    const handleVisibility = () => {
      if (document.hidden) {
        isHiddenRef.current = true;
        intentionalCloseRef.current = true;
        if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
        if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      } else {
        isHiddenRef.current = false;
        if (termRef.current && sessionIdRef.current) {
          setBgReconnecting(true);
          intentionalCloseRef.current = false;
          connectWebSocket(termRef.current, devRef.current, sessionIdRef.current);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      resizeObserver.disconnect();
      terminalContainerRef.current?.removeEventListener("paste", handleNativePaste);
      // Do NOT end the session on unmount — user may be navigating within the app.
      // Session is only ended explicitly via handleDisconnect.
      cleanup();
    };
  }, [deviceId, user]);

  // ── WebSocket ────────────────────────────────────────────────────────
  const connectWebSocket = async (term: Terminal, dev: Tables<"devices"> | null, sessionId: string) => {
    const relayUrl = import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com";
    if (!relayUrl) { fallbackToStub(term, dev, sessionId); return; }

    const { data: { session: authSession } } = await supabase.auth.getSession();
    const jwt = authSession?.access_token;
    if (!jwt) { term.writeln(`\x1b[31m✗ No auth session\x1b[0m`); setConnectionStatus("offline"); return; }

    term.writeln(`\x1b[33m⟳ Connecting to relay...\x1b[0m`);
    setConnectionStatus("connecting");
    intentionalCloseRef.current = false;

    try {
      const ws = new WebSocket(`${relayUrl}/session`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", data: { token: jwt, session_id: sessionId, device_id: dev?.id ?? deviceId } }));
      };

      ws.onmessage = (event) => {
        try {
          const msg: RelayMessage = JSON.parse(event.data);
          if (msg.type === "auth_ok") {
            term.writeln(`\x1b[32m✓ Connected\x1b[0m`);
            setConnectionStatus("online");
            setBgReconnecting(false);
            reconnectDelayRef.current = 1000;
            ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: term.cols, rows: term.rows } }));
            if (pingTimerRef.current) clearInterval(pingTimerRef.current);
            pingTimerRef.current = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                pingSentAtRef.current = performance.now();
                ws.send(JSON.stringify({ type: "ping" }));
              }
            }, 5000);
          } else if (msg.type === "pong") {
            setLatency(Math.round(performance.now() - pingSentAtRef.current));
          } else if (msg.type === "stdout" && msg.data) {
            const { data_b64 } = msg.data as { session_id: string; data_b64: string };
            term.write(Uint8Array.from(atob(data_b64), (c) => c.charCodeAt(0)));
          } else if (msg.type === "session_end") {
            term.writeln("\r\n\x1b[31m● Session ended by remote\x1b[0m");
            intentionalCloseRef.current = true;
            setConnectionStatus("offline");
          } else if (msg.type === "error") {
            const { message } = (msg.data ?? {}) as { message?: string };
            term.writeln(`\r\n\x1b[31m✗ ${message ?? "Unknown error"}\x1b[0m`);
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        if (intentionalCloseRef.current) { setConnectionStatus("offline"); return; }
        const delay = reconnectDelayRef.current;
        term.writeln(`\r\n\x1b[33m⚠ Lost connection. Retry in ${Math.round(delay / 1000)}s...\x1b[0m`);
        setConnectionStatus("connecting");
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connectWebSocket(term, dev, sessionId);
        }, delay);
        reconnectDelayRef.current = Math.min(delay * 2, 30000);
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(data) } }));
        }
      });
    } catch { fallbackToStub(term, dev, sessionId); }
  };

  const fallbackToStub = (term: Terminal, dev: Tables<"devices"> | null, sessionId: string) => {
    term.writeln(`\x1b[33m⚠ Relay unavailable — stub mode\x1b[0m`);
    term.write(`\x1b[32m${dev?.name ?? "device"}\x1b[0m $ `);
    setConnectionStatus("online");
    let line = "";
    term.onData((data) => {
      if (data === "\r" || data === "\n") {
        term.write("\r\n");
        if (line.trim()) term.writeln(`\x1b[2m[stub] ${line.trim()}\x1b[0m`);
        line = "";
        term.write(`\x1b[32m${dev?.name ?? "device"}\x1b[0m $ `);
      } else if (data === "\x7f") {
        if (line.length > 0) { line = line.slice(0, -1); term.write("\b \b"); }
      } else if (data >= " " || data === "\t") { line += data; term.write(data); }
    });
  };

  // ── Actions ──────────────────────────────────────────────────────────
  const handleReconnect = () => { clearPersistedSessionId(); cleanup(); window.location.reload(); };

  const handleDisconnect = async () => {
    clearPersistedSessionId();
    await endSessionInDb();
    cleanup();
    navigate(-1);
  };

  const handleCopy = async () => {
    const sel = termRef.current?.getSelection();
    if (sel) await navigator.clipboard.writeText(sel);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        wsRef.current.send(JSON.stringify({
          type: "stdin",
          data: { session_id: sessionIdRef.current, data_b64: btoa(unescape(encodeURIComponent(text))) },
        }));
      }
    } catch { /* clipboard access denied */ }
  };

  const scrollTerminal = (direction: "up" | "down") => {
    const term = termRef.current;
    if (!term) return;
    if (direction === "up") term.scrollLines(-Math.floor(term.rows * 0.8));
    else term.scrollToBottom();
  };

  // ── Mobile keyboard ──────────────────────────────────────────────────
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const isKeyboard = vv.height < window.innerHeight * 0.75;
      setKeyboardVisible(isKeyboard);
      if (isKeyboard) {
        setVpStyle({ position: "fixed", top: `${vv.offsetTop}px`, left: `${vv.offsetLeft}px`, width: `${vv.width}px`, height: `${vv.height}px` });
      } else {
        setVpStyle({});
      }
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);

  const sendKey = (sequence: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
      const bytes = new TextEncoder().encode(sequence);
      wsRef.current.send(JSON.stringify({
        type: "stdin",
        data: { session_id: sessionIdRef.current, data_b64: btoa(String.fromCharCode(...bytes)) },
      }));
    }
    termRef.current?.focus();
  };

  const handleToolbarKey = (sequence: string) => {
    if (ctrlActive) {
      const char = sequence.toUpperCase().charCodeAt(0) - 64;
      if (char > 0) { sendKey(String.fromCharCode(char)); setCtrlActive(false); return; }
    }
    sendKey(sequence);
  };

  type KeyDef = { label: string; seq: string; wide?: boolean; special?: boolean };
  const keyRows: KeyDef[][] = [
    [
      { label: "Esc", seq: "\x1b", special: true },
      { label: "Tab", seq: "\t", special: true },
      { label: "↑", seq: "\x1b[A" },
      { label: "↓", seq: "\x1b[B" },
      { label: "←", seq: "\x1b[D" },
      { label: "→", seq: "\x1b[C" },
      { label: "Home", seq: "\x01", special: true },
      { label: "End", seq: "\x05", special: true },
    ],
    [
      { label: "Ctrl", seq: "ctrl", special: true },
      { label: "C", seq: "C" },
      { label: "D", seq: "D" },
      { label: "Z", seq: "Z" },
      { label: "L", seq: "L" },
      { label: "A", seq: "A" },
      { label: "U", seq: "U" },
      { label: "K", seq: "K" },
    ],
    [
      { label: "|", seq: "|" },
      { label: "/", seq: "/" },
      { label: "~", seq: "~" },
      { label: "-", seq: "-" },
      { label: "$", seq: "$" },
      { label: "&", seq: "&" },
      { label: ">", seq: ">" },
      { label: "#", seq: "#" },
    ],
  ];

  // ── Status helpers ───────────────────────────────────────────────────
  const latencyColor = latency === null
    ? "text-muted-foreground"
    : latency < 60 ? "text-green-400"
    : latency < 150 ? "text-yellow-400"
    : "text-red-400";

  const statusDot = {
    connecting: "bg-yellow-400 animate-pulse",
    online: "bg-green-400",
    offline: "bg-red-500",
  }[connectionStatus];

  const statusLabel = { connecting: "Connecting", online: "Connected", offline: "Offline" }[connectionStatus];

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: "#0a0e1a", ...vpStyle }}
    >
      {/* ── Top header bar ────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center justify-between px-2 sm:px-3 py-1.5 border-b"
        style={{ borderColor: "#1e2a1e", background: "#0d1219" }}
      >
        {/* Left: back + device name + status */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={handleDisconnect}
            className="shrink-0 h-7 w-7 rounded flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-1.5 min-w-0">
            <TerminalIcon className="h-3.5 w-3.5 text-green-400 shrink-0" />
            <span className="text-sm font-semibold text-slate-100 truncate max-w-[120px] sm:max-w-[200px]">
              {device?.name ?? "Connecting…"}
            </span>
          </div>

          {/* Status pill */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border shrink-0"
            style={{ borderColor: "#1e2a1e", background: "#111820" }}>
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
            <span className="text-[10px] font-medium text-slate-400">{statusLabel}</span>
            {connectionStatus === "online" && latency !== null && (
              <span className={`text-[10px] font-mono ${latencyColor}`}>{latency}ms</span>
            )}
          </div>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {/* Elapsed time — desktop only */}
          {sessionStarted && (
            <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-500 font-mono mr-1">
              <Clock className="h-3 w-3" />
              {elapsed}
            </div>
          )}

          {/* Font size — desktop only */}
          <div className="hidden sm:flex items-center gap-0.5">
            <button
              onClick={() => changeFontSize(-1)}
              disabled={fontSizeIdx === 0}
              className="h-6 w-6 rounded flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/5 disabled:opacity-30 transition-colors"
              title="Decrease font size"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-[10px] text-slate-600 font-mono w-6 text-center">{FONT_SIZES[fontSizeIdx]}</span>
            <button
              onClick={() => changeFontSize(1)}
              disabled={fontSizeIdx === FONT_SIZES.length - 1}
              className="h-6 w-6 rounded flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/5 disabled:opacity-30 transition-colors"
              title="Increase font size"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="w-px h-4 bg-white/10 mx-0.5 hidden sm:block" />

          {/* Copy */}
          <button
            onClick={handleCopy}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
            title="Copy selection"
          >
            <Clipboard className="h-3.5 w-3.5" />
          </button>

          {/* Paste */}
          <button
            onClick={handlePaste}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
            title="Paste"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
          </button>

          {/* Info panel toggle */}
          <button
            onClick={() => setShowInfo((v) => !v)}
            className={`h-7 w-7 rounded flex items-center justify-center transition-colors ${showInfo ? "text-green-400 bg-green-400/10" : "text-slate-500 hover:text-slate-200 hover:bg-white/5"}`}
            title="Session info"
          >
            <Info className="h-3.5 w-3.5" />
          </button>

          {/* Reconnect */}
          <button
            onClick={handleReconnect}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
            title="Reconnect"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>

          {/* Fullscreen — desktop only */}
          <button
            onClick={toggleFullscreen}
            className="hidden sm:flex h-7 w-7 rounded items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
            title="Toggle fullscreen"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>

          {/* Disconnect */}
          <button
            onClick={handleDisconnect}
            className="h-7 w-7 rounded flex items-center justify-center text-red-500/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="End session"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Reconnecting banner ───────────────────────────────────────── */}
      {bgReconnecting && (
        <div
          className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 text-yellow-400 text-xs font-medium"
          style={{ background: "#1a1500", borderBottom: "1px solid #2a2000" }}
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          Resuming session…
        </div>
      )}

      {/* ── Info panel (slide-down) ───────────────────────────────────── */}
      <div
        className={`shrink-0 overflow-hidden transition-all duration-300 ${showInfo ? "max-h-40" : "max-h-0"}`}
        style={{ background: "#0d1219", borderBottom: showInfo ? "1px solid #1e2a1e" : "none" }}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3">
          <InfoCard icon={<Cpu className="h-3.5 w-3.5 text-blue-400" />} label="Device" value={device?.name ?? "—"} />
          <InfoCard icon={<Activity className="h-3.5 w-3.5 text-green-400" />} label="Session" value={sessionIdRef.current?.slice(0, 8) ?? "—"} />
          <InfoCard icon={<Clock className="h-3.5 w-3.5 text-yellow-400" />} label="Elapsed" value={elapsed} />
          <InfoCard icon={<Wifi className="h-3.5 w-3.5 text-cyan-400" />} label="Latency" value={latency !== null ? `${latency}ms` : "—"} />
        </div>
        {device?.workdir && (
          <p className="px-3 pb-2 text-[10px] text-slate-500 font-mono truncate">
            📁 {device.workdir}
          </p>
        )}
      </div>

      {/* ── Terminal ──────────────────────────────────────────────────── */}
      <div ref={terminalContainerRef} className="flex-1 min-h-0" style={{ padding: "4px 6px" }} />

      {/* ── Scroll controls (mobile, always visible) ─────────────────── */}
      <div
        className="sm:hidden shrink-0 flex items-center gap-1 px-2 py-1 border-t"
        style={{ borderColor: "#1e2a1e", background: "#0d1219" }}
      >
        <button
          onPointerDown={(e) => { e.preventDefault(); scrollTerminal("up"); }}
          className="flex-1 h-7 rounded flex items-center justify-center gap-1 text-[11px] font-medium select-none transition-colors text-slate-400 active:text-slate-200"
          style={{ background: "#141c14" }}
        >
          <ChevronUp className="h-3.5 w-3.5" /> Scroll Up
        </button>
        <button
          onPointerDown={(e) => { e.preventDefault(); scrollTerminal("down"); }}
          className="flex-1 h-7 rounded flex items-center justify-center gap-1 text-[11px] font-medium select-none transition-colors text-slate-400 active:text-slate-200"
          style={{ background: "#141c14" }}
        >
          <ChevronDown className="h-3.5 w-3.5" /> Bottom
        </button>
        {/* Mobile font size */}
        <button
          onPointerDown={(e) => { e.preventDefault(); changeFontSize(-1); }}
          disabled={fontSizeIdx === 0}
          className="h-7 w-8 rounded flex items-center justify-center text-slate-500 active:text-slate-200 disabled:opacity-30 select-none"
          style={{ background: "#141c14" }}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          onPointerDown={(e) => { e.preventDefault(); changeFontSize(1); }}
          disabled={fontSizeIdx === FONT_SIZES.length - 1}
          className="h-7 w-8 rounded flex items-center justify-center text-slate-500 active:text-slate-200 disabled:opacity-30 select-none"
          style={{ background: "#141c14" }}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Mobile keyboard toolbar ───────────────────────────────────── */}
      <div
        className={`sm:hidden shrink-0 overflow-hidden transition-all duration-200 border-t ${keyboardVisible ? "max-h-28 opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}
        style={{ borderColor: "#1e2a1e", background: "#0d1219" }}
      >
        {keyRows.map((row, ri) => (
          <div key={ri} className="flex items-center gap-0.5 px-1 py-0.5">
            {row.map((k) => {
              const isCtrlKey = k.seq === "ctrl";
              const isActive = isCtrlKey && ctrlActive;
              return (
                <button
                  key={k.label}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    if (isCtrlKey) { setCtrlActive((v) => !v); }
                    else { handleToolbarKey(k.seq); }
                  }}
                  className={[
                    "flex-1 min-w-0 h-8 rounded text-[11px] font-mono font-medium select-none transition-colors",
                    "flex items-center justify-center",
                    isActive
                      ? "text-black"
                      : ri === 2
                      ? "text-cyan-300"
                      : k.special
                      ? "text-slate-400"
                      : "text-green-300",
                  ].join(" ")}
                  style={{
                    background: isActive ? "#39ff8f" : ri === 2 ? "#0a1520" : k.special ? "#161e16" : "#101810",
                    border: `1px solid ${isActive ? "#39ff8f40" : "#1e2a1e"}`,
                  }}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ background: "#111820" }}>
      {icon}
      <div className="min-w-0">
        <p className="text-[9px] text-slate-600 uppercase tracking-wider">{label}</p>
        <p className="text-[11px] text-slate-300 font-mono truncate">{value}</p>
      </div>
    </div>
  );
}
