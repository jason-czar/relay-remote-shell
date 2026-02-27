import { cn } from "@/lib/utils";
import { Copy, Check, Terminal, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";
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

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  thinking?: boolean;
  streaming?: boolean;
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

export function ChatMessage({ role, content, thinking, streaming, rawStdout, thinkingContent, thinkingDurationMs, createdAt, agent, onRegenerate }: ChatMessageProps) {
  const isUser = role === "user";
  const agentImg = agent === "claude" ? claudecodeImg : agent === "codex" ? codexImg : openclawImg;
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);

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
        // non-image binary — just show filename chip
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
            className="max-w-[88%] sm:max-w-[72%] rounded-[22px] px-5 py-3.5 text-[18px] leading-relaxed break-words bg-[hsl(0,0%,14%)] text-foreground"
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
      className="group flex items-start pt-2 pb-1 px-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[18px] md:text-[19px] leading-8 md:leading-[1.85] text-foreground break-words pt-0.5">
          {/* Codex reasoning / thinking collapsible */}
          {thinkingContent && (
            <div className="mb-3">
              <button
                onClick={() => setThinkingOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors mb-1"
              >
                {thinkingOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span className="italic">Thinking…{thinkingDurationMs !== undefined ? ` (${(thinkingDurationMs / 1000).toFixed(1)}s)` : ""}</span>
              </button>
              {thinkingOpen && (
                <div
                  className="rounded-lg border border-border/30 px-3 py-2.5 text-xs text-muted-foreground/80 leading-relaxed whitespace-pre-wrap font-mono"
                  style={{ background: "hsl(var(--muted)/0.3)" }}
                >
                  {thinkingContent}
                </div>
              )}
            </div>
          )}
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              code({ className, children }) {
                const match = /language-(\w+)/.exec(className || "");
                const value = String(children).replace(/\n$/, "");
                // Block code fence
                if (match || (className && className.includes("language-"))) {
                  return <CodeBlock language={match?.[1] ?? ""} value={value} />;
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
        </div>

        {/* Hover action bar */}
        <div className={cn(
          "flex items-center gap-0.5 mt-1.5 transition-all duration-150",
          hovered ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"
        )}>
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
              <pre className="p-3 whitespace-pre-wrap break-all leading-relaxed text-primary/80 max-h-64 overflow-y-auto">
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
