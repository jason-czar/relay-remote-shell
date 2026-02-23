import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { ProjectViewSkeleton } from "@/components/LoadingSkeletons";
import { Plus, Monitor, Terminal, Copy, Users, ArrowLeft, Mail, UserMinus, Clock, Pencil, Trash2, RefreshCw, MoreVertical } from "lucide-react";
import { SetupWizard } from "@/components/SetupWizard";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useProjectRole } from "@/hooks/useProjectRole";
import type { Tables } from "@/integrations/supabase/types";

export default function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const { isOwner } = useProjectRole(projectId);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [project, setProject] = useState<Tables<"projects"> | null>(null);
  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [sessions, setSessions] = useState<Tables<"sessions">[]>([]);
  const [members, setMembers] = useState<Tables<"project_members">[]>([]);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [renameDeviceId, setRenameDeviceId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteDeviceId, setDeleteDeviceId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [sessionDeviceFilter, setSessionDeviceFilter] = useState("all");
  const [sessionStatusFilter, setSessionStatusFilter] = useState("all");
  const [showWizard, setShowWizard] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const filteredSessions = sessions.filter((s) => {
    if (sessionDeviceFilter !== "all" && s.device_id !== sessionDeviceFilter) return false;
    if (sessionStatusFilter !== "all" && s.status !== sessionStatusFilter) return false;
    return true;
  });

  const load = async () => {
    if (!projectId) return;
    const [p, d, s, m, inv] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase.from("devices").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("sessions").select("*").order("started_at", { ascending: false }).limit(20),
      supabase.from("project_members").select("*").eq("project_id", projectId),
      supabase.from("invitations").select("*").eq("project_id", projectId).eq("status", "pending").order("created_at", { ascending: false }),
    ]);
    setProject(p.data);
    setDevices(d.data ?? []);
    const deviceIds = new Set((d.data ?? []).map((dev) => dev.id));
    setSessions((s.data ?? []).filter((ses) => deviceIds.has(ses.device_id)));
    setMembers(m.data ?? []);
    setPendingInvites(inv.data ?? []);
    if (!initialLoaded) {
      setShowWizard((d.data ?? []).length === 0);
      setInitialLoaded(true);
    }
  };

  useEffect(() => {
    if (user && projectId) load();
  }, [user, projectId]);

  // Realtime for devices — update in-place without full reload
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`project-devices-${projectId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "devices", filter: `project_id=eq.${projectId}` }, (payload) => {
        setDevices((prev) => [payload.new as Tables<"devices">, ...prev]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "devices", filter: `project_id=eq.${projectId}` }, (payload) => {
        setDevices((prev) => prev.map((d) => d.id === (payload.new as Tables<"devices">).id ? (payload.new as Tables<"devices">) : d));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "devices", filter: `project_id=eq.${projectId}` }, (payload) => {
        setDevices((prev) => prev.filter((d) => d.id !== (payload.old as any).id));
      })
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

  const renameDevice = async (deviceId: string) => {
    if (!renameValue.trim()) return;
    const { error } = await supabase.from("devices").update({ name: renameValue.trim() }).eq("id", deviceId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Device renamed" });
      setRenameDeviceId(null);
      setRenameValue("");
      load();
    }
  };

  const deleteDevice = async (deviceId: string) => {
    const { error } = await supabase.from("devices").delete().eq("id", deviceId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Device deleted" });
    }
  };

  const regeneratePairingCode = async (deviceId: string) => {
    const newCode = generatePairingCode();
    const { error } = await supabase.from("devices").update({ pairing_code: newCode, paired: false, device_token: null }).eq("id", deviceId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Pairing code regenerated", description: `New code: ${newCode}` });
    }
  };

  const inviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !inviteEmail.trim()) return;
    setInviteLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-member`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ project_id: projectId, email: inviteEmail.trim() }),
        }
      );
      const result = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: result.error, variant: "destructive" });
      } else {
        toast({ title: result.status === "added" ? "Member added" : "Invitation sent", description: result.message });
        setInviteEmail("");
        setInviteOpen(false);
        load();
      }
    } catch {
      toast({ title: "Error", description: "Failed to send invitation", variant: "destructive" });
    }
    setInviteLoading(false);
  };

  const removeMember = async (memberId: string) => {
    const { error } = await supabase.from("project_members").delete().eq("id", memberId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Member removed" });
      load();
    }
  };

  const cancelInvite = async (inviteId: string) => {
    const { error } = await supabase.from("invitations").delete().eq("id", inviteId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Invitation cancelled" });
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
        <ProjectViewSkeleton />
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
            {isOwner && (
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
            )}

            {devices.length === 0 && showWizard ? (
              <SetupWizard
                projectId={projectId!}
                onComplete={() => { setShowWizard(false); load(); }}
                onSkip={() => setShowWizard(false)}
              />
            ) : devices.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center py-12">
                  <Monitor className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold">No devices</h3>
                  <p className="text-sm text-muted-foreground mb-4">Add a device to start connecting</p>
                  {isOwner && (
                    <Button variant="outline" onClick={() => setShowWizard(true)} className="gap-2">
                      <Monitor className="h-4 w-4" /> Start Setup Wizard
                    </Button>
                  )}
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
                      <div className="flex items-center gap-2">
                        {device.status === "online" && (
                          <Button size="sm" className="gap-1" onClick={() => navigate(`/terminal/${device.id}`)}>
                            <Terminal className="h-3 w-3" /> Connect
                          </Button>
                        )}
                        {isOwner && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setRenameDeviceId(device.id); setRenameValue(device.name); }}>
                                <Pencil className="h-4 w-4 mr-2" /> Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => regeneratePairingCode(device.id)}>
                                <RefreshCw className="h-4 w-4 mr-2" /> Regenerate Pairing Code
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteDeviceId(device.id)}>
                                <Trash2 className="h-4 w-4 mr-2" /> Delete Device
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="sessions" className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={sessionDeviceFilter}
                onChange={(e) => setSessionDeviceFilter(e.target.value)}
              >
                <option value="all">All devices</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={sessionStatusFilter}
                onChange={(e) => setSessionStatusFilter(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="ended">Ended</option>
              </select>
            </div>

            {filteredSessions.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center py-12">
                  <Terminal className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold">No sessions</h3>
                  <p className="text-sm text-muted-foreground">Terminal sessions will appear here</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredSessions.map((s) => {
                  const dev = devices.find((d) => d.id === s.device_id);
                  const duration = s.ended_at
                    ? Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000)
                    : Math.round((Date.now() - new Date(s.started_at).getTime()) / 1000);
                  const durationStr = duration >= 3600
                    ? `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`
                    : duration >= 60
                      ? `${Math.floor(duration / 60)}m ${duration % 60}s`
                      : `${duration}s`;
                  return (
                    <Card key={s.id}>
                      <CardContent className="flex items-center justify-between p-4">
                        <div>
                          <p className="text-sm font-medium">{dev?.name ?? s.device_id.slice(0, 8)}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(s.started_at).toLocaleString()} · {durationStr}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={s.status} />
                          {s.status === "active" && dev && (
                            <Button size="sm" variant="outline" className="gap-1 h-7" onClick={() => navigate(`/terminal/${dev.id}?session=${s.id}`)}>
                              <Terminal className="h-3 w-3" /> Rejoin
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="team" className="space-y-4">
            {isOwner && (
              <div className="flex justify-end">
                <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2"><Mail className="h-4 w-4" /> Invite Member</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>
                    <form onSubmit={inviteMember} className="space-y-4">
                      <Input type="email" placeholder="Email address" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
                      <p className="text-xs text-muted-foreground">If the user already has an account, they'll be added immediately. Otherwise, they'll be added when they sign up.</p>
                      <Button type="submit" className="w-full" disabled={inviteLoading}>
                        {inviteLoading ? "Sending..." : "Send Invitation"}
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            )}

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
                          <Badge variant={m.role === "owner" ? "default" : "secondary"} className="text-xs capitalize mt-0.5">
                            {m.role}
                          </Badge>
                        </div>
                      </div>
                      {isOwner && m.role !== "owner" && m.user_id !== user?.id && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                              <UserMinus className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove member?</AlertDialogTitle>
                              <AlertDialogDescription>This will revoke their access to this project.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => removeMember(m.id)}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {pendingInvites.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pending Invitations</CardTitle>
                  <CardDescription>{pendingInvites.length} pending</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {pendingInvites.map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between rounded-lg border border-dashed border-border p-3">
                        <div className="flex items-center gap-3">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{inv.email}</p>
                            <p className="text-xs text-muted-foreground">
                              Invited {new Date(inv.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        {isOwner && (
                          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => cancelInvite(inv.id)}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Rename Device Dialog */}
        <Dialog open={renameDeviceId !== null} onOpenChange={(open) => { if (!open) setRenameDeviceId(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Rename Device</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); if (renameDeviceId) renameDevice(renameDeviceId); }} className="space-y-4">
              <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="Device name" required />
              <Button type="submit" className="w-full">Save</Button>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Device Confirmation */}
        <AlertDialog open={deleteDeviceId !== null} onOpenChange={(open) => { if (!open) setDeleteDeviceId(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete device?</AlertDialogTitle>
              <AlertDialogDescription>This will permanently remove this device and all its session history. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { if (deleteDeviceId) { deleteDevice(deleteDeviceId); setDeleteDeviceId(null); } }}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
