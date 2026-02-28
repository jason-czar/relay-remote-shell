import { useEffect, useState } from "react";
import { Download, Share, MoreVertical, Plus, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function Install() {
  const navigate = useNavigate();
  const [deferredPrompt, setDeferredPrompt] = useState<Event & { prompt: () => void } | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    setIsIOS(/iphone|ipad|ipod/i.test(ua));
    setIsAndroid(/android/i.test(ua));

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as Event & { prompt: () => void });
    };
    window.addEventListener("beforeinstallprompt", handler);

    window.addEventListener("appinstalled", () => setInstalled(true));

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-12">
      <button
        onClick={() => navigate(-1)}
        className="absolute top-4 left-4 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>

      <img src="/pwa-192.png" alt="PrivaClaw" className="w-20 h-20 rounded-2xl mb-6 shadow-lg" />
      <h1 className="text-2xl font-semibold text-foreground mb-2">Install PrivaClaw</h1>
      <p className="text-sm text-muted-foreground text-center mb-10 max-w-xs">
        Add PrivaClaw to your home screen for a native-like experience — no app store required.
      </p>

      {installed ? (
        <div className="flex flex-col items-center gap-3">
          <div className="text-4xl">✅</div>
          <p className="text-sm text-muted-foreground">App installed! Launch it from your home screen.</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/")}>Open app</Button>
        </div>
      ) : deferredPrompt ? (
        <Button onClick={handleInstall} className="gap-2">
          <Download className="h-4 w-4" />
          Add to Home Screen
        </Button>
      ) : isIOS ? (
        <div className="bg-card border border-border rounded-xl p-5 max-w-sm space-y-4">
          <p className="text-sm font-medium text-foreground">On iPhone / iPad:</p>
          <ol className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">1</span>
              <span>Tap the <Share className="inline h-4 w-4 align-middle" /> <strong>Share</strong> button in Safari's toolbar</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">2</span>
              <span>Scroll down and tap <strong>"Add to Home Screen"</strong> <Plus className="inline h-4 w-4 align-middle" /></span>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">3</span>
              <span>Tap <strong>"Add"</strong> in the top-right corner</span>
            </li>
          </ol>
        </div>
      ) : isAndroid ? (
        <div className="bg-card border border-border rounded-xl p-5 max-w-sm space-y-4">
          <p className="text-sm font-medium text-foreground">On Android:</p>
          <ol className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">1</span>
              <span>Tap the <MoreVertical className="inline h-4 w-4 align-middle" /> <strong>menu</strong> in Chrome's top-right</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">2</span>
              <span>Tap <strong>"Add to Home screen"</strong></span>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">3</span>
              <span>Tap <strong>"Add"</strong> to confirm</span>
            </li>
          </ol>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          Open this page on your mobile device to install the app, or use your browser's <strong>"Install"</strong> / <strong>"Add to Home Screen"</strong> option.
        </p>
      )}
    </div>
  );
}
