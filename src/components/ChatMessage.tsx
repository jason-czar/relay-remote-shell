import { cn } from "@/lib/utils";
import { Copy, Check, Terminal, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState, useEffect, useRef } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import openclawImg from "@/assets/openclaw.png";
import claudecodeImg from "@/assets/claudecode.png";
import codexImg from "@/assets/codex.png";

// Patch oneDark to use pure black background
const codeTheme = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    background: "hsl(0 0% 6%)",
    margin: 0,
  },
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    background: "hsl(0 0% 6%)",
  },
};

// ── Unified diff detection & renderer ────────────────────────────────────────

function looksLikeDiff(value: string): boolean {
  const lines = value.split("\n");
  const hasHunk = lines.some((l) => l.startsWith("@@") || l.startsWith("--- ") || l.startsWith("+++ "));
  const hasChanges = lines.some((l) => l.startsWith("+") || l.startsWith("-"));
  return hasHunk && hasChanges;
}

function DiffBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [blockHovered, setBlockHovered] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = value.split("\n");

  return (
    <div
      className="relative my-3 rounded-xl overflow-hidden border border-border/40"
      onMouseEnter={() => setBlockHovered(true)}
      onMouseLeave={() => setBlockHovered(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[hsl(0_0%_12%)] border-b border-border/40">
        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">diff</span>
      </div>
      {/* Floating copy */}
      <button
        onClick={handleCopy}
        className={cn(
          "absolute top-1.5 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded-md",
          "text-[10px] transition-all duration-150",
          "bg-[hsl(0_0%_14%)] border border-border/40",
          copied ? "text-primary opacity-100" : "text-muted-foreground/70 hover:text-foreground",
          blockHovered ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {copied ? (
          <><Check className="h-3 w-3" /><span>Copied</span></>
        ) : (
          <><Copy className="h-3 w-3" /><span>Copy</span></>
        )}
      </button>
      {/* Diff lines */}
      <div
        className="overflow-x-auto thinking-scroll bg-[hsl(0_0%_6%)] text-[13px] leading-[1.65]"
        style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
      >
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => {
              // File headers --- / +++
              if (line.startsWith("--- ") || line.startsWith("+++ ")) {
                return (
                  <tr key={i} className="bg-[hsl(220_20%_10%)]">
                    <td className="pl-3 pr-3 py-0 w-4 text-right text-muted-foreground/30 text-[11px] select-none border-r border-border/20" />
                    <td className="px-4 py-0 text-muted-foreground/70 whitespace-pre">{line}</td>
                  </tr>
                );
              }
              // Hunk header @@
              if (line.startsWith("@@")) {
                return (
                  <tr key={i} className="bg-[hsl(210_30%_10%)]">
                    <td className="pl-3 pr-3 py-0 w-4 text-right text-muted-foreground/30 text-[11px] select-none border-r border-[hsl(210_30%_16%)]" />
                    <td className="px-4 py-[1px] text-[hsl(200_70%_62%)] whitespace-pre">{line}</td>
                  </tr>
                );
              }
              // Added line
              if (line.startsWith("+")) {
                return (
                  <tr key={i} className="bg-[hsl(142_45%_7%)] hover:bg-[hsl(142_45%_10%)] transition-colors duration-75">
                    <td className="pl-3 pr-3 py-0 w-4 text-center text-[hsl(142_60%_38%)] text-[12px] font-bold select-none border-r border-[hsl(142_40%_13%)]">+</td>
                    <td className="px-4 py-0 text-[hsl(142_55%_70%)] whitespace-pre">{line.slice(1)}</td>
                  </tr>
                );
              }
              // Removed line
              if (line.startsWith("-")) {
                return (
                  <tr key={i} className="bg-[hsl(0_45%_8%)] hover:bg-[hsl(0_45%_11%)] transition-colors duration-75">
                    <td className="pl-3 pr-3 py-0 w-4 text-center text-[hsl(0_60%_48%)] text-[12px] font-bold select-none border-r border-[hsl(0_40%_15%)]">−</td>
                    <td className="px-4 py-0 text-[hsl(0_70%_68%)] whitespace-pre">{line.slice(1)}</td>
                  </tr>
                );
              }
              // Context line
              return (
                <tr key={i}>
                  <td className="pl-3 pr-3 py-0 w-4 text-right text-muted-foreground/20 text-[11px] select-none border-r border-border/20" />
                  <td className="px-4 py-0 text-muted-foreground/55 whitespace-pre">{line || " "}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Standard code block ───────────────────────────────────────────────────────

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  thinking?: boolean;
  streaming?: boolean;
  activityStatus?: "thinking" | "writing" | "running" | null;
  toolCalls?: string[];
  rawStdout?: string;
  thinkingContent?: string;
  thinkingDurationMs?: number;
  createdAt?: string;
  agent?: "openclaw" | "claude" | "codex";
  onRegenerate?: () => void;
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [blockHovered, setBlockHovered] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="relative my-3 rounded-xl overflow-hidden border border-border/40"
      onMouseEnter={() => setBlockHovered(true)}
      onMouseLeave={() => setBlockHovered(false)}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[hsl(0_0%_12%)] border-b border-border/40">
        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">
          {language || "code"}
        </span>
      </div>
      {/* Floating copy button */}
      <button
        onClick={handleCopy}
        className={cn(
          "absolute top-1.5 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded-md",
          "text-[10px] transition-all duration-150",
          "bg-[hsl(0_0%_14%)] border border-border/40",
          copied ? "text-primary opacity-100" : "text-muted-foreground/70 hover:text-foreground",
          blockHovered ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {copied ? (
          <><Check className="h-3 w-3" /><span>Copied</span></>
        ) : (
          <><Copy className="h-3 w-3" /><span>Copy</span></>
        )}
      </button>
      <SyntaxHighlighter
        style={codeTheme}
        language={language || "text"}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "14px 18px",
          fontSize: "13px",
          lineHeight: "1.6",
          overflowX: "auto",
          background: "hsl(0 0% 6%)",
        }}
        codeTagProps={{ style: { fontFamily: "'JetBrains Mono', monospace" } }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

export function ChatMessage({ role, content, thinking, streaming, activityStatus, toolCalls, rawStdout, thinkingContent, thinkingDurationMs, createdAt, agent, onRegenerate }: ChatMessageProps) {
  const [thinkingPanelEnabled, setThinkingPanelEnabled] = useState(() => {
    const v = localStorage.getItem("show-thinking-panel");
    return v === null ? true : v === "true";
  });
  useEffect(() => {
    const handler = (e: Event) => setThinkingPanelEnabled((e as CustomEvent<boolean>).detail);
    window.addEventListener("thinking-panel-change", handler);
    return () => window.removeEventListener("thinking-panel-change", handler);
  }, []);
  const isUser = role === "user";
  const agentImg = agent === "claude" ? claudecodeImg : agent === "codex" ? codexImg : openclawImg;
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);

  // Progress bar — ticks every 200ms, asymptotically approaches 95% over ~25s
  const AVG_DURATION_MS = 25_000;
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (!streaming) { setProgress(0); startTimeRef.current = null; return; }
    startTimeRef.current = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - (startTimeRef.current ?? Date.now());
      // Ease toward 95% — never reaches 100% until stream stops
      const p = 95 * (1 - Math.exp(-elapsed / AVG_DURATION_MS));
      setProgress(p);
    }, 200);
    return () => clearInterval(id);
  }, [streaming]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedTime = createdAt
    ? (() => {
        const d = new Date(createdAt);
        const now = new Date();
        const diff = (now.getTime() - d.getTime()) / 1000;
        if (diff < 60) return "just now";
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      })()
    : null;

  if (thinking) {
    return (
      <div className="flex items-start gap-3 mb-4 px-1">
        <span className="flex gap-1 items-center h-5 mt-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
              style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
            />
          ))}
        </span>
      </div>
    );
  }

  if (isUser) {
    // Parse out embedded <file> blocks from user message content
    const fileBlockRegex = /<file name="([^"]+)"(?:\s+type="([^"]+)")?(?:\s+encoding="([^"]+)")?>([^]*?)<\/file>/g;
    const imageAttachments: { name: string; type: string; src: string }[] = [];
    const textAttachments: { name: string; text: string }[] = [];
    const textContent = content.replace(fileBlockRegex, (_, name, type, encoding, body) => {
      if (encoding === "base64" && type?.startsWith("image/")) {
        imageAttachments.push({ name, type, src: `data:${type};base64,${body.trim()}` });
      } else if (encoding === "base64") {
        imageAttachments.push({ name, type: type ?? "file", src: "" });
      } else {
        textAttachments.push({ name, text: body.trim() });
      }
      return "";
    }).trim();

    return (
      <div className="flex flex-col items-end pt-5 px-1 gap-1.5 group animate-[slide-in-from-right_0.25s_cubic-bezier(0.22,1,0.36,1)_both]">
        {/* Image previews */}
        {imageAttachments.map((f) => f.src ? (
          <img
            key={f.name}
            src={f.src}
            alt={f.name}
            className="max-w-[60%] max-h-64 rounded-xl border border-white/10 object-cover shadow-md"
          />
        ) : (
          <div key={f.name} className="px-3 py-1.5 rounded-xl text-xs text-muted-foreground bg-muted/30 border border-border/40">
            📎 {f.name}
          </div>
        ))}
        {/* Text file chips */}
        {textAttachments.map((f) => (
          <div key={f.name} className="px-3 py-1.5 rounded-xl text-xs text-muted-foreground bg-muted/30 border border-border/40">
            📄 {f.name}
          </div>
        ))}
        {/* Text content bubble */}
        {textContent && (
          <div
            className="max-w-[88%] sm:max-w-[72%] rounded-[22px] px-4 py-2 text-[18px] leading-[1.35] break-words bg-[hsl(0,0%,14%)] text-foreground"
          >
            {textContent}
          </div>
        )}
        {formattedTime && (
          <span className="text-[10px] text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pr-0.5">
            {formattedTime}
          </span>
        )}
      </div>
    );
  }

  // Assistant — hover actions
  return (
    <div
      className="group flex items-start pt-5 pb-1 px-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[18px] md:text-[19px] leading-[1.45] text-foreground break-words pt-0.5">
          {/* Reasoning / thinking collapsible — Codex (with duration) and Claude Code (without) */}
          {thinkingPanelEnabled && thinkingContent && (() => {
            const firstLine = thinkingContent.split("\n").find((l) => l.trim()) ?? "";
            const preview = firstLine.length > 72 ? firstLine.slice(0, 72).trimEnd() + "…" : firstLine;
            const label = agent === "claude"
              ? "Thinking"
              : thinkingDurationMs !== undefined
                ? `Thought for ${(thinkingDurationMs / 1000).toFixed(1)}s`
                : "Thought for…";
            return (
              <div className="mb-4">
                <button
                  onClick={() => setThinkingOpen((v) => !v)}
                  className="group/btn flex items-center gap-2 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors duration-150 select-none w-full text-left"
                >
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                      thinkingOpen ? "rotate-0" : "-rotate-90"
                    )}
                  />
                  <span className="italic font-medium tracking-wide shrink-0">
                    {label}
                  </span>
                  {!thinkingOpen && preview && (
                    <span className="ml-1 font-mono not-italic text-muted-foreground/40 truncate min-w-0">
                      — {preview}
                    </span>
                  )}
                </button>
                {/* Animated expand using grid trick for true height animation */}
                <div
                  className={cn(
                    "grid transition-all duration-300 ease-in-out",
                    thinkingOpen ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0 mt-0"
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="border-l-2 border-primary/30 pl-3 py-0.5">
                      <div className="max-h-48 overflow-y-auto pr-1 thinking-scroll">
                        <p className="text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap font-mono italic">
                          {thinkingContent}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
          {streaming && !content && (
            <span className="inline-flex gap-1 items-center h-5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
                />
              ))}
            </span>
          )}
          {!streaming && !content && !thinkingContent && (
            <span className="italic text-muted-foreground/40 text-base">(empty response)</span>
          )}
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              code({ className, children }) {
                const match = /language-(\w+)/.exec(className || "");
                const value = String(children).replace(/\n$/, "");
                // Block code fence
                if (match || (className && className.includes("language-"))) {
                  const lang = match?.[1] ?? "";
                  // Route diff/patch (explicit or auto-detected) through the diff renderer
                  if (lang === "diff" || lang === "patch" || looksLikeDiff(value)) {
                    return <DiffBlock value={value} />;
                  }
                  return <CodeBlock language={lang} value={value} />;
                }
                // Inline code
                return (
                  <code className="bg-muted/60 rounded px-1.5 py-0.5 text-xs font-mono text-primary/90">
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => <>{children}</>,
              ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
              li: ({ children }) => <li>{children}</li>,
              h1: ({ children }) => <h1 className="font-semibold text-lg md:text-xl mb-1">{children}</h1>,
              h2: ({ children }) => <h2 className="font-semibold text-base md:text-[17px] mb-1">{children}</h2>,
              h3: ({ children }) => <h3 className="font-medium text-sm md:text-[15px] mb-1">{children}</h3>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-primary">
                  {children}
                </a>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
          {streaming && content && (
            <span
              className="inline-block w-0.5 h-3.5 ml-0.5 align-middle bg-primary rounded-full animate-pulse"
              style={{ animationDuration: "0.7s" }}
            />
          )}
          {/* Tool-call chips — animated while streaming, faded when done */}
          {toolCalls && toolCalls.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {toolCalls.map((name, i) => (
                <span
                  key={name}
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border select-none",
                    streaming || thinking
                      ? "bg-muted/60 text-muted-foreground/60 border-border/30 animate-chip-in"
                      : "bg-muted/30 text-muted-foreground/35 border-border/15"
                  )}
                  style={streaming || thinking ? { animationDelay: `${i * 40}ms` } : undefined}
                >
                  <span className={cn("w-1 h-1 rounded-full shrink-0", streaming || thinking ? "bg-primary/50" : "bg-muted-foreground/25")} />
                  {name}
                </span>
              ))}
            </div>
          )}
          {/* Streaming progress bar */}
          {streaming && (
            <div className="mt-2 h-[2px] w-full rounded-full overflow-hidden bg-border/30">
              <div
                className="h-full rounded-full bg-primary/40 transition-all duration-200 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {/* Activity status pill */}
          {(streaming || thinking) && activityStatus && (
            <div className="flex items-center gap-1.5 mt-2">
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1 h-1 rounded-full bg-muted-foreground/50 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
                  />
                ))}
              </span>
              <span className="text-[11px] text-muted-foreground/50 font-medium tracking-wide select-none">
                {activityStatus === "thinking"
                  ? "thinking…"
                  : activityStatus === "writing"
                  ? "writing…"
                  : toolCalls && toolCalls.length > 0
                  ? toolCalls[toolCalls.length - 1]
                  : "running…"}
              </span>
            </div>
          )}
        </div>

        {/* Hover action bar */}
        <div className="flex items-center gap-0.5 mt-1.5">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Copy"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-status-online" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="text-[11px]">{copied ? "Copied" : "Copy"}</span>
          </button>
          <button
            onClick={() => setDebugOpen((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Terminal output"
          >
            <Terminal className="h-3.5 w-3.5" />
            <span className="text-[11px]">Terminal</span>
            {debugOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Regenerate"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="text-[11px]">Regenerate</span>
            </button>
          )}
          {formattedTime && (
            <span className="ml-1 text-[10px] text-muted-foreground/40 select-none">
              {formattedTime}
            </span>
          )}
        </div>

        {/* Debug panel */}
        {debugOpen && (
          <div
            className="mt-2 rounded-lg border border-border/50 overflow-hidden text-xs font-mono bg-terminal-bg/80 backdrop-blur-sm"
          >
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/30 text-muted-foreground">
              <Terminal className="h-3 w-3" />
              <span className="text-[11px] font-sans">raw stdout from relay</span>
            </div>
            {rawStdout ? (
              <pre className="p-3 whitespace-pre-wrap break-all leading-relaxed text-primary/80 max-h-64 overflow-y-auto thinking-scroll">
                {rawStdout}
              </pre>
            ) : (
              <p className="p-3 text-[11px] text-muted-foreground/50 font-sans">No terminal output for this message.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
