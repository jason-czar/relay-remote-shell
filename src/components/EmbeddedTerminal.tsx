import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
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
  convId?: string | null;
  initialCommand?: string | null;
  onConnectorDisconnected?: () => void;
  onConnectorReconnected?: () => void;
}

export interface EmbeddedTerminalHandle {
  focus: () => void;
}

const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20];
// How often to probe for connector reconnect (seconds between attempts, capped)
const CONNECTOR_RETRY_DELAYS = [3000, 5000, 8000, 10000, 15000, 20000, 30000];

export const EmbeddedTerminal = forwardRef<EmbeddedTerminalHandle, Props>(function EmbeddedTerminal(
  { deviceId, convId, initialCommand, onConnectorDisconnected, onConnectorReconnected },
  ref
) {
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
  const connectorOfflineRef = useRef(false);
  const connectorRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectorRetryCountRef = useRef(0);
  const onConnectorDisconnectedRef = useRef(onConnectorDisconnected);
  const onConnectorReconnectedRef = useRef(onConnectorReconnected);
  useEffect(() => { onConnectorDisconnectedRef.current = onConnectorDisconnected; }, [onConnectorDisconnected]);
  useEffect(() => { onConnectorReconnectedRef.current = onConnectorReconnected; }, [onConnectorReconnected]);

  const [status, setStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [latency, setLatency] = useState<number | null>(null);
  const [bgReconnecting, setBgReconnecting] = useState(false);
  const [connectorOffline, setConnectorOffline] = useState(false);
  const [fontSizeIdx, setFontSizeIdx] = useState(() => {
    const saved = localStorage.getItem("terminal-font-size-idx");
    return saved ? parseInt(saved, 10) : (window.innerWidth < 640 ? 2 : 4);
  });

  // Session storage key: scoped to conversation when available, falls back to device-level
  const sessionStorageKey = convId ? `relay-session-${deviceId}-${convId}` : `relay-session-${deviceId}`;
  const persistSessionId = useCallback((id: string) => {
    sessionStorage.setItem(sessionStorageKey, id);
    localStorage.setItem(sessionStorageKey, id);
    const deviceKey = `relay-session-${deviceId}`;
    sessionStorage.setItem(deviceKey, id);
    localStorage.setItem(deviceKey, id);
  }, [sessionStorageKey, deviceId]);
  const getPersistedSessionId = useCallback((): string | null => {
    return sessionStorage.getItem(sessionStorageKey) ?? localStorage.getItem(sessionStorageKey);
  }, [sessionStorageKey]);
  const clearPersistedSessionId = useCallback(() => {
    sessionStorage.removeItem(sessionStorageKey);
    localStorage.removeItem(sessionStorageKey);
  }, [sessionStorageKey]);

  // Forward-declare connectWebSocket so startConnectorRetry can reference it
  const connectWebSocketRef = useRef<(term: Terminal, dev: Tables<"devices"> | null, sessionId: string, isResume: boolean) => void>(() => {});

  // ── Connector retry loop ──────────────────────────────────────────────
  // Polls for a new session every CONNECTOR_RETRY_DELAYS[n] ms until the
  // device connector comes back online, then resumes the terminal.
  const startConnectorRetry = useCallback(() => {
    if (connectorRetryTimerRef.current) clearTimeout(connectorRetryTimerRef.current);
    connectorRetryCountRef.current = 0;

    const attempt = async () => {
      if (intentionalCloseRef.current) return;
      if (!termRef.current) return;

      // Try to start a fresh session — will fail with 404/error if connector is still offline
      const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", {
        body: { device_id: deviceId },
      });

      if (!sesErr && sesData?.session_id) {
        // Connector came back — resume
        const newSessionId = sesData.session_id;
        sessionIdRef.current = newSessionId;
        persistSessionId(newSessionId);
        connectorOfflineRef.current = false;
        connectorRetryCountRef.current = 0;
        setConnectorOffline(false);
        setBgReconnecting(false);
        onConnectorReconnectedRef.current?.();
        connectWebSocketRef.current(termRef.current, devRef.current, newSessionId, false);
        return;
      }

      // Still offline — schedule next attempt with capped backoff
      const idx = Math.min(connectorRetryCountRef.current, CONNECTOR_RETRY_DELAYS.length - 1);
      const delay = CONNECTOR_RETRY_DELAYS[idx];
      connectorRetryCountRef.current++;
      connectorRetryTimerRef.current = setTimeout(attempt, delay);
    };

    connectorRetryTimerRef.current = setTimeout(attempt, CONNECTOR_RETRY_DELAYS[0]);
  }, [deviceId, persistSessionId]);

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

      let probeTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const clearProbeTimeout = () => { if (probeTimeoutId) { clearTimeout(probeTimeoutId); probeTimeoutId = null; } };

      const markPtyReady = () => {
        clearProbeTimeout();
        if (ptyReady) return;
        ptyReady = true;
        setStatus("online");
        setBgReconnecting(false);
        setConnectorOffline(false);
        connectorOfflineRef.current = false;
        reconnectDelayRef.current = 1000;
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
              ws.send(JSON.stringify({ type: "resize", data: { session_id: sessionId, cols: term.cols, rows: term.rows, probe: true } }));
              probeTimeoutId = setTimeout(() => {
                if (!ptyReady && !resumeFallbackTried) {
                  resumeFallbackTried = true;
                  ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: term.cols, rows: term.rows } }));
                }
              }, 3000);
            } else {
              ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: term.cols, rows: term.rows } }));
            }
          } else if (msg.type === "session_started") {
            markPtyReady();
            // Send initial command if provided (e.g. tmux attach -t <name>)
            if (initialCommand) {
              ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(initialCommand + "\n") } }));
            }
          } else if (msg.type === "pong") {
            setLatency(Date.now() - pingSentAtRef.current);
          } else if (msg.type === "stdout") {
            const { data_b64 } = (msg.data ?? {}) as { data_b64: string };
            if (data_b64) {
              try {
                const bin = atob(data_b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                term.write(bytes);
              } catch { term.write(data_b64); }
            }
          } else if (msg.type === "scrollback") {
            const { data_b64, frames } = (msg.data ?? {}) as { data_b64?: string; frames?: { d: string }[] };
            const writeB64 = (b64: string) => {
              try {
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                term.write(bytes);
              } catch { term.write(b64); }
            };
            if (Array.isArray(frames) && frames.length > 0) {
              for (const frame of frames) writeB64(frame.d);
            } else if (data_b64) {
              writeB64(data_b64);
            }
          } else if (msg.type === "session_end") {
            const { reason } = (msg.data ?? {}) as { reason?: string };
            if (!ptyReady && isResume && !resumeFallbackTried && missingSessionRe.test(reason ?? "")) {
              resumeFallbackTried = true;
              ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: term.cols, rows: term.rows } }));
              return;
            }
            // Connector went offline — start polling retry loop
            if (reason === "connector_disconnected") {
              clearProbeTimeout();
              if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
              connectorOfflineRef.current = true;
              setConnectorOffline(true);
              setStatus("offline");
              setBgReconnecting(true);
              onConnectorDisconnectedRef.current?.();
              startConnectorRetry();
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
        clearProbeTimeout();
        if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
        // If we're in connector-retry mode, don't try the normal WS backoff
        if (connectorOfflineRef.current) return;
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
  }, [deviceId, startConnectorRetry]);

  // Keep the ref in sync so startConnectorRetry can call it
  useEffect(() => { connectWebSocketRef.current = connectWebSocket; }, [connectWebSocket]);

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
      if (sessionId) isResume = true;

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
      if (connectorRetryTimerRef.current) clearTimeout(connectorRetryTimerRef.current);
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (termRef.current) { termRef.current.dispose(); termRef.current = null; }
      fitRef.current = null;
    };
  }, [deviceId, user, convId]); // eslint-disable-line react-hooks/exhaustive-deps

  const latencyColor = latency === null ? "text-muted-foreground/40" : latency < 80 ? "text-green-400" : latency < 200 ? "text-yellow-400" : "text-red-400";

  useImperativeHandle(ref, () => ({
    focus: () => termRef.current?.focus(),
  }));

  return (
    <div className="flex flex-col h-full w-full bg-background">
      {/* Slim status + controls bar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-border/20 text-xs">
        <div className="flex items-center gap-1.5">
          {status === "connecting" && <><Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" /><span className="text-muted-foreground/50">Connecting…</span></>}
          {status === "online" && !bgReconnecting && <><Wifi className="h-3 w-3 text-green-500/70" /><span className="text-muted-foreground/60">Connected</span></>}
          {status === "offline" && !bgReconnecting && <><WifiOff className="h-3 w-3 text-red-400/80" /><span className="text-muted-foreground/60">Disconnected</span></>}
          {bgReconnecting && !connectorOffline && <><Loader2 className="h-3 w-3 animate-spin text-yellow-400/80" /><span className="text-muted-foreground/60">Reconnecting…</span></>}
          {connectorOffline && <><Loader2 className="h-3 w-3 animate-spin text-orange-400/80" /><span className="text-orange-400/80">Device offline — reconnecting…</span></>}
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

      {/* Connector offline banner — shown inside terminal area */}
      {connectorOffline && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-orange-500/10 border-b border-orange-500/20 text-xs text-orange-400/90">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span>Device connector is offline. Retrying automatically — your session will resume when it reconnects.</span>
        </div>
      )}

      {/* Terminal canvas */}
      <div ref={containerRef} className="flex-1 min-h-0 px-2 pt-2" />
    </div>
  );
});
