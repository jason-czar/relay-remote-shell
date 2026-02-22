import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { Monitor, Wifi, Activity, Plus, Terminal, ArrowRight } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Tables<"projects">[]>([]);
  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [sessions, setSessions] = useState<Tables<"sessions">[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [p, d, s] = await Promise.all([
        supabase.from("projects").select("*"),
        supabase.from("devices").select("*"),
        supabase.from("sessions").select("*").order("started_at", { ascending: false }).limit(10),
      ]);
      setProjects(p.data ?? []);
      setDevices(d.data ?? []);
      setSessions(s.data ?? []);
      setLoading(false);
    };
    load();
  }, [user]);

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

  return (
    <AppLayout>
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
        )}
      </div>
    </AppLayout>
  );
}

function FolderIcon() {
  return (
    <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}
