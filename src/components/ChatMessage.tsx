import { cn } from "@/lib/utils";
import { Bot, Copy, Check, Terminal, ChevronDown, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useState } from "react";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  thinking?: boolean;
  streaming?: boolean;
  rawStdout?: string;
}

export function ChatMessage({ role, content, thinking, streaming, rawStdout }: ChatMessageProps) {
  const isUser = role === "user";
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (thinking) {
    return (
      <div className="flex items-start gap-3 mb-4 px-1">
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center mt-0.5">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
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
    return (
      <div className="flex justify-end mb-4 px-1 animate-[slide-in-from-right_0.25s_cubic-bezier(0.22,1,0.36,1)_both]">
        <div
          className="max-w-[72%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed break-words"
          style={{
            background: "rgba(255,255,255,0.12)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.2)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.15)",
            color: "hsl(var(--foreground))",
          }}
        >
          {content}
        </div>
      </div>
    );
  }

  // Assistant — hover actions
  return (
    <div
      className="group flex items-start gap-3 mb-5 px-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center mt-0.5">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm leading-relaxed text-foreground break-words pt-0.5">
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
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              code: ({ className, children }) => {
                const isBlock = className?.includes("language-");
                return isBlock ? (
                  <code className="block bg-muted rounded-md px-3 py-2 my-2 text-xs font-mono whitespace-pre-wrap overflow-x-auto">
                    {children}
                  </code>
                ) : (
                  <code className="bg-muted rounded px-1 py-0.5 text-xs font-mono">
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => <pre className="my-2">{children}</pre>,
              ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
              li: ({ children }) => <li>{children}</li>,
              h1: ({ children }) => <h1 className="font-semibold text-base mb-1">{children}</h1>,
              h2: ({ children }) => <h2 className="font-semibold text-sm mb-1">{children}</h2>,
              h3: ({ children }) => <h3 className="font-medium text-sm mb-1">{children}</h3>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-primary">{children}</a>,
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
          {rawStdout && (
            <button
              onClick={() => setDebugOpen((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Raw stdout"
            >
              <Terminal className="h-3.5 w-3.5" />
              <span className="text-[11px]">Raw</span>
              {debugOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
        </div>

        {/* Debug panel */}
        {rawStdout && debugOpen && (
          <div
            className="mt-2 rounded-lg border border-border/50 overflow-hidden text-xs font-mono"
            style={{
              background: "rgba(0,0,0,0.35)",
              backdropFilter: "blur(8px)",
            }}
          >
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/30 text-muted-foreground">
              <Terminal className="h-3 w-3" />
              <span className="text-[11px] font-sans">raw stdout from relay</span>
            </div>
            <pre className="p-3 whitespace-pre-wrap break-all leading-relaxed text-green-400/90 max-h-64 overflow-y-auto">
              {rawStdout}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
