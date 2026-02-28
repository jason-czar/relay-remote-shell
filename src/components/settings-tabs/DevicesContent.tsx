import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { SetupWizard } from "@/components/SetupWizard";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Monitor, Terminal, Plus, Trash2, RefreshCw, Loader2 } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

export default function DevicesContent() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  const fetchDevices = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase.from("devices").select("*").order("created_at", { ascending: false });
    if (!error && data) setDevices(data);
    setLoading(false);
  };

  useEffect(() => { fetchDevices(); }, [user]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel("devices-tab").on("postgres_changes", { event: "*", schema: "public", table: "devices" }, fetchDevices).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    const { error } = await supabase.from("devices").delete().eq("id", deleteId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { setDevices((prev) => prev.filter((d) => d.id !== deleteId)); }
    setDeleting(false);
    setDeleteId(null);
  };

  const handleDisconnect = async (device: Tables<"devices">) => {
    await supabase.from("sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("device_id", device.id).eq("status", "active");
    await supabase.from("devices").update({ status: "offline" }).eq("id", device.id);
    toast({ title: "Disconnected", description: `${device.name} has been disconnected.` });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Devices</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage machines connected to your account</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchDevices} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShowWizard(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Device
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading devices…</span>
        </div>
      ) : devices.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <Monitor className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No devices yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add a device to start remote terminal sessions</p>
            </div>
            <Button onClick={() => setShowWizard(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add your first device
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => (
            <Card key={device.id} className="transition-shadow hover:shadow-sm">
              <CardContent className="py-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Monitor className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{device.name}</p>
                    <StatusBadge status={device.status} />
                    {!device.paired && <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">Unpaired</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {device.workdir && <p className="text-xs text-muted-foreground font-mono truncate max-w-xs">{device.workdir}</p>}
                    {device.last_seen && <p className="text-xs text-muted-foreground">Last seen {new Date(device.last_seen).toLocaleString()}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {device.status === "online" && (
                    <>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/terminal/${device.id}`)}>
                        <Terminal className="h-3.5 w-3.5" /> Open Terminal
                      </Button>
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={() => handleDisconnect(device)}>Disconnect</Button>
                    </>
                  )}
                  {!device.paired && device.pairing_code && (
                    <span className="text-xs font-mono bg-muted px-2 py-1 rounded text-primary font-bold">{device.pairing_code}</span>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(device.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showWizard} onOpenChange={setShowWizard}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add a Device</DialogTitle></DialogHeader>
          <SetupWizard projectId="" onComplete={() => { setShowWizard(false); fetchDevices(); }} onSkip={() => setShowWizard(false)} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove device?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the device record. Any active sessions will be ended.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
