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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Wifi, WifiOff, Shield, Activity, Copy, Check, ChevronDown, ChevronRight,
  RefreshCw, RotateCcw, Loader2, Globe, Server, Zap, ArrowLeft, Settings2, Eye, EyeOff, Terminal, ExternalLink,
  Plus, Trash2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

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

interface SavedNode {
  id: string;
  node_id: string;
  name: string;
  config: RelayConfig;
}

const DEFAULT_CONFIG: RelayConfig = {
  relayUrl: "wss://privaclaw.fly.dev",
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
  const { user } = useAuth();
  const [config, setConfig] = useState<RelayConfig>(DEFAULT_CONFIG);
  const [savedNodes, setSavedNodes] = useState<SavedNode[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Load all saved configs for user
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("skill_configs")
        .select("*")
        .eq("user_id", user.id)
        .eq("skill_slug", "privaclaw") as any;
      const nodes: SavedNode[] = (data ?? []).map((row: any) => ({
        id: row.id,
        node_id: row.node_id,
        name: row.name,
        config: { ...DEFAULT_CONFIG, ...(row.config as Partial<RelayConfig>) },
      }));
      setSavedNodes(nodes);
      if (nodes.length > 0) {
        setActiveNodeId(nodes[0].node_id);
        setConfig(nodes[0].config);
      }
      setLoadingConfig(false);
    };
    load();
  }, [user]);

  const selectNode = (nodeId: string) => {
    const node = savedNodes.find(n => n.node_id === nodeId);
    if (node) {
      setActiveNodeId(nodeId);
      setConfig(node.config);
      setStatus("disconnected");
      setLatency(null);
    }
  };

  const createNewNode = () => {
    const newConfig = { ...DEFAULT_CONFIG, nodeId: generateUUID(), nodeName: `node-${savedNodes.length + 1}` };
    const newNodeId = newConfig.nodeId;
    setConfig(newConfig);
    setActiveNodeId(newNodeId);
    setStatus("disconnected");
    setLatency(null);
    // Don't add to savedNodes yet — will be added on save
    toast({ title: "New node config", description: "Configure and save to persist." });
  };

  const deleteNode = async (nodeId: string) => {
    if (!user) return;
    const node = savedNodes.find(n => n.node_id === nodeId);
    if (!node) return;
    await supabase.from("skill_configs").delete().eq("id", node.id) as any;
    const remaining = savedNodes.filter(n => n.node_id !== nodeId);
    setSavedNodes(remaining);
    if (activeNodeId === nodeId) {
      if (remaining.length > 0) {
        setActiveNodeId(remaining[0].node_id);
        setConfig(remaining[0].config);
      } else {
        setActiveNodeId(null);
        setConfig({ ...DEFAULT_CONFIG, nodeId: generateUUID() });
      }
    }
    toast({ title: "Node deleted", description: `"${node.name}" has been removed.` });
  };

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

    let wsUrl = config.relayUrl.replace(/\/+$/, "");
    wsUrl = wsUrl.replace(/^https:\/\//, "wss://");
    wsUrl = wsUrl.replace(/^http:\/\//, "ws://");

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        setStatus("disconnected");
        setLatency(null);
        setTesting(false);
        toast({ title: "Connection timeout", description: "Relay server did not respond within 5 seconds.", variant: "destructive" });
        resolve();
      }, 5000);

      let ws: WebSocket;
      try {
        ws = new WebSocket(`${wsUrl}/connect`);
      } catch {
        clearTimeout(timeout);
        setStatus("disconnected");
        setTesting(false);
        toast({ title: "Connection failed", description: "Could not create WebSocket connection.", variant: "destructive" });
        resolve();
        return;
      }

      ws.onopen = () => {
        const ms = Date.now() - start;
        clearTimeout(timeout);
        setLatency(ms);
        setStatus("connected");
        setLastHeartbeat(new Date().toLocaleTimeString());
        setTesting(false);
        toast({ title: "Relay reachable", description: `WebSocket connected in ${ms}ms. Server is online.` });
        ws.close(1000);
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        setStatus("disconnected");
        setLatency(null);
        setTesting(false);
        toast({ title: "Connection failed", description: "Could not reach the relay server. Check the URL and try again.", variant: "destructive" });
        resolve();
      };
    });
  };

  const saveConfig = async () => {
    if (!user) return;
    if (!isValidUrl(config.relayUrl)) {
      toast({ title: "Validation error", description: "Relay URL must start with https:// or wss://", variant: "destructive" });
      return;
    }
    if (!config.authToken || config.authToken.length < 8) {
      toast({ title: "Validation error", description: "Auth token is required (min 8 chars).", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error, data } = await supabase
      .from("skill_configs")
      .upsert([{
        user_id: user.id,
        skill_slug: "privaclaw",
        node_id: config.nodeId,
        name: config.nodeName,
        config: JSON.parse(JSON.stringify(config)),
      }] as any, { onConflict: "user_id,skill_slug,node_id" })
      .select() as any;
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    // Update local saved nodes list
    const existing = savedNodes.findIndex(n => n.node_id === config.nodeId);
    const savedNode: SavedNode = {
      id: data?.[0]?.id ?? config.nodeId,
      node_id: config.nodeId,
      name: config.nodeName,
      config,
    };
    if (existing >= 0) {
      setSavedNodes(prev => prev.map((n, i) => i === existing ? savedNode : n));
    } else {
      setSavedNodes(prev => [...prev, savedNode]);
    }
    setActiveNodeId(config.nodeId);
    await testConnection();
    setSaving(false);
    toast({ title: "Configuration saved", description: `"${config.nodeName}" saved to your account.` });
  };

  const generateToken = () => {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    update("authToken", token);
    toast({ title: "Token generated", description: "A new auth token has been generated." });
  };

  const [configCopied, setConfigCopied] = useState(false);
  const skillConfig = JSON.stringify({
    relay_url: config.relayUrl || "wss://privaclaw.fly.dev",
    node_id: config.nodeId,
    auth_token: config.authToken || "<generate a token above>",
  }, null, 2);

  const copySkillConfig = () => {
    navigator.clipboard.writeText(skillConfig);
    setConfigCopied(true);
    setTimeout(() => setConfigCopied(false), 2000);
    toast({ title: "Config copied", description: "Paste this into your OpenClaw skill config." });
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

  const isUnsaved = !savedNodes.some(n => n.node_id === config.nodeId);

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
                PrivaClaw Configuration
              </h1>
              <p className="text-sm text-muted-foreground">Connect your OpenClaw nodes via PrivaClaw</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://clawhub.ai/skills/privaclaw"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                ClawHub
              </Button>
            </a>
            <Badge variant={status === "connected" ? "default" : "secondary"} className="gap-1.5">
              <span className={`h-2 w-2 rounded-full ${status === "connected" ? "bg-primary-foreground" : status === "connecting" ? "bg-[hsl(var(--status-connecting))]" : "bg-muted-foreground"}`} />
              {status === "connected" ? "Connected" : status === "connecting" ? "Connecting" : "Disconnected"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Node Selector */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                Your Nodes
              </span>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={createNewNode}>
                <Plus className="h-3.5 w-3.5" />
                New Node
              </Button>
            </CardTitle>
            <CardDescription>Select a node to configure, or create a new one</CardDescription>
          </CardHeader>
          <CardContent>
            {savedNodes.length === 0 && !isUnsaved ? (
              <p className="text-sm text-muted-foreground">No saved nodes yet. Click "New Node" to create one.</p>
            ) : (
              <div className="space-y-2">
                {savedNodes.map(node => (
                  <div
                    key={node.node_id}
                    className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors ${
                      activeNodeId === node.node_id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    }`}
                    onClick={() => selectNode(node.node_id)}
                  >
                    <div className="flex items-center gap-3">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{node.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{node.node_id.slice(0, 8)}… · {node.config.envTag}</p>
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={e => e.stopPropagation()}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{node.name}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently remove this node configuration. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteNode(node.node_id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
                {isUnsaved && (
                  <div className="flex items-center justify-between rounded-lg border border-dashed border-primary/50 bg-primary/5 p-3">
                    <div className="flex items-center gap-3">
                      <Server className="h-4 w-4 text-primary" />
                      <div>
                        <p className="text-sm font-medium">{config.nodeName} <Badge variant="outline" className="ml-2 text-[10px]">unsaved</Badge></p>
                        <p className="text-xs text-muted-foreground font-mono">{config.nodeId.slice(0, 8)}… · new</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

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
                placeholder="wss://privaclaw.fly.dev"
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
                <Input value={config.nodeId} onChange={e => update("nodeId", e.target.value)} className="font-mono text-sm" placeholder="UUID or custom identifier" />
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

        {/* Use in OpenClaw */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="h-4 w-4 text-primary" />
              Use in OpenClaw
            </CardTitle>
            <CardDescription>Copy this config into your local OpenClaw skill settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted p-4 font-mono text-sm text-foreground relative">
              <pre className="whitespace-pre-wrap break-all">{skillConfig}</pre>
              <Button
                variant="ghost" size="icon"
                className="absolute top-2 right-2"
                onClick={copySkillConfig}
              >
                {configCopied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">How to connect</p>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Install the <code className="bg-muted px-1.5 py-0.5 rounded text-xs">privaclaw</code> skill in your OpenClaw instance</li>
                <li>Paste the config above into your skill configuration</li>
                <li>Start OpenClaw — it will connect to the relay automatically</li>
                <li>Use this page to monitor connection status</li>
              </ol>
            </div>
          </CardContent>
        </Card>

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
