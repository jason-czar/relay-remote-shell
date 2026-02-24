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

  // --- EventSource (SSE) interception ---
  var OrigEventSource = window.EventSource;
  if (OrigEventSource) {
    window.EventSource = function(url, config) {
      var rewritten = rewriteHttpUrl(url);
      if (rewritten) {
        console.log('[sse-proxy] intercepting ' + url);
        return new OrigEventSource(rewritten, config);
      }
      return new OrigEventSource(url, config);
    };
    window.EventSource.prototype = OrigEventSource.prototype;
    window.EventSource.CONNECTING = OrigEventSource.CONNECTING;
    window.EventSource.OPEN = OrigEventSource.OPEN;
    window.EventSource.CLOSED = OrigEventSource.CLOSED;
  }

  // --- navigator.sendBeacon interception ---
  var origBeacon = navigator.sendBeacon;
  if (origBeacon) {
    navigator.sendBeacon = function(url, data) {
      var rewritten = rewriteHttpUrl(url);
      if (rewritten) {
        console.log('[beacon-proxy] intercepting ' + url);
        return origBeacon.call(navigator, rewritten, data);
      }
      return origBeacon.call(navigator, url, data);
    };
  }

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

  // --- MutationObserver for dynamically created elements ---
  function rewriteAttr(el, attr) {
    var val = el.getAttribute(attr);
    if (!val) return;
    if (/^(https?:|data:|blob:|#|\/\/)/i.test(val)) return;
    var rewritten = rewriteHttpUrl(val);
    if (rewritten) {
      console.log('[mutation-proxy] rewriting ' + attr + '=' + val);
      el.setAttribute(attr, rewritten);
    }
  }

  function rewriteElement(el) {
    if (!el || !el.getAttribute) return;
    var tag = el.tagName;
    if (!tag) return;
    tag = tag.toUpperCase();
    if (['SCRIPT', 'IMG', 'SOURCE', 'VIDEO', 'AUDIO', 'EMBED', 'IFRAME'].indexOf(tag) !== -1) {
      rewriteAttr(el, 'src');
    }
    if (['LINK'].indexOf(tag) !== -1) {
      rewriteAttr(el, 'href');
    }
    if (tag === 'OBJECT') {
      rewriteAttr(el, 'data');
    }
  }

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      // Handle added nodes
      for (var j = 0; j < mutation.addedNodes.length; j++) {
        var node = mutation.addedNodes[j];
        if (node.nodeType !== 1) continue;
        rewriteElement(node);
        // Also check children
        var children = node.querySelectorAll ? node.querySelectorAll('script,img,link,source,video,audio,embed,object,iframe') : [];
        for (var k = 0; k < children.length; k++) {
          rewriteElement(children[k]);
        }
      }
      // Handle attribute changes on existing elements
      if (mutation.type === 'attributes' && mutation.target && mutation.target.nodeType === 1) {
        rewriteElement(mutation.target);
      }
    }
  });

  observer.observe(document.documentElement || document.body || document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'href', 'data']
  });

  // --- Stylesheet @import / url() rewriting ---
  function rewriteCssText(cssText) {
    // Rewrite url(...) references pointing to localhost
    cssText = cssText.replace(/url\\(\\s*["']?([^)"']+)["']?\\s*\\)/gi, function(match, rawUrl) {
      var rewritten = rewriteHttpUrl(rawUrl);
      if (rewritten) {
        console.log('[css-proxy] rewriting url() ' + rawUrl);
        return 'url("' + rewritten + '")';
      }
      return match;
    });
    // Rewrite @import "..." or @import url(...)
    cssText = cssText.replace(/@import\\s+["']([^"']+)["']/gi, function(match, rawUrl) {
      var rewritten = rewriteHttpUrl(rawUrl);
      if (rewritten) {
        console.log('[css-proxy] rewriting @import ' + rawUrl);
        return '@import "' + rewritten + '"';
      }
      return match;
    });
    return cssText;
  }

  // Intercept CSSStyleSheet.insertRule to rewrite url()/\@import in dynamically added rules
  var origInsertRule = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function(rule, index) {
    return origInsertRule.call(this, rewriteCssText(rule), index);
  };

  // Intercept setting .cssText on CSSStyleDeclaration (inline styles)
  var cssTextDesc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'cssText');
  if (cssTextDesc && cssTextDesc.set) {
    Object.defineProperty(CSSStyleDeclaration.prototype, 'cssText', {
      set: function(val) { cssTextDesc.set.call(this, rewriteCssText(val)); },
      get: cssTextDesc.get,
      configurable: true
    });
  }

  // Intercept .textContent and .innerHTML on <style> elements
  function patchStyleProperty(prop) {
    var origDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
                || Object.getOwnPropertyDescriptor(Element.prototype, prop)
                || Object.getOwnPropertyDescriptor(Node.prototype, prop);
    if (!origDesc || !origDesc.set) return;
    Object.defineProperty(HTMLStyleElement.prototype, prop, {
      set: function(val) {
        origDesc.set.call(this, rewriteCssText(val));
      },
      get: origDesc.get,
      configurable: true
    });
  }
  patchStyleProperty('textContent');
  patchStyleProperty('innerHTML');

  // Scan existing <style> tags on load
  setTimeout(function() {
    var styles = document.querySelectorAll('style');
    for (var i = 0; i < styles.length; i++) {
      var original = styles[i].textContent;
      if (!original) continue;
      var rewritten = rewriteCssText(original);
      if (rewritten !== original) {
        // Use the raw descriptor to avoid infinite loop
        var rawDesc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
        if (rawDesc && rawDesc.set) rawDesc.set.call(styles[i], rewritten);
      }
    }
  }, 0);
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

  const relayHttpUrl = (import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com")
    .replace("wss://", "https://")
    .replace("ws://", "http://");

  const relayWsUrl = (import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com")
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
