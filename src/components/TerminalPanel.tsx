import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Wifi, RotateCcw, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface RelayMessage {
  type: string;
  id?: string;
  data?: unknown;
}

interface TerminalPanelProps {
  deviceId: string;
  deviceName?: string;
  onClose?: () => void;
}

export function TerminalPanel({ deviceId, deviceName, onClose }: TerminalPanelProps) {
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const intentionalCloseRef = useRef(false);
  const isHiddenRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingSentAtRef = useRef<number>(0);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [latency, setLatency] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState(deviceName ?? deviceId);

  const cleanup = useCallback(() => {
    intentionalCloseRef.current = true;
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (wsRef.current) {
      if (sessionIdRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "session_end", data: { session_id: sessionIdRef.current, reason: "user_disconnect" } }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    if (termRef.current) { termRef.current.dispose(); termRef.current = null; }
    fitRef.current = null;
  }, []);

  const endSessionInDb = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try { await supabase.functions.invoke("end-session", { body: { session_id: sessionIdRef.current } }); } catch {}
  }, []);

  const connectWebSocket = async (term: Terminal, sessionId: string, isResume = false) => {
    const relayUrl = import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com";
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const jwt = authSession?.access_token;
    if (!jwt) { term.writeln(`\x1b[31m✗ No auth session\x1b[0m`); setConnectionStatus("offline"); return; }

    term.writeln(`\x1b[33m⟳ Connecting to relay...\x1b[0m`);
    setConnectionStatus("connecting");
    intentionalCloseRef.current = false;

    try {
      const ws = new WebSocket(`${relayUrl}/session`);
      wsRef.current = ws;
      let ptyReady = false;
      let resumeFallbackTried = false;
      const missingSessionRe = /session[_\s-]*not[_\s-]*found|unknown session|missing session|not found/i;

      const markPtyReady = () => {
        if (ptyReady) return;
        ptyReady = true;
        term.writeln(`\x1b[32m✓ Connected\x1b[0m`);
        setConnectionStatus("online");
        reconnectDelayRef.current = 1000;
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            pingSentAtRef.current = performance.now();
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
            } else {
              ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: term.cols, rows: term.rows } }));
            }
          } else if (msg.type === "session_started") {
            markPtyReady();
          } else if (msg.type === "pong") {
            setLatency(Math.round(performance.now() - pingSentAtRef.current));
          } else if (msg.type === "stdout" && msg.data) {
            const { data_b64 } = msg.data as { session_id: string; data_b64: string };
            term.write(Uint8Array.from(atob(data_b64), (c) => c.charCodeAt(0)));
          } else if (msg.type === "session_end") {
            const { reason } = (msg.data ?? {}) as { reason?: string };
            if (!ptyReady && isResume && !resumeFallbackTried && missingSessionRe.test(reason ?? "")) {
              resumeFallbackTried = true;
              ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: term.cols, rows: term.rows } }));
              return;
            }
            term.writeln("\r\n\x1b[31m● Session ended by remote\x1b[0m");
            intentionalCloseRef.current = true;
            setConnectionStatus("offline");
          } else if (msg.type === "error") {
            const { message } = (msg.data ?? {}) as { message?: string };
            if (!ptyReady && isResume && !resumeFallbackTried && missingSessionRe.test(message ?? "")) {
              resumeFallbackTried = true;
              ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: term.cols, rows: term.rows } }));
              return;
            }
            term.writeln(`\r\n\x1b[31m✗ ${message ?? "Unknown error"}\x1b[0m`);
          }
        } catch {}
      };

      ws.onclose = () => {
        if (intentionalCloseRef.current) { setConnectionStatus("offline"); return; }
        const delay = reconnectDelayRef.current;
        term.writeln(`\r\n\x1b[33m⚠ Reconnecting in ${Math.round(delay / 1000)}s...\x1b[0m`);
        setConnectionStatus("connecting");
        reconnectTimerRef.current = setTimeout(() => { connectWebSocket(term, sessionId, true); }, delay);
        reconnectDelayRef.current = Math.min(delay * 2, 30000);
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(data) } }));
        }
      });
    } catch {
      term.writeln(`\x1b[33m⚠ Relay not available\x1b[0m`);
      setConnectionStatus("offline");
    }
  };

  useEffect(() => {
    if (!deviceId || !user || !containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true, cursorStyle: "bar",
      fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.4,
      theme: (() => {
        const v = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
        const hsl = (name: string) => `hsl(${v(name)})`;
        return {
          background:          hsl("terminal-bg"),
          foreground:          hsl("terminal-fg"),
          cursor:              hsl("terminal-cursor"),
          selectionBackground: `hsl(${v("terminal-green")} / 0.2)`,
          black:               hsl("terminal-black"),
          red:                 hsl("terminal-red"),
          green:               hsl("terminal-green"),
          yellow:              hsl("terminal-yellow"),
          blue:                hsl("terminal-blue"),
          magenta:             hsl("terminal-magenta"),
          cyan:                hsl("terminal-cyan"),
          white:               hsl("terminal-white"),
          brightBlack:         hsl("terminal-bright-black"),
          brightRed:           hsl("terminal-bright-red"),
          brightGreen:         hsl("terminal-bright-green"),
          brightYellow:        hsl("terminal-bright-yellow"),
          brightBlue:          hsl("terminal-bright-blue"),
          brightMagenta:       hsl("terminal-bright-magenta"),
          brightCyan:          hsl("terminal-bright-cyan"),
          brightWhite:         hsl("terminal-bright-white"),
        };
      })(),
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        wsRef.current.send(JSON.stringify({ type: "resize", data: { session_id: sessionIdRef.current, cols: term.cols, rows: term.rows } }));
      }
    });
    resizeObserver.observe(containerRef.current);

    const init = async () => {
      const { data: dev } = await supabase.from("devices").select("*").eq("id", deviceId).single();
      if (dev) setDisplayName(dev.name);

      const { data: activeSessions } = await supabase.from("sessions").select("id")
        .eq("device_id", deviceId).eq("user_id", user!.id).eq("status", "active")
        .order("started_at", { ascending: false }).limit(1);

      let sessionId = activeSessions?.[0]?.id;
      let isResume = false;
      if (sessionId) {
        isResume = true;
        term.writeln(`\x1b[33m⟳ Resuming session ${sessionId.slice(0, 8)}...\x1b[0m`);
      } else {
        const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", { body: { device_id: deviceId } });
        if (sesErr || !sesData?.session_id) {
          term.writeln(`\x1b[31m✗ Failed to create session\x1b[0m`);
          setConnectionStatus("offline");
          return;
        }
        sessionId = sesData.session_id;
      }

      sessionIdRef.current = sessionId!;
      term.writeln(`\x1b[2m── ${dev?.name ?? deviceId} ──\x1b[0m`);
      connectWebSocket(term, sessionId!, isResume);
    };

    init();

    // When user switches away, just drop WS (don't end session in DB), reconnect on return
    const handleVisibility = () => {
      if (document.hidden) {
        isHiddenRef.current = true;
        intentionalCloseRef.current = true;
        if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
        if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      } else {
        isHiddenRef.current = false;
        if (termRef.current && sessionIdRef.current) {
          intentionalCloseRef.current = false;
          connectWebSocket(termRef.current, sessionIdRef.current, true);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      resizeObserver.disconnect();
      // Do NOT end the session on unmount — only end explicitly on close button.
      cleanup();
    };
  }, [deviceId, user]);

  const latencyColor = latency === null ? "text-muted-foreground" : latency < 100 ? "text-status-online" : latency < 300 ? "text-status-connecting" : "text-destructive";

  return (
    <div className="flex flex-col h-full bg-terminal-bg">
      <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={connectionStatus} />
          <span className="text-xs font-medium truncate">{displayName}</span>
          {connectionStatus === "online" && latency !== null && (
            <span className={`text-[10px] font-mono flex items-center gap-0.5 ${latencyColor}`}>
              <Wifi className="h-2.5 w-2.5" /> {latency}ms
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { cleanup(); if (containerRef.current && deviceId && user) window.location.reload(); }} title="Reconnect">
            <RotateCcw className="h-3 w-3" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => { endSessionInDb(); cleanup(); onClose(); }} title="Close">
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <div ref={containerRef} className="flex-1 p-0.5" />
    </div>
  );
}
