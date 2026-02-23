import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, Monitor, Terminal, Download, ChevronRight, Loader2 } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

interface SetupWizardProps {
  projectId: string;
  onComplete: () => void;
  onSkip: () => void;
  existingDevice?: Tables<"devices"> | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export function SetupWizard({ projectId, onComplete, onSkip, existingDevice }: SetupWizardProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(existingDevice ? 2 : 1);
  const [deviceName, setDeviceName] = useState(existingDevice?.name || "");
  const [creating, setCreating] = useState(false);
  const [device, setDevice] = useState<Tables<"devices"> | null>(existingDevice || null);
  const [copied, setCopied] = useState<string | null>(null);

  // Poll for device pairing status when on step 3
  useEffect(() => {
    if (step !== 3 || !device) return;
    const channel = supabase
      .channel(`wizard-device-${device.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "devices",
        filter: `id=eq.${device.id}`,
      }, (payload) => {
        const updated = payload.new as Tables<"devices">;
        setDevice(updated);
        if (updated.paired) {
          setStep(4);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [step, device]);

  // Also poll for online status on step 4
  useEffect(() => {
    if (step !== 4 || !device) return;
    const channel = supabase
      .channel(`wizard-device-status-${device.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "devices",
        filter: `id=eq.${device.id}`,
      }, (payload) => {
        setDevice(payload.new as Tables<"devices">);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [step, device]);

  const createDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName.trim()) return;
    setCreating(true);

    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data, error } = await supabase
      .from("devices")
      .insert({ project_id: projectId, name: deviceName.trim(), pairing_code: pairingCode })
      .select()
      .single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else if (data) {
      setDevice(data);
      setStep(2);
    }
    setCreating(false);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: "Copied!", description: `${label} copied to clipboard` });
    setTimeout(() => setCopied(null), 2000);
  };

  const pairCommand = device?.pairing_code
    ? `cd relay-connector && ./relay-connector --pair ${device.pairing_code} --api ${SUPABASE_URL}/functions/v1 --name "${device.name || "MyDevice"}"`
    : "";

  const connectCommand = `./relay-connector connect`;

  const steps = [
    { num: 1, label: "Name Device" },
    { num: 2, label: "Install Connector" },
    { num: 3, label: "Pair Device" },
    { num: 4, label: "Connect" },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Step indicators */}
      <div className="flex items-center justify-center gap-1">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              step === s.num
                ? "bg-primary text-primary-foreground"
                : step > s.num
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
            }`}>
              {step > s.num ? <Check className="h-3 w-3" /> : <span>{s.num}</span>}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <ChevronRight className="h-4 w-4 text-muted-foreground mx-1" />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Name device */}
      {step === 1 && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Monitor className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Name your device</h3>
                <p className="text-sm text-muted-foreground">Give this machine a recognizable name</p>
              </div>
            </div>
            <form onSubmit={createDevice} className="space-y-4">
              <Input
                placeholder="e.g. Home Server, Raspberry Pi, Work Laptop"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                required
                autoFocus
              />
              <div className="flex justify-between">
                <Button type="button" variant="ghost" onClick={onSkip}>Skip setup</Button>
                <Button type="submit" disabled={creating} className="gap-2">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {creating ? "Creating..." : "Create Device"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Install connector */}
      {step === 2 && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Download className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Install the connector</h3>
                <p className="text-sm text-muted-foreground">Run this on the machine you want to connect to</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">Download the connector source</p>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    const link = document.createElement("a");
                    link.href = `${SUPABASE_URL}/functions/v1/download-connector`;
                    link.download = "relay-connector.zip";
                    link.click();
                  }}
                >
                  <Download className="h-4 w-4" /> Download relay-connector.zip
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Contains <code className="bg-muted px-1 rounded">main.go</code>, <code className="bg-muted px-1 rounded">client.go</code>, <code className="bg-muted px-1 rounded">go.mod</code>, and <code className="bg-muted px-1 rounded">go.sum</code>.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">then build</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Unzip and build</p>
                <div className="relative">
                  <pre className="bg-muted rounded-lg p-4 pr-12 text-sm font-mono overflow-x-auto">
                    <code>{`unzip relay-connector.zip && cd relay-connector && go build -o relay-connector .`}</code>
                  </pre>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2 h-8 w-8"
                    onClick={() => copyToClipboard(`unzip relay-connector.zip && cd relay-connector && go build -o relay-connector .`, "Build command")}
                  >
                    {copied === "Build command" ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Requires Go 1.22+ installed.
                </p>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)} className="gap-2">
                I have the connector <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Pair device */}
      {step === 3 && device && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Terminal className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Pair your device</h3>
                <p className="text-sm text-muted-foreground">Run this command on your target machine</p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Run the pairing command:</p>
              <div className="relative">
                <pre className="bg-muted rounded-lg p-4 pr-12 text-sm font-mono overflow-x-auto break-all whitespace-pre-wrap">
                  <code>{pairCommand}</code>
                </pre>
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute top-2 right-2 h-8 w-8"
                  onClick={() => copyToClipboard(pairCommand, "Pair command")}
                >
                  {copied === "Pair command" ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Pairing code:</span>
                <code className="bg-muted px-2 py-0.5 rounded font-mono font-bold text-primary">
                  {device.pairing_code}
                </code>
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 flex items-center gap-3">
              {device.paired ? (
                <>
                  <Check className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-primary">Device paired successfully!</p>
                    <p className="text-xs text-muted-foreground">Your device is connected and ready</p>
                  </div>
                </>
              ) : (
                <>
                  <Loader2 className="h-5 w-5 text-muted-foreground animate-spin shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Waiting for device to pair...</p>
                    <p className="text-xs text-muted-foreground">Run the command above and this will update automatically</p>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => setStep(4)} disabled={!device.paired} className="gap-2">
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Connect */}
      {step === 4 && device && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Terminal className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Start the connector</h3>
                <p className="text-sm text-muted-foreground">Keep this running on your target machine</p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Run the connect command:</p>
              <div className="relative">
                <pre className="bg-muted rounded-lg p-4 pr-12 text-sm font-mono">
                  <code>{connectCommand}</code>
                </pre>
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute top-2 right-2 h-8 w-8"
                  onClick={() => copyToClipboard(connectCommand, "Connect command")}
                >
                  {copied === "Connect command" ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Monitor className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{device.name}</p>
                  <StatusBadge status={device.status} />
                </div>
              </div>
              {device.status === "online" && (
                <Button size="sm" className="gap-1" onClick={() => navigate(`/terminal/${device.id}`)}>
                  <Terminal className="h-3 w-3" /> Open Terminal
                </Button>
              )}
            </div>

            {device.status !== "online" && (
              <p className="text-xs text-muted-foreground text-center">
                Run <code className="bg-muted px-1 rounded">./relay-connector connect</code> on your machine — status will update automatically
              </p>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
              <Button onClick={onComplete} variant={device.status === "online" ? "default" : "outline"}>
                {device.status === "online" ? "Done — Go to Project" : "Skip — Go to Project"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
