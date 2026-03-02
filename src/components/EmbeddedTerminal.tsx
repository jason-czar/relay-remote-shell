import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Loader2, WifiOff, Wifi } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

interface RelayMessage {
  type: string;
  id?: string;
  data?: unknown;
}

interface Props {
  deviceId: string;
}

const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20];

export function EmbeddedTerminal({ deviceId }: Props) {
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const devRef = useRef<Tables<"devices"> | null>(null);
  const intentionalCloseRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingSentAtRef = useRef<number>(0);
  const isHiddenRef = useRef(false);

  const [status, setStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [latency, setLatency] = useState<number | null>(null);
  const [bgReconnecting, setBgReconnecting] = useState(false);
  const [fontSizeIdx, setFontSizeIdx] = useState(() => {
    const saved = localStorage.getItem("terminal-font-size-idx");
    return saved ? parseInt(saved, 10) : (window.innerWidth < 640 ? 2 : 4);
  });

  const sessionStorageKey = `relay-session-${deviceId}`;
  const persistSessionId = useCallback((id: string) => {
    sessionStorage.setItem(sessionStorageKey, id);
    localStorage.setItem(sessionStorageKey, id);
  }, [sessionStorageKey]);
  const getPersistedSessionId = useCallback((): string | null => {
    return sessionStorage.getItem(sessionStorageKey) ?? localStorage.getItem(sessionStorageKey);
  }, [sessionStorageKey]);
  const clearPersistedSessionId = useCallback(() => {
    sessionStorage.removeItem(sessionStorageKey);
    localStorage.removeItem(sessionStorageKey);
  }, [sessionStorageKey]);

  const connectWebSocket = useCallback((term: Terminal, dev: Tables<"devices"> | null, sessionId: string, isResume: boolean) => {
    const relayUrl = import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com";

    const connect = async () => {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const jwt = authSession?.access_token;
      if (!jwt) { setStatus("offline"); return; }

      const ws = new WebSocket(`${relayUrl}/session`);
      wsRef.current = ws;
      let ptyReady = false;
      let resumeFallbackTried = false;
      const missingSessionRe = /session[_\s-]*not[_\s-]*found|unknown session|missing session|not found/i;

      const markPtyReady = () => {
        if (ptyReady) return;
        ptyReady = true;
        setStatus("online");
        setBgReconnecting(false);
        reconnectDelayRef.current = 1000;
        // Start ping once the PTY is confirmed alive.
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            pingSentAtRef.current = Date.now();
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 5000);
      };

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", data: { token: jwt, session_id: sessionId, device_id: deviceId } }));
      };

      ws.onmessage = (event) => {
        try {
          const msg: RelayMessage = JSON.parse(event.data);
          if (msg.type === "auth_ok") {
            if (isResume) {
              // Probe whether the previous PTY is still alive.
              ws.send(JSON.stringify({ type: "resize", data: { session_id: sessionId, cols: term.cols, rows: term.rows, probe: true } }));
            } else {
              ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: term.cols, rows: term.rows } }));
            }
          } else if (msg.type === "session_started") {
            markPtyReady();
          } else if (msg.type === "pong") {
            setLatency(Date.now() - pingSentAtRef.current);
          } else if (msg.type === "stdout") {
            const { data_b64 } = (msg.data ?? {}) as { data_b64: string };
            if (data_b64) {
              try { term.write(atob(data_b64)); } catch { term.write(data_b64); }
            }
          } else if (msg.type === "scrollback") {
            const { data_b64, frames } = (msg.data ?? {}) as { data_b64?: string; frames?: { d: string }[] };
            if (Array.isArray(frames) && frames.length > 0) {
              for (const frame of frames) {
                try { term.write(atob(frame.d)); } catch { term.write(frame.d); }
              }
            } else if (data_b64) {
              try { term.write(atob(data_b64)); } catch { term.write(data_b64); }
            }
          } else if (msg.type === "session_end") {
            const { reason } = (msg.data ?? {}) as { reason?: string };
            if (!ptyReady && isResume && !resumeFallbackTried && missingSessionRe.test(reason ?? "")) {
              resumeFallbackTried = true;
              ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: term.cols, rows: term.rows } }));
              return;
            }
            setStatus("offline");
          } else if (msg.type === "error") {
            const { message } = (msg.data ?? {}) as { message?: string };
            if (!ptyReady && isResume && !resumeFallbackTried && missingSessionRe.test(message ?? "")) {
              resumeFallbackTried = true;
              ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: term.cols, rows: term.rows } }));
              return;
            }
            term.writeln(`\x1b[31m✗ ${message ?? "Relay error"}\x1b[0m`);
            setStatus("offline");
          }
        } catch { /* ignore */ }
      };

      ws.onerror = () => setStatus("offline");
      ws.onclose = () => {
        if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
        if (!intentionalCloseRef.current && !isHiddenRef.current) {
          setStatus("offline");
          const delay = reconnectDelayRef.current;
          reconnectDelayRef.current = Math.min(delay * 2, 30000);
          setBgReconnecting(true);
          reconnectTimerRef.current = setTimeout(() => {
            if (!intentionalCloseRef.current) {
              connect();
            }
          }, delay);
        }
      };
    };

    connect();
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId || !user || !containerRef.current) return;

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
        background: "transparent",
        foreground: "#c8d8c8",
        cursor: "#39ff8f",
        cursorAccent: "#0a0e1a",
        selectionBackground: "#39ff8f28",
        selectionForeground: "#e8f8e8",
        black: "#0d1117", red: "#ff5555", green: "#39ff8f", yellow: "#ffb86c",
        blue: "#6fa8ff", magenta: "#bd93f9", cyan: "#8be9fd", white: "#d8e8d8",
        brightBlack: "#4a5568", brightRed: "#ff7b7b", brightGreen: "#69ffaf",
        brightYellow: "#ffd080", brightBlue: "#90c0ff", brightMagenta: "#d0b0ff",
        brightCyan: "#a8f0ff", brightWhite: "#f0f8f0",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        wsRef.current.send(JSON.stringify({
          type: "stdin",
          data: { session_id: sessionIdRef.current, data_b64: btoa(unescape(encodeURIComponent(data))) },
        }));
      }
    });

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
    containerRef.current.addEventListener("paste", handleNativePaste);

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        wsRef.current.send(JSON.stringify({
          type: "resize",
          data: { session_id: sessionIdRef.current, cols: term.cols, rows: term.rows },
        }));
      }
    });
    ro.observe(containerRef.current);

    const init = async () => {
      const { data: dev } = await supabase.from("devices").select("*").eq("id", deviceId).single();
      devRef.current = dev;

      let sessionId = getPersistedSessionId();
      let isResume = false;

      if (sessionId) {
        const { data: existing } = await supabase.from("sessions").select("id, status").eq("id", sessionId).single();
        if (!existing || existing.status !== "active") { sessionId = null; clearPersistedSessionId(); }
        else { isResume = true; }
      }

      if (!sessionId) {
        const { data: active } = await supabase.from("sessions").select("id")
          .eq("device_id", deviceId).eq("user_id", user!.id).eq("status", "active")
          .order("started_at", { ascending: false }).limit(1);
        if (active?.length) { sessionId = active[0].id; isResume = true; }
      }

      if (!sessionId) {
        const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", { body: { device_id: deviceId } });
        if (sesErr || !sesData?.session_id) {
          term.writeln(`\x1b[31m✗ Failed to start session: ${sesData?.error || sesErr?.message}\x1b[0m`);
          setStatus("offline");
          return;
        }
        sessionId = sesData.session_id;
      }

      sessionIdRef.current = sessionId;
      persistSessionId(sessionId!);
      connectWebSocket(term, dev, sessionId!, isResume);
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
          connectWebSocket(termRef.current, devRef.current, sessionIdRef.current, true);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      ro.disconnect();
      containerRef.current?.removeEventListener("paste", handleNativePaste);
      intentionalCloseRef.current = true;
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      // Don't dispose terminal — keep session alive
    };
  }, [deviceId, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const latencyColor = latency === null ? "text-muted-foreground/40" : latency < 80 ? "text-green-400" : latency < 200 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="flex flex-col h-full w-full bg-background">
      {/* Slim status + controls bar — matches chat header aesthetic */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-border/20 text-xs">
        <div className="flex items-center gap-1.5">
          {status === "connecting" && <><Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" /><span className="text-muted-foreground/50">Connecting…</span></>}
          {status === "online" && !bgReconnecting && <><Wifi className="h-3 w-3 text-green-500/70" /><span className="text-muted-foreground/60">Connected</span></>}
          {status === "offline" && <><WifiOff className="h-3 w-3 text-red-400/80" /><span className="text-muted-foreground/60">Disconnected</span></>}
          {bgReconnecting && <><Loader2 className="h-3 w-3 animate-spin text-yellow-400/80" /><span className="text-muted-foreground/60">Reconnecting…</span></>}
          {latency !== null && !bgReconnecting && (
            <span className={`ml-2 font-mono text-[11px] ${latencyColor}`}>{latency}ms</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => setFontSizeIdx(i => { const n = Math.max(0, i-1); if(termRef.current){termRef.current.options.fontSize=FONT_SIZES[n];fitRef.current?.fit();} localStorage.setItem("terminal-font-size-idx",String(n)); return n; })}
            className="px-2 py-0.5 rounded text-[11px] text-muted-foreground/50 hover:text-foreground hover:bg-secondary transition-colors"
          >A−</button>
          <button
            onClick={() => setFontSizeIdx(i => { const n = Math.min(FONT_SIZES.length-1, i+1); if(termRef.current){termRef.current.options.fontSize=FONT_SIZES[n];fitRef.current?.fit();} localStorage.setItem("terminal-font-size-idx",String(n)); return n; })}
            className="px-2 py-0.5 rounded text-[11px] text-muted-foreground/50 hover:text-foreground hover:bg-secondary transition-colors"
          >A+</button>
        </div>
      </div>
      {/* Terminal canvas */}
      <div ref={containerRef} className="flex-1 min-h-0 px-2 pt-2" />
    </div>
  );
}
