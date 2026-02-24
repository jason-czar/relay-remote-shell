import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, X, RotateCcw, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface WebPanelProps {
  initialUrl?: string;
  deviceId?: string;
  deviceName?: string;
  onClose?: () => void;
}

/**
 * Generates a script that intercepts WebSocket, fetch, and XMLHttpRequest
 * so that any localhost connections from the proxied page are routed
 * through the relay with authentication.
 */
function buildInterceptScript(relayHttpUrl: string, relayWsUrl: string, deviceId: string, token: string): string {
  return `
<script>
(function() {
  var RELAY_HTTP = ${JSON.stringify(relayHttpUrl)};
  var RELAY_WS = ${JSON.stringify(relayWsUrl)};
  var DEVICE_ID = ${JSON.stringify(deviceId)};
  var TOKEN = ${JSON.stringify(token)};

  function isLocal(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  }

  function rewriteHttpUrl(url) {
    var parsed;
    try { parsed = new URL(url, location.href); } catch(e) { return null; }
    if (!isLocal(parsed.hostname)) return null;
    var hostPort = parsed.host;
    var path = parsed.pathname + parsed.search;
    var sep = path.indexOf('?') !== -1 ? '&' : '?';
    return RELAY_HTTP + '/proxy/' + DEVICE_ID + '/' + hostPort + path + sep + 'token=' + encodeURIComponent(TOKEN);
  }

  // --- WebSocket interception ---
  var OrigWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    var parsed;
    try { parsed = new URL(url); } catch(e) {
      return protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);
    }
    if (isLocal(parsed.hostname)) {
      var hostPort = parsed.host;
      var path = parsed.pathname + parsed.search;
      var proxyUrl = RELAY_WS + '/ws-proxy/' + DEVICE_ID + '/' + hostPort + path + '?token=' + encodeURIComponent(TOKEN);
      console.log('[ws-proxy] intercepting ' + url);
      return protocols ? new OrigWebSocket(proxyUrl, protocols) : new OrigWebSocket(proxyUrl);
    }
    return protocols ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);
  };
  window.WebSocket.prototype = OrigWebSocket.prototype;
  window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
  window.WebSocket.OPEN = OrigWebSocket.OPEN;
  window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
  window.WebSocket.CLOSED = OrigWebSocket.CLOSED;

  // --- fetch() interception ---
  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
    var rewritten = rewriteHttpUrl(url);
    if (rewritten) {
      console.log('[fetch-proxy] intercepting ' + url);
      if (typeof input === 'string') {
        return origFetch.call(this, rewritten, init);
      } else {
        return origFetch.call(this, new Request(rewritten, input), init);
      }
    }
    return origFetch.call(this, input, init);
  };

  // --- XMLHttpRequest interception ---
  var OrigXHR = window.XMLHttpRequest;
  var origOpen = OrigXHR.prototype.open;
  OrigXHR.prototype.open = function(method, url) {
    var rewritten = rewriteHttpUrl(url);
    if (rewritten) {
      console.log('[xhr-proxy] intercepting ' + url);
      arguments[1] = rewritten;
    }
    return origOpen.apply(this, arguments);
  };
})();
</script>`;
}

export function WebPanel({ initialUrl = "", deviceId, deviceName, onClose }: WebPanelProps) {
  const [url, setUrl] = useState(initialUrl);
  const [loadedUrl, setLoadedUrl] = useState("");
  const [proxyHtml, setProxyHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const relayHttpUrl = (import.meta.env.VITE_RELAY_URL || "wss://relay-terminal-cloud.fly.dev")
    .replace("wss://", "https://")
    .replace("ws://", "http://");

  const relayWsUrl = (import.meta.env.VITE_RELAY_URL || "wss://relay-terminal-cloud.fly.dev")
    .replace("https://", "wss://")
    .replace("http://", "ws://");

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

      const resp = await fetch(`${relayHttpUrl}${proxyPath}`, {
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
        const proxyBase = `${relayHttpUrl}/proxy/${deviceId}/${hostPort}/`;
        const tokenParam = `token=${encodeURIComponent(jwt)}`;

        // Rewrite relative asset URLs (src="./..." href="./...") to go through proxy with token
        const rewriteUrl = (attrUrl: string): string => {
          // Skip absolute URLs, data URIs, anchors, and protocol-relative
          if (/^(https?:|data:|blob:|#|\/\/)/i.test(attrUrl)) return attrUrl;
          // Resolve relative to proxy base and append token
          const resolved = new URL(attrUrl, proxyBase).href;
          const sep = resolved.includes("?") ? "&" : "?";
          return resolved + sep + tokenParam;
        };

        // Rewrite src and href attributes in HTML tags
        html = html.replace(
          /(<(?:script|link|img|source|video|audio|embed|object|iframe)\b[^>]*?\b)(src|href)(=["'])([^"']*)(["'])/gi,
          (_match, before, attr, eqQuote, url, endQuote) => {
            return before + attr + eqQuote + rewriteUrl(url) + endQuote;
          }
        );

        // Also rewrite url() in inline styles
        html = html.replace(
          /url\(["']?([^)"']+)["']?\)/gi,
          (_match, url) => `url("${rewriteUrl(url)}")`
        );

        // Build the intercept script (WS + fetch + XHR)
        const wsScript = buildInterceptScript(relayHttpUrl, relayWsUrl, deviceId, jwt);

        // Inject <base> (without token — just for any remaining relative refs) and WS intercept
        const baseTag = `<base href="${proxyBase}" />`;
        if (html.match(/<head[^>]*>/i)) {
          html = html.replace(
            /(<head[^>]*>)/i,
            `$1${baseTag}${wsScript}`
          );
        } else {
          html = `<head>${baseTag}${wsScript}</head>` + html;
        }
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
  }, [deviceId, relayHttpUrl, relayWsUrl]);

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
