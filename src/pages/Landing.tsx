import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import logo from "@/assets/logo.png";

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

export default function Landing() {
  const navigate = useNavigate();
  const [activeAgent, setActiveAgent] = useState<keyof typeof PROMPTS>("OpenClaw");

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

      {/* Agent tabs — visual only */}
      <div className="border-b border-border/40">
        <div className="max-w-2xl mx-auto flex items-center px-4">
          {AGENT_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveAgent(tab as keyof typeof PROMPTS)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === activeAgent
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main empty-state preview */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {/* Icon */}
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-3xl bg-primary/20 blur-xl scale-110" />
          <div
            className="relative w-24 h-24 rounded-3xl flex items-center justify-center ring-1 ring-primary/30"
            style={{
              background: "linear-gradient(135deg, hsl(var(--primary) / 0.18) 0%, hsl(var(--primary) / 0.08) 100%)",
              boxShadow: "0 8px 32px hsl(var(--primary) / 0.25), inset 0 1px 0 rgba(255,255,255,0.12)",
            }}
          >
            <span className="text-5xl">{activeAgent === "OpenClaw" ? "🐾" : "⌨️"}</span>
          </div>
        </div>

        <h2 className="text-xl font-semibold text-foreground mb-2">{activeAgent === "OpenClaw" ? "OpenClaw Agent" : "Claude Code"}</h2>
        <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed mb-8">
          {activeAgent === "OpenClaw"
            ? "Ask your local OpenClaw agent anything. Commands run on your selected device."
            : "Send prompts directly to Claude Code running on your device."}
        </p>

        {/* Prompt suggestion cards */}
        <div className="grid grid-cols-2 gap-2.5 w-full max-w-lg mx-auto mb-8">
          {PROMPTS[activeAgent].map(({ title, desc }) => (
            <button
              key={title}
              onClick={() => navigate("/auth")}
              className="group flex flex-col gap-2 px-5 py-4 rounded-xl border border-border/40 bg-card/40 hover:bg-card/80 hover:border-border/80 transition-all duration-200 text-left"
              onMouseEnter={e =>
                (e.currentTarget.style.boxShadow = "0 0 18px 2px hsl(var(--primary) / 0.08), 0 2px 12px rgba(0,0,0,0.15)")
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
  );
}
