import { cn } from "@/lib/utils";
import { Bot, User } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  thinking?: boolean;
}

export function ChatMessage({ role, content, thinking }: ChatMessageProps) {
  const isUser = role === "user";

  if (thinking) {
    return (
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
          <span className="flex gap-1 items-center h-5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
                style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
              />
            ))}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 mb-4",
        isUser && "flex-row-reverse"
      )}
    >
      <div
        className={cn(
          "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center",
          isUser ? "bg-primary/20" : "bg-secondary/60"
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary" />
        ) : (
          <Bot className="h-4 w-4 text-secondary-foreground" />
        )}
      </div>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm"
        )}
      >
        {content}
      </div>
    </div>
  );
}
