import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import logo from "@/assets/logo.png";
import openclawImg from "@/assets/openclaw.png";
import claudecodeImg from "@/assets/claudecode.png";

const AGENT_TABS = ["OpenClaw", "Claude Code"] as const;

const PROMPTS = {
  OpenClaw: [
    { title: "List files", desc: "List all files in the current directory" },
    { title: "Search code", desc: "Search for TODO comments in the codebase" },
    { title: "System info", desc: "Show system info: OS, CPU, memory usage" },
    { title: "Git status", desc: "Show the current git status and recent commits" },
  ],
  "Claude Code": [
    { title: "Debug code", desc: "Help me debug an issue in my code" },
    { title: "Write tests", desc: "Write unit tests for the current file" },
    { title: "Refactor", desc: "Refactor this code to be cleaner and more readable" },
    { title: "Explain code", desc: "Explain what this code does" },
  ],
};

const TILE_COLORS = {
  OpenClaw: { hex: "#DA5048", rgb: [218, 80, 72] as [number, number, number] },
  "Claude Code": { hex: "#D37551", rgb: [211, 117, 81] as [number, number, number] },
};

export default function Landing() {
  const navigate = useNavigate();
  const [activeAgent, setActiveAgent] = useState<keyof typeof PROMPTS>("OpenClaw");
  const { hex, rgb } = TILE_COLORS[activeAgent];
  const [r, g, b] = rgb;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <nav className="border-b border-border/40">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <img src={logo} alt="PrivaClaw" className="h-6 w-6 rounded" />
            <span className="text-sm font-bold tracking-tight">PrivaClaw</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")}>
              Sign in
            </Button>
            <Button size="sm" onClick={() => navigate("/auth")} className="gap-1.5">
              Get Started <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Agent tabs */}
      <div className="border-b border-border/40">
        <div className="max-w-2xl mx-auto flex items-center justify-center px-4">
          {AGENT_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveAgent(tab as keyof typeof PROMPTS)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === activeAgent
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <img
                src={tab === "OpenClaw" ? openclawImg : claudecodeImg}
                alt={tab}
                className="w-4 h-4 rounded object-cover"
              />
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main empty-state preview */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div key={activeAgent} className="flex flex-col items-center w-full animate-fade-in">
          {/* Icon tile */}
          <div className="relative mb-6">
            <div className="absolute inset-0 rounded-3xl blur-xl scale-110" style={{ background: hex, opacity: 0.3 }} />
            <div
              className="relative w-24 h-24 rounded-3xl overflow-hidden"
              style={{
                background: `linear-gradient(135deg, rgba(${r},${g},${b},0.35) 0%, rgba(${r},${g},${b},0.15) 100%)`,
                boxShadow: `0 8px 32px rgba(${r},${g},${b},0.35), inset 0 1px 0 rgba(255,255,255,0.12)`,
                outline: `1px solid rgba(${r},${g},${b},0.3)`,
              }}
            >
              <img
                src={activeAgent === "OpenClaw" ? openclawImg : claudecodeImg}
                alt={activeAgent}
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          <h2 className="text-xl font-semibold text-foreground mb-2">
            {activeAgent === "OpenClaw" ? "OpenClaw Agent" : "Claude Code"}
          </h2>
          <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed mb-8">
            {activeAgent === "OpenClaw"
              ? "Ask your local OpenClaw agent anything. Commands run on your selected device."
              : "Send prompts directly to Claude Code running on your device."}
          </p>

          {/* Prompt suggestion cards */}
          <div className="grid grid-cols-2 gap-2.5 w-full max-w-lg mx-auto mb-8">
            {PROMPTS[activeAgent].map(({ title, desc }, i) => (
              <button
                key={title}
                onClick={() => navigate("/auth")}
                className="animate-fade-in group flex flex-col gap-2 px-5 py-4 rounded-xl border border-border/40 bg-card/40 hover:bg-card/80 hover:border-border/80 transition-all duration-200 text-left"
                style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
                onMouseEnter={e =>
                  (e.currentTarget.style.boxShadow = `0 0 18px 2px rgba(${r},${g},${b},0.12), 0 2px 12px rgba(0,0,0,0.15)`)
                }
                onMouseLeave={e => (e.currentTarget.style.boxShadow = "")}
              >
                <span className="text-xs font-semibold text-foreground">{title}</span>
                <span className="text-xs text-muted-foreground/80 leading-snug">{desc}</span>
              </button>
            ))}
          </div>

          {/* Input bar (locked) */}
          <div className="w-full max-w-lg relative" onClick={() => navigate("/auth")}>
            <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-card/40 px-4 py-3 cursor-pointer hover:border-border/80 hover:bg-card/60 transition-all duration-200 group">
              <span className="flex-1 text-sm text-muted-foreground/50 select-none">
                Sign in to start chatting…
              </span>
              <div className="shrink-0 w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
                <ArrowRight className="h-3.5 w-3.5 text-primary/70" />
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs text-muted-foreground/50">
            Free to get started · No credit card required
          </p>
        </div>
      </div>

      <footer className="border-t border-border/40 py-6">
        <div className="max-w-2xl mx-auto px-4 flex gap-4 text-xs text-muted-foreground/50">
          <button onClick={() => navigate("/terms")} className="hover:text-muted-foreground transition-colors">Terms of Service</button>
          <button onClick={() => navigate("/privacy")} className="hover:text-muted-foreground transition-colors">Privacy Policy</button>
        </div>
      </footer>
    </div>
  );
}