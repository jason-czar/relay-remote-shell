import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, RotateCcw, X } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

export default function TerminalSession() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const terminalRef = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<Tables<"devices"> | null>(null);
  const [session, setSession] = useState<Tables<"sessions"> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!deviceId || !user) return;
    const loadDevice = async () => {
      const { data } = await supabase.from("devices").select("*").eq("id", deviceId).single();
      setDevice(data);

      // Create session
      const { data: ses } = await supabase.from("sessions").insert({
        device_id: deviceId,
        user_id: user.id,
      }).select().single();
      setSession(ses);

      // Simulate connection
      setTimeout(() => {
        setConnectionStatus("online");
        setTerminalLines([
          `\x1b[32m✓\x1b[0m Connected to ${data?.name ?? "device"}`,
          `Session ID: ${ses?.id?.slice(0, 8)}`,
          `Type commands below. WebSocket relay not yet connected.`,
          "",
          `${data?.name ?? "device"} $`,
        ]);
      }, 1500);
    };
    loadDevice();

    return () => {
      // End session on unmount
      if (session?.id) {
        supabase.from("sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", session.id);
      }
    };
  }, [deviceId, user]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [terminalLines]);

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    const cmd = inputValue.trim();
    setTerminalLines((prev) => [
      ...prev,
      `$ ${cmd}`,
      `[relay stub] Command "${cmd}" would be sent via WebSocket to connector`,
      "",
      `${device?.name ?? "device"} $`,
    ]);
    setInputValue("");
  };

  const handleDisconnect = async () => {
    if (session?.id) {
      await supabase.from("sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", session.id);
    }
    navigate(-1);
  };

  return (
    <div className="flex flex-col h-screen bg-terminal-bg">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <p className="text-sm font-medium">{device?.name ?? "Connecting..."}</p>
            <StatusBadge status={connectionStatus} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => { setConnectionStatus("connecting"); setTimeout(() => setConnectionStatus("online"), 1000); }}>
            <RotateCcw className="h-3 w-3" /> Reconnect
          </Button>
          <Button variant="ghost" size="sm" className="gap-1 text-xs text-destructive hover:text-destructive" onClick={handleDisconnect}>
            <X className="h-3 w-3" /> Disconnect
          </Button>
        </div>
      </div>

      {/* Terminal body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-4 font-mono text-sm text-terminal-fg cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {connectionStatus === "connecting" ? (
          <div className="flex items-center gap-2 text-status-connecting">
            <span className="animate-pulse-glow">●</span> Connecting to {device?.name ?? "device"}...
          </div>
        ) : (
          <>
            {terminalLines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap leading-6">
                {line}
              </div>
            ))}
            <form onSubmit={handleCommand} className="flex items-center">
              <span className="text-primary mr-1">$</span>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="flex-1 bg-transparent outline-none text-terminal-fg caret-terminal-cursor"
                autoFocus
              />
            </form>
          </>
        )}
      </div>
    </div>
  );
}
