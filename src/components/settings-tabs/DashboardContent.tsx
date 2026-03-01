import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { Monitor, Wifi, Activity, Plus, Terminal, Plug, RefreshCw, Clock, Settings2, HeartPulse, Server, MemoryStick, Play } from "lucide-react";
import { LogViewerCard } from "@/components/LogViewerCard";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";
import { OnboardingTour } from "@/components/OnboardingTour";
import type { Tables } from "@/integrations/supabase/types";

interface RelayNode {
  device_id: string; name: string; kind: string;
  connected_at: string; last_heartbeat: string; online: boolean;
}
interface RelayHealth {
  status: "ok" | "unreachable"; uptime_seconds?: number; connectors?: number;
  sessions?: number; memory_mb?: number; version?: string; timestamp?: string; error?: string;
}

function timeSince(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
function formatUptime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export default function DashboardContent() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Tables<"projects">[]>([]);
  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [sessions, setSessions] = useState<Tables<"sessions">[]>([]);
  const [nodes, setNodes] = useState<RelayNode[]>([]);
  const [health, setHealth] = useState<RelayHealth | null>(null);
  const [skillConfigs, setSkillConfigs] = useState<any[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchNodes = useCallback(async () => {
    setNodesLoading(true);
    try {
      const [nodesRes, healthRes] = await Promise.allSettled([
        supabase.functions.invoke("relay-nodes"),
        supabase.functions.invoke("relay-health"),
      ]);
      if (nodesRes.status === "fulfilled" && !nodesRes.value.error && nodesRes.value.data?.nodes)
        setNodes(nodesRes.value.data.nodes);
      if (healthRes.status === "fulfilled" && !healthRes.value.error && healthRes.value.data)
        setHealth(healthRes.value.data as RelayHealth);
      else if (healthRes.status === "rejected" || (healthRes.status === "fulfilled" && healthRes.value.error))
        setHealth({ status: "unreachable", error: "Relay is starting up or unreachable" });
    } catch { setHealth({ status: "unreachable", error: "Failed to reach relay" }); }
    setNodesLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [p, d, s, sc] = await Promise.all([
        supabase.from("projects").select("*"),
        supabase.from("devices").select("*"),
        supabase.from("sessions").select("*").order("started_at", { ascending: false }).limit(10),
        supabase.from("skill_configs").select("*") as any,
      ]);
      setProjects(p.data ?? []); setDevices(d.data ?? []); setSessions(s.data ?? []); setSkillConfigs(sc.data ?? []);
      setLoading(false);
    };
    load(); fetchNodes();
    const interval = setInterval(fetchNodes, 30000);
    return () => clearInterval(interval);
  }, [user, fetchNodes]);

  useEffect(() => {
    const devChannel = supabase.channel("devices-dash-tab").on("postgres_changes", { event: "*", schema: "public", table: "devices" }, (payload) => {
      if (payload.eventType === "UPDATE") setDevices((prev) => prev.map((d) => d.id === (payload.new as Tables<"devices">).id ? payload.new as Tables<"devices"> : d));
    }).subscribe();
    const sesChannel = supabase.channel("sessions-dash-tab").on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => {
      supabase.from("sessions").select("*").order("started_at", { ascending: false }).limit(10).then(({ data }) => { if (data) setSessions(data); });
    }).subscribe();
    return () => { supabase.removeChannel(devChannel); supabase.removeChannel(sesChannel); };
  }, []);

  const onlineDevices = devices.filter((d) => d.status === "online");
  const activeSessions = sessions.filter((s) => s.status === "active");
  const onlineNodes = nodes.filter((n) => n.online);

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="space-y-6">
      <OnboardingTour />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card data-tour="stat-projects" className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate("/settings?tab=projects")}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Projects</CardTitle>
            <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{projects.length}</div></CardContent>
        </Card>
        <Card data-tour="stat-devices" className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate("/settings?tab=devices")}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Devices</CardTitle>
            <Monitor className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{devices.length}</div></CardContent>
        </Card>
        <Card data-tour="stat-online" className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate("/settings?tab=devices")}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Online</CardTitle>
            <Wifi className="h-4 w-4 text-status-online" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-status-online">{onlineDevices.length}</div></CardContent>
        </Card>
        <Card data-tour="stat-sessions" className="cursor-pointer hover:border-primary/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
            <Activity className="h-4 w-4 text-status-connecting" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{activeSessions.length}</div></CardContent>
        </Card>
      </div>

      {/* Relay Health */}
      <Card className={health?.status === "ok" ? "border-status-online/30" : health ? "border-status-offline/30" : ""}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div className="flex items-center gap-2">
            <HeartPulse className={`h-5 w-5 ${health?.status === "ok" ? "text-status-online" : "text-status-offline"}`} />
            <div>
              <CardTitle className="heading-4">Relay Server</CardTitle>
              <CardDescription>
                {health?.status === "ok" ? `v${health.version ?? "?"} · up ${formatUptime(health.uptime_seconds ?? 0)}` : health?.status === "unreachable" ? "Unable to reach relay server" : "Checking…"}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={health?.status === "ok" ? "online" : health ? "offline" : "connecting"} />
            <Button variant="ghost" size="icon" onClick={fetchNodes} disabled={nodesLoading} className="h-8 w-8">
              <RefreshCw className={`h-3.5 w-3.5 ${nodesLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        {health?.status === "ok" && (
          <CardContent>
            <TooltipProvider>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { icon: Server, label: "Connectors", value: health.connectors ?? 0, tip: "Active WebSocket connectors" },
                  { icon: Terminal, label: "Sessions", value: health.sessions ?? 0, tip: "Active browser terminal sessions" },
                  { icon: Clock, label: "Uptime", value: formatUptime(health.uptime_seconds ?? 0), tip: "Server uptime since last restart" },
                  { icon: MemoryStick, label: "Memory", value: `${health.memory_mb ?? "?"}MB`, tip: "Resident set size (RSS)" },
                ].map(({ icon: Icon, label, value, tip }) => (
                  <Tooltip key={label}>
                    <TooltipTrigger asChild>
                      <div className="rounded-2xl bg-[hsl(0,0%,11%)] border border-border/40 p-3 text-center hover:border-border/60 transition-colors">
                        <Icon className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
                        <p className="text-lg font-bold">{value}</p>
                        <p className="text-xs text-muted-foreground">{label}</p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{tip}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
            {health.timestamp && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                Last checked {timeSince(health.timestamp)} · auto-refreshes every 30s
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Terminal className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="heading-3">No projects yet</h3>
            <p className="body-sm text-muted-foreground mb-4">Create your first project to start connecting devices</p>
            <Button onClick={() => navigate("/settings?tab=projects")} className="gap-2">
              <Plus className="h-4 w-4" /> New Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="heading-4">Online Devices</CardTitle>
                <CardDescription className="body-sm">Devices ready for terminal sessions</CardDescription>
              </CardHeader>
              <CardContent>
                {onlineDevices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No devices currently online</p>
                ) : (
                  <div className="space-y-2">
                    {onlineDevices.slice(0, 5).map((device) => (
                      <div key={device.id} className="flex items-center justify-between rounded-2xl bg-[hsl(0,0%,11%)] border border-border/40 px-4 py-3 hover:border-border/70 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-[hsl(0,0%,17%)]">
                            <Monitor className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{device.name}</p>
                            <StatusBadge status="online" />
                          </div>
                        </div>
                        <button className="flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-[hsl(0,0%,22%)] hover:bg-[hsl(0,0%,28%)] text-foreground/80 hover:text-foreground text-xs font-medium transition-colors border border-border/40" onClick={() => navigate(`/terminal/${device.id}`)}>
                          <Terminal className="h-3 w-3" /> Connect
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="heading-4">Recent Sessions</CardTitle>
                <CardDescription className="body-sm">Latest terminal session activity</CardDescription>
              </CardHeader>
              <CardContent>
                {sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sessions yet</p>
                ) : (
                  <div className="space-y-2">
                    {sessions.slice(0, 5).map((session) => {
                      const device = devices.find((d) => d.id === session.device_id);
                      const duration = session.ended_at
                        ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000)
                        : Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000);
                      const durationStr = duration >= 3600 ? `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m` : duration >= 60 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : `${duration}s`;
                      return (
                        <div key={session.id} className="flex items-center justify-between rounded-2xl bg-[hsl(0,0%,11%)] border border-border/40 px-4 py-3 hover:border-border/70 transition-colors">
                          <div>
                            <p className="text-sm font-medium">{device?.name ?? session.id.slice(0, 8)}</p>
                            <p className="text-xs text-muted-foreground">{new Date(session.started_at).toLocaleString()} · {durationStr}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={session.status} />
                            {session.status === "active" && device && (
                              <button className="flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-[hsl(0,0%,22%)] hover:bg-[hsl(0,0%,28%)] text-foreground/80 hover:text-foreground text-xs font-medium transition-colors border border-border/40" onClick={() => navigate(`/terminal/${device.id}`)}>
                                <Terminal className="h-3 w-3" /> Rejoin
                              </button>
                            )}
                            {session.status === "ended" && (
                              <button className="flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-[hsl(0,0%,22%)] hover:bg-[hsl(0,0%,28%)] text-foreground/80 hover:text-foreground text-xs font-medium transition-colors border border-border/40" onClick={() => navigate(`/playback/${session.id}`)}>
                                <Play className="h-3 w-3" /> Replay
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Skill Configs */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="heading-4">Your Node Configurations</CardTitle>
                <CardDescription className="body-sm">Saved relay configs for your OpenClaw nodes ({skillConfigs.length})</CardDescription>
              </div>
              <button className="flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-[hsl(0,0%,22%)] hover:bg-[hsl(0,0%,28%)] text-foreground/80 hover:text-foreground text-xs font-medium transition-colors border border-border/40" onClick={() => navigate("/settings?tab=privaclaw")}>
                <Plus className="h-3.5 w-3.5" /> Add Node
              </button>
            </CardHeader>
            <CardContent>
              {skillConfigs.length === 0 ? (
                <div className="text-center py-6">
                  <Settings2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No node configurations yet</p>
                  <Button variant="link" size="sm" className="mt-1" onClick={() => navigate("/settings?tab=privaclaw")}>Configure your first node →</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {skillConfigs.map((sc: any) => {
                    const cfg = sc.config || {};
                    return (
                      <div key={sc.id} className="flex items-center justify-between rounded-2xl bg-[hsl(0,0%,11%)] border border-border/40 px-4 py-3 hover:border-border/70 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-[hsl(0,0%,17%)]">
                            <Settings2 className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{sc.name || cfg.nodeName || sc.skill_slug}</p>
                            <p className="text-xs text-muted-foreground">{cfg.relayUrl || "No URL set"} · {cfg.envTag || "dev"} · <span className="font-mono">{(sc.node_id || "").slice(0, 8)}…</span></p>
                          </div>
                        </div>
                        <button className="flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-[hsl(0,0%,22%)] hover:bg-[hsl(0,0%,28%)] text-foreground/80 hover:text-foreground text-xs font-medium transition-colors border border-border/40" onClick={() => navigate("/settings?tab=privaclaw")}>
                          <Settings2 className="h-3 w-3" /> Configure
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Connected Relay Nodes */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="heading-4">Connected Relay Nodes</CardTitle>
                <CardDescription className="body-sm">Live nodes connected to the relay server</CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={fetchNodes} disabled={nodesLoading}>
                <RefreshCw className={`h-4 w-4 ${nodesLoading ? "animate-spin" : ""}`} />
              </Button>
            </CardHeader>
            <CardContent>
              {nodes.length === 0 ? (
                <div className="text-center py-6">
                  <Plug className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No nodes connected to the relay</p>
                  <Button variant="link" size="sm" className="mt-1" onClick={() => navigate("/settings?tab=privaclaw")}>Configure PrivaClaw →</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {nodes.map((node) => (
                    <div key={node.device_id} className="flex items-center justify-between rounded-2xl bg-[hsl(0,0%,11%)] border border-border/40 px-4 py-3 hover:border-border/70 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-[hsl(0,0%,17%)]">
                          {node.kind === "openclaw" ? <Plug className="h-4 w-4 text-muted-foreground" /> : <Monitor className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{node.name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant={node.online ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">{node.online ? "online" : "offline"}</Badge>
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeSince(node.connected_at)}</span>
                          </div>
                        </div>
                      </div>
                      <span className="flex items-center h-7 px-3 rounded-full border border-border/50 text-xs text-muted-foreground bg-[hsl(0,0%,14%)]">{node.kind}</span>
                    </div>
                  ))}
                   <p className="text-xs text-muted-foreground text-center pt-1">{onlineNodes.length} online · {nodes.length} total · updates every 30s</p>
                </div>
              )}

        {/* Log Viewer */}
        <LogViewerCard />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
