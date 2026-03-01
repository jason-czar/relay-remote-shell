import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowUpRight, RotateCcw, X, MoreHorizontal, Globe, Monitor } from "lucide-react";
import { WebPanel } from "@/components/WebPanel";
import { cn } from "@/lib/utils";

interface PreviewPanelProps {
  initialUrl?: string;
  deviceId?: string;
  deviceName?: string;
  onClose: () => void;
  /** Called when the user wants to switch back to "Chat" tab */
  onSwitchToChat?: () => void;
  activeTab?: "chat" | "preview";
  onTabChange?: (tab: "chat" | "preview") => void;
}

export function PreviewPanel({
  initialUrl = "",
  deviceId,
  deviceName,
  onClose,
  onSwitchToChat,
  activeTab = "preview",
  onTabChange,
}: PreviewPanelProps) {
  const [urlInput, setUrlInput] = useState(initialUrl || "http://localhost:3000");
  const [submittedUrl, setSubmittedUrl] = useState(initialUrl || "");
  const [reloadKey, setReloadKey] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Sync URL when initialUrl prop changes (e.g., auto-detected port)
  useEffect(() => {
    if (initialUrl) {
      setUrlInput(initialUrl);
      setSubmittedUrl(initialUrl);
    }
  }, [initialUrl]);

  // Close "more" menu on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  const handleNavigate = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    let url = urlInput.trim();
    if (!url) return;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "http://" + url;
      setUrlInput(url);
    }
    setSubmittedUrl(url);
    setReloadKey(k => k + 1);
  }, [urlInput]);

  const handleReload = useCallback(() => {
    setReloadKey(k => k + 1);
  }, []);

  const handleOpenExternal = useCallback(() => {
    if (submittedUrl) window.open(submittedUrl, "_blank", "noopener,noreferrer");
  }, [submittedUrl]);

  return (
    <div className="flex flex-col h-full bg-[hsl(0,0%,8%)] overflow-hidden">

      {/* ── URL bar row ────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pt-3 pb-2">
        <form
          onSubmit={handleNavigate}
          className="flex items-center gap-2 bg-[hsl(0,0%,12%)] rounded-full px-3 h-9"
        >
          {/* URL input */}
          <input
            ref={urlInputRef}
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onFocus={e => e.target.select()}
            placeholder="http://localhost:3000"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none min-w-0"
            spellCheck={false}
            autoComplete="off"
          />

          {/* Open external */}
          <button
            type="button"
            onClick={handleOpenExternal}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Open in new tab"
          >
            <ArrowUpRight className="h-4 w-4" />
          </button>

          {/* Reload */}
          <button
            type="button"
            onClick={handleReload}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Reload"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          {/* Active preview indicator pill */}
          <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-primary">
            <Monitor className="h-4 w-4 text-primary-foreground" />
          </div>
        </form>
      </div>

      {/* ── Preview iframe content ─────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
      {submittedUrl ? (
        <div className="flex-1 min-h-0 overflow-hidden [&>div>div:first-child]:hidden">
          <WebPanel
            key={`${reloadKey}-${submittedUrl}`}
            initialUrl={submittedUrl}
            deviceId={deviceId}
            deviceName={deviceName}
          />
        </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Globe className="h-10 w-10 opacity-30" />
            <p className="text-sm">Enter a URL above to preview</p>
            <p className="text-xs opacity-50">
              {deviceId ? "Proxied from your remote device" : "e.g. http://localhost:3000"}
            </p>
          </div>
        )}
      </div>

      {/* ── Bottom tab bar ─────────────────────────────────────────── */}
      <div className="shrink-0 px-3 py-2.5 flex items-center gap-2">
        {/* History / back button */}
        <button
          className="w-9 h-9 flex items-center justify-center rounded-full bg-[hsl(0,0%,16%)] text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Close preview"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>

        {/* Chat / Preview pill toggle */}
        <div className="flex-1 flex bg-[hsl(0,0%,13%)] rounded-full p-0.5 h-9 relative">
          {/* Sliding indicator */}
          <div
            className={cn(
              "absolute top-0.5 bottom-0.5 rounded-full bg-[hsl(0,0%,22%)] transition-all duration-200",
              activeTab === "chat" ? "left-0.5 right-1/2" : "left-1/2 right-0.5"
            )}
          />
          <button
            className={cn(
              "relative flex-1 rounded-full text-sm font-medium transition-colors duration-150 z-10",
              activeTab === "chat" ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
            )}
            onClick={() => { onTabChange?.("chat"); onSwitchToChat?.(); }}
          >
            Chat
          </button>
          <button
            className={cn(
              "relative flex-1 rounded-full text-sm font-medium transition-colors duration-150 z-10",
              activeTab === "preview" ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
            )}
            onClick={() => onTabChange?.("preview")}
          >
            Preview
          </button>
        </div>

        {/* More menu */}
        <div className="relative shrink-0" ref={moreRef}>
          <button
            className="w-9 h-9 flex items-center justify-center rounded-full bg-[hsl(0,0%,16%)] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setMoreOpen(v => !v)}
            title="More options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {moreOpen && (
            <div className="absolute bottom-11 right-0 w-44 bg-[hsl(0,0%,15%)] border border-border/30 rounded-xl shadow-xl overflow-hidden z-50">
              <button
                className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-accent/40 transition-colors flex items-center gap-2"
                onClick={() => { handleReload(); setMoreOpen(false); }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reload
              </button>
              <button
                className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-accent/40 transition-colors flex items-center gap-2"
                onClick={() => { handleOpenExternal(); setMoreOpen(false); }}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
                Open in new tab
              </button>
              <button
                className="w-full text-left px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-2"
                onClick={() => { onClose(); setMoreOpen(false); }}
              >
                <X className="h-3.5 w-3.5" />
                Close preview
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
