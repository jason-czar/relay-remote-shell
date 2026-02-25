import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, RotateCcw, X, Clipboard, ClipboardPaste, Wifi } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// Relay message protocol (matches Go connector)
interface RelayMessage {
  type: string;
  id?: string;
  data?: unknown;
}

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
  const [device, setDevice] = useState<Tables<"devices"> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [latency, setLatency] = useState<number | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingSentAtRef = useRef<number>(0);

  // Whether we're currently hidden (app switched away)
  const isHiddenRef = useRef(false);

  // Clean up terminal + websocket
  const cleanup = useCallback(() => {
    intentionalCloseRef.current = true;
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
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
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }
    fitRef.current = null;
  }, []);

  // End session in DB
  const endSessionInDb = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try {
      await supabase.functions.invoke("end-session", {
        body: { session_id: sessionIdRef.current },
      });
    } catch {
      // Best effort
    }
  }, []);

  // Initialize terminal
  useEffect(() => {
    if (!deviceId || !user || !terminalContainerRef.current) return;

    const isMobile = window.innerWidth < 640;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: isMobile ? 12 : 14,
      lineHeight: 1.4,
      theme: {
        background: "#080c14",
        foreground: "#c4d9c4",
        cursor: "#4ade80",
        selectionBackground: "#4ade8033",
        black: "#1a1e2e",
        red: "#ef4444",
        green: "#4ade80",
        yellow: "#f59e0b",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#22d3ee",
        white: "#e2e8f0",
        brightBlack: "#475569",
        brightRed: "#f87171",
        brightGreen: "#86efac",
        brightYellow: "#fbbf24",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalContainerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Native paste handler: catches Cmd+V and mobile long-press paste on the terminal container
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

    // Resize observer
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

    // Load device and start/resume session
    const init = async () => {
      const { data: dev } = await supabase.from("devices").select("*").eq("id", deviceId).single();
      devRef.current = dev;
      setDevice(dev);

      let sessionId = resumeSessionId;

      // If no explicit session to resume, check for existing active session on this device
      if (!sessionId) {
        const { data: activeSessions } = await supabase
          .from("sessions")
          .select("id")
          .eq("device_id", deviceId)
          .eq("user_id", user!.id)
          .eq("status", "active")
          .order("started_at", { ascending: false })
          .limit(1);

        if (activeSessions && activeSessions.length > 0) {
          sessionId = activeSessions[0].id;
          term.writeln(`\x1b[33m⟳ Resuming active session ${sessionId.slice(0, 8)}...\x1b[0m`);
        }
      }

      // If still no session, create a new one
      if (!sessionId) {
        const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", {
          body: { device_id: deviceId },
        });

        if (sesErr || !sesData?.session_id) {
          const errMsg = sesData?.error || sesErr?.message || "Unknown error";
          term.writeln(`\x1b[31m✗ Failed to create session: ${errMsg}\x1b[0m`);
          if (errMsg.includes("supabaseKey") || errMsg.includes("config")) {
            term.writeln(`\x1b[33m  → Backend configuration issue. Contact your admin.\x1b[0m`);
          } else if (errMsg.includes("not found") || errMsg.includes("device")) {
            term.writeln(`\x1b[33m  → Device may have been removed. Go back and try again.\x1b[0m`);
          } else {
            term.writeln(`\x1b[33m  → Check that the device is online and try reconnecting.\x1b[0m`);
          }
          setConnectionStatus("offline");
          return;
        }
        sessionId = sesData.session_id;
      }

      sessionIdRef.current = sessionId;

      term.writeln(`\x1b[2m── PrivaClaw ──\x1b[0m`);
      term.writeln(`\x1b[2mDevice:\x1b[0m ${dev?.name ?? deviceId}`);
      term.writeln(`\x1b[2mSession:\x1b[0m ${sessionId!.slice(0, 8)}`);
      term.writeln("");

      // Try connecting to WebSocket relay
      connectWebSocket(term, dev, sessionId!);
    };

    init();

    // Visibility change: reconnect when coming back, but DON'T end session when hiding
    const handleVisibility = () => {
      if (document.hidden) {
        isHiddenRef.current = true;
        // Just close the WS transport; keep session alive in DB
        intentionalCloseRef.current = true;
        if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
        if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      } else {
        isHiddenRef.current = false;
        if (termRef.current && sessionIdRef.current) {
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
      if (!isHiddenRef.current) {
        endSessionInDb();
      }
      cleanup();
    };
  }, [deviceId, user]);

  const connectWebSocket = async (term: Terminal, dev: Tables<"devices"> | null, sessionId: string) => {
    const relayUrl = import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com";

    if (!relayUrl) {
      term.writeln(`\x1b[33m⚠ No relay URL configured (set VITE_RELAY_URL)\x1b[0m`);
      fallbackToStub(term, dev, sessionId);
      return;
    }

    // Get fresh JWT for relay auth
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const jwt = authSession?.access_token;
    if (!jwt) {
      term.writeln(`\x1b[31m✗ No auth session\x1b[0m`);
      setConnectionStatus("offline");
      return;
    }

    term.writeln(`\x1b[33m⟳ Connecting to relay...\x1b[0m`);
    setConnectionStatus("connecting");
    intentionalCloseRef.current = false;

    try {
      const ws = new WebSocket(`${relayUrl}/session`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "auth",
          data: {
            token: jwt,
            session_id: sessionId,
            device_id: dev?.id ?? deviceId,
          },
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg: RelayMessage = JSON.parse(event.data);
          if (msg.type === "auth_ok") {
            term.writeln(`\x1b[32m✓ Authenticated with relay\x1b[0m`);
            setConnectionStatus("online");
            reconnectDelayRef.current = 1000;
            ws.send(JSON.stringify({
              type: "session_start",
              data: { session_id: sessionId, cols: term.cols, rows: term.rows },
            }));
            // Start ping interval for latency measurement
            if (pingTimerRef.current) clearInterval(pingTimerRef.current);
            pingTimerRef.current = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                pingSentAtRef.current = performance.now();
                ws.send(JSON.stringify({ type: "ping" }));
              }
            }, 5000);
          } else if (msg.type === "pong") {
            const rtt = Math.round(performance.now() - pingSentAtRef.current);
            setLatency(rtt);
          } else if (msg.type === "stdout" && msg.data) {
            const { data_b64 } = msg.data as { session_id: string; data_b64: string };
            const bytes = Uint8Array.from(atob(data_b64), (c) => c.charCodeAt(0));
            term.write(bytes);
          } else if (msg.type === "session_end") {
            term.writeln("\r\n\x1b[31m● Session ended by remote\x1b[0m");
            intentionalCloseRef.current = true;
            setConnectionStatus("offline");
          } else if (msg.type === "error") {
            const { message } = (msg.data ?? {}) as { message?: string };
            term.writeln(`\r\n\x1b[31m✗ ${message ?? "Unknown error"}\x1b[0m`);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        // Will trigger onclose — reconnect logic lives there
      };

      ws.onclose = () => {
        if (intentionalCloseRef.current) {
          setConnectionStatus("offline");
          return;
        }
        // Auto-reconnect with exponential backoff
        const delay = reconnectDelayRef.current;
        const delaySec = Math.round(delay / 1000);
        term.writeln(`\r\n\x1b[33m⚠ Connection lost. Reconnecting in ${delaySec}s...\x1b[0m`);
        setConnectionStatus("connecting");

        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connectWebSocket(term, dev, sessionId);
        }, delay);

        // Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s max
        reconnectDelayRef.current = Math.min(delay * 2, 30000);
      };

      // Send stdin from xterm to relay
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          const b64 = btoa(data);
          ws.send(JSON.stringify({
            type: "stdin",
            data: { session_id: sessionId, data_b64: b64 },
          }));
        }
      });
    } catch {
      fallbackToStub(term, dev, sessionId);
    }
  };

  const fallbackToStub = (term: Terminal, dev: Tables<"devices"> | null, sessionId: string) => {
    term.writeln(`\x1b[33m⚠ Relay not available — running in stub mode\x1b[0m`);
    term.writeln(`\x1b[2mCommands will be echoed locally. Deploy a WebSocket relay to enable real terminal access.\x1b[0m`);
    term.writeln("");
    term.write(`\x1b[32m${dev?.name ?? "device"}\x1b[0m $ `);
    setConnectionStatus("online");

    let currentLine = "";

    term.onData((data) => {
      if (data === "\r" || data === "\n") {
        term.write("\r\n");
        if (currentLine.trim()) {
          term.writeln(`\x1b[2m[stub] "${currentLine.trim()}" → would be sent via relay as base64 stdin\x1b[0m`);
        }
        currentLine = "";
        term.write(`\x1b[32m${dev?.name ?? "device"}\x1b[0m $ `);
      } else if (data === "\x7f") {
        // Backspace
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1);
          term.write("\b \b");
        }
      } else if (data >= " " || data === "\t") {
        currentLine += data;
        term.write(data);
      }
    });
  };

  const handleReconnect = () => {
    cleanup();
    if (terminalContainerRef.current && deviceId && user) {
      window.location.reload();
    }
  };

  const handleDisconnect = async () => {
    await endSessionInDb();
    cleanup();
    navigate(-1);
  };

  const handleCopy = async () => {
    const sel = termRef.current?.getSelection();
    if (sel) {
      await navigator.clipboard.writeText(sel);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        const b64 = btoa(unescape(encodeURIComponent(text)));
        wsRef.current.send(JSON.stringify({
          type: "stdin",
          data: { session_id: sessionIdRef.current, data_b64: b64 },
        }));
      }
    } catch {
      // Clipboard access denied — iOS requires user gesture; the native paste listener handles that case
    }
  };

  const latencyColor = latency === null ? "text-muted-foreground" : latency < 100 ? "text-status-online" : latency < 300 ? "text-status-connecting" : "text-destructive";

  return (
    <div className="flex flex-col h-screen bg-terminal-bg">
      <div className="flex items-center justify-between px-2 sm:px-4 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => { handleDisconnect(); }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{device?.name ?? "Connecting..."}</p>
            <div className="flex items-center gap-2">
              <StatusBadge status={connectionStatus} />
              {connectionStatus === "online" && latency !== null && (
                <span className={`text-xs font-mono flex items-center gap-1 ${latencyColor}`}>
                  <Wifi className="h-3 w-3" /> {latency}ms
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <span className="text-xs font-mono text-muted-foreground hidden sm:inline">
            {sessionIdRef.current?.slice(0, 8) ?? ""}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopy} title="Copy selection">
            <Clipboard className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePaste} title="Paste from clipboard">
            <ClipboardPaste className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="gap-1 text-xs hidden sm:flex" onClick={handleReconnect}>
            <RotateCcw className="h-3 w-3" /> Reconnect
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden" onClick={handleReconnect} title="Reconnect">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="gap-1 text-xs text-destructive hover:text-destructive hidden sm:flex" onClick={handleDisconnect}>
            <X className="h-3 w-3" /> Disconnect
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden text-destructive hover:text-destructive" onClick={handleDisconnect} title="Disconnect">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div ref={terminalContainerRef} className="flex-1 p-1" />
    </div>
  );
}
