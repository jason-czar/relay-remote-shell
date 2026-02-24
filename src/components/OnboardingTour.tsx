import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { X, ArrowRight, ArrowLeft, FolderOpen, Monitor, Link2, Terminal, Sparkles } from "lucide-react";

const TOUR_KEY = "relay-onboarding-complete";

interface TourStep {
  title: string;
  description: string;
  icon: React.ElementType;
  targetSelector?: string;
  action?: string;
  position?: "top" | "bottom" | "center";
}

const steps: TourStep[] = [
  {
    title: "Welcome to Relay Terminal! 👋",
    description:
      "Let's walk you through getting set up. In under a minute, you'll have browser-based terminal access to any machine.",
    icon: Sparkles,
    position: "center",
  },
  {
    title: "1. Create a Project",
    description:
      "Projects group your devices and team members. Head to the Projects page and click 'New Project' to create one.",
    icon: FolderOpen,
    targetSelector: '[data-tour="stat-projects"]',
    action: "/projects",
    position: "bottom",
  },
  {
    title: "2. Add a Device",
    description:
      "Inside your project, click 'Add Device' to register a machine. You'll get a pairing code to link your device.",
    icon: Monitor,
    targetSelector: '[data-tour="stat-devices"]',
    position: "bottom",
  },
  {
    title: "3. Pair with the Connector",
    description:
      "Install the lightweight Go connector on your machine and run the pairing command with your code. The device will appear online instantly.",
    icon: Link2,
    targetSelector: '[data-tour="stat-online"]',
    position: "bottom",
  },
  {
    title: "4. Connect & Go!",
    description:
      "Once paired and online, click 'Connect' on any device to open a live terminal session right in your browser. That's it!",
    icon: Terminal,
    targetSelector: '[data-tour="stat-sessions"]',
    position: "bottom",
  },
];

export function OnboardingTour() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [highlight, setHighlight] = useState<DOMRect | null>(null);
  const navigate = useNavigate();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const done = localStorage.getItem(TOUR_KEY);
    if (!done) {
      // Small delay so dashboard renders first
      const t = setTimeout(() => setActive(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  const updateHighlight = useCallback(() => {
    const sel = steps[step]?.targetSelector;
    if (!sel) {
      setHighlight(null);
      return;
    }
    const el = document.querySelector(sel);
    if (el) {
      setHighlight(el.getBoundingClientRect());
    } else {
      setHighlight(null);
    }
  }, [step]);

  useEffect(() => {
    if (!active) return;
    updateHighlight();
    window.addEventListener("resize", updateHighlight);
    window.addEventListener("scroll", updateHighlight, true);
    return () => {
      window.removeEventListener("resize", updateHighlight);
      window.removeEventListener("scroll", updateHighlight, true);
    };
  }, [active, step, updateHighlight]);

  const finish = useCallback(() => {
    localStorage.setItem(TOUR_KEY, "true");
    setActive(false);
  }, []);

  const next = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      finish();
    }
  };

  const prev = () => {
    if (step > 0) setStep(step - 1);
  };

  const goToAction = () => {
    const action = steps[step]?.action;
    if (action) {
      finish();
      navigate(action);
    }
  };

  if (!active) return null;

  const current = steps[step];
  const Icon = current.icon;
  const isCenter = current.position === "center" || !highlight;
  const isLast = step === steps.length - 1;

  // Calculate tooltip position
  let tooltipStyle: React.CSSProperties = {};
  if (!isCenter && highlight) {
    const padding = 12;
    tooltipStyle = {
      position: "fixed",
      left: Math.max(16, Math.min(highlight.left, window.innerWidth - 360)),
      top: highlight.bottom + padding,
      zIndex: 10001,
    };
    // If would overflow bottom, show above
    if (highlight.bottom + padding + 260 > window.innerHeight) {
      tooltipStyle.top = Math.max(16, highlight.top - padding - 260);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[10000] transition-opacity duration-300"
        onClick={(e) => {
          if (e.target === overlayRef.current) finish();
        }}
        style={{
          background: "rgba(0,0,0,0.6)",
          // Cut out the highlighted element
          ...(highlight
            ? {
                clipPath: `polygon(
                  0% 0%, 0% 100%, 
                  ${highlight.left - 6}px 100%, 
                  ${highlight.left - 6}px ${highlight.top - 6}px, 
                  ${highlight.right + 6}px ${highlight.top - 6}px, 
                  ${highlight.right + 6}px ${highlight.bottom + 6}px, 
                  ${highlight.left - 6}px ${highlight.bottom + 6}px, 
                  ${highlight.left - 6}px 100%, 
                  100% 100%, 100% 0%
                )`,
              }
            : {}),
        }}
      />

      {/* Highlight ring */}
      {highlight && (
        <div
          className="fixed z-[10000] rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background pointer-events-none transition-all duration-300"
          style={{
            left: highlight.left - 6,
            top: highlight.top - 6,
            width: highlight.width + 12,
            height: highlight.height + 12,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className={`fixed z-[10001] w-[340px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-card shadow-2xl shadow-primary/10 p-5 transition-all duration-300 ${
          isCenter
            ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            : ""
        }`}
        style={isCenter ? {} : tooltipStyle}
      >
        {/* Close button */}
        <button
          onClick={finish}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close tour"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Icon + content */}
        <div className="flex items-start gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-sm leading-tight">{current.title}</h3>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              {current.description}
            </p>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step
                  ? "w-4 bg-primary"
                  : i < step
                  ? "w-1.5 bg-primary/40"
                  : "w-1.5 bg-muted-foreground/20"
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={prev} className="gap-1 text-xs">
                <ArrowLeft className="h-3 w-3" /> Back
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={finish} className="text-xs text-muted-foreground">
              Skip tour
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {current.action && (
              <Button variant="outline" size="sm" onClick={goToAction} className="text-xs gap-1">
                Go there <ArrowRight className="h-3 w-3" />
              </Button>
            )}
            <Button size="sm" onClick={next} className="gap-1 text-xs">
              {isLast ? "Finish" : "Next"} {!isLast && <ArrowRight className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Call this to reset and re-show the tour */
export function resetOnboardingTour() {
  localStorage.removeItem(TOUR_KEY);
}
