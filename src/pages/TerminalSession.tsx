import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, RotateCcw, X } from "lucide-react";
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [device, setDevice] = useState<Tables<"devices"> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "online" | "offline">("connecting");

  // Clean up terminal + websocket
  const cleanup = useCallback(() => {
    if (wsRef.current) {
      // Send session_end before closing
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

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 14,
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

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      // Send resize to relay if connected
      if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        wsRef.current.send(JSON.stringify({
          type: "resize",
          data: { session_id: sessionIdRef.current, cols: term.cols, rows: term.rows },
        }));
      }
    });
    resizeObserver.observe(terminalContainerRef.current);

    // Load device and start session
    const init = async () => {
      const { data: dev } = await supabase.from("devices").select("*").eq("id", deviceId).single();
      setDevice(dev);

      // Start session via edge function
      const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", {
        body: { device_id: deviceId },
      });

      if (sesErr || !sesData?.session_id) {
        term.writeln("\x1b[31m✗ Failed to create session\x1b[0m");
        setConnectionStatus("offline");
        return;
      }

      sessionIdRef.current = sesData.session_id;

      term.writeln(`\x1b[2m── Relay Terminal Cloud ──\x1b[0m`);
      term.writeln(`\x1b[2mDevice:\x1b[0m ${dev?.name ?? deviceId}`);
      term.writeln(`\x1b[2mSession:\x1b[0m ${sesData.session_id.slice(0, 8)}`);
      term.writeln("");

      // Try connecting to WebSocket relay
      connectWebSocket(term, dev, sesData.session_id);
    };

    init();

    return () => {
      resizeObserver.disconnect();
      endSessionInDb();
      cleanup();
    };
  }, [deviceId, user]);

  const connectWebSocket = async (term: Terminal, dev: Tables<"devices"> | null, sessionId: string) => {
    // Relay URL — set VITE_RELAY_URL in .env when you deploy the relay server
    const relayUrl = import.meta.env.VITE_RELAY_URL;

    if (!relayUrl) {
      term.writeln(`\x1b[33m⚠ No relay URL configured (set VITE_RELAY_URL)\x1b[0m`);
      fallbackToStub(term, dev, sessionId);
      return;
    }

    // Get JWT for relay auth
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const jwt = authSession?.access_token;
    if (!jwt) {
      term.writeln(`\x1b[31m✗ No auth session\x1b[0m`);
      setConnectionStatus("offline");
      return;
    }

    term.writeln(`\x1b[33m⟳ Connecting to relay...\x1b[0m`);
    setConnectionStatus("connecting");

    try {
      // Browser connects to /session endpoint
      const ws = new WebSocket(`${relayUrl}/session`);
      wsRef.current = ws;

      ws.onopen = () => {
        // Authenticate with relay using Supabase JWT
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
            // Now send session_start to trigger PTY on connector
            ws.send(JSON.stringify({
              type: "session_start",
              data: { session_id: sessionId, cols: term.cols, rows: term.rows },
            }));
          } else if (msg.type === "stdout" && msg.data) {
            const { data_b64 } = msg.data as { session_id: string; data_b64: string };
            const bytes = Uint8Array.from(atob(data_b64), (c) => c.charCodeAt(0));
            term.write(bytes);
          } else if (msg.type === "session_end") {
            term.writeln("\r\n\x1b[31m● Session ended by remote\x1b[0m");
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
        // Expected to fail until relay is deployed — show stub mode
        fallbackToStub(term, dev, sessionId);
      };

      ws.onclose = () => {
        if (connectionStatus !== "offline") {
          setConnectionStatus("offline");
        }
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
      // Re-mount by forcing a re-render — simplest approach
      window.location.reload();
    }
  };

  const handleDisconnect = async () => {
    await endSessionInDb();
    cleanup();
    navigate(-1);
  };

  return (
    <div className="flex flex-col h-screen bg-terminal-bg">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { handleDisconnect(); }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <p className="text-sm font-medium">{device?.name ?? "Connecting..."}</p>
            <StatusBadge status={connectionStatus} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">
            {sessionIdRef.current?.slice(0, 8) ?? ""}
          </span>
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={handleReconnect}>
            <RotateCcw className="h-3 w-3" /> Reconnect
          </Button>
          <Button variant="ghost" size="sm" className="gap-1 text-xs text-destructive hover:text-destructive" onClick={handleDisconnect}>
            <X className="h-3 w-3" /> Disconnect
          </Button>
        </div>
      </div>

      <div ref={terminalContainerRef} className="flex-1 p-1" />
    </div>
  );
}
