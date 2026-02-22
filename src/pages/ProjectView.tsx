import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Monitor, Terminal, Copy, Users, ArrowLeft } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

export default function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [project, setProject] = useState<Tables<"projects"> | null>(null);
  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [sessions, setSessions] = useState<Tables<"sessions">[]>([]);
  const [members, setMembers] = useState<Tables<"project_members">[]>([]);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = async () => {
    if (!projectId) return;
    const [p, d, s, m] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("devices").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("sessions").select("*").order("started_at", { ascending: false }).limit(20),
      supabase.from("project_members").select("*").eq("project_id", projectId),
    ]);
    setProject(p.data);
    setDevices(d.data ?? []);
    // Filter sessions to ones belonging to this project's devices
    const deviceIds = new Set((d.data ?? []).map((dev) => dev.id));
    setSessions((s.data ?? []).filter((ses) => deviceIds.has(ses.device_id)));
    setMembers(m.data ?? []);
  };

  useEffect(() => {
    if (user && projectId) load();
  }, [user, projectId]);

  // Realtime for devices
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`project-devices-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "devices", filter: `project_id=eq.${projectId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  const generatePairingCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const addDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !newDeviceName.trim()) return;
    const pairingCode = generatePairingCode();
    const { error } = await supabase.from("devices").insert({
      project_id: projectId,
      name: newDeviceName.trim(),
      pairing_code: pairingCode,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Device added", description: `Pairing code: ${pairingCode}` });
      setNewDeviceName("");
      setAddDeviceOpen(false);
      load();
    }
  };

  const copyPairingCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: "Copied", description: "Pairing code copied to clipboard" });
  };

  if (!project) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/projects")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            <p className="text-muted-foreground text-sm">Project overview</p>
          </div>
        </div>

        <Tabs defaultValue="devices">
          <TabsList>
            <TabsTrigger value="devices" className="gap-1">
              <Monitor className="h-3 w-3" /> Devices
            </TabsTrigger>
            <TabsTrigger value="sessions" className="gap-1">
              <Terminal className="h-3 w-3" /> Sessions
            </TabsTrigger>
            <TabsTrigger value="team" className="gap-1">
              <Users className="h-3 w-3" /> Team
            </TabsTrigger>
          </TabsList>

          <TabsContent value="devices" className="space-y-4">
            <div className="flex justify-end">
              <Dialog open={addDeviceOpen} onOpenChange={setAddDeviceOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2"><Plus className="h-4 w-4" /> Add Device</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Device</DialogTitle></DialogHeader>
                  <form onSubmit={addDevice} className="space-y-4">
                    <Input placeholder="Device name (e.g. Home Server)" value={newDeviceName} onChange={(e) => setNewDeviceName(e.target.value)} required />
                    <Button type="submit" className="w-full">Add Device</Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            {devices.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center py-12">
                  <Monitor className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold">No devices</h3>
                  <p className="text-sm text-muted-foreground">Add a device to start connecting</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {devices.map((device) => (
                  <Card key={device.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-4">
                        <Monitor className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{device.name}</p>
                          <div className="flex items-center gap-3 mt-1">
                            <StatusBadge status={device.status} />
                            {device.pairing_code && !device.paired && (
                              <button onClick={() => copyPairingCode(device.pairing_code!)} className="inline-flex items-center gap-1 text-xs font-mono bg-muted px-2 py-0.5 rounded hover:bg-accent transition-colors">
                                <Copy className="h-3 w-3" /> {device.pairing_code}
                              </button>
                            )}
                            {device.paired && <span className="text-xs text-primary">Paired</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {device.status === "online" && (
                          <Button size="sm" className="gap-1" onClick={() => navigate(`/terminal/${device.id}`)}>
                            <Terminal className="h-3 w-3" /> Connect
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="sessions" className="space-y-4">
            {sessions.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center py-12">
                  <Terminal className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold">No sessions</h3>
                  <p className="text-sm text-muted-foreground">Terminal sessions will appear here</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {sessions.map((s) => (
                  <Card key={s.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <p className="text-sm font-mono">{s.id.slice(0, 8)}</p>
                        <p className="text-xs text-muted-foreground">{new Date(s.started_at).toLocaleString()}</p>
                      </div>
                      <StatusBadge status={s.status} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="team" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Team Members</CardTitle>
                <CardDescription>{members.length} member{members.length !== 1 ? "s" : ""}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div className="flex items-center gap-3">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium font-mono">{m.user_id.slice(0, 8)}...</p>
                          <p className="text-xs text-muted-foreground capitalize">{m.role}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
