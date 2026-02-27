import { useState, useEffect, useRef, useCallback } from "react";
import openclawImg from "@/assets/openclaw.png";
import claudecodeImg from "@/assets/claudecode.png";
import codexImg from "@/assets/codex.png";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useScribe } from "@elevenlabs/react";
import { cn } from "@/lib/utils";
import { AppLayout } from "@/components/AppLayout";
import { ChatMessage } from "@/components/ChatMessage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Send, ChevronDown, Paperclip, X, FileText, Image, Plus, Monitor, Terminal, Loader2, WifiOff, Square, Mic, ArrowUp, RefreshCw, SquarePen } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
  conversation_id?: string;
  created_at?: string;
  type?: string;
  data?: unknown;
  thinkingContent?: string;
}

interface RelayMsg {
  type: string;
  data?: unknown;
}

const RELAY_TIMEOUT_MS = 60000;
const SILENCE_MS = 8000;

// ── Agent models ─────────────────────────────────────────────────────────────
export interface AgentModel {
  id: string;
  label: string;
  description: string;
}

// OpenClaw uses the same Anthropic models that openclaw agent supports via --model
export const OPENCLAW_MODELS: AgentModel[] = [
  { id: "auto", label: "Auto", description: "Use agent's default model" },
  { id: "claude-opus-4-5", label: "Opus 4.5", description: "Most capable" },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5", description: "Balanced" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", description: "Fast & compact" },
  { id: "claude-opus-4", label: "Opus 4", description: "Previous opus" },
  { id: "claude-sonnet-4", label: "Sonnet 4", description: "Previous sonnet" },
  { id: "claude-haiku-3-5", label: "Haiku 3.5", description: "Previous haiku" },
];

// Claude Code uses `claude --model <id>` — same model family
export const CLAUDE_MODELS: AgentModel[] = [
  { id: "auto", label: "Auto", description: "Use Claude Code's default model" },
  { id: "claude-opus-4-5", label: "Opus 4.5", description: "Most capable" },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5", description: "Balanced" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", description: "Fast & compact" },
  { id: "claude-opus-4", label: "Opus 4", description: "Previous opus" },
  { id: "claude-sonnet-4", label: "Sonnet 4", description: "Previous sonnet" },
  { id: "claude-haiku-3-5", label: "Haiku 3.5", description: "Previous haiku" },
];

// Codex CLI uses `codex --model <id>`
export const CODEX_MODELS: AgentModel[] = [
  { id: "auto", label: "Auto", description: "Use Codex's default model" },
  { id: "o4-mini", label: "o4-mini", description: "Fast & efficient" },
  { id: "o3", label: "o3", description: "Most capable" },
  { id: "o3-mini", label: "o3-mini", description: "Balanced" },
  { id: "gpt-4.1", label: "GPT-4.1", description: "Latest GPT-4 series" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", description: "Efficient GPT-4" },
  { id: "gpt-4o", label: "GPT-4o", description: "Previous multimodal" },
];

// ── Slash commands ───────────────────────────────────────────────────────────
interface SlashCommand {
  name: string;
  description: string;
  agents: ("openclaw" | "claude" | "codex" | "both")[];
  /** If set, this raw terminal command is sent instead of building via buildCommand */
  rawCommand?: (agent: "openclaw" | "claude" | "codex") => string;
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
      agent === "openclaw" ? `openclaw compact\n` : agent === "codex" ? `codex --compact\n` : `claude --compact\n`,
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
    name: "codex-resume",
    description: "Resume the last Codex session",
    agents: ["codex"],
    rawCommand: () => `codex --resume\n`,
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
  agent: "openclaw" | "claude" | "codex";
  model: string;
  onSlashCommand: (cmd: SlashCommand) => void;
  onAgentChange: (agent: "openclaw" | "claude" | "codex") => void;
  onModelChange: (model: string) => void;
}

function ComposerBox({ textareaRef, fileInputRef, input, setInput, onKeyDown, onSend, disabled, sendDisabled, placeholder, attachedFiles, onRemoveFile, onFileSelect, agent, model, onSlashCommand, onAgentChange, onModelChange }: ComposerBoxProps) {
  const [focused, setFocused] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [isDictating, setIsDictating] = useState(false);
  const [dictateError, setDictateError] = useState<string | null>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  const scribe = useScribe({
    modelId: "scribe_v2_realtime" as any,
    commitStrategy: "vad" as any,
    onPartialTranscript: (data: any) => {
      setInput(data.text ?? "");
    },
    onCommittedTranscript: (data: any) => {
      const incoming = (data.text ?? "").trim();
      setInput(incoming);
    },
  });

  const toggleDictation = useCallback(async () => {
    if (scribe.isConnected) {
      scribe.disconnect();
      setIsDictating(false);
      return;
    }
    setDictateError(null);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const resp = await fetch(`${supabaseUrl}/functions/v1/elevenlabs-scribe-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
      const { token, error } = await resp.json();
      if (!token) throw new Error(error ?? "No token received");
      await scribe.connect({ token, microphone: { echoCancellation: true, noiseSuppression: true } });
      setIsDictating(true);
    } catch (e) {
      setDictateError(e instanceof Error ? e.message : "Mic error");
      setIsDictating(false);
    }
  }, [scribe, supabaseUrl, supabaseKey]);

  // Sync isDictating with actual connection
  useEffect(() => {
    setIsDictating(scribe.isConnected);
  }, [scribe.isConnected]);

  // Slash command filtering
  const slashQuery = input.startsWith("/") ? input.slice(1).toLowerCase() : null;
  const slashMatches = slashQuery !== null
    ? SLASH_COMMANDS.filter((c) => c.name.toLowerCase().startsWith(slashQuery) || c.description.toLowerCase().includes(slashQuery))
    : [];

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    const isMobile = window.innerWidth < 768;
    const maxH = isMobile ? Math.floor(window.innerHeight * 0.4) : 240;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, maxH) + "px";
    el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
  };

  return (
    <div className="relative w-full">
      {/* Slash command menu */}
      {slashMatches.length > 0 && (
        <div className="absolute bottom-full mb-2 left-0 right-0 rounded-xl overflow-hidden z-30 bg-popover border border-border shadow-xl">
          {slashMatches.map((cmd, i) => (
            <button
              key={cmd.name}
              onMouseDown={(e) => { e.preventDefault(); onSlashCommand(cmd); }}
              className={cn(
                "w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-accent transition-colors",
                i === slashIdx && "bg-accent"
              )}
            >
              <span className="font-mono text-primary">/{cmd.name}</span>
              <span className="text-muted-foreground">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* File attachment chips */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2 px-1">
          {attachedFiles.map((f, i) => (
            <div key={i} className="flex items-center gap-1 bg-accent/50 rounded-full px-2.5 py-1 text-xs text-foreground/80 border border-border/50">
              <span className="max-w-[120px] truncate">{f.name}</span>
              <button onClick={() => onRemoveFile(i)} className="text-muted-foreground hover:text-foreground ml-0.5">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Main pill bar */}
      <div
        className={cn(
          "flex items-end gap-1 rounded-[24px] px-3 py-1.5 transition-all duration-200",
          "bg-[hsl(var(--muted)/0.6)] border border-border/20",
          disabled && "opacity-60 pointer-events-none"
        )}
      >
        {/* Attach button */}
        <button
          type="button"
          title="Attach file"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
        >
          <Paperclip size={16} />
        </button>
        <input ref={fileInputRef} type="file" className="hidden" multiple onChange={(e) => { if (e.target.files) onFileSelect(e.target.files); }} />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={(e) => {
            if (slashMatches.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((p) => Math.min(p + 1, slashMatches.length - 1)); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((p) => Math.max(p - 1, 0)); return; }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSlashCommand(slashMatches[slashIdx]); return; }
            }
            onKeyDown(e);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          style={{ height: "40px", overflowY: "hidden", resize: "none" }}
          className="text-sm min-h-[40px] flex-1 bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none px-2 py-2.5 placeholder:text-muted-foreground/40"
        />

        {/* Waveform — shown while dictating */}
        {isDictating && (
          <div className="shrink-0 flex items-center gap-[3px] px-1" aria-hidden>
            <div className="waveform-bar" />
            <div className="waveform-bar" />
            <div className="waveform-bar" />
            <div className="waveform-bar" />
            <div className="waveform-bar" />
            <div className="waveform-bar" />
            <div className="waveform-bar" />
          </div>
        )}

        {/* Agent + model selector — hidden for now */}

        {/* Mic / dictation button */}
        <button
          type="button"
          title={isDictating ? "Stop dictation" : "Voice input"}
          onClick={toggleDictation}
          className={cn(
            "shrink-0 p-2 rounded-full transition-all duration-200",
            isDictating
              ? "text-destructive animate-pulse"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Mic size={15} />
        </button>

        {/* Send button */}
        <button
          type="button"
          onClick={onSend}
          disabled={sendDisabled || disabled}
          title="Send"
          className={cn(
            "shrink-0 p-2 rounded-full transition-all duration-200",
            sendDisabled || disabled
              ? "bg-muted/40 text-muted-foreground/40 cursor-not-allowed"
              : "bg-primary text-primary-foreground hover:opacity-90 shadow-sm"
          )}
        >
          <ArrowUp size={15} />
        </button>
      </div>

      {dictateError && (
        <p className="text-xs text-destructive mt-1 pl-3">{dictateError}</p>
      )}
    </div>
  );
}

export default function Chat() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { conversations, setConversations, activeConvId, setActiveConvId, registerNewCallback, addJob, removeJob, activeJobs } = useChatContext();
  // Keep a ref so async callbacks can always read the latest active conversation
  const activeConvIdRef = useRef<string | null>(null);
  // Store raw relay stdout keyed by message array index (session-only, not persisted)
  const rawStdoutMapRef = useRef<Map<number, string>>(new Map());
  // Store codex reasoning summaries keyed by message array index
  const thinkingMapRef = useRef<Map<number, string>>(new Map());
  const thinkingDurationMapRef = useRef<Map<number, number>>(new Map());
  useEffect(() => { activeConvIdRef.current = activeConvId; }, [activeConvId]);

  // ── State ──────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [agent, setAgent] = useState<"openclaw" | "claude" | "codex">("openclaw");
  const [model, setModel] = useState<string>("auto");
  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [agentSwitchPending, setAgentSwitchPending] = useState<"openclaw" | "claude" | "codex" | null>(null);
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
  const abortStreamRef = useRef(false);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMsgCountRef = useRef(0);

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
      .select("id, role, content, created_at")
      .eq("conversation_id", activeConvId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setMessages(data as Message[]);
      });
  }, [activeConvId]);

  // Restore agent + model when conversation or conversations list changes (handles refresh where
  // conversations may load after activeConvId is restored from localStorage)
  useEffect(() => {
    if (!activeConvId || !conversations.length) return;
    const conv = conversations.find((c) => c.id === activeConvId);
    if (conv) {
      setAgent(conv.agent as "openclaw" | "claude" | "codex");
      setModel(conv.model || "auto");
    }
  }, [activeConvId, conversations]);

  // ── Reload messages when a background job for the active conv finishes ──
  const prevJobsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeConvId) return;
    const wasRunning = prevJobsRef.current.has(activeConvId);
    const isRunning = activeJobs.has(activeConvId);
    // Job just finished for the active conversation → reload from DB
    if (wasRunning && !isRunning) {
      supabase
        .from("chat_messages")
        .select("id, role, content")
        .eq("conversation_id", activeConvId)
        .order("created_at", { ascending: true })
        .then(({ data }) => { if (data) setMessages(data as Message[]); });
    }
    prevJobsRef.current = new Set(activeJobs);
  }, [activeJobs, activeConvId]);

  // ── Scroll tracking ───────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolled = distFromBottom > 120;
    setIsScrolledUp(scrolled);
    if (!scrolled) setUnreadCount(0);
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isScrolledUp) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    } else if (messages.length > prevMsgCountRef.current) {
      const newMsgs = messages.length - prevMsgCountRef.current;
      // Only count assistant messages as "unread"
      const newAssistant = messages.slice(prevMsgCountRef.current).filter(m => m.role === "assistant").length;
      if (newAssistant > 0) setUnreadCount(c => c + newAssistant);
    }
    prevMsgCountRef.current = messages.length;
  }, [messages, thinking, isScrolledUp]);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setUnreadCount(0);
  }, []);

  // ── New conversation ──────────────────────────────────────────────────
  const createConversation = useCallback(async (firstMessage: string, agentType: "openclaw" | "claude" | "codex"): Promise<string | null> => {
    if (!user) return null;
    const title = firstMessage.slice(0, 40) + (firstMessage.length > 40 ? "…" : "");
    const openclaw_session_id = agentType === "openclaw" ? crypto.randomUUID() : null;

    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({
        user_id: user.id,
        device_id: selectedDeviceId || null,
        agent: agentType,
        model,
        title,
        openclaw_session_id,
      })
      .select("id, title, agent, model, created_at")
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
        // If the output already contains a CLI error line, finish immediately
        const hasError = /^Error:/m.test(outputBuffer) || /^error:/im.test(outputBuffer);
        if (hasError) { finish(outputBuffer); return; }
        silenceTimer = setTimeout(() => {
          // For OpenClaw: detect complete JSON object and finish immediately — no need to wait full 8s
          if (isOpenClaw) {
            if (!outputBuffer.includes("{")) return; // no JSON yet
            // Walk the buffer to find a balanced top-level { ... } and finish early
            const firstBrace = outputBuffer.indexOf("{");
            let depth = 0, inStr = false, esc = false;
            for (let i = firstBrace; i < outputBuffer.length; i++) {
              const c = outputBuffer[i];
              if (esc) { esc = false; continue; }
              if (c === "\\" && inStr) { esc = true; continue; }
              if (c === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (c === "{") depth++;
              else if (c === "}") { depth--; if (depth === 0) { finish(outputBuffer); return; } }
            }
            return; // JSON not yet complete, keep waiting
          }
          // For Claude Code: keep waiting until we have at least 10 non-noise characters
          if (!isOpenClaw) {
            const stripped = outputBuffer.replace(/\x1b[\s\S]{1,10}/g, "").replace(/[%$#>\[\]?;=\r\n\s]/g, "");
            if (stripped.length < 10) return;
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

      ws.onerror = (e) => { console.error("[Relay] WebSocket error", e); finish(new Error("WebSocket error")); };
      ws.onclose = (e) => {
        // If the WebSocket closes unexpectedly (e.g. relay rejected the session) and we haven't finished yet, resolve with whatever we have
        if (silenceTimer || hardTimeout) finish(outputBuffer || new Error(`WebSocket closed (code ${e.code})`));
      };
    });
  }, [selectedDeviceId]);

  // ── Build command string ───────────────────────────────────────────────
  const buildCommand = useCallback(async (text: string, convId: string, selectedModel: string): Promise<string> => {
    const { data: conv } = await supabase
      .from("chat_conversations")
      .select("agent, openclaw_session_id, claude_session_id")
      .eq("id", convId)
      .single();
    if (!conv) throw new Error("Conversation not found");

    const escaped = text.replace(/"/g, '\\"');
    // "auto" = omit --model flag entirely, let the CLI use its configured default
    const modelFlag = selectedModel !== "auto" ? `--model ${selectedModel}` : "";

    if (conv.agent === "openclaw") {
      const sid = conv.openclaw_session_id ?? crypto.randomUUID();
      const modelPart = modelFlag ? ` ${modelFlag}` : "";
      return `openclaw agent --agent main --session-id ${sid}${modelPart} --message "${escaped}" --json --local\n`;
    } else if (conv.agent === "codex") {
      // Codex CLI: `codex -q "<prompt>"` (non-interactive / print mode)
      const modelPart = modelFlag ? ` --model ${selectedModel}` : "";
      return `codex${modelPart} -q "${escaped}"\n`;
    } else {
      // claude
      const modelPart = modelFlag ? ` ${modelFlag}` : "";
      if (conv.claude_session_id) {
        return `claude -c${modelPart} -p "${escaped}"\n`;
      }
      return `claude${modelPart} -p "${escaped}"\n`;
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
    if (!text && attachedFiles.length === 0) return;
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
    abortStreamRef.current = false;
    if (textareaRef.current) { textareaRef.current.style.height = "40px"; textareaRef.current.style.overflowY = "hidden"; }

    const displayText = text || `[${attachedFiles.map(f => f.name).join(", ")}]`;
    const userMsg: Message = { role: "user", content: displayText };
    setMessages((prev) => [...prev, userMsg]);
    setThinking(true);

    let convId = activeConvId;
    if (!convId) {
      convId = await createConversation(fullText, agent);
      if (!convId) { setThinking(false); return; }
      // Switch active conv so the user sees their new conversation
      setActiveConvId(convId);
    }

    await saveMessage(convId, "user", fullText);

    // Run the actual relay call detached — background jobs continue when user switches conversation
    const jobConvId = convId;
    const jobIsNew = !activeConvId;
    const jobText = text;
    addJob(jobConvId);

    const runJob = async () => {
      // Strip ANSI / terminal escape codes comprehensively
      const stripAnsi = (s: string) =>
        s
          .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
          .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
          .replace(/\x1b[PX^_].*?\x1b\\/g, "")
          .replace(/\x1b[^[\]PX^_]/g, "")
          .replace(/\x1b/g, "")
          .replace(/\[[\d;?<>!]*[a-zA-Z]/g, "")
          .replace(/\][\d;][^\r\n]*/g, "")
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

      try {
        const command = await buildCommand(fullText, jobConvId, model);
        const stdout = await sendViaRelay(command, agent === "openclaw");
        console.debug("[Chat] raw stdout:", stdout);

        const cleaned = stripAnsi(stdout);

        const { data: convData } = await supabase
          .from("chat_conversations")
          .select("agent, openclaw_session_id, claude_session_id")
          .eq("id", jobConvId)
          .single();

        let responseText = "";
        let codexThinking = "";
        let codexThinkingDurationMs: number | undefined;

        if (convData?.agent === "openclaw") {
          const jsonBlocks = cleaned.match(/\{[\s\S]*?\}/g) ?? [];
          const greedyMatch = cleaned.match(/\{[\s\S]*\}/);
          const candidates = greedyMatch ? [...jsonBlocks, greedyMatch[0]] : jsonBlocks;
          for (let i = candidates.length - 1; i >= 0; i--) {
            try {
              const parsed = JSON.parse(candidates[i]);
              const payloadText = parsed?.payloads?.[0]?.text;
              if (payloadText) { responseText = String(payloadText); break; }
              const fallback = parsed.content ?? parsed.message ?? parsed.response ?? parsed.text ?? parsed.result;
              if (fallback && typeof fallback === "string") { responseText = fallback; break; }
            } catch { /* try next */ }
          }
          if (!responseText) {
            // Check for known CLI error patterns and surface them directly
            const errorMatch = cleaned.match(/^Error:\s*(.+)/m) ?? cleaned.match(/error:\s*(.+)/im);
            if (errorMatch) {
              responseText = `⚠️ OpenClaw error: ${errorMatch[1].trim()}`;
            } else {
              console.warn("[Chat] OpenClaw: no JSON payload found, raw cleaned:", cleaned);
            }
          }
        } else if (convData?.agent === "codex") {
          // Codex CLI outputs JSONL in -q mode — each line is a JSON object.
          // We want the text from type:"message" / role:"assistant" objects.
          // Reasoning summaries (type:"reasoning") are extracted separately.
          const textParts: string[] = [];
          const reasoningParts: string[] = [];
          for (const line of cleaned.split("\n")) {
            const t = line.trim();
            if (!t) continue;
            if (t.startsWith("{")) {
              try {
                const obj = JSON.parse(t);
                // type:"message" with role:"assistant"
                if (obj.type === "message" && obj.role === "assistant" && Array.isArray(obj.content)) {
                  for (const part of obj.content) {
                    if (part.type === "output_text" && typeof part.text === "string") {
                      textParts.push(part.text);
                    }
                  }
                  continue;
                }
                // type:"reasoning" — collect summary_text items
                if (obj.type === "reasoning" && Array.isArray(obj.summary)) {
                  for (const s of obj.summary) {
                    if (s.type === "summary_text" && typeof s.text === "string") {
                      reasoningParts.push(s.text);
                    }
                  }
                  if (typeof obj.duration_ms === "number") {
                    codexThinkingDurationMs = obj.duration_ms;
                  }
                  continue;
                }
                // Also handle simple {type:"text", text:...} shapes
                if (obj.type === "text" && typeof obj.text === "string") {
                  textParts.push(obj.text);
                  continue;
                }
                continue;
              } catch { /* not JSON, fall through */ }
            }
            // Plain-text lines — strip shell noise
            if (/^[%$#>→]\s*$/.test(t)) continue;
            if (/^[%$#>→]\s/.test(t)) continue;
            if (/^codex\s+/i.test(t)) continue;
            if (/^\[[\d;?<>!]*[a-zA-Z]/.test(t)) continue;
            if (/^[=\-\+\*~\s]+$/.test(t)) continue;
            textParts.push(t);
          }
          codexThinking = reasoningParts.join("\n\n").trim();
          responseText = textParts.join("\n").trim();
          if (!responseText) {
            const errorMatch = cleaned.match(/^Error:\s*(.+)/m) ?? cleaned.match(/error:\s*(.+)/im);
            if (errorMatch) responseText = `⚠️ Codex error: ${errorMatch[1].trim()}`;
          }
        } else {
          responseText = cleaned
            .split("\n")
            .filter((line) => {
              const t = line.trim();
              if (!t) return false;
              if (/^[%$#>→]\s*$/.test(t)) return false;
              if (/^[%$#>→]\s/.test(t)) return false;
              if (/^Restored session:/i.test(t)) return false;
              if (/^claude\s+(-p|-c|--print|--resume)/i.test(t)) return false;
              if (/^\[[\d;?<>!]*[a-zA-Z]/.test(t)) return false;
              if (/^[=\-\+\*~\s]+$/.test(t)) return false;
              return true;
            })
            .join("\n")
            .trim();

          if (!convData?.claude_session_id) {
            const claudeId = extractClaudeSessionId(stdout);
            if (claudeId) {
              await supabase.from("chat_conversations").update({ claude_session_id: claudeId }).eq("id", jobConvId);
            }
          }
        }

        responseText = responseText.trim() || "(empty response)";

        // Only do streaming reveal if this conv is still the active one
        const isActive = activeConvIdRef.current === jobConvId;
        if (isActive) {
          const tokens = responseText.split(/(?<=\s)|(?=\s)/);
          let revealedIdx: number;
          setMessages((prev) => {
            revealedIdx = prev.length;
            // Store raw stdout keyed by this message's index for the debug panel
            rawStdoutMapRef.current.set(revealedIdx, stdout);
            // Store codex reasoning if present
            if (convData?.agent === "codex" && (codexThinking ?? "")) {
              thinkingMapRef.current.set(revealedIdx, codexThinking ?? "");
              if (codexThinkingDurationMs !== undefined) {
                thinkingDurationMapRef.current.set(revealedIdx, codexThinkingDurationMs);
              }
            }
            return [...prev, { role: "assistant", content: "" }];
          });
          setThinking(false);
          setStreamingMsgIndex(revealedIdx!);

          await new Promise<void>((resolveStream) => {
            let tokenIdx = 0;
            let revealed = "";
            if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
            streamIntervalRef.current = setInterval(() => {
              if (abortStreamRef.current || tokenIdx >= tokens.length) {
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
        } else {
          // Background: just clear thinking if still set
          setThinking(false);
        }

        await saveMessage(jobConvId, "assistant", responseText);

        // Update title after first exchange using AI
        if (jobIsNew) {
          // Optimistic fallback title immediately
          const fallbackTitle = jobText.length > 60 ? jobText.slice(0, 57).trimEnd() + "…" : jobText;
          await supabase.from("chat_conversations").update({ title: fallbackTitle }).eq("id", jobConvId);
          setConversations((prev) => prev.map((c) => c.id === jobConvId ? { ...c, title: fallbackTitle } : c));

          // Fire AI title generation in the background (non-blocking)
          (async () => {
            try {
              const { data: titleData } = await supabase.functions.invoke("generate-title", {
                body: { userMessage: jobText, assistantMessage: responseText },
              });
              if (titleData?.title) {
                const aiTitle = titleData.title.replace(/^["']|["']$/g, "").trim();
                await supabase.from("chat_conversations").update({ title: aiTitle }).eq("id", jobConvId);
                setConversations((prev) => prev.map((c) => c.id === jobConvId ? { ...c, title: aiTitle } : c));
              }
            } catch {
              // silently keep the fallback title
            }
          })();
        }

        setConversations((prev) => {
          const conv = prev.find((c) => c.id === jobConvId);
          if (!conv) return prev;
          return [conv, ...prev.filter((c) => c.id !== jobConvId)];
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        const isActive = activeConvIdRef.current === jobConvId;
        if (isActive) {
          setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ Error: ${errMsg}` }]);
        }
        await saveMessage(jobConvId, "assistant", `⚠️ Error: ${errMsg}`);
      } finally {
        const isActive = activeConvIdRef.current === jobConvId;
        if (isActive) {
          setThinking(false);
          setStreamingMsgIndex(null);
          if (streamIntervalRef.current) { clearInterval(streamIntervalRef.current); streamIntervalRef.current = null; }
          setRelayStatus("idle");
          setTimeout(() => textareaRef.current?.focus(), 50);
        }
        removeJob(jobConvId);
      }
    };

    // Fire-and-forget — doesn't block the UI
    runJob();
  }, [input, attachedFiles, selectedDeviceId, activeConvId, agent, createConversation, buildCommand, sendViaRelay, toast, addJob, removeJob]);

  // ── Abort streaming ────────────────────────────────────────────────────
  const handleAbort = useCallback(() => {
    abortStreamRef.current = true;
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    setStreamingMsgIndex(null);
    setThinking(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  // ── Regenerate ─────────────────────────────────────────────────────────
  const handleRegenerate = useCallback(async () => {
    // Find the last user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (!lastUserMsg || !selectedDeviceId) return;

    // Remove the last assistant message from UI
    setMessages(prev => {
      const idx = [...prev].map(m => m.role).lastIndexOf("assistant");
      return idx >= 0 ? prev.slice(0, idx) : prev;
    });

    setInput(lastUserMsg.content);
    // Tiny delay so state settles, then fire
    setTimeout(() => {
      setInput("");
      abortStreamRef.current = false;
      const text = lastUserMsg.content;
      const userMsg: Message = { role: "user", content: text };
      setMessages(prev => [...prev, userMsg]);
      setThinking(true);
      const convId = activeConvId;
      if (!convId) return;
      saveMessage(convId, "user", text);
      const jobConvId = convId;
      const jobText = text;
      addJob(jobConvId);
      (async () => {
        const stripAnsi = (s: string) =>
          s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
           .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
           .replace(/\x1b[PX^_].*?\x1b\\/g, "")
           .replace(/\x1b[^[\]PX^_]/g, "")
           .replace(/\x1b/g, "")
           .replace(/\[[\d;?<>!]*[a-zA-Z]/g, "")
           .replace(/\][\d;][^\r\n]*/g, "")
           .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
        try {
          const command = await buildCommand(text, jobConvId, model);
          const stdout = await sendViaRelay(command, agent === "openclaw");
          const cleaned = stripAnsi(stdout);
          const { data: convData } = await supabase.from("chat_conversations").select("agent, openclaw_session_id, claude_session_id").eq("id", jobConvId).single();
          let responseText = "";
          if (convData?.agent === "openclaw") {
            const jsonBlocks = cleaned.match(/\{[\s\S]*?\}/g) ?? [];
            const greedyMatch = cleaned.match(/\{[\s\S]*\}/);
            const candidates = greedyMatch ? [...jsonBlocks, greedyMatch[0]] : jsonBlocks;
            for (let i = candidates.length - 1; i >= 0; i--) {
              try {
                const parsed = JSON.parse(candidates[i]);
                const payloadText = parsed?.payloads?.[0]?.text;
                if (payloadText) { responseText = String(payloadText); break; }
                const fallback = parsed.content ?? parsed.message ?? parsed.response ?? parsed.text ?? parsed.result;
                if (fallback && typeof fallback === "string") { responseText = fallback; break; }
              } catch { /* next */ }
            }
          } else if (convData?.agent === "codex") {
            responseText = cleaned.split("\n").filter(line => {
              const t = line.trim();
              if (!t) return false;
              if (/^[%$#>→]\s*$/.test(t)) return false;
              if (/^[%$#>→]\s/.test(t)) return false;
              if (/^codex\s+/i.test(t)) return false;
              if (/^\[[\d;?<>!]*[a-zA-Z]/.test(t)) return false;
              if (/^[=\-\+\*~\s]+$/.test(t)) return false;
              return true;
            }).join("\n").trim();
          } else {
            responseText = cleaned.split("\n").filter(line => {
              const t = line.trim();
              if (!t) return false;
              if (/^[%$#>→]\s*$/.test(t)) return false;
              if (/^[%$#>→]\s/.test(t)) return false;
              if (/^Restored session:/i.test(t)) return false;
              if (/^claude\s+(-p|-c|--print|--resume)/i.test(t)) return false;
              if (/^\[[\d;?<>!]*[a-zA-Z]/.test(t)) return false;
              if (/^[=\-\+\*~\s]+$/.test(t)) return false;
              return true;
            }).join("\n").trim();
          }
          responseText = responseText.trim() || "(empty response)";
          await saveMessage(jobConvId, "assistant", responseText);
          if (activeConvIdRef.current === jobConvId) {
            setMessages(prev => [...prev, { role: "assistant", content: responseText }]);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          if (activeConvIdRef.current === jobConvId) {
            setMessages(prev => [...prev, { role: "assistant", content: `⚠️ Error: ${errMsg}` }]);
          }
        } finally {
          if (activeConvIdRef.current === jobConvId) {
            setThinking(false);
            setStreamingMsgIndex(null);
            setRelayStatus("idle");
            setTimeout(() => textareaRef.current?.focus(), 50);
          }
          removeJob(jobConvId);
        }
      })();
    }, 0);
  }, [messages, selectedDeviceId, activeConvId, agent, model, buildCommand, sendViaRelay, addJob, removeJob]);


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
    const newAgent = value as "openclaw" | "claude" | "codex";
    if (activeConvId && messages.length > 0) {
      setAgentSwitchPending(newAgent);
    } else {
      setAgent(newAgent);
      setModel(newAgent === "openclaw" ? OPENCLAW_MODELS[1].id : newAgent === "codex" ? CODEX_MODELS[1].id : CLAUDE_MODELS[1].id);
      if (activeConvId) {
        supabase.from("chat_conversations").update({ agent: newAgent }).eq("id", activeConvId);
        setConversations((prev) => prev.map((c) => c.id === activeConvId ? { ...c, agent: newAgent } : c));
      }
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
          <div className="shrink-0 h-12 border-b border-border/30 flex items-center px-3 relative">
            {/* Left — sidebar trigger */}
            <SidebarTrigger />
            {/* Center — agent dropdown */}
            <div className="absolute left-1/2 -translate-x-1/2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <button className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 border border-border/30 bg-muted/20 hover:bg-muted/50 hover:border-border/60 text-foreground select-none">
                    <img src={agent === "openclaw" ? openclawImg : agent === "codex" ? codexImg : claudecodeImg} alt={agent} className="w-4 h-4 rounded-sm object-cover" />
                    <span>{agent === "openclaw" ? "OpenClaw" : agent === "codex" ? "Codex" : "Claude Code"}</span>
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-48">
                  {(["openclaw", "claude", "codex"] as const).map((a) => (
                    <DropdownMenuItem key={a} onClick={() => handleAgentChange(a)} className="flex items-center gap-2 cursor-pointer">
                      <img src={a === "openclaw" ? openclawImg : a === "codex" ? codexImg : claudecodeImg} alt={a} className="w-4 h-4 rounded-sm object-cover" />
                      <span>{a === "openclaw" ? "Remote OpenClaw" : a === "codex" ? "Remote Codex" : "Remote Claude Code"}</span>
                      {agent === a && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-foreground/60" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* Right — new chat + refresh + device pill */}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setActiveConvId(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-muted/40 hover:bg-muted/70 text-foreground transition-all duration-150 border border-border/30"
                title="New conversation"
              >
                <SquarePen className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => window.location.reload()}
                className="hidden sm:flex w-7 h-7 rounded-full items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-all duration-150"
                title="Refresh page"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150 border border-border/30 bg-muted/20 hover:bg-muted/50 hover:border-border/60 text-muted-foreground hover:text-foreground">
                    {(() => {
                      const dev = devices.find(d => d.id === selectedDeviceId);
                      return dev ? (
                        <>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dev.status === "online" ? "bg-status-online animate-pulse" : "bg-muted-foreground/40"}`} />
                          <span className="hidden sm:inline max-w-[120px] truncate">{dev.name}</span>
                        </>
                      ) : (
                        <span className="opacity-50 hidden sm:inline">No device</span>
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
          {/* Scroll-to-bottom floating button */}
          {isScrolledUp && (
            <button
              onClick={scrollToBottom}
              className={cn(
                "absolute bottom-[80px] sm:bottom-[88px] left-1/2 -translate-x-1/2 z-20",
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full",
                "bg-background/80 backdrop-blur-md border border-border/60",
                "text-xs text-muted-foreground hover:text-foreground",
                "shadow-lg hover:shadow-xl transition-all duration-200",
                "animate-[fade-in_0.2s_ease-out]"
              )}
            >
              {unreadCount > 0 && (
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-none">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
              <ChevronDown className="h-3.5 w-3.5" />
              <span>{unreadCount > 0 ? `${unreadCount} new` : "Jump to bottom"}</span>
            </button>
          )}

          <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-4 sm:py-6">
            <div className="max-w-[860px] mx-auto px-3 sm:px-6">
              {messages.length === 0 && !thinking && (
                <div className="flex flex-col items-center justify-center min-h-[70vh] sm:min-h-[80vh] text-center">

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
                        {(() => {
                          const tileColor = agent === "openclaw" ? "#DA5048" : agent === "codex" ? "#10B981" : "#D37551";
                          const [r, g, b] = agent === "openclaw" ? [218,80,72] : agent === "codex" ? [16,185,129] : [211,117,81];
                          return <>
                            <div className="absolute inset-0 rounded-3xl blur-xl scale-110" style={{ background: tileColor, opacity: 0.3 }} />
                            <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center" style={{
                              background: `linear-gradient(135deg, rgba(${r},${g},${b},0.35) 0%, rgba(${r},${g},${b},0.15) 100%)`,
                              boxShadow: `0 8px 32px rgba(${r},${g},${b},0.35), inset 0 1px 0 rgba(255,255,255,0.12)`,
                              outline: `1px solid rgba(${r},${g},${b},0.3)`,
                            }}>
                              <img src={agent === "openclaw" ? openclawImg : agent === "codex" ? codexImg : claudecodeImg} alt={agent} className="w-full h-full object-cover rounded-3xl" />
                            </div>
                          </>;
                        })()}
                      </div>
                      <h3 className="font-semibold text-foreground mb-2 text-lg animate-fade-in" style={{ animationDelay: "120ms", animationFillMode: "both" }}>
                        {agent === "openclaw" ? "Remote OpenClaw" : agent === "codex" ? "Remote Codex" : "Remote Claude Code"}
                      </h3>
                      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed mb-8 animate-fade-in" style={{ animationDelay: "220ms", animationFillMode: "both" }}>
                        {agent === "openclaw"
                          ? "Ask your local OpenClaw agent anything. Commands run on your selected device."
                          : agent === "codex"
                          ? "Send prompts directly to OpenAI Codex CLI running on your device."
                          : "Send prompts directly to Claude Code running on your device."}
                      </p>

                      {/* Starter prompt cards */}
                      <div className="grid grid-cols-2 gap-2.5 w-full max-w-lg mx-auto animate-fade-in" style={{ animationDelay: "340ms", animationFillMode: "both" }}>
                        {(agent === "openclaw" ? [
                          { icon: "📂", title: "List files", prompt: "List all files in the current directory" },
                          { icon: "🔍", title: "Search code", prompt: "Search for TODO comments in the codebase" },
                          { icon: "💻", title: "System info", prompt: "Show system info: OS, CPU, memory usage" },
                          { icon: "🌿", title: "Git status", prompt: "Show the current git status and recent commits" },
                        ] : agent === "codex" ? [
                          { icon: "🐛", title: "Fix a bug", prompt: "Find and fix the bug in my code" },
                          { icon: "✍️", title: "Write tests", prompt: "Write unit tests for the current file" },
                          { icon: "♻️", title: "Refactor", prompt: "Refactor this code to be cleaner and more readable" },
                          { icon: "📖", title: "Explain code", prompt: "Explain what this code does step by step" },
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
                      streaming={streamingMsgIndex === i}
                      rawStdout={msg.role === "assistant" ? (msg as any).rawStdout : undefined}
                      thinkingContent={msg.role === "assistant" ? thinkingMapRef.current.get(i) : undefined}
                      thinkingDurationMs={msg.role === "assistant" ? thinkingDurationMapRef.current.get(i) : undefined}
                      createdAt={msg.created_at}
                      agent={agent}
                      onRegenerate={
                        msg.role === "assistant" &&
                        i === messages.length - 1 &&
                        !thinking &&
                        streamingMsgIndex === null
                          ? handleRegenerate
                          : undefined
                      }
                    />
                  </div>
                ))}
                {thinking && (
                  <div className="animate-fade-in">
                    <ChatMessage role="assistant" content="" thinking agent={agent} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Floating composer */}
          <div className="shrink-0 px-3 sm:px-6 pt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
            <div className="max-w-[860px] mx-auto">
              {/* Stop streaming button */}
              {(thinking || streamingMsgIndex !== null) && (
                <div className="flex justify-center mb-3">
                  <button
                    onClick={handleAbort}
                    className="flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-accent transition-all duration-150 shadow-sm animate-fade-in"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    Stop generating
                  </button>
                </div>
              )}
              <ComposerBox
                textareaRef={textareaRef}
                fileInputRef={fileInputRef}
                input={input}
                setInput={setInput}
                onKeyDown={handleKeyDown}
                onSend={handleSend}
                disabled={!selectedDeviceId}
                sendDisabled={(!input.trim() && attachedFiles.length === 0)}
                placeholder={selectedDeviceId ? `Message ${agent === "openclaw" ? "OpenClaw" : agent === "codex" ? "Codex" : "Claude Code"}…` : "Select a device first…"}
                attachedFiles={attachedFiles}
                onRemoveFile={(i) => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                onFileSelect={processFiles}
                agent={agent}
                model={model}
                onSlashCommand={handleSlashCommand}
                onAgentChange={handleAgentChange}
                onModelChange={(m) => {
                  setModel(m);
                  if (activeConvId) {
                    supabase.from("chat_conversations").update({ model: m }).eq("id", activeConvId);
                    setConversations((prev) => prev.map((c) => c.id === activeConvId ? { ...c, model: m } : c));
                  }
                }}
              />
              <p className="hidden sm:block text-center text-[10px] text-muted-foreground/40 mt-2 select-none whitespace-nowrap">
                Enter to send · Shift+Enter for newline · <span className="font-mono">/</span> for commands
              </p>
            </div>
          </div>
        </div>

        {/* Agent switch confirmation */}
        <AlertDialog open={!!agentSwitchPending} onOpenChange={(open) => { if (!open) setAgentSwitchPending(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Start a new conversation with {agentSwitchPending === "openclaw" ? "OpenClaw" : agentSwitchPending === "codex" ? "Codex" : "Claude Code"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Switching agents will start a fresh conversation. Your current conversation will be preserved and accessible from the sidebar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                setAgent(agentSwitchPending!);
                setModel(agentSwitchPending === "openclaw" ? OPENCLAW_MODELS[1].id : agentSwitchPending === "codex" ? CODEX_MODELS[1].id : CLAUDE_MODELS[1].id);
                setAgentSwitchPending(null);
                setActiveConvId(null);
                handleNew();
              }}>
                Start New Chat
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
