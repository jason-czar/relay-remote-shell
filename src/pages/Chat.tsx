import { useState, useEffect, useRef, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { ChatMessage } from "@/components/ChatMessage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Send, ChevronDown, Paperclip, X, FileText, Image, Plus, Monitor, Terminal, Loader2, WifiOff } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Tables } from "@/integrations/supabase/types";
import { useChatContext } from "@/contexts/ChatContext";
import { SetupWizard } from "@/components/SetupWizard";

interface AttachedFile {
  name: string;
  type: string;
  size: number;
  content: string; // base64 for binary, raw text for text files
  isText: boolean;
}

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
}

interface RelayMsg {
  type: string;
  data?: unknown;
}

const RELAY_TIMEOUT_MS = 60000;
const SILENCE_MS = 3000;

// ── Slash commands ───────────────────────────────────────────────────────────
interface SlashCommand {
  name: string;
  description: string;
  agents: ("openclaw" | "claude" | "both")[];
  /** If set, this raw terminal command is sent instead of building via buildCommand */
  rawCommand?: (agent: "openclaw" | "claude") => string;
  /** If set, executes a client-side action instead */
  clientAction?: "clear" | "help" | "new";
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "clear",
    description: "Clear the current conversation and start fresh",
    agents: ["both"],
    clientAction: "clear",
  },
  {
    name: "new",
    description: "Start a new conversation",
    agents: ["both"],
    clientAction: "new",
  },
  {
    name: "compact",
    description: "Compact conversation context to save tokens",
    agents: ["both"],
    rawCommand: (agent) =>
      agent === "openclaw" ? `openclaw compact\n` : `claude --compact\n`,
  },
  {
    name: "status",
    description: "Show agent status (uptime, tasks, last error)",
    agents: ["openclaw"],
    rawCommand: () => `openclaw status --json\n`,
  },
  {
    name: "restart",
    description: "Gracefully restart the OpenClaw agent process",
    agents: ["openclaw"],
    rawCommand: () => `openclaw restart\n`,
  },
  {
    name: "resume",
    description: "Resume the last Claude Code session",
    agents: ["claude"],
    rawCommand: () => `claude -c -p "continue"\n`,
  },
  {
    name: "help",
    description: "Show available slash commands",
    agents: ["both"],
    clientAction: "help",
  },
];

// ── Composer component ──────────────────────────────────────────────────────
interface ComposerBoxProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  input: string;
  setInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  disabled: boolean;
  sendDisabled: boolean;
  placeholder: string;
  attachedFiles: AttachedFile[];
  onRemoveFile: (idx: number) => void;
  onFileSelect: (files: FileList) => void;
  agent: "openclaw" | "claude";
  onSlashCommand: (cmd: SlashCommand) => void;
}

function ComposerBox({ textareaRef, fileInputRef, input, setInput, onKeyDown, onSend, disabled, sendDisabled, placeholder, attachedFiles, onRemoveFile, onFileSelect, agent, onSlashCommand }: ComposerBoxProps) {
  const [focused, setFocused] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);

  // Slash menu: show when input starts with "/"
  const slashQuery = input.startsWith("/") ? input.slice(1).toLowerCase() : null;
  const filteredCmds = slashQuery !== null
    ? SLASH_COMMANDS.filter((c) => {
        const forAgent = c.agents.includes("both") || c.agents.includes(agent);
        return forAgent && c.name.startsWith(slashQuery);
      })
    : [];
  const showSlash = filteredCmds.length > 0;

  // Reset selection when query changes
  useEffect(() => { setSlashIdx(0); }, [slashQuery]);

  const handleSlashKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlash) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => (i + 1) % filteredCmds.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => (i - 1 + filteredCmds.length) % filteredCmds.length); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const cmd = filteredCmds[slashIdx];
        if (cmd) { setInput(""); onSlashCommand(cmd); }
        return;
      }
      if (e.key === "Escape") { setInput(""); return; }
    }
    onKeyDown(e);
  };

  // Auto-resize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input, textareaRef]);

  const isImage = (type: string) => type.startsWith("image/");

  return (
    <div className="relative">
      {/* Slash command palette */}
      {showSlash && (
        <div
          className="absolute bottom-full mb-2 left-0 right-0 rounded-xl overflow-hidden z-30"
          style={{
            background: "rgba(18,18,24,0.92)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 -4px 32px rgba(0,0,0,0.4)",
          }}
        >
          <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5 border-b border-white/[0.06]">
            <span className="text-[10px] font-semibold text-primary/80 uppercase tracking-wider">Commands</span>
            <span className="text-[10px] text-muted-foreground/40">· Tab or Enter to select · Esc to dismiss</span>
          </div>
          {filteredCmds.map((cmd, i) => (
            <button
              key={cmd.name}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setInput(""); onSlashCommand(cmd); }}
              onMouseEnter={() => setSlashIdx(i)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
              style={{
                background: i === slashIdx ? "rgba(255,255,255,0.07)" : "transparent",
              }}
            >
              <span
                className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold font-mono"
                style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" }}
              >
                /
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-foreground">{cmd.name}</span>
                <span className="text-xs text-muted-foreground ml-2">{cmd.description}</span>
              </div>
              {i === slashIdx && (
                <kbd className="shrink-0 text-[10px] text-muted-foreground/50 border border-white/10 rounded px-1.5 py-0.5">↵</kbd>
              )}
            </button>
          ))}
        </div>
      )}

    <div
      className="flex flex-col rounded-2xl p-1.5 transition-all duration-300"
      style={{
        background: "rgba(255,255,255,0.05)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: focused
          ? "1px solid rgba(255,255,255,0.22)"
          : "1px solid rgba(255,255,255,0.10)",
        boxShadow: focused
          ? "0 8px 40px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.10), 0 0 0 3px hsl(var(--primary) / 0.15), 0 0 24px hsl(var(--primary) / 0.08)"
          : "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* File attachment chips */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2 pt-1.5 pb-1">
          {attachedFiles.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs max-w-[180px]"
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)" }}
            >
              {isImage(f.type) ? (
                <Image className="h-3 w-3 text-primary shrink-0" />
              ) : (
                <FileText className="h-3 w-3 text-primary shrink-0" />
              )}
              <span className="truncate text-foreground/80">{f.name}</span>
              <span className="text-muted-foreground shrink-0">
                {f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(0)}K`}
              </span>
              <button
                onClick={() => onRemoveFile(i)}
                className="shrink-0 hover:text-destructive transition-colors ml-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-1">
        {/* Attach button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed hover:scale-105 active:scale-95 ml-0.5"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.10)",
            color: "hsl(var(--muted-foreground))",
          }}
          title="Attach file"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && onFileSelect(e.target.files)}
        />

        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleSlashKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          style={{ height: "40px", overflowY: "hidden" }}
          className="resize-none text-sm min-h-[40px] max-h-[200px] flex-1 bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none px-3 py-2.5 overflow-y-auto"
        />
        <button
          onClick={onSend}
          disabled={sendDisabled}
          className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
          style={{
            background: sendDisabled ? "rgba(255,255,255,0.06)" : "hsl(var(--primary))",
            border: sendDisabled ? "1px solid rgba(255,255,255,0.08)" : "1px solid hsl(var(--primary))",
            boxShadow: sendDisabled ? "none" : "0 2px 12px hsl(var(--primary) / 0.45), inset 0 1px 0 rgba(255,255,255,0.2)",
            color: sendDisabled ? "rgba(255,255,255,0.3)" : "hsl(var(--primary-foreground))",
          }}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
    </div>
  );
}
export default function Chat() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { conversations, setConversations, activeConvId, setActiveConvId, registerNewCallback } = useChatContext();

  // ── State ──────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [agent, setAgent] = useState<"openclaw" | "claude">("openclaw");
  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [agentSwitchPending, setAgentSwitchPending] = useState<"openclaw" | "claude" | null>(null);
  const [streamingMsgIndex, setStreamingMsgIndex] = useState<number | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [projectId, setProjectId] = useState<string>("");
  const [relayStatus, setRelayStatus] = useState<"idle" | "connecting" | "retrying" | "failed">("idle");
  const relayRetryCountRef = useRef(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load devices ──────────────────────────────────────────────────────


  // ── Load conversations (now handled by ChatContext) ────────────────────
  // (removed — context loads them)

  // ── Load devices ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    // Load devices + first project in parallel
    Promise.all([
      supabase.from("devices").select("id, name, status, project_id"),
      supabase.from("projects").select("id").limit(1).single(),
    ]).then(([devRes, projRes]) => {
      const data = devRes.data;
      if (data) {
        setDevices(data as Tables<"devices">[]);
        if (data.length > 0 && !selectedDeviceId) {
          const online = data.find((d) => d.status === "online");
          setSelectedDeviceId((online ?? data[0]).id);
        }
      }
      if (projRes.data) setProjectId(projRes.data.id);
    });
  }, [user]);

  // ── Load messages on conversation select ──────────────────────────────
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    supabase
      .from("chat_messages")
      .select("id, role, content")
      .eq("conversation_id", activeConvId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setMessages(data as Message[]);
      });
    // also set agent from conversation
    const conv = conversations.find((c) => c.id === activeConvId);
    if (conv) setAgent(conv.agent as "openclaw" | "claude");
  }, [activeConvId]);

  // ── Auto-scroll ───────────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  // ── New conversation ──────────────────────────────────────────────────
  const createConversation = useCallback(async (firstMessage: string, agentType: "openclaw" | "claude"): Promise<string | null> => {
    if (!user) return null;
    const title = firstMessage.slice(0, 40) + (firstMessage.length > 40 ? "…" : "");
    const openclaw_session_id = agentType === "openclaw" ? crypto.randomUUID() : null;

    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({
        user_id: user.id,
        device_id: selectedDeviceId || null,
        agent: agentType,
        title,
        openclaw_session_id,
      })
      .select("id, title, agent, created_at")
      .single();

    if (error || !data) {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
      return null;
    }
    setConversations((prev) => [data as import("@/contexts/ChatContext").Conversation, ...prev]);
    setActiveConvId(data.id);
    return data.id;
  }, [user, selectedDeviceId, toast]);

  // ── Save message to DB ─────────────────────────────────────────────────
  const saveMessage = async (convId: string, role: "user" | "assistant", content: string) => {
    await supabase.from("chat_messages").insert({ conversation_id: convId, role, content });
    // bump updated_at
    await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
  };

  // ── Relay send (with auto-retry + status banner) ───────────────────────
  const sendViaRelay = useCallback(async (command: string, isOpenClaw = false): Promise<string> => {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 2500, 5000];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt === 0) {
        setRelayStatus("connecting");
        relayRetryCountRef.current = 0;
      } else {
        relayRetryCountRef.current = attempt;
        setRelayStatus("retrying");
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1] ?? 5000));
      }

      try {
        const result = await sendViaRelayOnce(command, isOpenClaw);
        setRelayStatus("idle");
        return result;
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          setRelayStatus("failed");
          throw err;
        }
        // loop to retry
      }
    }
    throw new Error("Relay unreachable");
  }, [selectedDeviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendViaRelayOnce = useCallback(async (command: string, isOpenClaw = false): Promise<string> => {
    // 1. Start session
    const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", {
      body: { device_id: selectedDeviceId },
    });
    if (sesErr || !sesData?.session_id) throw new Error(sesData?.error || sesErr?.message || "Failed to start session");
    const sessionId: string = sesData.session_id;

    // 2. Connect WebSocket
    const relayUrl = import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com";
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const jwt = authSession?.access_token;
    if (!jwt) throw new Error("No auth session");

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${relayUrl}/session`);
      let outputBuffer = "";
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimeout: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: string | Error) => {
        if (silenceTimer) clearTimeout(silenceTimer);
        if (hardTimeout) clearTimeout(hardTimeout);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "session_end", data: { session_id: sessionId, reason: "done" } }));
          ws.close();
        }
        supabase.functions.invoke("end-session", { body: { session_id: sessionId } }).catch(() => {});
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      const resetSilence = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (isOpenClaw && !outputBuffer.includes("{")) return;
          if (!isOpenClaw) {
            const stripped = outputBuffer.replace(/\x1b[\s\S]{1,10}/g, "").replace(/[%$#>\[\]?;=\r\n\s]/g, "");
            if (stripped.length < 5) return;
          }
          finish(outputBuffer);
        }, SILENCE_MS);
      };

      hardTimeout = setTimeout(() => finish(new Error("Response timed out after 30s")), RELAY_TIMEOUT_MS);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "auth",
          data: { token: jwt, session_id: sessionId, device_id: selectedDeviceId },
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg: RelayMsg = JSON.parse(event.data);
          if (msg.type === "auth_ok") {
            ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: 200, rows: 50 } }));
            setTimeout(() => {
              ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(command) } }));
              resetSilence();
            }, 100);
          } else if (msg.type === "stdout") {
            const { data_b64 } = (msg.data ?? {}) as { data_b64: string };
            if (data_b64) {
              try {
                const chunk = decodeURIComponent(escape(atob(data_b64)));
                outputBuffer += chunk;
                resetSilence();
              } catch {
                outputBuffer += atob(data_b64);
                resetSilence();
              }
            }
          } else if (msg.type === "session_end") {
            finish(outputBuffer);
          } else if (msg.type === "error") {
            const { message } = (msg.data ?? {}) as { message?: string };
            finish(new Error(message ?? "Relay error"));
          }
        } catch { /* ignore */ }
      };

      ws.onerror = () => finish(new Error("WebSocket error"));
      ws.onclose = () => { /* handled by finish */ };
    });
  }, [selectedDeviceId]);

  // ── Build command string ───────────────────────────────────────────────
  const buildCommand = useCallback(async (text: string, convId: string): Promise<string> => {
    const { data: conv } = await supabase
      .from("chat_conversations")
      .select("agent, openclaw_session_id, claude_session_id")
      .eq("id", convId)
      .single();
    if (!conv) throw new Error("Conversation not found");

    const escaped = text.replace(/"/g, '\\"');

    if (conv.agent === "openclaw") {
      const sid = conv.openclaw_session_id ?? crypto.randomUUID();
      return `openclaw agent --agent main --session-id ${sid} --message "${escaped}" --json --local\n`;
    } else {
      // claude
      if (conv.claude_session_id) {
        return `claude -c -p "${escaped}"\n`;
      }
      return `claude -p "${escaped}"\n`;
    }
  }, []);

  // ── Parse claude session id from stdout ───────────────────────────────
  const extractClaudeSessionId = (stdout: string): string | null => {
    const match = stdout.match(/Session ID:\s*(\S+)/i) ?? stdout.match(/"session_id"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  };

  // ── Send message ──────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachedFiles.length === 0) || thinking) return;
    if (!selectedDeviceId) {
      toast({ title: "Select a device first", variant: "destructive" });
      return;
    }

    // Build full message: user text + file contents appended
    let fullText = text;
    if (attachedFiles.length > 0) {
      const fileSection = attachedFiles.map((f) => {
        if (f.isText) {
          return `\n\n<file name="${f.name}">\n${f.content}\n</file>`;
        } else {
          return `\n\n<file name="${f.name}" type="${f.type}" encoding="base64">\n${f.content}\n</file>`;
        }
      }).join("");
      fullText = text ? text + fileSection : fileSection.trim();
    }

    setInput("");
    setAttachedFiles([]);
    const userMsg: Message = { role: "user", content: text || `[${attachedFiles.map(f => f.name).join(", ")}]` };
    setMessages((prev) => [...prev, userMsg]);
    setThinking(true);

    let convId = activeConvId;
    if (!convId) {
      convId = await createConversation(fullText, agent);
      if (!convId) { setThinking(false); return; }
    }

    await saveMessage(convId, "user", fullText);

    try {
      const command = await buildCommand(fullText, convId);
      const stdout = await sendViaRelay(command, agent === "openclaw");

      // Debug: log raw stdout so we can inspect the payload shape
      console.debug("[Chat] raw stdout:", stdout);

      // Strip ANSI / terminal escape codes comprehensively
      const stripAnsi = (s: string) =>
        s
          // OSC sequences: ESC ] ... ST (where ST is BEL \x07 or ESC \)
          .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
          // CSI sequences: ESC [ ... final byte
          .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
          // DCS / PM / APC sequences
          .replace(/\x1b[PX^_].*?\x1b\\/g, "")
          // Single-char ESC sequences
          .replace(/\x1b[^[\]PX^_]/g, "")
          // Bare ESC
          .replace(/\x1b/g, "")
          // Remove leftover bracket sequences that weren't caught (e.g. [?1004l after ESC was stripped)
          .replace(/\[[\d;?<>!]*[a-zA-Z]/g, "")
          // Remove OSC remnants like ]7;file://...
          .replace(/\][\d;][^\r\n]*/g, "")
          // Remove other control chars except newline/tab
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

      const cleaned = stripAnsi(stdout);

      const { data: convData } = await supabase
        .from("chat_conversations")
        .select("agent, openclaw_session_id, claude_session_id")
        .eq("id", convId)
        .single();

      let responseText = "";

      if (convData?.agent === "openclaw") {
        // Find all JSON-like blocks and try each, preferring one with a `payloads` array
        const jsonBlocks = cleaned.match(/\{[\s\S]*?\}/g) ?? [];
        // Also try the greedy match for large JSON objects
        const greedyMatch = cleaned.match(/\{[\s\S]*\}/);
        const candidates = greedyMatch ? [...jsonBlocks, greedyMatch[0]] : jsonBlocks;

        for (let i = candidates.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(candidates[i]);
            // Preferred: payloads[0].text (openclaw --json output)
            const payloadText = parsed?.payloads?.[0]?.text;
            if (payloadText) { responseText = String(payloadText); break; }
            // Fallback fields
            const fallback = parsed.content ?? parsed.message ?? parsed.response ?? parsed.text ?? parsed.result;
            if (fallback && typeof fallback === "string") { responseText = fallback; break; }
          } catch { /* try next */ }
        }

        if (!responseText) {
          console.warn("[Chat] OpenClaw: no JSON payload found, raw cleaned:", cleaned);
        }
      } else {
        // Claude: after thorough ANSI stripping, filter remaining noise lines
        responseText = cleaned
          .split("\n")
          .filter((line) => {
            const t = line.trim();
            if (!t) return false;
            // shell prompts and bare characters
            if (/^[%$#>→]\s*$/.test(t)) return false;
            if (/^[%$#>→]\s/.test(t)) return false;
            // session/terminal noise
            if (/^Restored session:/i.test(t)) return false;
            if (/^claude\s+(-p|-c|--print|--resume)/i.test(t)) return false;
            // leftover bracket/escape fragments after stripping
            if (/^\[[\d;?<>!]*[a-zA-Z]/.test(t)) return false;
            // lines that are only punctuation/symbols after stripping
            if (/^[=\-\+\*~\s]+$/.test(t)) return false;
            return true;
          })
          .join("\n")
          .trim();

        // Persist Claude session ID if not yet stored
        if (!convData?.claude_session_id) {
          const claudeId = extractClaudeSessionId(stdout);
          if (claudeId) {
            await supabase.from("chat_conversations").update({ claude_session_id: claudeId }).eq("id", convId);
          }
        }
      }

      responseText = responseText.trim() || "(empty response)";

      // ── Stream-reveal the response word-by-word ──────────────────────────
      const tokens = responseText.split(/(?<=\s)|(?=\s)/);
      let revealedIdx: number;
      setMessages((prev) => {
        revealedIdx = prev.length;
        return [...prev, { role: "assistant", content: "" }];
      });
      setThinking(false);
      setStreamingMsgIndex(revealedIdx!);

      await new Promise<void>((resolveStream) => {
        let tokenIdx = 0;
        let revealed = "";
        if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = setInterval(() => {
          if (tokenIdx >= tokens.length) {
            clearInterval(streamIntervalRef.current!);
            streamIntervalRef.current = null;
            setStreamingMsgIndex(null);
            resolveStream();
            return;
          }
          const batchSize = Math.floor(Math.random() * 3) + 2;
          for (let b = 0; b < batchSize && tokenIdx < tokens.length; b++, tokenIdx++) {
            revealed += tokens[tokenIdx];
          }
          const snap = revealed;
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (updated[lastIdx]?.role === "assistant") {
              updated[lastIdx] = { ...updated[lastIdx], content: snap };
            }
            return updated;
          });
        }, 18);
      });

      await saveMessage(convId, "assistant", responseText);

      // Update title after first exchange (was a new conversation)
      if (!activeConvId) {
        const smartTitle = text.length > 60
          ? text.slice(0, 57).trimEnd() + "…"
          : text;
        await supabase.from("chat_conversations").update({ title: smartTitle }).eq("id", convId!);
        setConversations((prev) =>
          prev.map((c) => c.id === convId ? { ...c, title: smartTitle } : c)
        );
      }

      setConversations((prev) => {
        const conv = prev.find((c) => c.id === convId);
        if (!conv) return prev;
        return [conv, ...prev.filter((c) => c.id !== convId)];
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      const errResponse: Message = { role: "assistant", content: `⚠️ Error: ${errMsg}` };
      setMessages((prev) => [...prev, errResponse]);
      await saveMessage(convId, "assistant", `⚠️ Error: ${errMsg}`);
    } finally {
      setThinking(false);
      setStreamingMsgIndex(null);
      if (streamIntervalRef.current) { clearInterval(streamIntervalRef.current); streamIntervalRef.current = null; }
      setRelayStatus("idle");
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [input, attachedFiles, thinking, selectedDeviceId, activeConvId, agent, createConversation, buildCommand, sendViaRelay, toast]);

  // ── New conversation ───────────────────────────────────────────────────
  const handleNew = useCallback(() => {
    setMessages([]);
    setInput("");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  // Register handleNew with context so sidebar "New" button triggers it
  useEffect(() => {
    registerNewCallback(handleNew);
  }, [handleNew, registerNewCallback]);

  // ── Agent toggle ───────────────────────────────────────────────────────
  const handleAgentChange = (value: string) => {
    if (!value) return;
    const newAgent = value as "openclaw" | "claude";
    if (activeConvId && messages.length > 0) {
      setAgentSwitchPending(newAgent);
    } else {
      setAgent(newAgent);
    }
  };

  // ── File handling ─────────────────────────────────────────────────────
  const processFiles = useCallback(async (files: FileList) => {
    const processed: AttachedFile[] = [];
    for (const file of Array.from(files)) {
      const isText = file.type.startsWith("text/") || /\.(ts|tsx|js|jsx|json|md|txt|py|go|sh|css|html|yaml|yml|env|toml)$/i.test(file.name);
      const content = await new Promise<string>((res) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        if (isText) reader.readAsText(file);
        else reader.readAsDataURL(file);
      });
      processed.push({ name: file.name, type: file.type, size: file.size, content, isText });
    }
    setAttachedFiles((prev) => [...prev, ...processed]);
  }, []);

  // ── Slash command handler ─────────────────────────────────────────────
  const handleSlashCommand = useCallback(async (cmd: SlashCommand) => {
    setInput("");
    if (cmd.clientAction === "clear") {
      setMessages([]);
      setActiveConvId(null);
      toast({ title: "Conversation cleared" });
      return;
    }
    if (cmd.clientAction === "new") {
      handleNew();
      return;
    }
    if (cmd.clientAction === "help") {
      const available = SLASH_COMMANDS.filter(
        (c) => c.agents.includes("both") || c.agents.includes(agent)
      );
      const helpText = `**Available slash commands**\n\n${available
        .map((c) => `\`/${c.name}\` — ${c.description}`)
        .join("\n")}`;
      setMessages((prev) => [...prev, { role: "assistant", content: helpText }]);
      return;
    }
    // rawCommand: send via relay
    if (cmd.rawCommand) {
      if (!selectedDeviceId) {
        toast({ title: "Select a device first", variant: "destructive" });
        return;
      }
      const userMsg: Message = { role: "user", content: `/${cmd.name}` };
      setMessages((prev) => [...prev, userMsg]);
      setThinking(true);
      try {
        const rawCmd = cmd.rawCommand(agent);
        const stdout = await sendViaRelay(rawCmd, agent === "openclaw");
        const stripped = stdout.replace(/\x1b\[[\d;]*[a-zA-Z]/g, "").trim() || "(done)";
        setMessages((prev) => [...prev, { role: "assistant", content: `\`\`\`\n${stripped}\n\`\`\`` }]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${msg}` }]);
      } finally {
        setThinking(false);
        setRelayStatus("idle");
      }
    }
  }, [agent, selectedDeviceId, sendViaRelay, handleNew, toast]);

  // ── Key handler ───────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <AppLayout>
      <div className="flex h-full overflow-hidden">
        {/* Main chat area — sidebar is now in AppSidebar */}
        <div
          className={`flex flex-col flex-1 min-w-0 h-full relative transition-all duration-150 ${isDragOver ? "ring-2 ring-primary/40 ring-inset" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
          onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files); }}
        >
          {isDragOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 px-10 py-8 text-center backdrop-blur-sm">
                <p className="text-sm font-medium text-primary">Drop files to attach</p>
                <p className="text-xs text-muted-foreground mt-1">Text files will be sent as context</p>
              </div>
            </div>
          )}

          {/* Top header bar */}
          <div className="shrink-0 h-12 border-b border-border/30 flex items-center px-6 relative">
            {/* Center — agent tabs */}
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
              {(["openclaw", "claude"] as const).map((a) => {
                const active = agent === a;
                const label = a === "openclaw" ? "OpenClaw" : "Claude Code";
                return (
                  <button
                    key={a}
                    onClick={() => handleAgentChange(a)}
                    className={`relative px-4 py-2 text-xs font-medium transition-all duration-200 select-none ${
                      active ? "text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground"
                    }`}
                  >
                    {label}
                    {active && <span className="absolute bottom-0 left-3 right-3 h-px bg-foreground/70 rounded-full" />}
                  </button>
                );
              })}
            </div>
            {/* Right — device pill */}
            <div className="ml-auto flex items-center">
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150 border border-border/30 bg-muted/20 hover:bg-muted/50 hover:border-border/60 text-muted-foreground hover:text-foreground">
                    {(() => {
                      const dev = devices.find(d => d.id === selectedDeviceId);
                      return dev ? (
                        <>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dev.status === "online" ? "bg-status-online animate-pulse" : "bg-muted-foreground/40"}`} />
                          <span className="max-w-[120px] truncate">{dev.name}</span>
                        </>
                      ) : (
                        <span className="opacity-50">No device</span>
                      );
                    })()}
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-40" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-48 p-1">
                  {devices.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-2 py-1.5">No devices found</p>
                  ) : (
                    devices.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setSelectedDeviceId(d.id)}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors ${selectedDeviceId === d.id ? "bg-accent text-accent-foreground font-medium" : "hover:bg-muted text-foreground/80"}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.status === "online" ? "bg-status-online" : "bg-muted-foreground/40"}`} />
                        <span className="truncate">{d.name}</span>
                      </button>
                    ))
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Relay reconnection banner */}
          {(relayStatus === "retrying" || relayStatus === "failed") && (
            <div
              className="shrink-0 flex items-center justify-center gap-2 py-1.5 px-4 text-xs font-medium transition-all duration-300"
              style={{
                background: relayStatus === "failed"
                  ? "hsl(var(--destructive) / 0.12)"
                  : "hsl(var(--primary) / 0.10)",
                borderBottom: relayStatus === "failed"
                  ? "1px solid hsl(var(--destructive) / 0.25)"
                  : "1px solid hsl(var(--primary) / 0.18)",
                color: relayStatus === "failed"
                  ? "hsl(var(--destructive))"
                  : "hsl(var(--primary))",
              }}
            >
              {relayStatus === "retrying" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <span>
                    Relay disconnected — reconnecting
                    {relayRetryCountRef.current > 0 ? ` (attempt ${relayRetryCountRef.current} of 3)` : ""}
                    …
                  </span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 shrink-0" />
                  <span>Could not reach relay — check your connection</span>
                </>
              )}
            </div>
          )}

          {/* Messages — centered column */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto py-6">
            <div className="max-w-[720px] mx-auto px-6">
              {messages.length === 0 && !thinking && (
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">

                  {/* ── No device paired: prominent CTA ─────────────────── */}
                  {devices.length === 0 ? (
                    <div className="flex flex-col items-center gap-6 max-w-sm">
                      <div className="relative animate-fade-in" style={{ animationFillMode: "both" }}>
                        <div className="absolute inset-0 rounded-3xl bg-primary/20 blur-xl scale-110" />
                        <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center ring-1 ring-primary/30"
                          style={{
                            background: "linear-gradient(135deg, hsl(var(--primary) / 0.18) 0%, hsl(var(--primary) / 0.08) 100%)",
                            boxShadow: "0 8px 32px hsl(var(--primary) / 0.25), inset 0 1px 0 rgba(255,255,255,0.12)",
                          }}
                        >
                          <Monitor className="w-10 h-10 text-primary/70" />
                        </div>
                      </div>

                      <div className="animate-fade-in" style={{ animationDelay: "100ms", animationFillMode: "both" }}>
                        <h3 className="font-semibold text-foreground text-lg mb-2">No device connected</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Pair your first machine to start running commands and chatting with AI agents directly on your device.
                        </p>
                      </div>

                      <div className="flex flex-col items-center gap-3 w-full animate-fade-in" style={{ animationDelay: "200ms", animationFillMode: "both" }}>
                        <Button
                          size="lg"
                          className="w-full gap-2 text-sm font-medium"
                          onClick={() => setShowWizard(true)}
                        >
                          <Plus className="h-4 w-4" />
                          Pair your first device
                        </Button>
                        <p className="text-xs text-muted-foreground/50">Takes about 60 seconds · runs a single bash command</p>
                      </div>

                      {/* How it works */}
                      <div className="grid grid-cols-3 gap-3 w-full mt-2 animate-fade-in" style={{ animationDelay: "300ms", animationFillMode: "both" }}>
                        {[
                          { icon: "1", label: "Name device" },
                          { icon: "2", label: "Run installer" },
                          { icon: "3", label: "Start chatting" },
                        ].map(({ icon, label }) => (
                          <div key={label} className="flex flex-col items-center gap-1.5 rounded-xl border border-border/30 bg-card/30 py-3 px-2">
                            <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">{icon}</span>
                            <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                  ) : (
                    /* ── Has device, no messages: normal empty state ────── */
                    <>
                      <div className="relative mb-6 animate-fade-in" style={{ animationDelay: "0ms", animationFillMode: "both" }}>
                        <div className="absolute inset-0 rounded-3xl bg-primary/20 blur-xl scale-110" />
                        <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center ring-1 ring-primary/30"
                          style={{
                            background: "linear-gradient(135deg, hsl(var(--primary) / 0.18) 0%, hsl(var(--primary) / 0.08) 100%)",
                            boxShadow: "0 8px 32px hsl(var(--primary) / 0.25), inset 0 1px 0 rgba(255,255,255,0.12)",
                          }}
                        >
                          <span className="text-5xl">{agent === "openclaw" ? "🐾" : "⌨️"}</span>
                        </div>
                      </div>
                      <h3 className="font-semibold text-foreground mb-2 text-lg animate-fade-in" style={{ animationDelay: "120ms", animationFillMode: "both" }}>
                        {agent === "openclaw" ? "OpenClaw Agent" : "Claude Code"}
                      </h3>
                      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed mb-8 animate-fade-in" style={{ animationDelay: "220ms", animationFillMode: "both" }}>
                        {agent === "openclaw"
                          ? "Ask your local OpenClaw agent anything. Commands run on your selected device."
                          : "Send prompts directly to Claude Code running on your device."}
                      </p>

                      {/* Starter prompt cards */}
                      <div className="grid grid-cols-2 gap-2.5 w-full max-w-lg mx-auto animate-fade-in" style={{ animationDelay: "340ms", animationFillMode: "both" }}>
                        {(agent === "openclaw" ? [
                          { icon: "📂", title: "List files", prompt: "List all files in the current directory" },
                          { icon: "🔍", title: "Search code", prompt: "Search for TODO comments in the codebase" },
                          { icon: "💻", title: "System info", prompt: "Show system info: OS, CPU, memory usage" },
                          { icon: "🌿", title: "Git status", prompt: "Show the current git status and recent commits" },
                        ] : [
                          { icon: "🐛", title: "Debug code", prompt: "Help me debug an issue in my code" },
                          { icon: "✍️", title: "Write tests", prompt: "Write unit tests for the current file" },
                          { icon: "♻️", title: "Refactor", prompt: "Refactor this code to be cleaner and more readable" },
                          { icon: "📖", title: "Explain code", prompt: "Explain what this code does" },
                        ]).map(({ icon, title, prompt }, i) => (
                          <button
                            key={title}
                            onClick={() => setInput(prompt)}
                            disabled={!selectedDeviceId}
                            className="animate-fade-in group flex flex-col gap-2 px-5 py-4 rounded-xl border border-border/40 bg-card/40 hover:bg-card/80 hover:border-border/80 transition-all duration-200 text-left disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ animationDelay: `${420 + i * 80}ms`, animationFillMode: "both", boxShadow: "0 0 0 0 transparent" }}
                            onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 0 18px 2px hsl(var(--primary) / 0.08), 0 2px 12px rgba(0,0,0,0.15)")}
                            onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 0 0 0 transparent")}
                          >
                            <span className="text-xs font-semibold text-foreground">{title}</span>
                            <span className="text-xs text-muted-foreground/80 leading-snug line-clamp-2">{prompt}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="space-y-6">
                {messages.map((msg, i) => (
                  <div key={msg.id ?? i} className="animate-fade-in">
                    <ChatMessage
                      role={msg.role}
                      content={msg.content}
                      streaming={i === streamingMsgIndex}
                    />
                  </div>
                ))}
                {thinking && (
                  <div className="animate-fade-in">
                    <ChatMessage role="assistant" content="" thinking />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Floating composer */}
          <div className="shrink-0 px-6 pb-6 pt-2">
            <div className="max-w-[720px] mx-auto">
              <ComposerBox
                textareaRef={textareaRef}
                fileInputRef={fileInputRef}
                input={input}
                setInput={setInput}
                onKeyDown={handleKeyDown}
                onSend={handleSend}
                disabled={thinking || !selectedDeviceId}
                sendDisabled={thinking || (!input.trim() && attachedFiles.length === 0)}
                placeholder={selectedDeviceId ? `Message ${agent === "openclaw" ? "OpenClaw" : "Claude Code"}... (type / for commands)` : "Select a device first…"}
                attachedFiles={attachedFiles}
                onRemoveFile={(i) => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                onFileSelect={processFiles}
                agent={agent}
                onSlashCommand={handleSlashCommand}
              />
              <p className="text-center text-[10px] text-muted-foreground/30 mt-2">
                Enter to send · Shift+Enter for newline · Type <kbd className="font-mono">/</kbd> for commands
              </p>
            </div>
          </div>
        </div>

        {/* Agent switch confirmation */}
        {agentSwitchPending && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="bg-card border border-border rounded-xl p-6 shadow-xl max-w-sm w-full mx-4">
              <h3 className="font-semibold text-foreground mb-2">Switch to {agentSwitchPending === "openclaw" ? "OpenClaw" : "Claude Code"}?</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Switching agents will start a new conversation. The current conversation will be preserved.
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setAgentSwitchPending(null)}>Cancel</Button>
                <Button size="sm" onClick={() => {
                  setAgent(agentSwitchPending!);
                  setAgentSwitchPending(null);
                  setActiveConvId(null);
                  handleNew();
                }}>
                  Start New Chat
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Device pairing wizard dialog */}
      <Dialog open={showWizard} onOpenChange={setShowWizard}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              Pair a device
            </DialogTitle>
          </DialogHeader>
          {projectId && (
            <SetupWizard
              projectId={projectId}
              onComplete={() => {
                setShowWizard(false);
                // Reload devices after pairing
                supabase.from("devices").select("id, name, status, project_id").then(({ data }) => {
                  if (data) {
                    setDevices(data as Tables<"devices">[]);
                    const online = data.find((d) => d.status === "online");
                    if (online ?? data[0]) setSelectedDeviceId((online ?? data[0]).id);
                  }
                });
              }}
              onSkip={() => setShowWizard(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
