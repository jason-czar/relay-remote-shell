import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Copy, Check, Terminal, Loader2, Wifi } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

interface QuickStartProps {
  projectId: string;
  onDeviceOnline: (device: Tables<"devices">) => void;
}

export function QuickStart({ projectId, onDeviceOnline }: QuickStartProps) {
  const [device, setDevice] = useState<Tables<"devices"> | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [online, setOnline] = useState(false);

  // Auto-create a device on mount
  useEffect(() => {
    if (!projectId) return;
    setCreating(true);
    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    supabase
      .from("devices")
      .insert({ project_id: projectId, name: "My Device", pairing_code: pairingCode })
      .select()
      .single()
      .then(({ data }) => {
        if (data) setDevice(data as Tables<"devices">);
        setCreating(false);
      });
  }, [projectId]);

  // Watch for device to come online
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
          onDeviceOnline(updated);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [device, onDeviceOnline]);

  const command = device?.pairing_code
    ? `set -e\nRELAY_DIR="$HOME/relay-connector"\nAPI_URL="${API_URL}"\nPAIR_CODE="${device.pairing_code}"\nNAME="${device.name}"\n\nrm -rf "$RELAY_DIR"\ncurl -fsSL "$API_URL/download-connector?install=1" | bash\n\ncd "$RELAY_DIR"\n./relay-connector --pair "$PAIR_CODE" --api "$API_URL" --name "$NAME"\n\necho "Starting connector in background..."\n(\n  cd "$RELAY_DIR"\n  nohup ./relay-connector connect >/dev/null 2>&1 &\n)\necho "Connector running."`
    : "";

  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

      {/* Command box */}
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

      {/* Pairing code + status */}
      {device && !online && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border/50 bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Pairing code:</span>
            <code className="font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
              {device.pairing_code}
            </code>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting…
          </div>
        </div>
      )}

      {online && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary font-medium">
          <Wifi className="h-4 w-4 shrink-0" />
          Device connected! You can now start chatting.
        </div>
      )}
    </div>
  );
}
