import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { X, Terminal, Wifi, WifiOff, Plus, Copy, Check, Loader2, Info, AlertCircle, Trash2, Power } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

type Platform = "unix" | "windows";

interface DevicePanelProps {
  open: boolean;
  onClose: () => void;
  devices: Tables<"devices">[];
  selectedDeviceId: string | null;
  onSelectDevice: (id: string) => void;
  userId: string;
  projectId?: string;
  onDeviceAdded: (device: Tables<"devices">) => void;
  onDeviceDeleted: (id: string) => void;
}

function AddDeviceFlow({ userId, projectId, onDone }: { userId: string; projectId?: string; onDone: (d: Tables<"devices">) => void }) {
  const [deviceName, setDeviceName] = useState("");
  const [creating, setCreating] = useState(false);
  const [device, setDevice] = useState<Tables<"devices"> | null>(null);
  const [platform, setPlatform] = useState<Platform>("unix");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);

  const doCreate = useCallback(async (name: string) => {
    setCreating(true);
    setCreateError(null);
    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const insertPayload: any = projectId
      ? { project_id: projectId, name, pairing_code: pairingCode }
      : { user_id: userId, name, pairing_code: pairingCode };
    const { data, error } = await supabase.from("devices").insert(insertPayload).select().single();
    if (error) setCreateError(error.message);
    else if (data) setDevice(data as Tables<"devices">);
    setCreating(false);
  }, [userId, projectId]);

  useEffect(() => {
    if (!device) return;
    const channel = supabase
      .channel(`dp-device-${device.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "devices", filter: `id=eq.${device.id}` }, (payload) => {
        const updated = payload.new as Tables<"devices">;
        setDevice(updated);
        if (updated.paired && updated.status === "online") {
          setOnline(true);
          onDone(updated);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [device, onDone]);

  const unixCommands = device?.pairing_code ? [
    { label: "1. Install the connector", cmd: `curl -fsSL "${API_URL}/download-connector?install=1" | bash` },
    { label: "2. Pair this device", cmd: `cd ~/relay-connector && ./relay-connector --pair "${device.pairing_code}" --api "${API_URL}" --name "${device.name}"` },
    { label: "3. Start in background", cmd: `cd ~/relay-connector && nohup ./relay-connector connect > relay.log 2>&1 &` },
  ] : [];

  const windowsCommands = device?.pairing_code ? [
    { label: "1. Install the connector", cmd: `$InstallScript = (Invoke-WebRequest "${API_URL}/download-connector?install=ps" -UseBasicParsing).Content; Invoke-Expression $InstallScript` },
    { label: "2. Pair this device", cmd: `cd "$env:USERPROFILE\\\\relay-connector"; .\\\\relay-connector.exe --pair "${device.pairing_code}" --api "${API_URL}" --name "${device.name}"` },
    { label: "3. Start in background", cmd: `Start-Process -FilePath "$env:USERPROFILE\\\\relay-connector\\\\relay-connector.exe" -ArgumentList "connect" -WindowStyle Hidden` },
  ] : [];

  const commands = platform === "unix" ? unixCommands : windowsCommands;

  const copyCmd = (cmd: string, idx: number) => {
    navigator.clipboard.writeText(cmd);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  if (online) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary font-medium">
        <Wifi className="h-4 w-4 shrink-0" />
        Device connected!
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {createError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {createError}
        </div>
      )}

      {!device && !creating && (
        <form onSubmit={(e) => { e.preventDefault(); doCreate(deviceName.trim() || "My Device"); }} className="flex gap-2">
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="Device name"
            maxLength={64}
            className="flex-1 rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </form>
      )}

      {creating && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating commands…
        </div>
      )}

      {device && !creating && (
        <>
          {/* Platform toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border/40 self-start">
            {(["unix", "windows"] as Platform[]).map((p) => (
              <button
                key={p}
                onClick={() => { setPlatform(p); setCopiedIdx(null); }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150",
                  platform === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {p === "unix" ? <><span className="text-[11px]">🍎</span> macOS / Linux</> : <><span className="text-[11px]">🪟</span> Windows</>}
              </button>
            ))}
          </div>

          {/* Commands */}
          <div className="flex flex-col gap-2">
            {commands.map(({ label, cmd }, i) => (
              <div key={i} className="space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
                <div className="relative rounded-lg border border-border/50 bg-muted/40 overflow-hidden">
                  <pre className="px-3 py-2.5 pr-9 text-[11px] font-mono text-foreground/90 overflow-x-auto whitespace-pre [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <code>{cmd}</code>
                  </pre>
                  <button
                    onClick={() => copyCmd(cmd, i)}
                    className="absolute top-2 right-2 p-1.5 rounded-md hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy"
                  >
                    {copiedIdx === i ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* macOS hint */}
          {platform === "unix" && (
            <div className="flex items-start gap-2 rounded-lg bg-muted/30 border border-border/30 px-3 py-2">
              <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong className="text-foreground/70">macOS:</strong> if blocked by Gatekeeper, run{" "}
                <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">
                  xattr -d com.apple.quarantine ~/relay-connector/relay-connector
                </code>
              </p>
            </div>
          )}

          {/* Waiting for pairing */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border/50 bg-muted/20 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Pairing code:</span>
              <code className="font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded text-[11px]">
                {device.pairing_code}
              </code>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Waiting…
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function DevicePanel({ open, onClose, devices, selectedDeviceId, onSelectDevice, userId, projectId, onDeviceAdded, onDeviceDeleted }: DevicePanelProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  // Reset state when panel closes
  useEffect(() => {
    if (!open) { setShowAdd(false); setConfirmDeleteId(null); }
  }, [open]);

  const handleDeviceAdded = useCallback((d: Tables<"devices">) => {
    onDeviceAdded(d);
    onSelectDevice(d.id);
    onClose();
  }, [onDeviceAdded, onSelectDevice, onClose]);

  const handleDisconnect = useCallback(async (id: string) => {
    setDisconnectingId(id);
    // End all active sessions for this device, then mark offline
    await supabase.from("sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("device_id", id).eq("status", "active");
    await supabase.from("devices").update({ status: "offline" }).eq("id", id);
    setDisconnectingId(null);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    await supabase.from("devices").delete().eq("id", id);
    setDeletingId(null);
    setConfirmDeleteId(null);
    onDeviceDeleted(id);
  }, [onDeviceDeleted]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full z-50 w-80 max-w-[92vw] flex flex-col bg-background border-l border-border/60 shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm text-foreground">Devices</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">

          {/* Device list */}
          {devices.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide px-1 mb-1">Connected devices</p>
              {devices.map((d) => (
                <div key={d.id} className="flex flex-col">
                  <div
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                      selectedDeviceId === d.id
                        ? "bg-primary/8 text-foreground border border-primary/20"
                        : "hover:bg-muted/60 text-foreground/80 border border-transparent"
                    )}
                  >
                    {/* Status dot + name — clickable to select */}
                    <button
                      onClick={() => { onSelectDevice(d.id); onClose(); }}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <span className={cn(
                        "w-2 h-2 rounded-full shrink-0 transition-colors",
                        d.status === "online" ? "bg-status-online animate-pulse" : "bg-muted-foreground/30"
                      )} />
                      <span className="flex-1 truncate font-medium">{d.name}</span>
                      <span className={cn(
                        "text-[11px] font-medium shrink-0",
                        d.status === "online" ? "text-status-online" : "text-muted-foreground/50"
                      )}>
                        {d.status === "online" ? "online" : "offline"}
                      </span>
                    </button>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Disconnect — only meaningful when online */}
                      {d.status === "online" && (
                        <button
                          onClick={() => handleDisconnect(d.id)}
                          disabled={disconnectingId === d.id}
                          title="Disconnect device"
                          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                        >
                          {disconnectingId === d.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Power className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {/* Delete */}
                      {confirmDeleteId === d.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(d.id)}
                            disabled={deletingId === d.id}
                            className="px-2 py-0.5 rounded text-[11px] font-medium bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors disabled:opacity-50"
                          >
                            {deletingId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(d.id)}
                          title="Delete device"
                          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Divider */}
          {devices.length > 0 && <div className="border-t border-border/30" />}

          {/* Add device toggle */}
          {!showAdd ? (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-border/60 text-sm text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30 transition-all duration-150 w-full"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span>Connect a new device</span>
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide px-1">New device</p>
                <button
                  onClick={() => setShowAdd(false)}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
              <AddDeviceFlow userId={userId} projectId={projectId} onDone={handleDeviceAdded} />
            </div>
          )}

          {/* Empty state */}
          {devices.length === 0 && !showAdd && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <WifiOff className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No devices connected yet</p>
              <p className="text-xs text-muted-foreground/60">Click "Connect a new device" to get started</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
