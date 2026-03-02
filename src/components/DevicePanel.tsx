import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { X, Terminal, Wifi, WifiOff, Plus, Copy, Check, Loader2, Info, AlertCircle, Trash2, Power, RefreshCw, PackageX, Activity, ArrowUpCircle, ShieldOff } from "lucide-react";
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

function AddDeviceFlow({ userId, projectId, onCreated, onDone }: { userId: string; projectId?: string; onCreated: (d: Tables<"devices">) => void; onDone: (d: Tables<"devices">) => void }) {
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
    else if (data) { setDevice(data as Tables<"devices">); onCreated(data as Tables<"devices">); }
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
    { label: "3. Start in background", cmd: `cd ~/relay-connector && nohup ./relay-connector connect >> relay.log 2>&1 &` },
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

const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 360;

const STORAGE_KEY = "device-panel-width";

// ── StatusOutputBlock ─────────────────────────────────────────────────────────
function StatusOutputBlock({ raw, loading }: { raw: string; loading: boolean }) {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const getValue = (key: string) => {
    const line = lines.find(l => l.startsWith(key + ":"));
    return line ? line.slice(key.length + 1).trim() : undefined;
  };
  const installed = getValue("installed");
  const running = getValue("running");
  return (
    <div className="flex flex-col gap-1.5">
      {(installed !== undefined || running !== undefined) && (
        <div className="flex items-center gap-2 flex-wrap">
          {installed !== undefined && (
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium",
              installed === "true" ? "bg-status-online/15 text-status-online" : "bg-muted text-muted-foreground"
            )}>
              <span className={cn("w-1.5 h-1.5 rounded-full", installed === "true" ? "bg-status-online" : "bg-muted-foreground/40")} />
              {installed === "true" ? "Installed" : "Not installed"}
            </span>
          )}
          {running !== undefined && (
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium",
              running === "true" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            )}>
              <span className={cn("w-1.5 h-1.5 rounded-full", running === "true" ? "bg-primary" : "bg-muted-foreground/40")} />
              {running === "true" ? "Running" : "Stopped"}
            </span>
          )}
        </div>
      )}
      <pre className={cn(
        "text-[10px] font-mono bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all [scrollbar-width:thin] transition-opacity",
        loading ? "opacity-50" : "opacity-100"
      )}>{raw}</pre>
    </div>
  );
}

export function DevicePanel({ open, onClose, devices, selectedDeviceId, onSelectDevice, userId, projectId, onDeviceAdded, onDeviceDeleted }: DevicePanelProps) {
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (!isNaN(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
    return DEFAULT_WIDTH;
  });
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_WIDTH);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    // Only on desktop
    if (window.innerWidth < 768) return;
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = panelWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX.current - ev.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      setPanelWidth(next);
    };
    const onUp = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Persist final width
      const delta = startX.current - ev.clientX;
      const final = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      localStorage.setItem(STORAGE_KEY, String(final));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelWidth]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [expandedOfflineId, setExpandedOfflineId] = useState<string | null>(null);
  const [reinstallDeviceId, setReinstallDeviceId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [copiedReinstallId, setCopiedReinstallId] = useState<string | null>(null);
  const [offlineCopiedId, setOfflineCopiedId] = useState<string | null>(null);
  const [confirmUninstallId, setConfirmUninstallId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [uninstallLog, setUninstallLog] = useState<string | null>(null);

  // Status check state: deviceId → { loading, output }
  const [statusCheckId, setStatusCheckId] = useState<string | null>(null);
  const [statusCheckLoading, setStatusCheckLoading] = useState(false);
  const [statusOutput, setStatusOutput] = useState<string | null>(null);

  // Update agent state
  const [updateAgentId, setUpdateAgentId] = useState<string | null>(null);
  const [updateAgentLog, setUpdateAgentLog] = useState<string>("");
  const [updateAgentDone, setUpdateAgentDone] = useState(false);
  const updateLogRef = useRef<HTMLPreElement>(null);
  // Agent trust reset — tracks which devices have a stored trust key
  const [trustedDeviceIds, setTrustedDeviceIds] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("agent-trust-")) s.add(k.replace("agent-trust-", ""));
    }
    return s;
  });
  const [trustResetId, setTrustResetId] = useState<string | null>(null);
  useEffect(() => {
    if (updateLogRef.current) {
      updateLogRef.current.scrollTop = updateLogRef.current.scrollHeight;
    }
  }, [updateAgentLog]);

  // Version check state per device: null = unchecked, "checking" | "up-to-date" | "available" | "error"
  type VersionCheckStatus = "checking" | "up-to-date" | "available" | "error";
  const [versionChecks, setVersionChecks] = useState<Record<string, VersionCheckStatus>>({});


  const getOneLiner = useCallback((d: Tables<"devices">) => {
    if (!d.pairing_code) return "";
    return `curl -fsSL "${API_URL}/download-connector?install=full" | bash -s -- "${d.pairing_code}"`;
  }, []);

  const getWinOneLiner = useCallback((d: Tables<"devices">) => {
    if (!d.pairing_code) return "";
    return `$s=(Invoke-WebRequest "${API_URL}/download-connector?install=ps-full" -UseBasicParsing).Content; Invoke-Expression "$s ${d.pairing_code}"`;
  }, []);

  const isWindows = navigator.platform.startsWith("Win");
  const [reinstallPlatform, setReinstallPlatform] = useState<Record<string, "unix" | "windows">>({});
  const [offlinePlatform, setOfflinePlatform] = useState<Record<string, "unix" | "windows">>({});

  const copyOneLiner = useCallback((cmd: string, id: string, type: "reinstall" | "offline") => {
    navigator.clipboard.writeText(cmd);
    if (type === "reinstall") {
      setCopiedReinstallId(id);
      setTimeout(() => setCopiedReinstallId(null), 2000);
    } else {
      setOfflineCopiedId(id);
      setTimeout(() => setOfflineCopiedId(null), 2000);
    }
  }, []);

  // Reset state when panel closes
  useEffect(() => {
    if (!open) { setShowAdd(false); setConfirmDeleteId(null); setExpandedOfflineId(null); }
  }, [open]);

  const handleDeviceAdded = useCallback((d: Tables<"devices">) => {
    onDeviceAdded(d);
    onSelectDevice(d.id);
    setShowAdd(false);
  }, [onDeviceAdded, onSelectDevice]);

  const handleRename = useCallback(async (id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) { setRenamingId(null); return; }
    await supabase.from("devices").update({ name: trimmed }).eq("id", id);
    setRenamingId(null);
  }, []);

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

  // ── Shared relay command helper ───────────────────────────────────────────
  // Starts a session for deviceId, sends `command` via stdin, streams stdout
  // into onOutput until `isDone(line)` returns true or timeout fires.
  const sendRelayCommand = useCallback(async (
    deviceId: string,
    command: string,
    onOutput: (chunk: string) => void,
    isDone: (accumulated: string) => boolean,
    timeoutMs = 20000,
  ): Promise<void> => {
    const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", {
      body: { device_id: deviceId },
    });
    if (sesErr || !sesData?.session_id) throw new Error(sesErr?.message ?? "Could not start session");
    const sessionId: string = sesData.session_id;

    const relayUrl = (import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com")
      .replace("https://", "wss://").replace("http://", "ws://");
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const jwt = authSession?.access_token;
    const wsUrl = `${relayUrl}/connect${jwt ? `?token=${jwt}` : ""}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let settled = false;
      let accumulated = "";
      let commandSent = false;

      const finish = (err?: string) => {
        if (settled) return;
        settled = true;
        ws.close();
        if (err) reject(new Error(err)); else resolve();
      };

      const timeout = setTimeout(() => finish("Timed out waiting for device response"), timeoutMs);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "hello", data: { session_id: sessionId } }));
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (!commandSent && (msg.type === "authenticated" || msg.type === "session_ready" || msg.type === "scrollback")) {
            commandSent = true;
            ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(command) } }));
          }
          if (msg.type === "stdout") {
            const chunk = atob(msg.data?.data_b64 ?? "");
            accumulated += chunk;
            onOutput(chunk);
            if (isDone(accumulated)) {
              clearTimeout(timeout);
              setTimeout(() => finish(), 400);
            }
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onerror = () => finish("WebSocket error");
      ws.onclose = () => { clearTimeout(timeout); if (!settled) finish(); };
    });
  }, []);

  // ── Uninstall via relay ───────────────────────────────────────────────────
  const handleUninstall = useCallback(async (deviceId: string) => {
    setUninstallingId(deviceId);
    setUninstallLog("Connecting to device…");
    try {
      await sendRelayCommand(
        deviceId,
        "./relay-connector --uninstall-agent\n",
        (chunk) => setUninstallLog((prev) => (prev ?? "") + chunk),
        (acc) => acc.includes("uninstalled") || acc.includes("✅"),
      );
    } catch (err: any) {
      setUninstallLog(`Warning: ${err.message}. Removing device from list anyway.`);
      await new Promise(r => setTimeout(r, 1500));
    }
    await supabase.from("devices").delete().eq("id", deviceId);
    setUninstallingId(null);
    setUninstallLog(null);
    setConfirmUninstallId(null);
    onDeviceDeleted(deviceId);
  }, [sendRelayCommand, onDeviceDeleted]);

  // ── Status check via relay ────────────────────────────────────────────────
  const handleStatusCheck = useCallback(async (deviceId: string) => {
    setStatusCheckId(deviceId);
    setStatusCheckLoading(true);
    setStatusOutput("Connecting to device…");
    try {
      let output = "";
      await sendRelayCommand(
        deviceId,
        "./relay-connector --status\n",
        (chunk) => {
          output += chunk;
          setStatusOutput(output);
        },
        (acc) => acc.includes("installed:") && acc.includes("\n"),
        15000,
      );
      setStatusOutput(output.trim() || "(no output)");
    } catch (err: any) {
      setStatusOutput(`Error: ${err.message}`);
    }
    setStatusCheckLoading(false);
  }, [sendRelayCommand]);

  // ── Update agent via relay ────────────────────────────────────────────────
  const handleUpdateAgent = useCallback(async (deviceId: string) => {
    setUpdateAgentId(deviceId);
    setUpdateAgentLog("Connecting to device…\n");
    setUpdateAgentDone(false);
    try {
      const cmd = `./relay-connector --update --api ${API_URL}\n`;
      await sendRelayCommand(
        deviceId,
        cmd,
        (chunk) => setUpdateAgentLog((prev) => prev + chunk),
        (acc) => acc.includes("✅") && acc.includes("install-agent"),
        60000, // allow up to 60s for download + reinstall
      );
      setUpdateAgentDone(true);
      // After a successful update, mark version as up-to-date
      setVersionChecks((prev) => ({ ...prev, [deviceId]: "up-to-date" }));
    } catch (err: any) {
      setUpdateAgentLog((prev) => prev + `\nError: ${err.message}`);
      setUpdateAgentDone(true);
    }
  }, [sendRelayCommand]);

  // ── Self-update-check via relay ───────────────────────────────────────────
  const handleVersionCheck = useCallback(async (deviceId: string) => {
    setVersionChecks((prev) => ({ ...prev, [deviceId]: "checking" }));
    try {
      let output = "";
      await sendRelayCommand(
        deviceId,
        `./relay-connector --self-update-check --api ${API_URL}\n`,
        (chunk) => { output += chunk; },
        (acc) => acc.includes("update-available:"),
        20000,
      );
      const match = output.match(/update-available:\s*(true|false|unknown)/i);
      if (!match) {
        setVersionChecks((prev) => ({ ...prev, [deviceId]: "error" }));
      } else if (match[1] === "false") {
        setVersionChecks((prev) => ({ ...prev, [deviceId]: "up-to-date" }));
      } else {
        setVersionChecks((prev) => ({ ...prev, [deviceId]: "available" }));
      }
    } catch {
      setVersionChecks((prev) => ({ ...prev, [deviceId]: "error" }));
    }
  }, [sendRelayCommand]);

  // ── Auto-trigger version check when a device comes online ─────────────────
  const prevStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const prev = prevStatusRef.current;
    devices.forEach((d) => {
      if (d.status === "online" && prev[d.id] !== "online" && !versionChecks[d.id]) {
        handleVersionCheck(d.id);
      }
    });
    const next: Record<string, string> = {};
    devices.forEach((d) => { next[d.id] = d.status; });
    prevStatusRef.current = next;
  }, [devices]); // eslint-disable-line react-hooks/exhaustive-deps


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
        onClick={(e) => e.stopPropagation()}
        style={{ width: window.innerWidth >= 768 ? panelWidth : undefined }}
        className={cn(
          "fixed top-0 right-0 h-full z-50 max-w-[92vw] flex flex-col bg-background border-l border-border/60 shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "md:max-w-none",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Resize handle — desktop only */}
        <div
          onMouseDown={onResizeStart}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize hidden md:block hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
          title="Drag to resize"
        />
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
                    {/* Status dot + name — click to select/expand actions; double-click name to rename */}
                    <button
                      onClick={() => {
                        if (d.status === "online") {
                          onSelectDevice(selectedDeviceId === d.id ? "" : d.id);
                        } else {
                          setExpandedOfflineId((prev) => prev === d.id ? null : d.id);
                        }
                      }}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <span className={cn(
                        "w-2 h-2 rounded-full shrink-0 transition-colors",
                        d.status === "online" ? "bg-status-online animate-pulse" : "bg-muted-foreground/30"
                      )} />
                      {renamingId === d.id ? (
                        <input
                          autoFocus
                          className="flex-1 min-w-0 bg-transparent border-b border-primary outline-none text-sm font-medium"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => handleRename(d.id, renameValue)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(d.id, renameValue);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="flex-1 truncate font-medium cursor-text hover:text-primary transition-colors"
                          onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(d.id); setRenameValue(d.name); }}
                          title="Double-click to rename"
                        >{d.name}</span>
                      )}
                      <span className={cn(
                        "text-[11px] font-medium shrink-0",
                        d.status === "online" ? "text-status-online" : "text-muted-foreground/50"
                      )}>
                        {d.status === "online" ? "online" : "offline"}
                      </span>
                    </button>

                    {/* Delete icon — stays inline top-right */}
                    <div className="flex items-center gap-1 shrink-0">
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
                          onClick={() => { setConfirmDeleteId(d.id); setConfirmUninstallId(null); }}
                          title="Delete device"
                          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Action button rows ── */}
                  {selectedDeviceId === d.id && (
                    <div className="flex flex-col gap-1 px-3 pb-2.5 pt-0.5">
                      {/* Online-only actions */}
                      {d.status === "online" && (
                        <>
                          {/* Open Terminal */}
                          <button
                            onClick={() => navigate(`/terminal/${d.id}`)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 border border-primary/20 transition-colors"
                          >
                            <Terminal className="h-3.5 w-3.5 shrink-0" />
                            Open Terminal
                          </button>

                          {/* Disconnect */}
                          <button
                            onClick={() => handleDisconnect(d.id)}
                            disabled={disconnectingId === d.id}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-foreground/80 bg-muted/40 hover:bg-muted/70 border border-border/40 transition-colors disabled:opacity-40"
                          >
                            {disconnectingId === d.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                              : <Power className="h-3.5 w-3.5 shrink-0" />}
                            Disconnect
                          </button>

                          {/* Check service status */}
                          <button
                            onClick={() => {
                              if (statusCheckId === d.id) { setStatusCheckId(null); setStatusOutput(null); }
                              else { handleStatusCheck(d.id); }
                            }}
                            disabled={statusCheckLoading && statusCheckId === d.id}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40",
                              statusCheckId === d.id
                                ? "bg-primary/10 text-primary border-primary/20"
                                : "text-foreground/80 bg-muted/40 hover:bg-muted/70 border-border/40"
                            )}
                          >
                            {statusCheckLoading && statusCheckId === d.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                              : <Activity className="h-3.5 w-3.5 shrink-0" />}
                            Check Service Status
                          </button>

                          {/* Update agent */}
                          <button
                            onClick={() => {
                              if (updateAgentId === d.id) { setUpdateAgentId(null); setUpdateAgentLog(""); setUpdateAgentDone(false); }
                              else { handleUpdateAgent(d.id); }
                            }}
                            disabled={updateAgentId === d.id && !updateAgentDone}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors disabled:opacity-60",
                              updateAgentId === d.id
                                ? "bg-primary/10 text-primary border-primary/20"
                                : versionChecks[d.id] === "available"
                                  ? "bg-warning/10 text-warning border-warning/20 hover:bg-warning/20"
                                  : "text-foreground/80 bg-muted/40 hover:bg-muted/70 border-border/40"
                            )}
                          >
                            {updateAgentId === d.id && !updateAgentDone
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                              : <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />}
                            Update Agent
                            {(() => {
                              const vs = versionChecks[d.id];
                              if (!vs) return (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleVersionCheck(d.id); }}
                                  className="ml-auto text-[10px] text-muted-foreground hover:text-primary transition-colors"
                                >Check version</button>
                              );
                              if (vs === "checking") return <Loader2 className="ml-auto h-2.5 w-2.5 animate-spin text-muted-foreground" />;
                              if (vs === "up-to-date") return <span className="ml-auto text-[10px] text-status-online">✓ Up to date</span>;
                              if (vs === "available") return <span className="ml-auto text-[10px] text-warning animate-pulse">↑ Update ready</span>;
                              return <button onClick={(e) => { e.stopPropagation(); handleVersionCheck(d.id); }} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">Retry</button>;
                            })()}
                          </button>
                        </>
                      )}

                      {/* Reinstall / Update connector — any device with pairing code */}
                      {d.pairing_code && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setReinstallDeviceId((prev) => prev === d.id ? null : d.id); setExpandedOfflineId(null); }}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                            reinstallDeviceId === d.id
                              ? "bg-primary/10 text-primary border-primary/20"
                              : "text-foreground/80 bg-muted/40 hover:bg-muted/70 border-border/40"
                          )}
                        >
                          <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                          Reinstall / Update Connector
                        </button>
                      )}

                      {/* Uninstall agent */}
                      <button
                        onClick={() => { setConfirmUninstallId((prev) => prev === d.id ? null : d.id); setConfirmDeleteId(null); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                          confirmUninstallId === d.id
                            ? "bg-warning/10 text-warning border-warning/20"
                            : "text-foreground/80 bg-muted/40 hover:bg-muted/70 border-border/40"
                        )}
                      >
                        <PackageX className="h-3.5 w-3.5 shrink-0" />
                        Uninstall Agent
                      </button>

                      {/* Reset agent trust */}
                      {trustedDeviceIds.has(d.id) && (
                        <button
                          onClick={() => {
                            localStorage.removeItem(`agent-trust-${d.id}`);
                            setTrustedDeviceIds(prev => { const n = new Set(prev); n.delete(d.id); return n; });
                            setTrustResetId(d.id);
                            setTimeout(() => setTrustResetId(null), 2000);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors text-foreground/80 bg-muted/40 hover:bg-muted/70 border-border/40"
                        >
                          {trustResetId === d.id
                            ? <Check className="h-3.5 w-3.5 shrink-0 text-status-online" />
                            : <ShieldOff className="h-3.5 w-3.5 shrink-0" />}
                          {trustResetId === d.id ? "Trust cleared" : "Reset Agent Trust"}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Uninstall agent confirm / progress panel */}
                  {confirmUninstallId === d.id && (
                    <div className="mt-1 mb-1 px-1 pb-1">
                      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 flex flex-col gap-2">
                        {uninstallingId === d.id ? (
                          <>
                            <div className="flex items-center gap-2 text-xs text-warning font-medium">
                              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                              Uninstalling…
                            </div>
                            {uninstallLog && (
                              <pre className="text-[10px] font-mono text-foreground/70 bg-muted/40 rounded p-2 overflow-x-auto max-h-24 whitespace-pre-wrap break-all [scrollbar-width:thin]">
                                {uninstallLog}
                              </pre>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5">
                              <PackageX className="h-3 w-3 text-warning shrink-0" />
                              <p className="text-[11px] font-semibold text-foreground/80">Uninstall agent</p>
                            </div>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">
                              This will run <code className="font-mono bg-muted px-1 rounded">--uninstall-agent</code> on the device to remove the background service, then delete the device from your list.
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleUninstall(d.id)}
                                className="px-2.5 py-1 rounded text-[11px] font-medium bg-warning text-warning-foreground hover:bg-warning/90 transition-colors"
                              >
                                Uninstall &amp; Remove
                              </button>
                              <button
                                onClick={() => setConfirmUninstallId(null)}
                                className="px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Service status panel */}
                  {statusCheckId === d.id && (
                    <div className="mt-1 mb-1 px-1 pb-1">
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Activity className="h-3 w-3 text-primary shrink-0" />
                            <p className="text-[11px] font-semibold text-foreground/80">Service Status</p>
                          </div>
                          <button
                            onClick={() => { handleStatusCheck(d.id); }}
                            disabled={statusCheckLoading && statusCheckId === d.id}
                            title="Refresh"
                            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                          >
                            <RefreshCw className={cn("h-3 w-3", statusCheckLoading && statusCheckId === d.id && "animate-spin")} />
                          </button>
                        </div>
                        {statusOutput && (
                          <StatusOutputBlock raw={statusOutput} loading={statusCheckLoading && statusCheckId === d.id} />
                        )}
                      </div>
                    </div>
                  )}
                  {/* Update Agent progress panel */}
                  {updateAgentId === d.id && (
                    <div className="mt-1 mb-1 px-1 pb-1">
                      <div className={cn(
                        "rounded-lg border p-3 flex flex-col gap-2 transition-colors",
                        updateAgentDone
                          ? "border-status-online/30 bg-status-online/5"
                          : "border-primary/20 bg-primary/5"
                      )}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {updateAgentDone
                              ? <Check className="h-3 w-3 text-status-online shrink-0" />
                              : <Loader2 className="h-3 w-3 text-primary animate-spin shrink-0" />}
                            <p className="text-[11px] font-semibold text-foreground/80">
                              {updateAgentDone ? "Update complete" : "Updating agent…"}
                            </p>
                          </div>
                          {updateAgentDone && (
                            <button
                              onClick={() => { setUpdateAgentId(null); setUpdateAgentLog(""); setUpdateAgentDone(false); }}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              title="Dismiss"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <pre ref={updateLogRef} className="text-[10px] font-mono text-foreground/70 bg-muted/40 rounded p-2 overflow-y-auto max-h-36 whitespace-pre-wrap break-all [scrollbar-width:thin]">
                          {updateAgentLog || "…"}
                        </pre>
                        {!updateAgentDone && (
                          <p className="text-[10px] text-muted-foreground">
                            Downloading latest binary and re-registering service on the device…
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Reinstall / Update panel */}
                  {reinstallDeviceId === d.id && d.pairing_code && (
                    <div className="mt-1 mb-1 px-1 pb-1">
                      <div className="rounded-lg border border-border/50 bg-muted/30 p-3 flex flex-col gap-2">
                        <div className="flex items-center gap-1.5">
                          <RefreshCw className="h-3 w-3 text-muted-foreground shrink-0" />
                          <p className="text-[11px] font-semibold text-foreground/80">Reinstall / Update connector</p>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Run this on your machine. It will download the latest binary, re-pair if needed, and restart the background service.
                        </p>
                        {/* Platform tabs */}
                        <div className="flex gap-1 mb-1">
                          {(["unix", "windows"] as const).map(p => (
                            <button
                              key={p}
                              onClick={() => setReinstallPlatform(prev => ({ ...prev, [d.id]: p }))}
                              className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                                (reinstallPlatform[d.id] ?? (isWindows ? "windows" : "unix")) === p
                                  ? "bg-primary/15 text-primary"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
                              )}
                            >
                              {p === "unix" ? "macOS / Linux" : "Windows"}
                            </button>
                          ))}
                        </div>
                        <div className="relative rounded-lg bg-muted/60 border border-border/40 overflow-hidden">
                          <pre className="px-2.5 py-2.5 pr-8 text-[10px] font-mono text-foreground/90 overflow-x-auto whitespace-pre-wrap break-all [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            <code>{(reinstallPlatform[d.id] ?? (isWindows ? "windows" : "unix")) === "unix" ? getOneLiner(d) : getWinOneLiner(d)}</code>
                          </pre>
                          <button
                            onClick={(e) => { e.stopPropagation(); copyOneLiner((reinstallPlatform[d.id] ?? (isWindows ? "windows" : "unix")) === "unix" ? getOneLiner(d) : getWinOneLiner(d), d.id, "reinstall"); }}
                            className="absolute top-2 right-2 p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy"
                          >
                            {copiedReinstallId === d.id
                              ? <Check className="h-3 w-3 text-primary" />
                              : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Offline expand — reconnect via one-liner */}
                  {d.status === "offline" && expandedOfflineId === d.id && (
                    <div className="mt-1 mb-1 flex flex-col gap-2 px-1 pb-1">
                      {d.pairing_code ? (
                        <>
                          <p className="text-[11px] text-muted-foreground leading-relaxed px-0.5">
                            Run this on your machine to reinstall and reconnect:
                          </p>
                          {/* Platform tabs */}
                          <div className="flex gap-1 mb-1">
                            {(["unix", "windows"] as const).map(p => (
                              <button
                                key={p}
                                onClick={(e) => { e.stopPropagation(); setOfflinePlatform(prev => ({ ...prev, [d.id]: p })); }}
                                className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                                  (offlinePlatform[d.id] ?? (isWindows ? "windows" : "unix")) === p
                                    ? "bg-primary/15 text-primary"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                )}
                              >
                                {p === "unix" ? "macOS / Linux" : "Windows"}
                              </button>
                            ))}
                          </div>
                          <div className="relative rounded-lg bg-muted/40 border border-border/40 overflow-hidden">
                            <pre className="px-2.5 py-2.5 pr-8 text-[10px] font-mono text-foreground/90 overflow-x-auto whitespace-pre-wrap break-all [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                              <code>{(offlinePlatform[d.id] ?? (isWindows ? "windows" : "unix")) === "unix" ? getOneLiner(d) : getWinOneLiner(d)}</code>
                            </pre>
                            <button
                              onClick={(e) => { e.stopPropagation(); copyOneLiner((offlinePlatform[d.id] ?? (isWindows ? "windows" : "unix")) === "unix" ? getOneLiner(d) : getWinOneLiner(d), d.id, "offline"); }}
                              className="absolute top-2 right-2 p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
                              title="Copy"
                            >
                              {offlineCopiedId === d.id
                                ? <Check className="h-3 w-3 text-primary" />
                                : <Copy className="h-3 w-3" />}
                            </button>
                          </div>
                          <div className="flex items-start gap-1.5 px-0.5">
                            <Info className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                            <p className="text-[10px] text-muted-foreground leading-relaxed">
                              <strong className="text-foreground/60">macOS:</strong> if blocked by Gatekeeper, first run{" "}
                              <code className="font-mono bg-muted px-1 rounded">xattr -d com.apple.quarantine ~/relay-connector/relay-connector</code>
                            </p>
                          </div>
                        </>
                      ) : (
                        <p className="text-[11px] text-muted-foreground/70 px-0.5 leading-relaxed">
                          No pairing code stored. Delete this device and add it again to get a fresh install command.
                        </p>
                      )}
                    </div>
                  )}
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
              <AddDeviceFlow
                userId={userId}
                projectId={projectId}
                onCreated={(d) => onDeviceAdded(d)}
                onDone={handleDeviceAdded}
              />
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
