import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, X, RotateCcw, ExternalLink } from "lucide-react";

interface WebPanelProps {
  initialUrl?: string;
  onClose?: () => void;
}

export function WebPanel({ initialUrl = "", onClose }: WebPanelProps) {
  const [url, setUrl] = useState(initialUrl);
  const [loadedUrl, setLoadedUrl] = useState(initialUrl);
  const [key, setKey] = useState(0);

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let normalized = url.trim();
    if (normalized && !normalized.startsWith("http")) {
      normalized = "http://" + normalized;
      setUrl(normalized);
    }
    setLoadedUrl(normalized);
    setKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-card shrink-0">
        <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <form onSubmit={handleNavigate} className="flex-1 flex items-center gap-1">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:3000"
            className="h-6 text-xs bg-muted/50 border-none px-2"
          />
        </form>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setKey((k) => k + 1)} title="Reload">
          <RotateCcw className="h-3 w-3" />
        </Button>
        {loadedUrl && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => window.open(loadedUrl, "_blank")} title="Open in new tab">
            <ExternalLink className="h-3 w-3" />
          </Button>
        )}
        {onClose && (
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={onClose} title="Close">
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      {loadedUrl ? (
        <iframe
          key={key}
          src={loadedUrl}
          className="flex-1 w-full border-none bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title="Web preview"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <Globe className="h-8 w-8 mx-auto opacity-40" />
            <p className="text-sm">Enter a URL above to preview</p>
            <p className="text-xs opacity-60">e.g. http://localhost:3000</p>
          </div>
        </div>
      )}
    </div>
  );
}
