import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Copy, Check, Terminal, Loader2, Wifi, AlertCircle, Info } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

type Platform = "unix" | "windows";

interface QuickStartProps {
  userId: string;
  projectId?: string;
  onDeviceOnline: (device: Tables<"devices">) => void;
}

export function QuickStart({ userId, projectId, onDeviceOnline }: QuickStartProps) {
  const [device, setDevice] = useState<Tables<"devices"> | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  
  const [online, setOnline] = useState(false);
  const [platform, setPlatform] = useState<Platform>("unix");

  const handleDeviceOnline = useCallback(
    (dev: Tables<"devices">) => onDeviceOnline(dev),
    [onDeviceOnline]
  );

  const doCreate = useCallback(async (name: string) => {
    setCreating(true);
    setCreateError(null);
    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertPayload: any = projectId
      ? { project_id: projectId, name, pairing_code: pairingCode }
      : { user_id: userId, name, pairing_code: pairingCode };
    const { data, error } = await supabase.from("devices").insert(insertPayload).select().single();
    if (error) {
      setCreateError(error.message);
    } else if (data) {
      setDevice(data as Tables<"devices">);
    }
    setCreating(false);
  }, [userId, projectId]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const name = deviceName.trim() || "My Device";
    if (!userId || creating) return;
    doCreate(name);
  }, [userId, creating, deviceName, doCreate]);

  // Watch for device to come online via realtime
  useEffect(() => {
    if (!device) return;
    const channel = supabase
      .channel(`qs-device-${device.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "devices",
        filter: `id=eq.${device.id}`,
      }, (payload) => {
        const updated = payload.new as Tables<"devices">;
        setDevice(updated);
        if (updated.paired && updated.status === "online") {
          setOnline(true);
          handleDeviceOnline(updated);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [device, handleDeviceOnline]);

  const unixCommands = device?.pairing_code
    ? [
        { label: "1. Install the connector", cmd: `curl -fsSL "${API_URL}/download-connector?install=1" | bash` },
        { label: "2. Pair this device", cmd: `cd ~/relay-connector && ./relay-connector --pair "${device.pairing_code}" --api "${API_URL}" --name "${device.name}"` },
        { label: "3. Start in background", cmd: `cd ~/relay-connector && nohup ./relay-connector connect >/dev/null 2>&1 &` },
      ]
    : [];

  const windowsCommands = device?.pairing_code
    ? [
        { label: "1. Install the connector", cmd: `$InstallScript = (Invoke-WebRequest "${API_URL}/download-connector?install=ps" -UseBasicParsing).Content; Invoke-Expression $InstallScript` },
        { label: "2. Pair this device", cmd: `cd "$env:USERPROFILE\\relay-connector"; .\\relay-connector.exe --pair "${device.pairing_code}" --api "${API_URL}" --name "${device.name}"` },
        { label: "3. Start in background", cmd: `Start-Process -FilePath "$env:USERPROFILE\\relay-connector\\relay-connector.exe" -ArgumentList "connect" -WindowStyle Hidden` },
      ]
    : [];

  const commands = platform === "unix" ? unixCommands : windowsCommands;

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copyCmd = (cmd: string, idx: number) => {
    navigator.clipboard.writeText(cmd);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const retry = () => {
    setCreateError(null);
    setDevice(null);
    doCreate(deviceName.trim() || "My Device");
  };

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col gap-5 text-left animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Terminal className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-semibold text-base text-foreground">Connect your first device</h2>
          <p className="text-sm text-muted-foreground">Run these commands in your terminal to get started</p>
        </div>
      </div>

      {/* Error state */}
      {createError && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-destructive font-medium">Failed to create device</p>
            <p className="text-xs text-muted-foreground mt-0.5 break-words">{createError}</p>
          </div>
          <button
            onClick={retry}
            className="text-xs text-primary underline underline-offset-2 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Platform toggle — only show once device is created */}
      {!createError && device && (
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border/40 self-start">
          {(["unix", "windows"] as Platform[]).map((p) => (
            <button
              key={p}
              onClick={() => { setPlatform(p); setCopiedIdx(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                platform === p
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p === "unix" ? (
                <><span className="text-[11px]">🍎</span> macOS / Linux</>
              ) : (
                <><span className="text-[11px]">🪟</span> Windows</>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Name input + Generate button, or 3 command boxes */}
      {!createError && (
        !device && !creating ? (
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Device name (e.g. Home Server)"
              maxLength={64}
              className="flex-1 rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
            >
              <Terminal className="h-3.5 w-3.5" />
              Generate
            </button>
          </form>
        ) : creating ? (
          <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground rounded-xl border border-border/50 bg-muted/40">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating install commands…
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {commands.map(({ label, cmd }, i) => (
              <div key={i} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <div className="relative rounded-xl border border-border/50 bg-muted/40 overflow-hidden">
                  <pre className="px-4 py-3 pr-12 text-xs font-mono text-foreground/90 overflow-x-auto whitespace-pre [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <code>{cmd}</code>
                  </pre>
                  <button
                    onClick={() => copyCmd(cmd, i)}
                    className="absolute top-2 right-2 p-2 rounded-lg hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy command"
                  >
                    {copiedIdx === i ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* macOS hint */}
      {!createError && platform === "unix" && device && !online && (
        <div className="flex items-start gap-2 rounded-lg bg-muted/30 border border-border/30 px-3 py-2.5">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground/70">macOS only:</strong> if the connector is blocked by Gatekeeper, run{" "}
            <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">
              xattr -d com.apple.quarantine ~/relay-connector/relay-connector
            </code>{" "}
            then re-run the last two lines.
          </p>
        </div>
      )}

      {/* Pairing code + waiting status */}
      {device && !online && !createError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border/50 bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Pairing code:</span>
            <code className="font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
              {device.pairing_code}
            </code>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting for connection…
          </div>
        </div>
      )}

      {/* Connected */}
      {online && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary font-medium">
          <Wifi className="h-4 w-4 shrink-0" />
          Device connected! You can now start chatting.
        </div>
      )}
    </div>
  );
}
