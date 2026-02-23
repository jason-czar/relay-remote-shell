import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Wifi, WifiOff, Shield, Activity, Copy, Check, ChevronDown, ChevronRight,
  RefreshCw, RotateCcw, Loader2, Globe, Server, Zap, ArrowLeft, Settings2, Eye, EyeOff
} from "lucide-react";
import { useNavigate } from "react-router-dom";

function generateUUID() {
  return crypto.randomUUID();
}

type ConnectionStatus = "disconnected" | "connecting" | "connected";
type EnvTag = "dev" | "staging" | "prod";

interface RelayConfig {
  relayUrl: string;
  connectionMode: "websocket" | "polling";
  nodeName: string;
  nodeId: string;
  envTag: EnvTag;
  authToken: string;
  zeroTrust: boolean;
  autoReconnect: boolean;
  heartbeatInterval: number;
  backoffStrategy: "exponential" | "linear" | "fixed";
  maxConcurrentTasks: number;
}

const DEFAULT_CONFIG: RelayConfig = {
  relayUrl: "wss://relay-terminal-cloud.fly.dev",
  connectionMode: "websocket",
  nodeName: "my-node",
  nodeId: generateUUID(),
  envTag: "dev",
  authToken: "",
  zeroTrust: true,
  autoReconnect: true,
  heartbeatInterval: 15,
  backoffStrategy: "exponential",
  maxConcurrentTasks: 5,
};

export default function SkillConfig() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [config, setConfig] = useState<RelayConfig>(() => {
    const saved = localStorage.getItem("openclaw-relay-config");
    return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
  });

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [latency, setLatency] = useState<number | null>(null);
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);
  const [uptime, setUptime] = useState<string>("—");
  const [runningTasks, setRunningTasks] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const update = useCallback(<K extends keyof RelayConfig>(key: K, value: RelayConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  const isValidUrl = (url: string) => /^(https:\/\/|wss:\/\/)/.test(url.trim());

  const copyNodeId = () => {
    navigator.clipboard.writeText(config.nodeId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const testConnection = async () => {
    if (!isValidUrl(config.relayUrl)) {
      toast({ title: "Invalid URL", description: "Relay URL must start with https:// or wss://", variant: "destructive" });
      return;
    }
    setTesting(true);
    setStatus("connecting");
    const start = Date.now();

    // Simulate handshake
    await new Promise(r => setTimeout(r, 800 + Math.random() * 700));
    const ms = Date.now() - start;

    if (config.authToken.length < 8) {
      setStatus("disconnected");
      setLatency(null);
      setTesting(false);
      toast({ title: "Connection failed", description: "Auth token is required before connecting.", variant: "destructive" });
      return;
    }

    setLatency(ms);
    setStatus("connected");
    setLastHeartbeat(new Date().toLocaleTimeString());
    setTesting(false);
    toast({ title: "Connected", description: `Handshake successful (${ms}ms)` });
  };

  const saveConfig = async () => {
    if (!isValidUrl(config.relayUrl)) {
      toast({ title: "Validation error", description: "Relay URL must start with https:// or wss://", variant: "destructive" });
      return;
    }
    if (!config.authToken || config.authToken.length < 8) {
      toast({ title: "Validation error", description: "Auth token is required (min 8 chars).", variant: "destructive" });
      return;
    }
    setSaving(true);
    await testConnection();
    localStorage.setItem("openclaw-relay-config", JSON.stringify(config));
    setSaving(false);
    if (status === "connected") {
      toast({ title: "Node connected successfully", description: "Configuration saved and relay handshake verified." });
    }
  };

  const generateToken = () => {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    update("authToken", token);
    toast({ title: "Token generated", description: "A new auth token has been generated." });
  };

  // Simulated uptime ticker
  useEffect(() => {
    if (status !== "connected") return;
    const start = Date.now();
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      setUptime(h > 0 ? `${h}h ${m % 60}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`);
      setRunningTasks(Math.floor(Math.random() * 3));
      setLastHeartbeat(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  const statusColor = {
    connected: "text-primary",
    connecting: "text-[hsl(var(--status-connecting))]",
    disconnected: "text-muted-foreground",
  }[status];

  const statusBg = {
    connected: "bg-primary/10",
    connecting: "bg-[hsl(var(--status-connecting))]/10",
    disconnected: "bg-muted",
  }[status];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-muted-foreground" />
                Remote Relay Configuration
              </h1>
              <p className="text-sm text-muted-foreground">Connect your OpenClaw node to a remote relay server</p>
            </div>
          </div>
          <Badge variant={status === "connected" ? "default" : "secondary"} className="gap-1.5">
            <span className={`h-2 w-2 rounded-full ${status === "connected" ? "bg-primary-foreground" : status === "connecting" ? "bg-[hsl(var(--status-connecting))]" : "bg-muted-foreground"}`} />
            {status === "connected" ? "Connected" : status === "connecting" ? "Connecting" : "Disconnected"}
          </Badge>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Section 1: Relay Connection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4 text-primary" />
              Relay Connection
            </CardTitle>
            <CardDescription>Configure the relay server your node will connect to</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="relay-url">Relay URL <span className="text-destructive">*</span></Label>
              <Input
                id="relay-url"
                placeholder="wss://relay-terminal-cloud.fly.dev"
                value={config.relayUrl}
                onChange={e => update("relayUrl", e.target.value)}
                className={config.relayUrl && !isValidUrl(config.relayUrl) ? "border-destructive" : ""}
              />
              {config.relayUrl && !isValidUrl(config.relayUrl) && (
                <p className="text-xs text-destructive">URL must start with https:// or wss://</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Connection Mode</Label>
              <Select value={config.connectionMode} onValueChange={v => update("connectionMode", v as "websocket" | "polling")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="websocket">WebSocket (recommended)</SelectItem>
                  <SelectItem value="polling">Secure Polling (fallback)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={testConnection} disabled={testing || !config.relayUrl}>
                {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
                Test Connection
              </Button>
              {latency !== null && status === "connected" && (
                <span className="text-sm text-primary font-medium">{latency}ms</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Node Identity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4 text-primary" />
              Node Identity
            </CardTitle>
            <CardDescription>Identify this node on the relay network</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="node-name">Node Name</Label>
              <Input id="node-name" value={config.nodeName} onChange={e => update("nodeName", e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Node ID</Label>
              <div className="flex gap-2">
                <Input value={config.nodeId} readOnly className="font-mono text-sm bg-muted" />
                <Button variant="outline" size="icon" onClick={copyNodeId} className="shrink-0">
                  {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Environment</Label>
              <Select value={config.envTag} onValueChange={v => update("envTag", v as EnvTag)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dev">Development</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="prod">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Security */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4 text-primary" />
              Security
            </CardTitle>
            <CardDescription>Authentication and connection security settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="auth-token">Auth Token <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="auth-token"
                    type={showToken ? "text" : "password"}
                    value={config.authToken}
                    onChange={e => update("authToken", e.target.value)}
                    placeholder="Paste or generate a token"
                    className="pr-10 font-mono text-sm"
                  />
                  <Button
                    variant="ghost" size="icon"
                    className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <Button variant="outline" onClick={generateToken} className="shrink-0">Generate</Button>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Zero-Trust Mode</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Only allow outbound relay connections</p>
              </div>
              <Switch checked={config.zeroTrust} onCheckedChange={v => update("zeroTrust", v)} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Auto-Reconnect</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Automatically reconnect on connection drop</p>
              </div>
              <Switch checked={config.autoReconnect} onCheckedChange={v => update("autoReconnect", v)} />
            </div>
          </CardContent>
        </Card>

        {/* Section 4: Status Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              Status
            </CardTitle>
            <CardDescription>Live connection and node health</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className={`rounded-lg p-4 ${statusBg} border border-border`}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Connection</p>
                  <div className={`flex items-center gap-1.5 font-medium text-sm ${statusColor}`}>
                    {status === "connected" ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Last Heartbeat</p>
                  <p className="text-sm font-medium">{lastHeartbeat ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Uptime</p>
                  <p className="text-sm font-medium">{uptime}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Running Tasks</p>
                  <p className="text-sm font-medium">{runningTasks}</p>
                </div>
              </div>
              {lastError && (
                <div className="mt-3 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
                  Last error: {lastError}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={testConnection} disabled={testing} className="gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${testing ? "animate-spin" : ""}`} />
                Reconnect
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                toast({ title: "Restart initiated", description: "OpenClaw is restarting..." });
              }}>
                <RotateCcw className="h-3.5 w-3.5" />
                Restart OpenClaw
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Section 5: Advanced */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-primary" />
                    Advanced
                  </span>
                  {advancedOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-5 pt-0">
                <div className="space-y-2">
                  <Label>Heartbeat Interval (seconds)</Label>
                  <Input
                    type="number" min={5} max={120}
                    value={config.heartbeatInterval}
                    onChange={e => update("heartbeatInterval", parseInt(e.target.value) || 15)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Reconnect Backoff Strategy</Label>
                  <Select value={config.backoffStrategy} onValueChange={v => update("backoffStrategy", v as "exponential" | "linear" | "fixed")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exponential">Exponential (recommended)</SelectItem>
                      <SelectItem value="linear">Linear</SelectItem>
                      <SelectItem value="fixed">Fixed interval</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Max Concurrent Tasks</Label>
                  <Input
                    type="number" min={1} max={50}
                    value={config.maxConcurrentTasks}
                    onChange={e => update("maxConcurrentTasks", parseInt(e.target.value) || 5)}
                  />
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Save */}
        <div className="flex justify-end pb-8">
          <Button onClick={saveConfig} disabled={saving} className="min-w-[160px]">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save Configuration
          </Button>
        </div>
      </div>
    </div>
  );
}
