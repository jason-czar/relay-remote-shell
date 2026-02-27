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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [online, setOnline] = useState(false);
  const [platform, setPlatform] = useState<Platform>("unix");

  const handleDeviceOnline = useCallback(
    (dev: Tables<"devices">) => onDeviceOnline(dev),
    [onDeviceOnline]
  );

  const doCreate = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertPayload: any = projectId
      ? { project_id: projectId, name: "My Device", pairing_code: pairingCode }
      : { user_id: userId, name: "My Device", pairing_code: pairingCode };
    const { data, error } = await supabase.from("devices").insert(insertPayload).select().single();
    if (error) {
      setCreateError(error.message);
    } else if (data) {
      setDevice(data as Tables<"devices">);
    }
    setCreating(false);
  }, [userId, projectId]);

  const createDevice = useCallback(() => {
    if (!userId || creating) return;
    doCreate();
  }, [userId, creating, doCreate]);

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

  const unixCommand = device?.pairing_code
    ? `set -e
RELAY_DIR="$HOME/relay-connector"
API_URL="${API_URL}"
PAIR_CODE="${device.pairing_code}"
NAME="${device.name}"

rm -rf "$RELAY_DIR"
curl -fsSL "$API_URL/download-connector?install=1" | bash

cd "$RELAY_DIR"
# macOS only — clear Gatekeeper quarantine if needed:
# xattr -d com.apple.quarantine ./relay-connector
./relay-connector --pair "$PAIR_CODE" --api "$API_URL" --name "$NAME"

echo "Starting connector in background..."
(
  cd "$RELAY_DIR"
  nohup ./relay-connector connect >/dev/null 2>&1 &
)
echo "Connector running."`
    : "";

  const windowsCommand = device?.pairing_code
    ? `$RelayDir = "$env:USERPROFILE\\relay-connector"
$ApiUrl   = "${API_URL}"
$PairCode = "${device.pairing_code}"
$Name     = "${device.name}"

if (Test-Path $RelayDir) { Remove-Item -Recurse -Force $RelayDir }

$InstallScript = (Invoke-WebRequest "$ApiUrl/download-connector?install=ps" -UseBasicParsing).Content
Invoke-Expression $InstallScript

Set-Location $RelayDir
.\\relay-connector.exe --pair $PairCode --api $ApiUrl --name $Name

Write-Host "Starting connector in background..."
Start-Process -FilePath ".\\relay-connector.exe" -ArgumentList "connect" -WindowStyle Hidden
Write-Host "Connector running."`
    : "";

  const command = platform === "unix" ? unixCommand : windowsCommand;

  const copy = () => {
    if (!command) return;
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const retry = () => {
    setCreateError(null);
    setDevice(null);
    doCreate();
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
          <p className="text-sm text-muted-foreground">Run this one command in your terminal to get started</p>
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
              onClick={() => { setPlatform(p); setCopied(false); }}
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

      {/* Command box or Generate button */}
      {!createError && (
        !device && !creating ? (
          <button
            onClick={createDevice}
            className="flex items-center justify-center gap-2 w-full rounded-xl border border-border/50 bg-muted/40 px-4 py-5 text-sm font-medium text-foreground hover:bg-muted/70 transition-colors"
          >
            <Terminal className="h-4 w-4 text-primary" />
            Generate install command
          </button>
        ) : (
          <div className="relative rounded-xl border border-border/50 bg-muted/40 overflow-hidden">
            {creating ? (
              <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating install command…
              </div>
            ) : (
              <>
                <pre className="px-4 py-4 pr-12 text-xs font-mono text-foreground/90 overflow-x-auto whitespace-pre leading-relaxed [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <code>{command}</code>
                </pre>
                <button
                  onClick={copy}
                  className="absolute top-2 right-2 p-2 rounded-lg hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy command"
                >
                  {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                </button>
              </>
            )}
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
