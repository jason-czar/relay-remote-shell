import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { Monitor, Wifi, Activity, Plus, Terminal, ArrowRight, Plug, RefreshCw, Clock, Settings2 } from "lucide-react";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";
import type { Tables } from "@/integrations/supabase/types";

interface RelayNode {
  device_id: string;
  name: string;
  kind: string;
  connected_at: string;
  last_heartbeat: string;
  online: boolean;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Tables<"projects">[]>([]);
  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [sessions, setSessions] = useState<Tables<"sessions">[]>([]);
  const [nodes, setNodes] = useState<RelayNode[]>([]);
  const [skillConfigs, setSkillConfigs] = useState<any[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchNodes = useCallback(async () => {
    setNodesLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("relay-nodes");
      if (!error && data?.nodes) {
        setNodes(data.nodes);
      }
    } catch {
      // Silently fail — relay may be down
    }
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
      setProjects(p.data ?? []);
      setDevices(d.data ?? []);
      setSessions(s.data ?? []);
      setSkillConfigs(sc.data ?? []);
      setLoading(false);
    };
    load();
    fetchNodes();
    // Poll nodes every 30s
    const interval = setInterval(fetchNodes, 30000);
    return () => clearInterval(interval);
  }, [user, fetchNodes]);

  // Realtime subscriptions
  useEffect(() => {
    const devChannel = supabase
      .channel("devices-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "devices" }, (payload) => {
        if (payload.eventType === "UPDATE") {
          setDevices((prev) => prev.map((d) => (d.id === (payload.new as Tables<"devices">).id ? payload.new as Tables<"devices"> : d)));
        }
      })
      .subscribe();

    const sesChannel = supabase
      .channel("sessions-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, () => {
        supabase.from("sessions").select("*").order("started_at", { ascending: false }).limit(10).then(({ data }) => {
          if (data) setSessions(data);
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(devChannel);
      supabase.removeChannel(sesChannel);
    };
  }, []);

  const onlineDevices = devices.filter((d) => d.status === "online");
  const activeSessions = sessions.filter((s) => s.status === "active");
  const onlineNodes = nodes.filter((n) => n.online);

  return (
    <AppLayout>
      {loading ? (
        <DashboardSkeleton />
      ) : (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your relay infrastructure</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Projects</CardTitle>
              <FolderIcon />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{projects.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Devices</CardTitle>
              <Monitor className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{devices.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Online</CardTitle>
              <Wifi className="h-4 w-4 text-status-online" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-status-online">{onlineDevices.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
              <Activity className="h-4 w-4 text-status-connecting" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{activeSessions.length}</div>
            </CardContent>
          </Card>
        </div>

        {projects.length === 0 && !loading ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Terminal className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">No projects yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Create your first project to start connecting devices</p>
              <Button onClick={() => navigate("/projects")} className="gap-2">
                <Plus className="h-4 w-4" /> New Project
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Online Devices</CardTitle>
                <CardDescription>Devices ready for terminal sessions</CardDescription>
              </CardHeader>
              <CardContent>
                {onlineDevices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No devices currently online</p>
                ) : (
                  <div className="space-y-3">
                    {onlineDevices.slice(0, 5).map((device) => (
                      <div key={device.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div className="flex items-center gap-3">
                          <Monitor className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{device.name}</p>
                            <StatusBadge status="online" />
                          </div>
                        </div>
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate(`/terminal/${device.id}`)}>
                          <Terminal className="h-3 w-3" /> Connect
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Sessions</CardTitle>
                <CardDescription>Latest terminal session activity</CardDescription>
              </CardHeader>
              <CardContent>
                {sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sessions yet</p>
                ) : (
                  <div className="space-y-3">
                    {sessions.slice(0, 5).map((session) => {
                      const device = devices.find((d) => d.id === session.device_id);
                      const duration = session.ended_at
                        ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000)
                        : Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000);
                      const durationStr = duration >= 3600
                        ? `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`
                        : duration >= 60
                          ? `${Math.floor(duration / 60)}m ${duration % 60}s`
                          : `${duration}s`;
                      return (
                        <div key={session.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                          <div>
                            <p className="text-sm font-medium">{device?.name ?? session.id.slice(0, 8)}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(session.started_at).toLocaleString()} · {durationStr}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={session.status} />
                            {session.status === "active" && device && (
                              <Button size="sm" variant="ghost" className="gap-1 h-7" onClick={() => navigate(`/terminal/${device.id}`)}>
                                <Terminal className="h-3 w-3" /> Rejoin
                              </Button>
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

          {/* Saved Skill Configs */}
          {skillConfigs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your Skill Configurations</CardTitle>
                <CardDescription>Saved relay configurations for your OpenClaw nodes</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {skillConfigs.map((sc: any) => {
                    const cfg = sc.config || {};
                    return (
                      <div key={sc.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div className="flex items-center gap-3">
                          <Settings2 className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{cfg.nodeName || sc.skill_slug}</p>
                            <p className="text-xs text-muted-foreground">
                              {cfg.relayUrl || "No URL set"} · {cfg.envTag || "dev"}
                            </p>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate("/skill/remote-relay")}>
                          <Settings2 className="h-3 w-3" /> Configure
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Connected Relay Nodes */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Connected Relay Nodes</CardTitle>
                <CardDescription>Live nodes connected to the relay server</CardDescription>
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
                  <Button variant="link" size="sm" className="mt-1" onClick={() => navigate("/skill/remote-relay")}>
                    Configure Remote Relay →
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {nodes.map((node) => {
                    const connectedAgo = timeSince(node.connected_at);
                    const heartbeatAgo = timeSince(node.last_heartbeat);
                    return (
                      <div key={node.device_id} className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div className="flex items-center gap-3">
                          {node.kind === "openclaw" ? (
                            <Plug className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Monitor className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <p className="text-sm font-medium">{node.name}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant={node.online ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                                {node.online ? "online" : "offline"}
                              </Badge>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {connectedAgo}
                              </span>
                              {node.kind !== "connector" && (
                                <span>· heartbeat {heartbeatAgo}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {node.kind}
                        </Badge>
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    {onlineNodes.length} online · {nodes.length} total · updates every 30s
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          </>
        )}
      </div>
      )}
    </AppLayout>
  );
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

function FolderIcon() {
  return (
    <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}
