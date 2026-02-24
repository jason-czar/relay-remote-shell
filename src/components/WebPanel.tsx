import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, X, RotateCcw, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface WebPanelProps {
  initialUrl?: string;
  deviceId?: string;
  deviceName?: string;
  onClose?: () => void;
}

export function WebPanel({ initialUrl = "", deviceId, deviceName, onClose }: WebPanelProps) {
  const [url, setUrl] = useState(initialUrl);
  const [loadedUrl, setLoadedUrl] = useState("");
  const [proxyHtml, setProxyHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const relayUrl = (import.meta.env.VITE_RELAY_URL || "wss://relay-terminal-cloud.fly.dev")
    .replace("wss://", "https://")
    .replace("ws://", "http://");

  const fetchViaProxy = useCallback(async (targetUrl: string) => {
    if (!deviceId) return;
    setLoading(true);
    setError(null);
    setProxyHtml(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }

      // Parse the target URL to get host:port/path
      let parsed: URL;
      try {
        parsed = new URL(targetUrl);
      } catch {
        setError("Invalid URL");
        setLoading(false);
        return;
      }

      const hostPort = parsed.host; // e.g. "localhost:3000"
      const path = parsed.pathname + parsed.search + parsed.hash;
      const proxyPath = `/proxy/${deviceId}/${hostPort}${path}`;

      const resp = await fetch(`${relayUrl}${proxyPath}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });

      if (!resp.ok) {
        const body = await resp.text();
        try {
          const json = JSON.parse(body);
          setError(json.error || `HTTP ${resp.status}`);
        } catch {
          setError(`HTTP ${resp.status}`);
        }
        setLoading(false);
        return;
      }

      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        let html = await resp.text();
        // Inject a <base> tag so relative resources resolve through proxy
        const baseUrl = `${relayUrl}/proxy/${deviceId}/${hostPort}/`;
        html = html.replace(
          /(<head[^>]*>)/i,
          `$1<base href="${baseUrl}" />`
        );
        setProxyHtml(html);
      } else {
        // For non-HTML, display in iframe via blob URL
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        setProxyHtml(null);
        setLoadedUrl(blobUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Proxy request failed");
    } finally {
      setLoading(false);
    }
  }, [deviceId, relayUrl]);

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let normalized = url.trim();
    if (normalized && !normalized.startsWith("http")) {
      normalized = "http://" + normalized;
      setUrl(normalized);
    }
    if (!normalized) return;

    if (deviceId) {
      setLoadedUrl(normalized);
      fetchViaProxy(normalized);
    } else {
      // Direct mode (no device — legacy behavior)
      setLoadedUrl(normalized);
      setKey((k) => k + 1);
    }
  };

  const handleReload = () => {
    if (deviceId && loadedUrl) {
      fetchViaProxy(loadedUrl);
    } else {
      setKey((k) => k + 1);
    }
  };

  // Auto-load initial URL
  useEffect(() => {
    if (initialUrl && deviceId) {
      let normalized = initialUrl.trim();
      if (normalized && !normalized.startsWith("http")) {
        normalized = "http://" + normalized;
      }
      setUrl(normalized);
      setLoadedUrl(normalized);
      fetchViaProxy(normalized);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const label = deviceName ? `${deviceName} · Web` : "Web Preview";

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-card shrink-0">
        <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {deviceName && (
          <span className="text-[10px] text-muted-foreground font-medium shrink-0 mr-1">{deviceName}</span>
        )}
        <form onSubmit={handleNavigate} className="flex-1 flex items-center gap-1">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:3000"
            className="h-6 text-xs bg-muted/50 border-none px-2"
          />
        </form>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleReload} title="Reload">
          <RotateCcw className="h-3 w-3" />
        </Button>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={onClose} title="Close">
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center text-destructive">
          <div className="text-center space-y-2 max-w-sm px-4">
            <AlertCircle className="h-8 w-8 mx-auto opacity-60" />
            <p className="text-sm font-medium">Connection failed</p>
            <p className="text-xs opacity-80">{error}</p>
            <Button variant="outline" size="sm" onClick={handleReload} className="mt-2">
              Retry
            </Button>
          </div>
        </div>
      ) : proxyHtml ? (
        <iframe
          ref={iframeRef}
          key={key}
          srcDoc={proxyHtml}
          className="flex-1 w-full border-none bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title={label}
        />
      ) : loadedUrl && !deviceId ? (
        <iframe
          key={key}
          src={loadedUrl}
          className="flex-1 w-full border-none bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title={label}
        />
      ) : !loadedUrl ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <Globe className="h-8 w-8 mx-auto opacity-40" />
            <p className="text-sm">Enter a URL above to preview</p>
            <p className="text-xs opacity-60">
              {deviceId
                ? "URL will be fetched from the remote device"
                : "e.g. http://localhost:3000"}
            </p>
          </div>
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : null}
    </div>
  );
}
