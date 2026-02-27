import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Terminal, Zap, Shield, Cpu } from "lucide-react";
import logo from "@/assets/privaclaw-icon.png";
import openclawImg from "@/assets/openclaw.png";
import claudecodeImg from "@/assets/claudecode.png";
import codexImg from "@/assets/codex.png";
import terminalIcon from "@/assets/terminal-icon.png";
import codexIcon from "@/assets/codex-icon.png";
import openclawIcon from "@/assets/openclaw-icon.png";
import claudecodeIcon from "@/assets/claudecode-icon.png";

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

// ── Agent preview mock data ──────────────────────────────────────────────────
type AgentId = "openclaw" | "claudecode" | "codex" | "terminal";

const AGENT_PREVIEWS: Record<AgentId, { label: string; messages: { role: "user" | "assistant"; text: string }[]; color: string }> = {
  openclaw: {
    label: "OpenClaw",
    color: "text-red-400",
    messages: [
      { role: "user", text: "Refactor the auth module to use JWTs" },
      { role: "assistant", text: "Sure! I'll start by auditing the current session-based flow, then migrate to JWT issuance on login and stateless verification middleware.\n\n`src/auth/index.ts` → generating tokens with `jose`\n`src/middleware/auth.ts` → verifying on each request\n\nShall I also handle token refresh?" },
      { role: "user", text: "Yes, add refresh token rotation too" },
      { role: "assistant", text: "Done. Refresh tokens are stored in an HttpOnly cookie and rotated on each use. Old tokens are invalidated immediately to prevent replay attacks." },
    ],
  },
  claudecode: {
    label: "Claude Code",
    color: "text-amber-400",
    messages: [
      { role: "user", text: "Write tests for the UserService class" },
      { role: "assistant", text: "I'll write comprehensive unit tests covering the happy path, edge cases, and error conditions.\n\n```ts\ndescribe('UserService', () => {\n  it('creates a user with hashed password', async () => {\n    const user = await UserService.create({ email: 'a@b.com', password: 'secret' });\n    expect(user.passwordHash).not.toBe('secret');\n  });\n});\n```\n\nRunning `npx vitest`… ✓ 12 tests passed" },
      { role: "user", text: "Add a test for duplicate email handling" },
      { role: "assistant", text: "Added. The test expects a `ConflictError` when inserting an email that already exists — and it passes ✓" },
    ],
  },
  codex: {
    label: "Codex",
    color: "text-blue-400",
    messages: [
      { role: "user", text: "Build a REST endpoint for file uploads" },
      { role: "assistant", text: "I'll scaffold a `POST /upload` endpoint using `multer` for multipart parsing, validate MIME type and file size, and store to S3-compatible storage.\n\n*Thinking… (4.2s)*\n\n`routes/upload.ts` created\n`middleware/fileValidator.ts` created\n\nEndpoint is ready. Max 10 MB, images and PDFs only." },
      { role: "user", text: "Add virus scanning before storing" },
      { role: "assistant", text: "Integrated ClamAV via `clamscan`. Files are scanned in a temp dir before being moved to storage. Infected files are rejected with a 422 and logged." },
    ],
  },
  terminal: {
    label: "Terminal",
    color: "text-green-400",
    messages: [
      { role: "user", text: "git status" },
      { role: "assistant", text: "On branch main\nChanges not staged for commit:\n  modified:   src/pages/Chat.tsx\n  modified:   src/components/AppSidebar.tsx" },
      { role: "user", text: "npx vitest run" },
      { role: "assistant", text: "✓ src/test/example.test.ts (3 tests)\n  ✓ renders without crashing\n  ✓ handles empty state\n  ✓ validates input\n\nTest Files  1 passed (1)\nTests       3 passed (3)" },
    ],
  },
};

function AgentPreview() {
  const [active, setActive] = useState<AgentId>("openclaw");
  const [visibleCount, setVisibleCount] = useState(0);
  const preview = AGENT_PREVIEWS[active];

  useEffect(() => {
    setVisibleCount(0);
    const msgs = AGENT_PREVIEWS[active].messages;
    let i = 0;
    const tick = () => {
      i++;
      setVisibleCount(i);
      if (i < msgs.length) setTimeout(tick, 600);
    };
    const t = setTimeout(tick, 300);
    return () => clearTimeout(t);
  }, [active]);

  const tabs: { id: AgentId; label: string; img: string }[] = [
    { id: "openclaw",   label: "OpenClaw",    img: openclawIcon },
    { id: "claudecode", label: "Claude Code", img: claudecodeIcon },
    { id: "codex",      label: "Codex",       img: codexIcon },
    { id: "terminal",   label: "Terminal",    img: terminalIcon },
  ];

  return (
    <div className="w-full max-w-3xl mx-auto rounded-2xl border border-border/40 bg-card/60 backdrop-blur-sm shadow-2xl overflow-hidden">
      {/* Window chrome */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border/30 bg-muted/30">
        <span className="w-3 h-3 rounded-full bg-destructive/50" />
        <span className="w-3 h-3 rounded-full bg-muted-foreground/40" />
        <span className="w-3 h-3 rounded-full bg-muted-foreground/20" />
        <span className="ml-3 text-xs text-muted-foreground font-mono">privaclaw — {preview.label.toLowerCase()}</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/30 bg-muted/20">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
              active === tab.id
                ? "border-primary text-foreground bg-background/40"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
            }`}
          >
            <img src={tab.img} alt={tab.label} className={`w-4 h-4 rounded-md transition-opacity ${active === tab.id ? "opacity-100" : "opacity-50"}`} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex flex-col gap-4 p-5 min-h-[260px] font-mono">
        {preview.messages.slice(0, visibleCount).map((msg, i) => (
          <div key={`${active}-${i}`} className={`flex gap-3 animate-fade-in ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <span className={`shrink-0 mt-1 text-sm font-bold ${preview.color}`}>&gt;</span>
            )}
            <div
              className={`max-w-[85%] px-4 py-2.5 rounded-xl text-[0.8rem] leading-[1.6] whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-primary/15 text-foreground rounded-br-sm"
                  : "bg-muted/50 text-foreground/80 rounded-bl-sm"
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {visibleCount < preview.messages.length && (
          <div className="flex gap-1 px-1 mt-1">
            {[0,1,2].map(i => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
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
      <section className="relative flex flex-col items-center justify-center pt-16 pb-14 px-5">
        {/* App icons row */}
        <div className="relative z-10 flex items-center justify-center gap-5 mb-10">
          {[
            { src: openclawIcon, alt: "OpenClaw" },
            { src: claudecodeIcon, alt: "Claude Code" },
            { src: codexIcon, alt: "Codex" },
            { src: terminalIcon, alt: "Terminal" },
          ].map(({ src, alt }, i) => (
            <img
              key={alt}
              src={src}
              alt={alt}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl shadow-lg transition-transform duration-200 hover:scale-110 cursor-default opacity-0 animate-fade-in"
              style={{ animationDelay: `${i * 100}ms`, animationFillMode: "forwards" }}
            />
          ))}
        </div>
        {/* ambient glow */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full blur-3xl transition-all duration-700 bg-foreground/5" />

        <div className="relative z-10 flex flex-col items-center text-center max-w-3xl w-full">

          {/* Category badge */}
          <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full border border-border/40 text-xs text-muted-foreground/70 font-medium" style={{ background: "hsl(var(--muted)/0.4)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 inline-block" />
            Access your home machine from anywhere
          </div>

          <h1 className="heading-display mb-4 text-center">
            Your home computer.<br />
            <span className="text-muted-foreground/55">In your browser.</span>
          </h1>

          {/* Core value prop */}
          <p className="body-lg text-muted-foreground mb-3 max-w-2xl text-center">
            PrivaClaw lets you access the <strong className="text-foreground/80">terminal</strong>, <strong className="text-foreground/80">OpenClaw</strong>, <strong className="text-foreground/80">Claude Code</strong>, and <strong className="text-foreground/80">Codex</strong> running on your home computer — from any device, anywhere in the world.
          </p>
          <p className="text-sm text-muted-foreground/60 mb-7 max-w-lg text-center">
            No port forwarding. No public IP. Just install the connector on your machine, pair it once, and everything runs on <em>your</em> hardware while you chat from your phone, tablet, or laptop.
          </p>

          {/* Key capabilities pills */}
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {[
              "🏠 Runs on your hardware",
              "🔒 No port forwarding needed",
              "🖥️ Full terminal access",
              "🤖 OpenClaw · Claude Code · Codex",
              "📱 Any device, anywhere",
            ].map((pill) => (
              <span
                key={pill}
                className="px-3 py-1 rounded-full text-xs text-muted-foreground/70 border border-border/30"
                style={{ background: "hsl(var(--muted)/0.3)" }}
              >
                {pill}
              </span>
            ))}
          </div>

          {/* Agent preview */}
          <div className="w-full mb-8 animate-fade-in">
            <AgentPreview />
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
        <div className="max-w-4xl mx-auto">
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
        <div className="max-w-4xl mx-auto">
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
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground/50 uppercase text-center mb-8">Why PrivaClaw</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
