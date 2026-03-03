import { cn } from "@/lib/utils";
import { Copy, Check, Terminal, ChevronDown, ChevronRight, RefreshCw, RotateCcw, FileEdit, FileSearch, Wrench, Brain, Reply, Zap, CheckCircle2, XCircle, Loader2 } from "lucide-react";

export const EMPTY_RESPONSE_TEXT = "No response was received from the device. Try rephrasing your message, or check that the device is connected and the agent is running.";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState, useEffect, useRef } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import openclawImg from "@/assets/openclaw.png";
import claudecodeImg from "@/assets/claudecode.png";
import codexImg from "@/assets/codex.png";

export type LiveLogEntry = {
  type: "tool" | "bash" | "write" | "read" | "think" | "info" | "error" | "output" | "tool_call";
  label: string;
  detail?: string;
  /** Structured tool call data for type=tool_call */
  toolCallData?: {
    id?: string;
    name: string;
    input?: Record<string, unknown>;
    result?: string;
    isError?: boolean;
    startedAt?: number;   // Date.now() when tool_use was received
    durationMs?: number;  // set when tool_result is received
  };
};

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

// ── Result panel with copy button ────────────────────────────────────────────

function ResultPanel({ result, isError, hasBorder }: { result: string; isError: boolean; hasBorder: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className={cn("px-3 py-2 relative group", hasBorder && "border-t border-border/20")}>
      <div className="flex items-center justify-between mb-1">
        <div className={cn(
          "text-[9px] uppercase tracking-widest",
          isError ? "text-destructive/60" : "text-muted-foreground/40"
        )}>
          {isError ? "Error" : "Result"}
        </div>
        <button
          onClick={handleCopy}
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono transition-all duration-150",
            "opacity-0 group-hover:opacity-100",
            copied
              ? "text-primary bg-primary/10"
              : "text-muted-foreground/50 hover:text-muted-foreground bg-white/5 hover:bg-white/10"
          )}
        >
          {copied ? <><Check className="h-2.5 w-2.5" />Copied</> : <><Copy className="h-2.5 w-2.5" />Copy</>}
        </button>
      </div>
      <pre
        className={cn(
          "font-mono text-[11px] whitespace-pre-wrap break-all overflow-x-auto thinking-scroll max-h-48",
          isError ? "text-destructive/80" : "text-muted-foreground/70"
        )}
        style={{ lineHeight: 1.5 }}
      >
        {result}
      </pre>
    </div>
  );
}

// ── Tool call card ────────────────────────────────────────────────────────────

function ToolCallCard({ entry, isLast, agentColor, forceOpen }: {
  entry: LiveLogEntry;
  isLast: boolean;
  agentColor: string;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const effectiveOpen = forceOpen !== undefined ? forceOpen : open;
  const data = entry.toolCallData;
  const inProgress = data != null && data.startedAt !== undefined && data.durationMs === undefined;
  const [elapsed, setElapsed] = useState<number>(
    inProgress && data?.startedAt ? Date.now() - data.startedAt : 0
  );

  useEffect(() => {
    if (!inProgress || !data?.startedAt) return;
    const id = setInterval(() => setElapsed(Date.now() - data.startedAt!), 100);
    return () => clearInterval(id);
  }, [inProgress, data?.startedAt]);

  if (!data) return null;

  const hasInput = data.input && Object.keys(data.input).length > 0;
  const hasResult = typeof data.result === "string";
  const isComplete = hasResult;

  // Pretty-print JSON input
  const inputStr = hasInput ? JSON.stringify(data.input, null, 2) : null;

  // Truncate result for preview
  const resultPreview = data.result
    ? data.result.length > 120 ? data.result.slice(0, 120) + "…" : data.result
    : null;

  // Format duration — finalised or live elapsed
  const formatMs = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  const durationLabel = data.durationMs !== undefined
    ? formatMs(data.durationMs)
    : inProgress && elapsed > 0
      ? formatMs(elapsed)
      : null;

  return (
    <div
      className={cn(
        "mx-3 my-1 rounded-lg border overflow-hidden transition-opacity duration-200",
        isLast ? "opacity-100" : "opacity-50",
        data.isError ? "border-destructive/30" : "border-border/30"
      )}
      style={{ background: "hsl(0 0% 7%)" }}
    >
      {/* Header row — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 transition-colors"
      >
        {/* Status icon */}
        <span className="shrink-0">
          {isComplete
            ? data.isError
              ? <XCircle className="h-3 w-3 text-destructive" />
              : <CheckCircle2 className="h-3 w-3 text-[hsl(142_60%_45%)]" />
            : <Zap className="h-3 w-3 animate-pulse" style={{ color: agentColor }} />
          }
        </span>
        {/* Tool name */}
        <span className="font-mono text-[11px] font-semibold shrink-0 flex items-center gap-1.5" style={{ color: agentColor }}>
          {inProgress && (
            <Loader2 className="h-3 w-3 animate-spin opacity-70" />
          )}
          {data.name}
        </span>
        {/* Input preview */}
        {inputStr && !effectiveOpen && (
          <span className="font-mono text-[10px] text-muted-foreground/50 truncate min-w-0">
            {inputStr.replace(/\n\s+/g, " ").slice(0, 80)}
          </span>
        )}
        <span className="ml-auto shrink-0 flex items-center gap-1.5 text-muted-foreground/40">
          {durationLabel && (
            <span className={cn(
              "text-[9px] font-mono tabular-nums px-1 py-0.5 rounded transition-colors",
              inProgress
                ? "text-primary/80 bg-primary/10 animate-pulse"
                : data.isError
                  ? "text-destructive/70 bg-destructive/10"
                  : "text-muted-foreground/50 bg-white/5"
            )}>
              {durationLabel}
            </span>
          )}
          {effectiveOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>

      {/* Expanded detail */}
      {effectiveOpen && (
        <div className="border-t border-border/20">
          {/* Input */}
          {inputStr && (
            <div className="px-3 py-2">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground/40 mb-1">Input</div>
              <SyntaxHighlighter
                style={codeTheme}
                language="json"
                PreTag="div"
                customStyle={{
                  margin: 0,
                  padding: "8px 10px",
                  fontSize: "11px",
                  lineHeight: "1.55",
                  maxHeight: "192px",
                  overflowY: "auto",
                  background: "hsl(0 0% 6%)",
                  borderRadius: "6px",
                }}
                codeTagProps={{ style: { fontFamily: "'JetBrains Mono', monospace" } }}
              >
                {inputStr}
              </SyntaxHighlighter>
            </div>
          )}
          {/* Result */}
          {hasResult && (
            <ResultPanel result={data.result!} isError={!!data.isError} hasBorder={!!inputStr} />
          )}
          {/* Result preview when not expanded input */}
          {!hasResult && resultPreview && (
            <div className="px-3 py-2 border-t border-border/20">
              <span className="font-mono text-[11px] text-muted-foreground/50 italic">{resultPreview}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Completed tool calls section ─────────────────────────────────────────────

function CompletedToolCallsSection({ entries, agent }: {
  entries: LiveLogEntry[];
  agent?: string;
}) {
  const [allOpen, setAllOpen] = useState(false);

  const agentColor =
    agent === "claude" ? "hsl(180 60% 45%)" :
    agent === "codex"  ? "hsl(220 80% 65%)" :
                         "hsl(280 65% 65%)";
  const totalMs = entries.reduce((sum, e) => sum + (e.toolCallData?.durationMs ?? 0), 0);
  const finishedCount = entries.filter(e => e.toolCallData?.durationMs !== undefined).length;
  const totalLabel = totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`;

  return (
    <div className="mt-3 space-y-1">
      {entries.map((entry, i) => (
        <ToolCallCard
          key={i}
          entry={entry}
          isLast={false}
          agentColor={agentColor}
          forceOpen={allOpen ? true : undefined}
        />
      ))}
      {finishedCount > 0 && (
        <div className="flex items-center gap-2 pt-1.5 px-3">
          <button
            onClick={() => setAllOpen(v => !v)}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-full border transition-colors",
              allOpen
                ? "border-border/40 bg-white/[0.06] text-muted-foreground/70 hover:bg-white/[0.09]"
                : "border-border/20 bg-white/[0.03] text-muted-foreground/50 hover:bg-white/[0.06] hover:border-border/30"
            )}
            title={allOpen ? "Collapse all tool cards" : "Expand all tool cards"}
          >
            <CheckCircle2 className="h-2.5 w-2.5 text-muted-foreground/30" />
            <span className="text-[9px] font-mono">
              {finishedCount} tool{finishedCount !== 1 ? "s" : ""}
            </span>
            <span className="text-muted-foreground/20 text-[9px]">·</span>
            <span className="text-[9px] font-mono tabular-nums font-semibold">
              {totalLabel} total
            </span>
            {allOpen
              ? <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/40" />
              : <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/40" />
            }
          </button>
        </div>
      )}
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
  onOptionSelect?: (option: string) => void;
  liveLog?: LiveLogEntry[];
  completedToolCalls?: LiveLogEntry[];
}

// ── Question/option extraction ────────────────────────────────────────────────

/**
 * Detects if an assistant message is asking a question with selectable options.
 * Returns an array of option strings, or empty array if none detected.
 */
function extractInteractiveOptions(content: string): string[] {
  let options: string[] = [];

  // Pattern 1: numbered list items like "1. Yes" / "1) Approve"
  const numberedMatches = content.matchAll(/^\s*(?:\d+[.)]\s+)(.+)$/gm);
  for (const m of numberedMatches) {
    const opt = m[1].trim();
    if (opt.length > 0 && opt.length < 120) options.push(opt);
  }
  if (options.length >= 2) return options;

  // Pattern 2: lettered list items like "a. Yes" / "b) No"
  options = [];
  const letteredMatches = content.matchAll(/^\s*[a-zA-Z][.)]\s+(.+)$/gm);
  for (const m of letteredMatches) {
    const opt = m[1].trim();
    if (opt.length > 0 && opt.length < 120) options.push(opt);
  }
  if (options.length >= 2) return options;

  // Pattern 3: inline parenthesised options after a question mark
  // e.g. "Should I proceed? (yes/no)" or "Which one? (approve / deny / skip)"
  const parenAfterQ = content.match(/\?\s*\(([^)]{2,80})\)\s*$/m);
  if (parenAfterQ) {
    const inner = parenAfterQ[1];
    // Split on / or comma
    const parts = inner.split(/[\/,]/).map(s => s.trim()).filter(s => s.length > 0 && s.length < 60);
    if (parts.length >= 2) return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1));
  }

  // Pattern 4: approval-style yes/no/approve/deny keywords asked inline
  // e.g. "Do you want to proceed? (yes/no)" or "Approve or deny?"
  // Also matches sentences containing "approve" without ? (e.g. "needs your explicit approval")
  const approvalLine = content.split("\n").find(
    (line) => /\b(yes|no|approve|deny|allow|reject|proceed|cancel|continue|skip|abort|confirm|decline)\b/i.test(line) && (/[/?]/.test(line) || /\b(approv|explicit approval|approve the|allow the|deny the|reject the|confirm the)\b/i.test(line))
  );
  if (approvalLine) {
    const kws = [...new Set([...approvalLine.matchAll(/\b(yes|no|approve|deny|allow|reject|proceed|cancel|continue|skip|abort|confirm|decline)\b/gi)].map(m => {
      const w = m[1];
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }))];
    if (kws.length >= 2) return kws;
    // If only one keyword found (e.g. just "approve"), provide a default Approve/Deny pair
    if (kws.length === 1 || /\b(approv|explicit approval)\b/i.test(approvalLine)) {
      return ["Approve", "Deny"];
    }
  }

  // Pattern 4b: message contains "approve" or "allow" + "tool"/"command"/"action" — always show Approve/Deny
  if (/\b(approve|allow)\b.{0,60}\b(tool|command|action|operation|request)\b/i.test(content) ||
      /\b(tool|command|action|operation|request)\b.{0,60}\b(approve|allow|approval)\b/i.test(content)) {
    return ["Approve", "Deny"];
  }

  // Pattern 5: markdown bold options — **Yes** or **No** anywhere in the message
  // Works for "Would you like to **Approve** or **Deny** this?" style
  options = [];
  const boldMatches = content.matchAll(/\*\*([^*]{1,60})\*\*/g);
  for (const m of boldMatches) {
    const opt = m[1].trim();
    // Only treat as an option if it's a short word/phrase (not a heading or emphasis)
    if (opt.length > 0 && opt.length < 50 && !/[.!]$/.test(opt)) options.push(opt);
  }
  // Only surface bold options if the message contains a question mark (it's asking something)
  if (options.length >= 2 && content.includes("?")) return options;

  // Pattern 6: explicit "options:" / "choices:" header followed by dash list items
  options = [];
  if (/^\s*(?:options?|choices?)\s*:/im.test(content)) {
    const dashMatches = content.matchAll(/^\s*[-•*]\s+(.+)$/gm);
    for (const m of dashMatches) {
      const opt = m[1].trim();
      if (opt.length > 0 && opt.length < 120) options.push(opt);
    }
    if (options.length >= 2) return options;
  }

  return [];
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

export function ChatMessage({ role, content, thinking, streaming, activityStatus, toolCalls, rawStdout, thinkingContent, thinkingDurationMs, createdAt, agent, onRegenerate, onOptionSelect, liveLog, completedToolCalls }: ChatMessageProps) {
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
  const [copiedUser, setCopiedUser] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);

  // Progress bar — ticks every 200ms, asymptotically approaches 95% over ~25s
  const AVG_DURATION_MS = 25_000;
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  // Elapsed seconds while waiting (thinking=true, no content yet)
  const [waitElapsed, setWaitElapsed] = useState(0);
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (thinking) {
      setWaitElapsed(0);
      waitTimerRef.current = setInterval(() => setWaitElapsed((s) => s + 1), 1000);
    } else {
      setWaitElapsed(0);
      if (waitTimerRef.current) { clearInterval(waitTimerRef.current); waitTimerRef.current = null; }
    }
    return () => { if (waitTimerRef.current) { clearInterval(waitTimerRef.current); waitTimerRef.current = null; } };
  }, [thinking]);
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

  // Auto-scroll log to bottom as entries arrive
  const logScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [liveLog?.length]);

  if (thinking) {
    const hasLog = liveLog && liveLog.length > 0;
    const agentColor =
      agent === "claude" ? "hsl(180 60% 45%)" :
      agent === "codex"  ? "hsl(220 80% 65%)" :
                           "hsl(280 65% 65%)";

    const entryIcon = (entry: LiveLogEntry) => {
      switch (entry.type) {
        case "bash":      return <span className="text-[10px] font-mono font-bold opacity-80">$</span>;
        case "write":     return <FileEdit  className="h-3 w-3 shrink-0" />;
        case "read":      return <FileSearch className="h-3 w-3 shrink-0" />;
        case "think":     return <Brain     className="h-3 w-3 shrink-0" />;
        case "tool_call": return <Zap       className="h-3 w-3 shrink-0" />;
        case "output": return <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />;
        default:       return <Wrench   className="h-3 w-3 shrink-0" />;
      }
    };

    const entryColor = (type: LiveLogEntry["type"]) => {
      if (type === "bash")   return "text-[hsl(45_90%_68%)]";
      if (type === "write")  return "text-[hsl(195_70%_60%)]";
      if (type === "read")   return "text-[hsl(210_60%_65%)]";
      if (type === "think")  return "text-[hsl(280_60%_70%)]";
      if (type === "error")  return "text-destructive";
      return "text-muted-foreground/70";
    };

    return (
      <div className="flex items-start gap-3 mb-4 px-1 pt-5">
        <div className="flex-1 min-w-0">
          {/* Live log panel */}
          <div
            className="rounded-xl border border-border/40 overflow-hidden"
            style={{ background: "hsl(0 0% 5%)" }}
          >
            {/* Header bar — agent identity */}
            <div
              className="flex items-center justify-between px-3 py-2 border-b border-border/30"
              style={{ background: "hsl(0 0% 8%)" }}
            >
              <div className="flex items-center gap-2">
                <img
                  src={agent === "claude" ? claudecodeImg : agent === "codex" ? codexImg : openclawImg}
                  alt={agent}
                  className="h-4 w-4 rounded"
                />
                <span className="text-[11px] font-medium tracking-wide" style={{ color: agentColor }}>
                  {agent === "claude" ? "Claude Code" : agent === "codex" ? "Codex" : "OpenClaw"}
                </span>
                {/* Pulsing active dot */}
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: agentColor }} />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: agentColor }} />
                </span>
              </div>
              {/* Elapsed timer */}
              <span className="text-[10px] text-muted-foreground/40 font-mono tabular-nums">
                {waitElapsed > 0 ? `${waitElapsed}s` : ""}
              </span>
            </div>

            {/* Log entries */}
            <div
              ref={logScrollRef}
              className="max-h-64 overflow-y-auto thinking-scroll px-0 py-1.5 space-y-0.5"
            >
              {!hasLog ? (
                /* Fallback: no structured log yet — show spinner + status */
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="flex gap-1">
                    {[0,1,2].map(i => (
                      <span
                        key={i}
                        className="w-1 h-1 rounded-full bg-muted-foreground/50 animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
                      />
                    ))}
                  </span>
                  <span className="text-xs text-muted-foreground/40">
                    {waitElapsed >= 30
                      ? `Still waiting… (${waitElapsed}s)`
                      : waitElapsed >= 15
                      ? `Waiting for response…`
                      : `Sending to device…`}
                  </span>
                </div>
              ) : (
                liveLog!.map((entry, i) => {
                  const isLast = i === liveLog!.length - 1;
                  // Structured tool call card
                  if (entry.type === "tool_call") {
                    return (
                      <ToolCallCard
                        key={i}
                        entry={entry}
                        isLast={isLast}
                        agentColor={agentColor}
                      />
                    );
                  }
                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex items-start gap-2 px-3 py-1 font-mono text-[12px] leading-relaxed",
                        isLast ? "opacity-100" : "opacity-50",
                        entryColor(entry.type)
                      )}
                    >
                      {/* Icon */}
                      <span className="mt-[1px] shrink-0">
                        {entryIcon(entry)}
                      </span>
                      {/* Label */}
                      <span className="shrink-0 font-semibold text-[11px]" style={{ color: agentColor }}>
                        {entry.label}
                      </span>
                      {/* Detail */}
                      {entry.detail && (
                        <span className="truncate text-[11px] text-muted-foreground/60 min-w-0">
                          {entry.detail}
                        </span>
                      )}
                      {/* Blinking cursor on last entry */}
                      {isLast && (
                        <span
                          className="inline-block w-1 h-3 ml-0.5 align-middle rounded-sm animate-pulse shrink-0"
                          style={{ background: agentColor, animationDuration: "0.7s" }}
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
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
            className="max-w-[88%] sm:max-w-[72%] rounded-[22px] px-4 py-2 text-[15px] leading-[1.4] break-words bg-[hsl(0,0%,14%)] text-foreground"
          >
            {textContent}
          </div>
        )}
        {/* Copy button — visible on group-hover */}
        {textContent && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(textContent);
              setCopiedUser(true);
              setTimeout(() => setCopiedUser(false), 2000);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent"
            title="Copy message"
          >
            {copiedUser ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
            {copiedUser ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    );
  }

  // Assistant — hover actions
  const interactiveOpts = extractInteractiveOptions(content);
  const hasOptions = interactiveOpts.length > 0;

  return (
    <div
      className="group flex items-start pt-5 pb-1 px-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          "flex-1 min-w-0 transition-all duration-200",
          hasOptions && "pl-3 border-l-2 border-primary/50"
        )}
      >
        <div className="text-[15px] md:text-[16px] leading-[1.55] text-foreground break-words pt-0.5">
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
          {!streaming && content === EMPTY_RESPONSE_TEXT ? (
            <div className="flex flex-col gap-3 py-1">
              <p className="text-sm text-muted-foreground leading-relaxed">{EMPTY_RESPONSE_TEXT}</p>
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-accent text-foreground transition-colors border border-border"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Retry
                </button>
              )}
            </div>
          ) : (
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
          )}
          {streaming && content && (
            <span
              className="inline-block w-0.5 h-3.5 ml-0.5 align-middle bg-primary rounded-full animate-pulse"
              style={{ animationDuration: "0.7s" }}
            />
          )}

          {/* Completed tool call cards — shown after streaming finishes */}
          {completedToolCalls && completedToolCalls.length > 0 && (
            <CompletedToolCallsSection entries={completedToolCalls} agent={agent} />
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
          {/* Live activity log — shown during streaming reveal (faded) to recap what ran */}
          {streaming && liveLog && liveLog.length > 0 && (
            <div className="mt-2 rounded-lg overflow-hidden border border-border/20" style={{ background: "hsl(0 0% 5%)" }}>
              <div className="max-h-32 overflow-y-auto thinking-scroll py-1 space-y-0">
                {liveLog.map((entry, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-0.5 font-mono text-[11px] opacity-50">
                    <span className="shrink-0 text-muted-foreground/50 mt-[1px]">
                      {entry.type === "bash" ? <span className="font-bold">$</span> : entry.type === "write" ? <FileEdit className="h-2.5 w-2.5" /> : entry.type === "read" ? <FileSearch className="h-2.5 w-2.5" /> : <Wrench className="h-2.5 w-2.5" />}
                    </span>
                    <span className="text-muted-foreground/50 truncate">{entry.label}{entry.detail ? ` ${entry.detail}` : ""}</span>
                  </div>
                ))}
              </div>
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

        {/* Interactive option buttons — shown when agent asks a question */}
        {onOptionSelect && hasOptions && (
          <div className="mt-3 mb-1">
            {/* "Awaiting reply" badge */}
            <div className="flex items-center gap-1.5 mb-2">
              <Reply className="h-3 w-3 text-primary/70" />
              <span className="text-[11px] font-medium text-primary/60 tracking-wide select-none uppercase">
                Awaiting reply
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {interactiveOpts.map((opt) => (
                <button
                  key={opt}
                  onClick={() => onOptionSelect(opt)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-150",
                    "bg-muted/40 hover:bg-primary/10 border-border/50 hover:border-primary/50",
                    "text-foreground/80 hover:text-foreground",
                    "active:scale-95"
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}

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
