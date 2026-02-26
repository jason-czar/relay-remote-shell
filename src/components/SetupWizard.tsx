import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, Monitor, Terminal, ChevronRight, Loader2 } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

interface SetupWizardProps {
  projectId: string;
  onComplete: () => void;
  onSkip: () => void;
  existingDevice?: Tables<"devices"> | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const API_URL = `${SUPABASE_URL}/functions/v1`;

export function SetupWizard({ projectId, onComplete, onSkip, existingDevice }: SetupWizardProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(existingDevice ? 2 : 1);
  const [deviceName, setDeviceName] = useState(existingDevice?.name || "");
  const [creating, setCreating] = useState(false);
  const [device, setDevice] = useState<Tables<"devices"> | null>(existingDevice || null);
  const [copied, setCopied] = useState(false);

  // Poll for device pairing + online status on step 2
  useEffect(() => {
    if (step !== 2 || !device) return;
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
        if (updated.paired && updated.status === "online") {
          setStep(3);
        }
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "Copied!", description: "Command copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  // The single all-in-one command
  const oneLineCommand = device?.pairing_code
    ? `set -e
RELAY_DIR="$HOME/relay-connector"
API_URL="${API_URL}"
PAIR_CODE="${device.pairing_code}"
NAME="${device.name || "MyDevice"}"

rm -rf "$RELAY_DIR"
curl -fsSL "$API_URL/download-connector?install=1" | bash

cd "$RELAY_DIR"
./relay-connector --pair "$PAIR_CODE" --api "$API_URL" --name "$NAME"

echo "Starting connector in background..."
(
  cd "$RELAY_DIR"
  nohup ./relay-connector >/dev/null 2>&1 &
)
echo "Connector running."`
    : "";

  const steps = [
    { num: 1, label: "Name Device" },
    { num: 2, label: "Run Command" },
    { num: 3, label: "Done" },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Step indicators */}
      <div className="flex items-center justify-center gap-1">
        {steps.map((s, i) => {
          const isCompleted = step > s.num;
          const isCurrent = step === s.num;
          const isClickable = isCompleted || (s.num <= step + 1 && (s.num <= 1 || !!device));
          return (
            <div key={s.num} className="flex items-center">
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && setStep(s.num)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : isCompleted
                      ? "bg-primary/20 text-primary hover:bg-primary/30 cursor-pointer"
                      : isClickable
                        ? "bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer"
                        : "bg-muted text-muted-foreground/50 cursor-not-allowed"
                }`}
              >
                {isCompleted ? <Check className="h-3 w-3" /> : <span>{s.num}</span>}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < steps.length - 1 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground mx-1" />
              )}
            </div>
          );
        })}
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
                  {creating ? "Creating..." : "Continue"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Run the one-liner */}
      {step === 2 && device && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Terminal className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Run this on your machine</h3>
                <p className="text-sm text-muted-foreground">
                  One command installs, pairs, and starts the connector
                </p>
              </div>
            </div>

            <div className="relative">
              <pre className="bg-muted rounded-lg p-4 pr-12 text-sm font-mono overflow-x-auto whitespace-pre leading-relaxed">
                <code>{oneLineCommand}</code>
              </pre>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2 h-8 w-8"
                onClick={() => copyToClipboard(oneLineCommand)}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Pairing code:</span>
              <code className="bg-muted px-2 py-0.5 rounded font-mono font-bold text-primary">
                {device.pairing_code}
              </code>
            </div>

            {/* Status indicator */}
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 flex items-center gap-3">
              {device.paired && device.status === "online" ? (
                <>
                  <Check className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-primary">Device is online!</p>
                    <p className="text-xs text-muted-foreground">Connector running and connected</p>
                  </div>
                </>
              ) : device.paired ? (
                <>
                  <Loader2 className="h-5 w-5 text-muted-foreground animate-spin shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Paired — waiting for connector to come online...</p>
                    <p className="text-xs text-muted-foreground">Status will update automatically</p>
                  </div>
                </>
              ) : (
                <>
                  <Loader2 className="h-5 w-5 text-muted-foreground animate-spin shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Waiting for device to connect...</p>
                    <p className="text-xs text-muted-foreground">Run the command above — this will update automatically</p>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!(device.paired && device.status === "online")}
                className="gap-2"
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Done */}
      {step === 3 && device && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Check className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">You're all set!</h3>
                <p className="text-sm text-muted-foreground">Your device is connected and ready to use</p>
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

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={onComplete}>
                Done — Go to Project
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
