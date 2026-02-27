import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Terminal, Zap, Shield, Cpu } from "lucide-react";
import logo from "@/assets/privaclaw-icon.png";
import openclawImg from "@/assets/openclaw.png";
import claudecodeImg from "@/assets/claudecode.png";
import codexImg from "@/assets/codex.png";

// ── Terminal demo animation ──────────────────────────────────────────────────
type TermLine =
  | { kind: "cmd"; text: string }
  | { kind: "out"; text: string; color?: string }
  | { kind: "gap" };

const SCRIPT: TermLine[] = [
  { kind: "cmd", text: "ls -la src/" },
  { kind: "out", text: "drwxr-xr-x  components/" },
  { kind: "out", text: "drwxr-xr-x  pages/" },
  { kind: "out", text: "drwxr-xr-x  hooks/" },
  { kind: "out", text: "-rw-r--r--  App.tsx" },
  { kind: "out", text: "-rw-r--r--  main.tsx" },
  { kind: "gap" },
  { kind: "cmd", text: "git status" },
  { kind: "out", text: "On branch main", color: "#4ade80" },
  { kind: "out", text: "Changes not staged for commit:" },
  { kind: "out", text: "  modified:   src/pages/Chat.tsx", color: "#facc15" },
  { kind: "out", text: "  modified:   src/components/AppSidebar.tsx", color: "#facc15" },
  { kind: "gap" },
  { kind: "cmd", text: "npx vitest run" },
  { kind: "out", text: "✓ src/test/example.test.ts (3 tests)", color: "#4ade80" },
  { kind: "out", text: "  ✓ renders without crashing" },
  { kind: "out", text: "  ✓ handles empty state" },
  { kind: "out", text: "  ✓ validates input" },
  { kind: "out", text: "" },
  { kind: "out", text: "Test Files  1 passed (1)", color: "#4ade80" },
  { kind: "out", text: "     Tests  3 passed (3)", color: "#4ade80" },
];

// Delay (ms) between each visible step
const CMD_TYPE_DELAY = 42;   // per character while typing
const LINE_APPEAR_DELAY = 60; // between output lines
const CMD_PAUSE = 320;       // pause before output starts
const LOOP_PAUSE = 2800;     // pause before restart

function TerminalDemo() {
  // lines that are fully visible
  const [visibleLines, setVisibleLines] = useState<TermLine[]>([]);
  // the current command being typed (partial string)
  const [typingCmd, setTypingCmd] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

    async function run() {
      while (!cancelled) {
        setVisibleLines([]);
        setTypingCmd(null);

        for (const line of SCRIPT) {
          if (cancelled) return;

          if (line.kind === "gap") {
            setVisibleLines((p) => [...p, line]);
            await delay(LINE_APPEAR_DELAY);
            continue;
          }

          if (line.kind === "cmd") {
            setTypingCmd("");
            for (let i = 1; i <= line.text.length; i++) {
              if (cancelled) return;
              setTypingCmd(line.text.slice(0, i));
              await delay(CMD_TYPE_DELAY);
            }
            await delay(CMD_PAUSE);
            setTypingCmd(null);
            setVisibleLines((p) => [...p, line]);
            continue;
          }

          // output line
          setVisibleLines((p) => [...p, line]);
          await delay(LINE_APPEAR_DELAY);
        }

        await delay(LOOP_PAUSE);
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  // auto-scroll
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines, typingCmd]);

  return (
    <div
      className="w-full max-w-2xl mx-auto rounded-xl border border-border/30 overflow-hidden shadow-2xl"
      style={{ background: "hsl(0 0% 5%)" }}
    >
      {/* window chrome */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border/20 bg-card">
        <span className="w-3 h-3 rounded-full bg-border/60" />
        <span className="w-3 h-3 rounded-full bg-border/40" />
        <span className="w-3 h-3 rounded-full bg-border/20" />
        <span className="ml-3 text-xs text-muted-foreground/40 font-mono">privaclaw — bash — 80×24</span>
      </div>

      {/* terminal body */}
      <div
        ref={containerRef}
        className="px-4 py-3 h-64 overflow-hidden font-mono text-xs leading-5 select-none text-terminal-fg"
      >
        {visibleLines.map((line, i) => {
          if (line.kind === "gap") return <div key={i} className="h-2" />;
          if (line.kind === "cmd") return (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-status-online">❯</span>
              <span className="text-terminal-fg">{line.text}</span>
            </div>
          );
          return (
            <div
              key={i}
              className="pl-5"
              style={{ color: line.color ? `hsl(var(--terminal-green))` : "hsl(var(--terminal-dim-text))", paddingLeft: "1.25rem" }}
            >
              {line.text || "\u00A0"}
            </div>
          );
        })}

        {/* typing line */}
        {typingCmd !== null && (
          <div className="flex items-start gap-1.5">
            <span className="text-status-online">❯</span>
            <span className="text-terminal-fg">{typingCmd}</span>
            <span className="inline-block w-1.5 h-3.5 ml-px align-middle animate-[pulse_0.9s_ease-in-out_infinite] bg-terminal-fg opacity-80" />
          </div>
        )}
      </div>
    </div>
  );
}

const AGENTS = [
  {
    id: "openclaw" as const,
    name: "OpenClaw",
    tagline: "Local shell agent",
    desc: "Execute shell commands, browse files, and control your machine remotely from anywhere.",
    img: openclawImg,
    hex: "hsl(var(--foreground))",
    rgb: [140, 140, 140] as [number, number, number],
    prompts: ["List files in project", "Show git status", "Run test suite", "Check system resources"],
  },
  {
    id: "claude" as const,
    name: "Claude Code",
    tagline: "AI coding agent",
    desc: "Pair with Claude Code running on your device to write, debug, and refactor code at speed.",
    img: claudecodeImg,
    hex: "hsl(var(--foreground))",
    rgb: [140, 140, 140] as [number, number, number],
    prompts: ["Debug this error", "Write unit tests", "Refactor this file", "Explain the codebase"],
  },
  {
    id: "codex" as const,
    name: "Codex",
    tagline: "OpenAI reasoning agent",
    desc: "Harness OpenAI's o-series reasoning models to solve complex engineering problems step by step.",
    img: codexImg,
    hex: "hsl(var(--foreground))",
    rgb: [140, 140, 140] as [number, number, number],
    prompts: ["Fix this bug", "Refactor for clarity", "Generate unit tests", "Explain step by step"],
  },
];

const FEATURES = [
  {
    icon: Terminal,
    title: "Remote terminal",
    desc: "Full PTY terminal streamed securely to your browser over an encrypted WebSocket relay.",
  },
  {
    icon: Zap,
    title: "Background execution",
    desc: "Switch between conversations while tasks run. Return to results whenever you're ready.",
  },
  {
    icon: Shield,
    title: "Private by design",
    desc: "All traffic routes through your own connector. Your code and commands stay on your machine.",
  },
  {
    icon: Cpu,
    title: "Multi-agent",
    desc: "Switch seamlessly between OpenClaw, Claude Code, and Codex from a single interface.",
  },
];

export default function Landing() {
  const navigate = useNavigate();
  const [activeIdx, setActiveIdx] = useState(0);
  const agent = AGENTS[activeIdx];

  return (
    <div className="min-h-screen bg-background flex flex-col text-foreground">
      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 border-b border-border/30 backdrop-blur-md" style={{ background: "hsl(var(--background)/0.85)" }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <img src={logo} alt="PrivaClaw" className="h-6 w-6 rounded" />
            <span className="text-sm font-bold tracking-tight">PrivaClaw</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate("/auth")}>
              Sign in
            </Button>
            <Button size="sm" onClick={() => navigate("/auth")} className="gap-1.5 font-medium">
              Get started <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative flex flex-col items-center justify-center pt-16 pb-14 px-5 overflow-hidden">
        {/* ambient glow behind terminal */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full blur-3xl transition-all duration-700 bg-foreground/5" />

        <div className="relative z-10 flex flex-col items-center text-center max-w-2xl w-full">
          <h1 className="heading-display mb-3 text-center">
            Chat with your machine.<br />
            <span className="text-muted-foreground/60">From anywhere.</span>
          </h1>
          <p className="body-lg text-muted-foreground mb-8 max-w-xl text-center">
            PrivaClaw connects OpenClaw, Claude Code, and Codex to your local machine through a secure relay — giving you a private AI terminal in the browser.
          </p>

          {/* Terminal animation */}
          <div className="w-full mb-8 animate-fade-in">
            <TerminalDemo />
          </div>

          <div className="flex items-center gap-3">
            <Button size="lg" onClick={() => navigate("/auth")} className="gap-2 font-semibold px-6">
              Start for free <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/docs")} className="px-6 border-border/50 text-muted-foreground hover:text-foreground">
              View docs
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground/40">No credit card required · Works with your existing setup</p>
        </div>
      </section>

      {/* ── Agent tabs + live preview ── */}
      <section className="px-5 pb-20">
        <div className="max-w-2xl mx-auto">
          {/* Tab bar */}
          <div className="flex items-center justify-center gap-1 mb-6 p-1 rounded-xl border border-border/30 w-fit mx-auto" style={{ background: "hsl(var(--muted)/0.4)" }}>
            {AGENTS.map((a, i) => (
              <button
                key={a.id}
                onClick={() => setActiveIdx(i)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  i === activeIdx
                    ? "bg-card text-foreground shadow-sm border border-border/40"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <img src={a.img} alt={a.name} className="w-4 h-4 rounded object-cover" />
                <span className="hidden sm:inline">{a.name}</span>
              </button>
            ))}
          </div>

          {/* Preview card */}
          <div
            key={agent.id}
            className="rounded-2xl border border-border/30 overflow-hidden animate-fade-in"
            style={{ background: "hsl(var(--card))" }}
          >
            {/* Card header */}
            <div className="flex items-center gap-4 px-6 py-5 border-b border-border/20 bg-muted/10">
              <div className="relative shrink-0">
                <div className="absolute inset-0 rounded-2xl blur-lg bg-foreground/10" />
                <div className="relative w-12 h-12 rounded-2xl overflow-hidden bg-muted/40 border border-border/30 shadow-sm outline outline-1 outline-border/20">
                  <img src={agent.img} alt={agent.name} className="w-full h-full object-cover" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{agent.name}</span>
                  <span className="label-xs text-muted-foreground/60 px-2 py-0.5 rounded-full bg-muted/50 border border-border/30">
                    {agent.tagline}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed max-w-sm">{agent.desc}</p>
              </div>
            </div>

            {/* Prompt suggestions */}
            <div className="grid grid-cols-2 gap-2 p-4">
              {agent.prompts.map((p, i) => (
                <button
                  key={p}
                  onClick={() => navigate("/auth")}
                  className="animate-fade-in flex items-start gap-2.5 px-4 py-3.5 rounded-xl border border-border/30 hover:border-border/60 transition-all duration-200 text-left group"
                  style={{
                    animationDelay: `${i * 50}ms`,
                    animationFillMode: "both",
                    background: "hsl(var(--muted)/0.3)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 0 16px hsl(var(--foreground) / 0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "")}
                >
                  <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 transition-transform group-hover:translate-x-0.5 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors leading-snug">{p}</span>
                </button>
              ))}
            </div>

            {/* Locked composer */}
            <div className="px-4 pb-4">
              <div
                onClick={() => navigate("/auth")}
                className="flex items-center gap-3 rounded-xl border border-border/30 px-4 py-3 cursor-pointer hover:border-border/60 transition-all duration-200 group"
                style={{ background: "hsl(var(--muted)/0.3)" }}
                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 0 20px hsl(var(--foreground) / 0.05)")}
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "")}
              >
                <span className="flex-1 text-sm text-muted-foreground/40 select-none">Sign in to start chatting…</span>
                <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-muted/50 border border-border/30 transition-colors">
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="border-t border-border/20 px-5 py-16">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground/50 uppercase text-center mb-2">How it works</p>
          <h2 className="text-2xl font-bold tracking-tight text-center mb-10">Up and running in minutes</h2>

          <div className="relative flex flex-col sm:flex-row gap-8 sm:gap-4">
            {/* connector line (desktop only) */}
            <div
              className="hidden sm:block absolute top-7 left-[calc(16.66%+1rem)] right-[calc(16.66%+1rem)] h-px"
              style={{ background: "linear-gradient(to right, hsl(var(--border)/0.6), hsl(var(--border)/0.6))" }}
            />

            {[
              {
                n: "1",
                title: "Install the connector",
                desc: "Download the lightweight PrivaClaw connector binary and run it on any machine you want to control.",
              },
              {
                n: "2",
                title: "Pair your device",
                desc: "The connector displays a one-time pairing code. Enter it in the app to securely link your machine.",
              },
              {
                n: "3",
                title: "Start chatting",
                desc: "Pick an agent — OpenClaw, Claude Code, or Codex — and start sending commands from anywhere.",
              },
            ].map(({ n, title, desc }, i) => (
              <div
                key={n}
                className="relative flex-1 flex flex-col items-center text-center animate-fade-in"
                style={{ animationDelay: `${i * 120}ms`, animationFillMode: "both" }}
              >
                {/* number badge */}
                <div
                  className="relative z-10 w-14 h-14 rounded-full border border-border/40 flex items-center justify-center mb-4 text-lg font-bold"
                  style={{ background: "hsl(var(--card))" }}
                >
                  {n}
                </div>
                <p className="text-sm font-semibold mb-1">{title}</p>
                <p className="text-xs text-muted-foreground/70 leading-relaxed max-w-[180px]">{desc}</p>
              </div>
            ))}
          </div>

          <div className="flex justify-center mt-10">
            <Button size="sm" variant="outline" onClick={() => navigate("/docs")} className="gap-1.5 border-border/40 text-muted-foreground hover:text-foreground">
              Read the setup guide <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </section>
      <section className="border-t border-border/20 px-5 py-16">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground/50 uppercase text-center mb-8">Why PrivaClaw</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="flex gap-4 p-5 rounded-xl border border-border/20"
                style={{ background: "hsl(var(--card))" }}
              >
                <div className="shrink-0 w-8 h-8 rounded-lg border border-border/30 flex items-center justify-center" style={{ background: "hsl(var(--muted)/0.5)" }}>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold mb-1">{title}</p>
                  <p className="text-xs text-muted-foreground/70 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="px-5 py-16 border-t border-border/20">
        <div className="max-w-md mx-auto flex flex-col items-center text-center">
          <img src={logo} alt="PrivaClaw" className="h-10 w-10 rounded-xl mb-4" />
          <h2 className="text-2xl font-bold tracking-tight mb-2">Ready to connect?</h2>
          <p className="text-sm text-muted-foreground mb-6">Set up your connector, pair a device, and start chatting with your machine in minutes.</p>
          <Button size="lg" onClick={() => navigate("/auth")} className="gap-2 font-semibold px-8">
            Get started free <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/20 py-6">
        <div className="max-w-5xl mx-auto px-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={logo} alt="PrivaClaw" className="h-4 w-4 rounded" />
            <span className="text-xs text-muted-foreground/50 font-medium">PrivaClaw</span>
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground/40">
            <button onClick={() => navigate("/terms")} className="hover:text-muted-foreground transition-colors">Terms</button>
            <button onClick={() => navigate("/privacy")} className="hover:text-muted-foreground transition-colors">Privacy</button>
            <button onClick={() => navigate("/docs")} className="hover:text-muted-foreground transition-colors">Docs</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
