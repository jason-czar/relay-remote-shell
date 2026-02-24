import { useState, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { TerminalPanel } from "@/components/TerminalPanel";
import { WebPanel } from "@/components/WebPanel";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Plus, Terminal, Globe, Columns2, Monitor } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import type { Tables } from "@/integrations/supabase/types";

type PanelType = "terminal" | "web";

interface SplitPanel {
  id: string;
  type: PanelType;
  deviceId?: string;
  deviceName?: string;
  url?: string;
}

let panelCounter = 0;
const nextId = () => `panel-${++panelCounter}`;

export default function MultiSession() {
  const { user } = useAuth();
  const [panels, setPanels] = useState<SplitPanel[]>([]);
  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [webUrl, setWebUrl] = useState("");

  useEffect(() => {
    if (!user) return;
    const loadDevices = async () => {
      // Get all devices across user's projects that are online
      const { data: memberProjects } = await supabase
        .from("project_members")
        .select("project_id")
        .eq("user_id", user.id);
      if (!memberProjects?.length) return;
      const projectIds = memberProjects.map((m) => m.project_id);
      const { data } = await supabase
        .from("devices")
        .select("*")
        .in("project_id", projectIds)
        .order("name");
      setDevices(data ?? []);
    };
    loadDevices();
  }, [user]);

  const addTerminalPanel = (device: Tables<"devices">) => {
    setPanels((prev) => [...prev, { id: nextId(), type: "terminal", deviceId: device.id, deviceName: device.name }]);
    setAddOpen(false);
  };

  const addWebPanel = (url?: string) => {
    const normalized = url?.trim() || "";
    setPanels((prev) => [...prev, { id: nextId(), type: "web", url: normalized }]);
    setWebUrl("");
    setAddOpen(false);
  };

  const removePanel = (id: string) => {
    setPanels((prev) => prev.filter((p) => p.id !== id));
  };

  const onlineDevices = devices.filter((d) => d.status === "online");
  const offlineDevices = devices.filter((d) => d.status !== "online");

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-theme(spacing.14)-theme(spacing.6)-theme(spacing.6))]">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Columns2 className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">Multi-Session</h1>
            {panels.length > 0 && (
              <span className="text-xs text-muted-foreground">{panels.length} panel{panels.length !== 1 ? "s" : ""}</span>
            )}
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add Panel
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add Panel</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* Terminal panels */}
                <div>
                  <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5" /> Terminal Sessions
                  </p>
                  {onlineDevices.length === 0 && offlineDevices.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No devices found. Add devices in a project first.</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {onlineDevices.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => addTerminalPanel(d)}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors text-sm"
                        >
                          <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="flex-1 truncate">{d.name}</span>
                          <StatusBadge status="online" />
                        </button>
                      ))}
                      {offlineDevices.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => addTerminalPanel(d)}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors text-sm opacity-50"
                        >
                          <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="flex-1 truncate">{d.name}</span>
                          <StatusBadge status="offline" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Web panel */}
                <div className="border-t border-border pt-4">
                  <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5" /> Web Preview
                  </p>
                  <form
                    onSubmit={(e) => { e.preventDefault(); addWebPanel(webUrl); }}
                    className="flex gap-2"
                  >
                    <Input
                      value={webUrl}
                      onChange={(e) => setWebUrl(e.target.value)}
                      placeholder="http://localhost:3000"
                      className="text-sm h-9"
                    />
                    <Button type="submit" size="sm" variant="secondary" className="shrink-0">
                      Add
                    </Button>
                  </form>
                  <p className="text-[10px] text-muted-foreground mt-1">Leave blank to enter URL later</p>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Panels area */}
        {panels.length === 0 ? (
          <div className="flex-1 flex items-center justify-center border border-dashed border-border rounded-lg">
            <div className="text-center space-y-3">
              <Columns2 className="h-12 w-12 mx-auto text-muted-foreground opacity-40" />
              <div>
                <p className="text-sm font-medium">No panels open</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Add terminal sessions or web previews to work side-by-side
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add Panel
              </Button>
            </div>
          </div>
        ) : panels.length === 1 ? (
          <div className="flex-1 rounded-lg overflow-hidden border border-border">
            {renderPanel(panels[0], removePanel)}
          </div>
        ) : (
          <ResizablePanelGroup direction="horizontal" className="flex-1 rounded-lg border border-border">
            {panels.map((panel, i) => (
              <PanelWithHandle key={panel.id} panel={panel} index={i} total={panels.length} onRemove={removePanel} />
            ))}
          </ResizablePanelGroup>
        )}
      </div>
    </AppLayout>
  );
}

function PanelWithHandle({ panel, index, total, onRemove }: { panel: SplitPanel; index: number; total: number; onRemove: (id: string) => void }) {
  return (
    <>
      {index > 0 && <ResizableHandle withHandle />}
      <ResizablePanel minSize={15} defaultSize={100 / total}>
        {renderPanel(panel, onRemove)}
      </ResizablePanel>
    </>
  );
}

function renderPanel(panel: SplitPanel, onRemove: (id: string) => void) {
  if (panel.type === "terminal" && panel.deviceId) {
    return (
      <TerminalPanel
        deviceId={panel.deviceId}
        deviceName={panel.deviceName}
        onClose={() => onRemove(panel.id)}
      />
    );
  }
  return (
    <WebPanel
      initialUrl={panel.url}
      onClose={() => onRemove(panel.id)}
    />
  );
}
