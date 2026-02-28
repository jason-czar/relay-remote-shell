import { useState, useEffect, useRef, useCallback } from "react";
import openclawImg from "@/assets/openclaw.png";
import claudecodeImg from "@/assets/claudecode.png";
import codexImg from "@/assets/codex.png";
import terminalIconImg from "@/assets/terminal-icon.png";
import { EmbeddedTerminal } from "@/components/EmbeddedTerminal";
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
import { useDeviceModels, invalidateDeviceModelCache } from "@/hooks/useDeviceModels";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { Tables } from "@/integrations/supabase/types";
import { useChatContext } from "@/contexts/ChatContext";
import { SetupWizard } from "@/components/SetupWizard";
import { QuickStart } from "@/components/QuickStart";
import { DevicePanel } from "@/components/DevicePanel";
import { useRelayHealth } from "@/hooks/useRelayHealth";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

// OpenClaw: model list can't be reliably queried from the device — Auto only
export const OPENCLAW_MODELS: AgentModel[] = [
{ id: "auto", label: "Auto", description: "Use agent's default model" }];

// Claude Code: model list can't be reliably queried from the device — Auto only
export const CLAUDE_MODELS: AgentModel[] = [
{ id: "auto", label: "Auto", description: "Use Claude Code's default model" }];

// Codex CLI — models confirmed available (from codex model picker)
export const CODEX_MODELS: AgentModel[] = [
{ id: "auto", label: "Auto", description: "Use Codex's default model" },
{ id: "gpt-5.3-codex", label: "GPT-5.3-Codex", description: "Latest Codex model" },
{ id: "gpt-5.2-codex", label: "GPT-5.2-Codex", description: "Previous Codex" },
{ id: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max", description: "Max capacity" },
{ id: "gpt-5.2", label: "GPT-5.2", description: "General purpose" },
{ id: "gpt-5.1-codex-mini", label: "GPT-5.1-Codex-Mini", description: "Fast & lightweight" }];


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
  clientAction: "clear"
},
{
  name: "new",
  description: "Start a new conversation",
  agents: ["both"],
  clientAction: "new"
},
{
  name: "compact",
  description: "Compact conversation context to save tokens",
  agents: ["both"],
  rawCommand: (agent) =>
  agent === "openclaw" ? `openclaw compact\n` : agent === "codex" ? `codex --compact\n` : `claude --compact\n`
},
{
  name: "status",
  description: "Show agent status (uptime, tasks, last error)",
  agents: ["openclaw"],
  rawCommand: () => `openclaw status --json\n`
},
{
  name: "restart",
  description: "Gracefully restart the OpenClaw agent process",
  agents: ["openclaw"],
  rawCommand: () => `openclaw restart\n`
},
{
  name: "resume",
  description: "Resume the last Claude Code session",
  agents: ["claude"],
  rawCommand: () => `claude -c -p "continue"\n`
},
{
  name: "codex-resume",
  description: "Resume the last Codex session",
  agents: ["codex"],
  rawCommand: () => `codex --resume\n`
},
{
  name: "help",
  description: "Show available slash commands",
  agents: ["both"],
  clientAction: "help"
}];


// ── Composer component ──────────────────────────────────────────────────────
interface ComposerBoxProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  isStreaming?: boolean;
  onAbort?: () => void;
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
  agent: "openclaw" | "claude" | "codex" | "terminal";
  model: string;
  onSlashCommand: (cmd: SlashCommand) => void;
  onAgentChange: (agent: "openclaw" | "claude" | "codex" | "terminal") => void;
  onModelChange: (model: string) => void;
  deviceId: string | null;
}

function ComposerBox({ textareaRef, fileInputRef, input, setInput, onKeyDown, onSend, disabled, sendDisabled, placeholder, attachedFiles, onRemoveFile, onFileSelect, agent, model, onSlashCommand, onAgentChange, onModelChange, isStreaming, onAbort, deviceId }: ComposerBoxProps) {
  const [focused, setFocused] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [isDictating, setIsDictating] = useState(false);
  const [dictateError, setDictateError] = useState<string | null>(null);

  const { models: deviceModels, loading: modelsLoading, error: modelsError, fetch: fetchModels } = useDeviceModels();

  // Base (static) models per agent — fallback when dynamic fetch unavailable
  const staticModels = agent === "openclaw" ? OPENCLAW_MODELS : agent === "claude" ? CLAUDE_MODELS : CODEX_MODELS;
  // Merge: prepend Auto, then dynamic models; fall back to static if no device or fetch failed
  const displayModels: AgentModel[] = deviceModels && deviceModels.length > 0
    ? [{ id: "auto", label: "Auto", description: `Use ${agent === "openclaw" ? "OpenClaw" : agent === "codex" ? "Codex" : "Claude Code"}'s default model` }, ...deviceModels]
    : staticModels;

  // Auto-fetch models when a device is selected and agent changes
  useEffect(() => {
    if (deviceId && agent !== "terminal") fetchModels(deviceId, agent);
  }, [deviceId, agent]); // eslint-disable-line react-hooks/exhaustive-deps



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
    }
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
          Authorization: `Bearer ${supabaseKey}`
        }
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
  const slashMatches = slashQuery !== null ?
  SLASH_COMMANDS.filter((c) => c.name.toLowerCase().startsWith(slashQuery) || c.description.toLowerCase().includes(slashQuery)) :
  [];

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
      {slashMatches.length > 0 &&
      <div className="absolute bottom-full mb-2 left-0 right-0 rounded-xl overflow-hidden z-30 bg-popover border border-border shadow-xl">
          {slashMatches.map((cmd, i) =>
        <button
          key={cmd.name}
          onMouseDown={(e) => {e.preventDefault();onSlashCommand(cmd);}}
          className={cn(
            "w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-accent transition-colors",
            i === slashIdx && "bg-accent"
          )}>

              <span className="font-mono text-primary">/{cmd.name}</span>
              <span className="text-muted-foreground">{cmd.description}</span>
            </button>
        )}
        </div>
      }

      {/* File attachment chips */}
      {attachedFiles.length > 0 &&
      <div className="flex flex-wrap gap-1.5 mb-2 px-1">
          {attachedFiles.map((f, i) =>
        <div key={i} className="flex items-center gap-1 bg-accent/50 rounded-full px-2.5 py-1 text-xs text-foreground/80 border border-border/50">
              <span className="max-w-[120px] truncate">{f.name}</span>
              <button onClick={() => onRemoveFile(i)} className="text-muted-foreground hover:text-foreground ml-0.5">×</button>
            </div>
        )}
        </div>
      }

      {/* Main composer card */}
      <div
        className={cn(
          "flex flex-col rounded-[26px] px-4 pt-2.5 pb-1.5 transition-all duration-150",
          "bg-[hsl(0,0%,11%)] border-2",
          focused ? "border-border/40" : "border-border/40",
          disabled && "opacity-60 pointer-events-none"
        )}>

        {/* Textarea row */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={(e) => {
            if (slashMatches.length > 0) {
              if (e.key === "ArrowDown") {e.preventDefault();setSlashIdx((p) => Math.min(p + 1, slashMatches.length - 1));return;}
              if (e.key === "ArrowUp") {e.preventDefault();setSlashIdx((p) => Math.max(p - 1, 0));return;}
              if (e.key === "Enter" && !e.shiftKey) {e.preventDefault();onSlashCommand(slashMatches[slashIdx]);return;}
            }
            onKeyDown(e);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          style={{ height: "48px", overflowY: "hidden", resize: "none" }}
          className="text-[19px] min-h-[48px] w-full bg-transparent border-0 \nfocus:outline-none focus-visible:outline-none\nfocus:ring-0 focus:ring-offset-0\nfocus-visible:ring-0 focus-visible:ring-offset-0\nshadow-none p-0\nplaceholder:text-muted-foreground/30\ntext-foreground" />


        {/* Waveform — shown while dictating */}
        {isDictating &&
        <div className="flex items-center gap-[3px] py-1" aria-hidden>
            <div className="waveform-bar" />
            <div className="waveform-bar" />
            <div className="waveform-bar" />
            <div className="waveform-bar" />
            <div className="waveform-bar" />
            <div className="waveform-bar" />
            <div className="waveform-bar" />
          </div>
        }

        {/* Bottom action row */}
        <div className="flex items-center justify-between mt-1">
          {/* Left: attach + model/agent picker */}
          <div className="flex items-center gap-2">
            {/* Attach button */}
            <button
              type="button"
              title="Attach file"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center h-10 w-10 rounded-full bg-[hsl(0,0%,22%)] text-foreground/70 hover:text-foreground hover:bg-[hsl(0,0%,28%)] transition-colors">

              <Paperclip size={18} />
            </button>
            <input ref={fileInputRef} type="file" className="hidden" multiple onChange={(e) => {if (e.target.files) onFileSelect(e.target.files);}} />

            {/* Agent + model selector pill */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 h-10 px-4 rounded-full bg-[hsl(0,0%,22%)] text-foreground/70 hover:text-foreground hover:bg-[hsl(0,0%,28%)] transition-colors text-[15px] font-medium">

                  {agent === "openclaw" ? <img src={openclawImg} className="w-5 h-5 object-contain" alt="" /> : agent === "claude" ? <img src={claudecodeImg} className="w-5 h-5 object-contain" alt="" /> : <img src={codexImg} className="w-5 h-5 object-contain" alt="" />}
                  <span>{model === "auto" ? "Auto" : model.split("-").slice(-2).join(" ")}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[200px]">
                {/* Header with refresh */}
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/30 mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">Model</span>
                  {deviceId && agent !== "terminal" && (
                    <button
                      onClick={() => { if (deviceId) { invalidateDeviceModelCache(deviceId, agent); fetchModels(deviceId, agent); } }}
                      disabled={modelsLoading}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors disabled:opacity-40"
                      title="Refresh model list from device"
                    >
                      <RefreshCw className={cn("h-3 w-3", modelsLoading && "animate-spin")} />
                      {modelsLoading ? "Loading…" : "Refresh"}
                    </button>
                  )}
                </div>
                {modelsError && (
                  <div className="px-2 py-1.5 mb-1">
                    <p className="text-[10px] text-muted-foreground/50 italic">Could not fetch models — showing defaults</p>
                  </div>
                )}
                {displayModels.map((m) =>
                  <DropdownMenuItem key={m.id} onSelect={() => onModelChange(m.id)} className={cn(model === m.id && "bg-accent")}>
                    <span className="font-medium">{m.label}</span>
                    {m.description && <span className="ml-auto text-xs text-muted-foreground">{m.description}</span>}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Mic button */}
            <button
              type="button"
              title={isDictating ? "Stop dictation" : "Voice input"}
              onClick={toggleDictation}
              className={cn(
                "flex items-center justify-center h-10 w-10 rounded-full transition-all duration-200",
                isDictating ?
                "bg-destructive/20 text-destructive animate-pulse" :
                "bg-[hsl(0,0%,22%)] text-foreground/70 hover:text-foreground hover:bg-[hsl(0,0%,28%)]"
              )}>

              <Mic size={18} />
            </button>
          </div>

          {/* Right: send button */}
          <div className="relative flex items-center justify-center">
            {/* Pulse ring while streaming */}
            {isStreaming &&
            <span className="absolute inset-0 rounded-full animate-ping bg-foreground/20 pointer-events-none" />
            }
          <button
              type="button"
              onClick={isStreaming ? onAbort : onSend}
              disabled={!isStreaming && (sendDisabled || disabled)}
              title={isStreaming ? "Stop generating" : "Send"}
              className={cn(
                "relative flex items-center justify-center h-11 w-11 rounded-full",
                "transition-all duration-300 ease-in-out overflow-hidden",
                isStreaming ?
                "bg-foreground text-background hover:opacity-80 shadow-md scale-100" :
                sendDisabled || disabled ?
                "bg-muted/30 text-muted-foreground/30 cursor-not-allowed scale-95" :
                "bg-foreground text-background hover:opacity-80 shadow-md scale-100"
              )}>

            <span
                className={cn(
                  "absolute inset-0 flex items-center justify-center transition-all duration-200",
                  isStreaming ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 rotate-90"
                )}>

              <Square size={15} className="fill-current" />
            </span>
            <span
                className={cn(
                  "absolute inset-0 flex items-center justify-center transition-all duration-200",
                  isStreaming ? "opacity-0 scale-50 -rotate-90" : "opacity-100 scale-100 rotate-0"
                )}>

              <ArrowUp size={19} />
            </span>
          </button>
          </div>
        </div>
      </div>

      {dictateError &&
      <p className="text-xs text-destructive mt-1 pl-3">{dictateError}</p>
      }
    </div>);

}

// ── Friendly display names for known tool names ──────────────────────────────
const TOOL_LABELS: Record<string, string> = {
  bash: "Bash", shell: "Bash", run: "Bash", exec: "Bash",
  edit: "Edit file", write_file: "Write file", create_file: "Create file",
  str_replace_editor: "Edit file", str_replace_based_edit_tool: "Edit file",
  read_file: "Read file", cat: "Read file",
  search: "Search", grep: "Search", ripgrep: "Search", web_search: "Web search",
  find: "Find", ls: "List files", list_directory: "List files",
  mkdir: "Make dir", computer: "Computer", browser: "Browser",
  todo_write: "Todo", notebook_edit: "Edit notebook",
};

function friendlyToolName(raw: string): string {
  const key = raw.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return TOOL_LABELS[key] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Chunk → activity status + tool name parser ────────────────────────────────
function parseChunkActivity(chunk: string): { status: "thinking" | "writing" | "running" | null; toolName: string | null } {
  // Tool-call signals — try to extract the tool name from JSON
  if (/\"type\"\s*:\s*\"tool_use\"/.test(chunk)) {
    const nameMatch = chunk.match(/"name"\s*:\s*"([^"]+)"/);
    return { status: "running", toolName: nameMatch ? friendlyToolName(nameMatch[1]) : "Tool" };
  }
  // Named tool patterns without full JSON
  const toolMatch = chunk.match(/\"name\"\s*:\s*\"(Bash|bash|shell|run|exec|grep|find|cat|ls|mkdir|write_file|Edit|create_file|computer|str_replace|web_search|search|read_file|browser|notebook)[^"]*\"/);
  if (toolMatch) return { status: "running", toolName: friendlyToolName(toolMatch[1]) };
  if (/running tool|tool_input|tool_result/i.test(chunk)) return { status: "running", toolName: null };
  // Write / edit → writing
  if (/\"type\"\s*:\s*\"(text_delta|content_block_start)\"|writing|editing|creating/i.test(chunk)) return { status: "writing", toolName: null };
  // Reasoning → thinking
  if (/<thinking>|\"type\"\s*:\s*\"thinking\"|reasoning/i.test(chunk)) return { status: "thinking", toolName: null };
  return { status: null, toolName: null };
}

export default function Chat() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { conversations, setConversations, activeConvId, setActiveConvId, registerNewCallback, addJob, removeJob, activeJobs } = useChatContext();
  // Keep a ref so async callbacks can always read the latest active conversation
  const activeConvIdRef = useRef<string | null>(null);
  // Store raw relay stdout keyed by message array index (session-only, not persisted)
  const rawStdoutMapRef = useRef<Map<number, string>>(new Map());
  // Store tool calls used per message (session-only, not persisted)
  const toolCallsMapRef = useRef<Map<number, string[]>>(new Map());
  // Store codex reasoning summaries keyed by message array index
  const thinkingMapRef = useRef<Map<number, string>>(new Map());
  const thinkingDurationMapRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {activeConvIdRef.current = activeConvId;}, [activeConvId]);

  // ── State ──────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [agent, setAgent] = useState<"openclaw" | "claude" | "codex" | "terminal">("openclaw");
  const [model, setModel] = useState<string>(() => {
    return localStorage.getItem("chat-model-default") ?? "auto";
  });
  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string>(() => {
    return localStorage.getItem("chat-device-id") ?? "";
  });
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [agentSwitchPending, setAgentSwitchPending] = useState<"openclaw" | "claude" | "codex" | "terminal" | null>(null);
  const [streamingMsgIndex, setStreamingMsgIndex] = useState<number | null>(null);
  const [activityStatus, setActivityStatus] = useState<"thinking" | "writing" | "running" | null>(null);
  const activityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [toolCalls, setToolCalls] = useState<string[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [projectId, setProjectId] = useState<string>("");
  const [relayStatus, setRelayStatus] = useState<"idle" | "connecting" | "retrying" | "failed">("idle");
  const relayRetryCountRef = useRef(0);
  const [gitStatus, setGitStatus] = useState<{
    branch: string;
    files: number;
    insertions: number;
    deletions: number;
  } | null | "loading">(null);
  const gitFetchedForRef = useRef<string | null>(null);
  const [gitRefreshTick, setGitRefreshTick] = useState(0);


  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortStreamRef = useRef(false);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // ── Activity status helpers ───────────────────────────────────────────────
  const startActivity = useCallback(() => {
    if (activityTimerRef.current) clearInterval(activityTimerRef.current);
    activityTimerRef.current = null;
    setActivityStatus("thinking");
    setToolCalls([]);
  }, []);

  // Called for each live stdout chunk — promotes status based on content
  const onChunkActivity = useCallback((chunk: string) => {
    const { status, toolName } = parseChunkActivity(chunk);
    if (status) setActivityStatus(status);
    if (toolName) setToolCalls((prev) => prev.includes(toolName) ? prev : [...prev, toolName]);
  }, []);

  const stopActivity = useCallback(() => {
    if (activityTimerRef.current) { clearInterval(activityTimerRef.current); activityTimerRef.current = null; }
    setActivityStatus(null);
    setToolCalls([]);
  }, []);
  const prevMsgCountRef = useRef(0);

  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const { health: relayHealth, refresh: refreshRelayHealth } = useRelayHealth(true);

  // ── Device selection with per-device agent persistence ───────────────
  const setSelectedDeviceId = useCallback((id: string) => {
    setSelectedDeviceIdState(id);
    localStorage.setItem("chat-device-id", id);
    // Restore the agent & model last used with this device
    const savedAgent = localStorage.getItem(`chat-agent-${id}`);
    if (savedAgent) setAgent(savedAgent as "openclaw" | "claude" | "codex" | "terminal");
    const savedModel = localStorage.getItem(`chat-model-${id}`);
    if (savedModel) setModel(savedModel);
  }, []);

  // Persist agent selection keyed by device whenever either changes
  useEffect(() => {
    if (selectedDeviceId) {
      localStorage.setItem(`chat-agent-${selectedDeviceId}`, agent);
      localStorage.setItem(`chat-model-${selectedDeviceId}`, model);
    }
    // Also persist as global default
    localStorage.setItem("chat-model-default", model);
  }, [agent, model, selectedDeviceId]);

  // ── Load devices ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    // Load devices + first project in parallel
    Promise.all([
    supabase.from("devices").select("id, name, status, project_id, user_id"),
    supabase.from("projects").select("id").limit(1).single()]
    ).then(([devRes, projRes]) => {
      const data = devRes.data;
      if (data) {
        setDevices(data as Tables<"devices">[]);
          if (!devicesLoaded) {
            setDevicesLoaded(true);
            if (data.length === 0) setDevicePanelOpen(true);
          }
          if (data.length > 0) {
          // Use persisted device if still valid, else pick online/first
          const persisted = localStorage.getItem("chat-device-id");
          const found = persisted ? data.find((d) => d.id === persisted) : null;
          if (!found) {
            const online = data.find((d) => d.status === "online");
            setSelectedDeviceId((online ?? data[0]).id);
          } else if (!selectedDeviceId) {
            // restore without overwriting agent (setSelectedDeviceId handles it)
            setSelectedDeviceId(found.id);
          }
        }
      }
      if (projRes.data) setProjectId(projRes.data.id);
    });
  }, [user]);

  // ── Load messages on conversation select ──────────────────────────────
  useEffect(() => {
    if (!activeConvId) {setMessages([]);return;}
    supabase.
    from("chat_messages").
    select("id, role, content, created_at, raw_stdout").
    eq("conversation_id", activeConvId).
    order("created_at", { ascending: true }).
    then(({ data }) => {
      if (data) {
        setMessages(data as Message[]);
        // Restore raw_stdout for the debug panel on historical messages
        rawStdoutMapRef.current.clear();
        data.forEach((msg, idx) => {
          if (msg.role === "assistant" && (msg as any).raw_stdout) {
            rawStdoutMapRef.current.set(idx, (msg as any).raw_stdout as string);
          }
        });
      }
    });
  }, [activeConvId]);

  // ── Auto-fetch git status when conversation is opened ─────────────────
  useEffect(() => {
    if (!activeConvId || !selectedDeviceId) { setGitStatus(null); return; }
    if (gitFetchedForRef.current === activeConvId) return;
    gitFetchedForRef.current = activeConvId;
    setGitStatus("loading");
    (async () => {
      try {
        const cmd = `git branch --show-current 2>/dev/null && git diff --stat HEAD 2>/dev/null | tail -1`;
        const { data: sesData } = await supabase.functions.invoke("start-session", { body: { device_id: selectedDeviceId } });
        if (!sesData?.session_id) { setGitStatus(null); return; }
        const sessionId: string = sesData.session_id;
        const relayUrl = import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com";
        const { data: { session: authSession } } = await supabase.auth.getSession();
        const jwt = authSession?.access_token;
        if (!jwt) { setGitStatus(null); return; }
        const raw = await new Promise<string>((resolve) => {
          const ws = new WebSocket(`${relayUrl}/session`);
          let buf = ""; let done = false; let silTimer: ReturnType<typeof setTimeout> | null = null;
          const finish = (v: string) => { if (done) return; done = true; if (silTimer) clearTimeout(silTimer); if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type: "session_end", data: { session_id: sessionId, reason: "done" } })); ws.close(); } supabase.functions.invoke("end-session", { body: { session_id: sessionId } }).catch(() => {}); resolve(v); };
          const resetSil = () => { if (silTimer) clearTimeout(silTimer); silTimer = setTimeout(() => finish(buf), 2500); };
          setTimeout(() => finish(buf), 12000);
          let promptSent = false;
          ws.onopen = () => ws.send(JSON.stringify({ type: "auth", data: { token: jwt, session_id: sessionId, device_id: selectedDeviceId } }));
          ws.onmessage = (e) => {
            try {
              const msg = JSON.parse(e.data);
              if (msg.type === "auth_ok") {
                ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: 200, rows: 10 } }));
                const PROMPT_RE = /(?:[%$#➜❯>]\s*$)/m;
                const trySend = () => { if (promptSent) return; const plain = buf.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "").replace(/\x1b[^[\]]/g, ""); if (PROMPT_RE.test(plain)) { promptSent = true; buf = ""; ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(cmd + "\n") } })); resetSil(); } };
                setTimeout(() => { if (!promptSent) { promptSent = true; buf = ""; ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(cmd + "\n") } })); resetSil(); } }, 4000);
                const origH = ws.onmessage; ws.onmessage = (ev) => { origH?.call(ws, ev); trySend(); };
              } else if (msg.type === "stdout") { const { data_b64 } = (msg.data ?? {}) as { data_b64: string }; if (data_b64) { try { buf += decodeURIComponent(escape(atob(data_b64))); } catch { buf += atob(data_b64); } resetSil(); }
              } else if (msg.type === "session_end") { finish(buf); }
            } catch {/* ignore */}
          };
          ws.onerror = () => finish(buf);
        });
        const clean = raw.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "").replace(/\x1b[^[\]]/g, "").replace(/\r/g, "");
        const lines = clean.split("\n").map(l => l.trim()).filter(Boolean);
        const branch = lines[0] ?? "";
        const statLine = lines.find(l => l.includes("changed")) ?? "";
        const filesMatch = statLine.match(/(\d+)\s+files? changed/);
        const insMatch = statLine.match(/(\d+)\s+insertions?\(\+\)/);
        const delMatch = statLine.match(/(\d+)\s+deletions?\(-\)/);
        if (!branch || branch.includes(" ") || branch.length > 100) { setGitStatus(null); return; }
        setGitStatus({ branch, files: filesMatch ? parseInt(filesMatch[1]) : 0, insertions: insMatch ? parseInt(insMatch[1]) : 0, deletions: delMatch ? parseInt(delMatch[1]) : 0 });
      } catch { setGitStatus(null); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, selectedDeviceId, gitRefreshTick]);

  // Restore agent + model when conversation or conversations list changes (handles refresh where


  // ── Reload messages when a background job for the active conv finishes ──
  const prevJobsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeConvId) return;
    const wasRunning = prevJobsRef.current.has(activeConvId);
    const isRunning = activeJobs.has(activeConvId);
    // Job just finished for the active conversation → reload from DB
    if (wasRunning && !isRunning) {
      supabase.
      from("chat_messages").
      select("id, role, content, raw_stdout").
      eq("conversation_id", activeConvId).
      order("created_at", { ascending: true }).
      then(({ data }) => {
        if (data) {
          setMessages(data as Message[]);
          rawStdoutMapRef.current.clear();
          data.forEach((msg, idx) => {
            if (msg.role === "assistant" && (msg as any).raw_stdout) {
              rawStdoutMapRef.current.set(idx, (msg as any).raw_stdout as string);
            }
          });
        }
      });
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
      const newAssistant = messages.slice(prevMsgCountRef.current).filter((m) => m.role === "assistant").length;
      if (newAssistant > 0) setUnreadCount((c) => c + newAssistant);
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

    const { data, error } = await supabase.
    from("chat_conversations").
    insert({
      user_id: user.id,
      device_id: selectedDeviceId || null,
      agent: agentType,
      model,
      title,
      openclaw_session_id
    }).
    select("id, title, agent, model, created_at").
    single();

    if (error || !data) {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
      return null;
    }
    setConversations((prev) => [data as import("@/contexts/ChatContext").Conversation, ...prev]);
    setActiveConvId(data.id);
    return data.id;
  }, [user, selectedDeviceId, toast]);

  // ── Save message to DB ─────────────────────────────────────────────────
  const saveMessage = async (convId: string, role: "user" | "assistant", content: string, rawStdout?: string) => {
    await supabase.from("chat_messages").insert({ conversation_id: convId, role, content, ...(rawStdout ? { raw_stdout: rawStdout } : {}) } as any);
    // bump updated_at
    await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
  };

  // ── Relay send (with auto-retry + status banner) ───────────────────────
  const sendViaRelay = useCallback(async (command: string, isOpenClaw = false, onChunk?: (chunk: string) => void): Promise<string> => {
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
        const result = await sendViaRelayOnce(command, isOpenClaw, onChunk);
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

  const sendViaRelayOnce = useCallback(async (command: string, isOpenClaw = false, onChunk?: (chunk: string) => void): Promise<string> => {
    // 1. Start session
    const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", {
      body: { device_id: selectedDeviceId }
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
        if (result instanceof Error) reject(result);else
        resolve(result);
      };

      const resetSilence = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        // If the output already contains a CLI error line, finish immediately
        const hasError = /^Error:/m.test(outputBuffer) || /^error:/im.test(outputBuffer);
        if (hasError) {finish(outputBuffer);return;}
        silenceTimer = setTimeout(() => {
          // For OpenClaw: detect complete JSON object and finish immediately — no need to wait full 8s
          if (isOpenClaw) {
            if (!outputBuffer.includes("{")) return; // no JSON yet
            // Walk the buffer to find a balanced top-level { ... } and finish early
            const firstBrace = outputBuffer.indexOf("{");
            let depth = 0,inStr = false,esc = false;
            for (let i = firstBrace; i < outputBuffer.length; i++) {
              const c = outputBuffer[i];
              if (esc) {esc = false;continue;}
              if (c === "\\" && inStr) {esc = true;continue;}
              if (c === '"') {inStr = !inStr;continue;}
              if (inStr) continue;
              if (c === "{") depth++;else
              if (c === "}") {depth--;if (depth === 0) {finish(outputBuffer);return;}}
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
          data: { token: jwt, session_id: sessionId, device_id: selectedDeviceId }
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg: RelayMsg = JSON.parse(event.data);
          if (msg.type === "auth_ok") {
            ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: 200, rows: 50 } }));
            // Prompt detection: wait until stdout contains a recognisable shell prompt
            // before sending the command, rather than relying on fixed delays.
            let promptSent = false;
            const PROMPT_RE = /(?:[%$#➜❯>]\s*$)|(?:\$\s+$)/m;
            const PROMPT_TIMEOUT = 5000;
            const promptDeadline = setTimeout(() => {
              if (!promptSent) { promptSent = true; sendCommand(); }
            }, PROMPT_TIMEOUT);
            const checkPrompt = () => {
              if (promptSent) return;
              // Strip ANSI from the accumulated buffer before testing
              const plain = outputBuffer
                .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
                .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
                .replace(/\x1b[^[\]]/g, "")
                .replace(/\x1b/g, "");
              if (PROMPT_RE.test(plain)) {
                clearTimeout(promptDeadline);
                promptSent = true;
                sendCommand();
              }
            };
            const sendCommand = () => {
              outputBuffer = ""; // discard shell init noise
              ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(command) } }));
              resetSilence();
            };
            // Patch the stdout handler to also run the prompt check
            const origOnMessage = ws.onmessage;
            ws.onmessage = (event) => {
              origOnMessage?.call(ws, event);
              if (!promptSent) checkPrompt();
            };
          } else if (msg.type === "stdout") {
            const { data_b64 } = (msg.data ?? {}) as {data_b64: string;};
            if (data_b64) {
              try {
                const chunk = decodeURIComponent(escape(atob(data_b64)));
                outputBuffer += chunk;
                onChunk?.(chunk);
                resetSilence();
              } catch {
                const chunk = atob(data_b64);
                outputBuffer += chunk;
                onChunk?.(chunk);
                resetSilence();
              }
            }
          } else if (msg.type === "session_end") {
            finish(outputBuffer);
          } else if (msg.type === "error") {
            const { message } = (msg.data ?? {}) as {message?: string;};
            finish(new Error(message ?? "Relay error"));
          }
        } catch {/* ignore */}
      };

      ws.onerror = (e) => {console.error("[Relay] WebSocket error", e);finish(new Error("WebSocket error"));};
      ws.onclose = (e) => {
        // If the WebSocket closes unexpectedly (e.g. relay rejected the session) and we haven't finished yet, resolve with whatever we have
        if (silenceTimer || hardTimeout) finish(outputBuffer || new Error(`WebSocket closed (code ${e.code})`));
      };
    });
  }, [selectedDeviceId]);

  // ── Build command string ───────────────────────────────────────────────
  const buildCommand = useCallback(async (text: string, convId: string, selectedModel: string): Promise<string> => {
    const { data: conv } = await supabase.
    from("chat_conversations").
    select("agent, openclaw_session_id, claude_session_id").
    eq("id", convId).
    single();
    if (!conv) throw new Error("Conversation not found");

    const escaped = text.replace(/"/g, '\\"');
    // "auto" = omit --model flag entirely, let the CLI use its configured default
    const modelFlag = selectedModel !== "auto" ? `--model ${selectedModel}` : "";

    if (conv.agent === "openclaw") {
      const sid = conv.openclaw_session_id ?? crypto.randomUUID();
      const modelPart = modelFlag ? ` ${modelFlag}` : "";
      return `openclaw agent --agent main --session-id ${sid}${modelPart} --message "${escaped}" --json --local\n`;
    } else if (conv.agent === "codex") {
      // Codex CLI: resume synced sessions by ID; otherwise fresh
      const modelPart = modelFlag ? ` --model ${selectedModel}` : "";
      if (conv.claude_session_id) {
        return `codex${modelPart} --resume ${conv.claude_session_id} -q "${escaped}"\n`;
      }
      return `codex${modelPart} -q "${escaped}"\n`;
    } else {
      // claude
      const modelPart = modelFlag ? ` ${modelFlag}` : "";
      if (conv.claude_session_id) {
        // Use --resume <id> for exact session targeting (synced or previously started)
        return `claude --resume ${conv.claude_session_id}${modelPart} -p "${escaped}"\n`;
      }
      return `claude${modelPart} -p "${escaped}"\n`;
    }
  }, []);


  // ── Parse claude session id from stdout ───────────────────────────────
  const extractClaudeSessionId = (stdout: string): string | null => {
    const match = stdout.match(/Session ID:\s*(\S+)/i) ?? stdout.match(/"session_id"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  };

  // ── Extract working directory from OSC 7 sequences in stdout ─────────
  // Shells like zsh/fish emit: \x1b]7;file://hostname/path\x07 or \x1b]7;file://hostname/path\x1b\\
  const extractCwd = (stdout: string): string | null => {
    const match = stdout.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)(?:\x07|\x1b\\)/);
    if (match) return decodeURIComponent(match[1]);
    // Also try plain ]7;file:// (without ESC prefix, some terminals)
    const match2 = stdout.match(/\]7;file:\/\/[^/]*([^\r\n\x07]+)/);
    if (match2) return decodeURIComponent(match2[1]);
    return null;
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
    if (textareaRef.current) {textareaRef.current.style.height = "40px";textareaRef.current.style.overflowY = "hidden";}

    const displayText = text || `[${attachedFiles.map((f) => f.name).join(", ")}]`;
    const userMsg: Message = { role: "user", content: displayText };
    setMessages((prev) => [...prev, userMsg]);
    setThinking(true);
    startActivity();

    let convId = activeConvId;
    if (!convId) {
      convId = await createConversation(fullText, agent === "terminal" ? "openclaw" : agent);
      if (!convId) {setThinking(false);return;}
      // Save the user message BEFORE switching activeConvId so the
      // message-load effect finds it already in the DB when it fires.
      await saveMessage(convId, "user", fullText);
      setActiveConvId(convId);
    } else {
      await saveMessage(convId, "user", fullText);
    }

    // Run the actual relay call detached — background jobs continue when user switches conversation
    const jobConvId = convId;
    const jobIsNew = !activeConvId;
    const jobText = text;
    addJob(jobConvId);

    const runJob = async () => {
      // Strip ANSI / terminal escape codes comprehensively
      const stripAnsi = (s: string) =>
      s.
      // OSC sequences: ESC ] ... BEL or ESC \
      replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").
      // CSI sequences: ESC [ ... final-byte
      replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "").
      // DCS/SOS/PM/APC/ST sequences
      replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, "").
      // Other ESC sequences
      replace(/\x1b[^[\]PX^_]/g, "").
      // Bare ESC
      replace(/\x1b/g, "").
      // Residual CSI-like fragments (e.g. after ESC was stripped: [1m, [27m, [?2004h)
      replace(/\[[\d;?<>!]*[a-zA-Z]/g, "").
      // Residual OSC-like fragments (e.g. ]7;file://... ]2;title)
      replace(/\]\d+;[^\r\n]*/g, "").
      // Shell working directory / title notifications without ESC prefix
      replace(/\]7;[^\r\n]*/g, "").
      replace(/\]2;[^\r\n]*/g, "").
      // Other control chars except \t \n \r
      replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

      try {
        const command = await buildCommand(fullText, jobConvId, model);
        const stdout = await sendViaRelay(command, agent === "openclaw", onChunkActivity);
        console.debug("[Chat] raw stdout:", stdout);

        const cleaned = stripAnsi(stdout);

        const { data: convData } = await supabase.
        from("chat_conversations").
        select("agent, openclaw_session_id, claude_session_id, device_id").
        eq("id", jobConvId).
        single();

        let responseText = "";
        let codexThinking = "";
        let codexThinkingDurationMs: number | undefined;
        let claudeThinking = "";
        let openclawThinking = "";

        if (convData?.agent === "openclaw") {
          const jsonBlocks = cleaned.match(/\{[\s\S]*?\}/g) ?? [];
          const greedyMatch = cleaned.match(/\{[\s\S]*\}/);
          const candidates = greedyMatch ? [...jsonBlocks, greedyMatch[0]] : jsonBlocks;
          for (let i = candidates.length - 1; i >= 0; i--) {
            try {
              const parsed = JSON.parse(candidates[i]);
              // Extract thinking blocks from payloads array
              if (Array.isArray(parsed?.payloads)) {
                const thinkingParts: string[] = [];
                let textFound = false;
                for (const p of parsed.payloads) {
                  if (p.type === "thinking" && typeof p.thinking === "string") {
                    thinkingParts.push(p.thinking.trim());
                  } else if (p.type === "redacted_thinking") {
                    thinkingParts.push("*[Redacted thinking block — content encrypted by the model]*");
                  }
                  if (p.type === "text" && typeof p.text === "string" && !textFound) {
                    responseText = p.text;
                    textFound = true;
                  }
                }
                if (thinkingParts.length > 0) openclawThinking = thinkingParts.join("\n\n");
                // Fallback: first payload text
                if (!textFound) {
                  const payloadText = parsed.payloads[0]?.text;
                  if (payloadText) responseText = String(payloadText);
                }
                if (responseText) break;
              }
              const fallback = parsed.content ?? parsed.message ?? parsed.response ?? parsed.text ?? parsed.result;
              if (fallback && typeof fallback === "string") {responseText = fallback;break;}
            } catch {/* try next */}
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
              } catch {/* not JSON, fall through */}
            }
            // Plain-text lines — strip shell noise
            if (/^[%$#>→➜❯]\s*$/.test(t)) continue;
            if (/^[%$#>→➜❯]\s/.test(t)) continue;
            if (/^c?codex\s+/i.test(t)) continue;
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
          // Claude Code: extract <thinking>...</thinking> blocks from raw stdout
          // These appear before ANSI stripping, so we check the raw `stdout`
          {
            const thinkingTagOpen = "<thinking>";
            const thinkingTagClose = "</thinking>";
            const parts: string[] = [];
            let searchFrom = 0;
            while (true) {
              const start = stdout.indexOf(thinkingTagOpen, searchFrom);
              if (start === -1) break;
              const end = stdout.indexOf(thinkingTagClose, start + thinkingTagOpen.length);
              if (end === -1) break;
              parts.push(stdout.slice(start + thinkingTagOpen.length, end).trim());
              searchFrom = end + thinkingTagClose.length;
            }
            if (parts.length > 0) {
              claudeThinking = parts.join("\n\n");
            }
          }
          responseText = cleaned.
          split("\n").
          filter((line) => {
            const t = line.trim();
            if (!t) return false;
            // Shell prompt characters (→ U+2192, ➜ U+279C, ❯ U+276F, and ASCII variants)
            if (/^[%$#>→➜❯]\s*$/.test(t)) return false;
            if (/^[%$#>→➜❯]\s/.test(t)) return false;
            if (/^Restored session:/i.test(t)) return false;
            // claude/cclaude command echo (with optional extra leading char from shell)
            if (/^c?claude\s+(-p|-c|--print|--resume)/i.test(t)) return false;
            if (/^\[[\d;?<>!]*[a-zA-Z]/.test(t)) return false;
            if (/^[=\-\+\*~\s]+$/.test(t)) return false;
            // Shell hostname / path lines emitted by prompt (e.g. "user@host ~ %")
            if (/\w+@\w+/.test(t) && /[~\/]/.test(t)) return false;
            // Residual OSC/title fragments
            if (/^\]\d+;/.test(t)) return false;
            // Bracketed paste mode sequences
            if (/^\?2004[hl]$/.test(t)) return false;
            return true;
          }).
          join("\n").
          trim();

          if (!convData?.claude_session_id && (convData?.agent === "claude" || convData?.agent === "codex")) {
            const sessionId = extractClaudeSessionId(stdout);
            if (sessionId) {
              await supabase.from("chat_conversations").update({ claude_session_id: sessionId }).eq("id", jobConvId);
            }
          }
          // Extract cwd from OSC 7 shell escape and persist to device
          const detectedCwd = extractCwd(stdout);
          if (detectedCwd && convData?.device_id) {
            await supabase.from("devices").update({ workdir: detectedCwd }).eq("id", convData.device_id);
            setConversations((prev) => prev.map((c) => c.id === jobConvId ? { ...c, workdir: detectedCwd } : c));
          }
        }

        // ── Auto-retry on empty response ────────────────────────────────────
        if (!responseText.trim()) {
          console.warn("[Chat] Empty response detected, retrying once…");
          try {
            const retryStdout = await sendViaRelay(command, convData?.agent === "openclaw", onChunkActivity);
            const retryCleaned = stripAnsi(retryStdout);

            if (convData?.agent === "openclaw") {
              const jsonBlocks = retryCleaned.match(/\{[\s\S]*?\}/g) ?? [];
              const greedyMatch = retryCleaned.match(/\{[\s\S]*\}/);
              const candidates = greedyMatch ? [...jsonBlocks, greedyMatch[0]] : jsonBlocks;
              for (let i = candidates.length - 1; i >= 0; i--) {
                try {
                  const parsed = JSON.parse(candidates[i]);
                  const payloadText = parsed?.payloads?.[0]?.text;
                  if (payloadText) { responseText = String(payloadText); break; }
                  const fallback = parsed.content ?? parsed.message ?? parsed.response ?? parsed.text ?? parsed.result;
                  if (fallback && typeof fallback === "string") { responseText = fallback; break; }
                } catch {/* try next */}
              }
            } else if (convData?.agent === "codex") {
              const retryParts: string[] = [];
              for (const line of retryCleaned.split("\n")) {
                const t = line.trim();
                if (!t || !t.startsWith("{")) continue;
                try {
                  const obj = JSON.parse(t);
                  if (obj.type === "message" && obj.role === "assistant" && Array.isArray(obj.content)) {
                    for (const part of obj.content) {
                      if (part.type === "output_text" && typeof part.text === "string") retryParts.push(part.text);
                    }
                  }
                } catch {/* skip */}
              }
              responseText = retryParts.join("\n").trim();
            } else {
              responseText = retryCleaned.split("\n").filter((line) => {
                const t = line.trim();
                if (!t) return false;
                if (/^[%$#>→]\s*$/.test(t)) return false;
                if (/^[%$#>→]\s/.test(t)) return false;
                if (/^Restored session:/i.test(t)) return false;
                if (/^claude\s+(-p|-c|--print|--resume)/i.test(t)) return false;
                if (/^\[[\d;?<>!]*[a-zA-Z]/.test(t)) return false;
                if (/^[=\-\+\*~\s]+$/.test(t)) return false;
                if (/\w+@\w+/.test(t) && /[~\/]/.test(t)) return false;
                if (/^\]\d+;/.test(t)) return false;
                if (/^\?2004[hl]$/.test(t)) return false;
                return true;
              }).join("\n").trim();
            }
          } catch (retryErr) {
            console.error("[Chat] Retry failed:", retryErr);
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
            // Snapshot tool calls for this message
            toolCallsMapRef.current.set(revealedIdx, [...toolCalls]);
            // Store codex reasoning if present
            if (convData?.agent === "codex" && (codexThinking ?? "")) {
              thinkingMapRef.current.set(revealedIdx, codexThinking ?? "");
              if (codexThinkingDurationMs !== undefined) {
                thinkingDurationMapRef.current.set(revealedIdx, codexThinkingDurationMs);
              }
            }
            // Store OpenClaw thinking blocks
            if (convData?.agent === "openclaw" && openclawThinking) {
              thinkingMapRef.current.set(revealedIdx, openclawThinking);
            }
            // Store Claude Code thinking blocks
            if (convData?.agent === "claude" && claudeThinking) {
              thinkingMapRef.current.set(revealedIdx, claudeThinking);
            }
            return [...prev, { role: "assistant", content: "" }];
          });
          setThinking(false);
          setStreamingMsgIndex(revealedIdx!);
          stopActivity(); setActivityStatus("writing");

          await new Promise<void>((resolveStream) => {
            let tokenIdx = 0;
            let revealed = "";
            if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
            streamIntervalRef.current = setInterval(() => {
              if (abortStreamRef.current || tokenIdx >= tokens.length) {
                clearInterval(streamIntervalRef.current!);
                streamIntervalRef.current = null;
                setStreamingMsgIndex(null);
                stopActivity();
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
          stopActivity();
        }

        await saveMessage(jobConvId, "assistant", responseText, stdout);

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
                body: { userMessage: jobText, assistantMessage: responseText }
              });
              if (titleData?.title) {
                const aiTitle = titleData.title.replace(/^["']|["']$/g, "").trim();
                await supabase.from("chat_conversations").update({ title: aiTitle }).eq("id", jobConvId);
                setConversations((prev) => prev.map((c) => c.id === jobConvId ? { ...c, title: aiTitle } : c));
              }
            } catch {

              // silently keep the fallback title
            }})();
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
          stopActivity();
          if (streamIntervalRef.current) {clearInterval(streamIntervalRef.current);streamIntervalRef.current = null;}
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
    stopActivity();
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [stopActivity]);

  // ── Regenerate ─────────────────────────────────────────────────────────
  const handleRegenerate = useCallback(async () => {
    // Find the last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg || !selectedDeviceId) return;

    // Remove the last assistant message from UI
    setMessages((prev) => {
      const idx = [...prev].map((m) => m.role).lastIndexOf("assistant");
      return idx >= 0 ? prev.slice(0, idx) : prev;
    });

    setInput(lastUserMsg.content);
    // Tiny delay so state settles, then fire
    setTimeout(() => {
      setInput("");
      abortStreamRef.current = false;
      const text = lastUserMsg.content;
      const userMsg: Message = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setThinking(true);
      startActivity();
      const convId = activeConvId;
      if (!convId) return;
      saveMessage(convId, "user", text);
      const jobConvId = convId;
      const jobText = text;
      addJob(jobConvId);
      (async () => {
        const stripAnsi = (s: string) =>
        s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").
        replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "").
        replace(/\x1b[PX^_].*?\x1b\\/g, "").
        replace(/\x1b[^[\]PX^_]/g, "").
        replace(/\x1b/g, "").
        replace(/\[[\d;?<>!]*[a-zA-Z]/g, "").
        replace(/\][\d;][^\r\n]*/g, "").
        replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
        try {
          const command = await buildCommand(text, jobConvId, model);
          const stdout = await sendViaRelay(command, agent === "openclaw", onChunkActivity);
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
                if (payloadText) {responseText = String(payloadText);break;}
                const fallback = parsed.content ?? parsed.message ?? parsed.response ?? parsed.text ?? parsed.result;
                if (fallback && typeof fallback === "string") {responseText = fallback;break;}
              } catch {/* next */}
            }
          } else if (convData?.agent === "codex") {
            responseText = cleaned.split("\n").filter((line) => {
              const t = line.trim();
              if (!t) return false;
              if (/^[%$#>→]\s*$/.test(t)) return false;
              if (/^[%$#>→]\s/.test(t)) return false;
              if (/^codex\s+/i.test(t)) return false;
              if (/^\[[\d;?<>!]*[a-zA-Z]/.test(t)) return false;
              if (/^[=\-\+\*~\s]+$/.test(t)) return false;
              return true;
            }).join("\n").trim();
            // Capture session ID from first Codex reply
            if (!convData?.claude_session_id) {
              const sessionId = extractClaudeSessionId(stdout);
              if (sessionId) {
                await supabase.from("chat_conversations").update({ claude_session_id: sessionId }).eq("id", jobConvId);
              }
            }
          } else {
            responseText = cleaned.split("\n").filter((line) => {
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
            // Capture claude_session_id from first reply if not yet stored
            if (!convData?.claude_session_id) {
              const claudeId = extractClaudeSessionId(stdout);
              if (claudeId) {
                await supabase.from("chat_conversations").update({ claude_session_id: claudeId }).eq("id", jobConvId);
              }
            }
          }
          responseText = responseText.trim() || "(empty response)";
          await saveMessage(jobConvId, "assistant", responseText);
          if (activeConvIdRef.current === jobConvId) {
            setMessages((prev) => [...prev, { role: "assistant", content: responseText }]);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          if (activeConvIdRef.current === jobConvId) {
            setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ Error: ${errMsg}` }]);
          }
        } finally {
          if (activeConvIdRef.current === jobConvId) {
            setThinking(false);
            setStreamingMsgIndex(null);
            stopActivity();
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
    const newAgent = value as "openclaw" | "claude" | "codex" | "terminal";
    if (newAgent === "terminal") {
      setAgent("terminal");
      return;
    }
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
        if (isText) reader.readAsText(file);else
        reader.readAsDataURL(file);
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
        (c) => c.agents.includes("both") || (agent !== "terminal" && c.agents.includes(agent))
      );
      const helpText = `**Available slash commands**\n\n${available.
      map((c) => `\`/${c.name}\` — ${c.description}`).
      join("\n")}`;
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
      startActivity();
      try {
        const rawCmd = cmd.rawCommand(agent === "terminal" ? "openclaw" : agent);
        const stdout = await sendViaRelay(rawCmd, agent === "openclaw");
        const stripped = stdout.replace(/\x1b\[[\d;]*[a-zA-Z]/g, "").trim() || "(done)";
        setMessages((prev) => [...prev, { role: "assistant", content: `\`\`\`\n${stripped}\n\`\`\`` }]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${msg}` }]);
      } finally {
        setThinking(false);
        stopActivity();
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
          onDragOver={(e) => {e.preventDefault();setIsDragOver(true);}}
          onDragLeave={(e) => {if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);}}
          onDrop={(e) => {e.preventDefault();setIsDragOver(false);if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);}}>

          {isDragOver &&
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 px-10 py-8 text-center backdrop-blur-sm">
                <p className="text-sm font-medium text-primary">Drop files to attach</p>
                <p className="text-xs text-muted-foreground mt-1">Text files will be sent as context</p>
              </div>
            </div>
          }

          {/* Top header bar */}
          <div
            className="sticky top-0 z-20 shrink-0 border-b border-border/10 flex items-center px-5 relative backdrop-blur-md bg-background/80"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)', minHeight: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}>

            {/* Left — sidebar trigger */}
            <SidebarTrigger className="scale-125" />
            {/* Center — agent dropdown + conversation context */}
            <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <button className="flex items-center gap-3 px-5 py-2.5 rounded-full text-base font-medium transition-all duration-150 hover:bg-accent text-foreground select-none">
                   <img src={agent === "openclaw" ? openclawImg : agent === "codex" ? codexImg : agent === "terminal" ? terminalIconImg : claudecodeImg} alt={agent} className="w-6 h-6 rounded-sm object-cover" />
                    <span>{agent === "openclaw" ? "OpenClaw" : agent === "codex" ? "Codex" : agent === "terminal" ? "Terminal" : "Claude Code"}</span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-56">
                  {(["openclaw", "claude", "codex", "terminal"] as const).map((a) =>
                  <DropdownMenuItem key={a} onClick={() => handleAgentChange(a)} className="flex items-center gap-3 cursor-pointer py-2.5 text-base">
                      <img src={a === "openclaw" ? openclawImg : a === "codex" ? codexImg : a === "terminal" ? terminalIconImg : claudecodeImg} alt={a} className="w-6 h-6 rounded-sm object-cover" />
                      <span>{a === "openclaw" ? "OpenClaw" : a === "codex" ? "Codex" : a === "terminal" ? "Terminal" : "Claude Code"}</span>
                      {agent === a && <span className="ml-auto w-2 h-2 rounded-full bg-foreground/60" />}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {(() => {
                const activeConv = conversations.find((c) => c.id === activeConvId);
                const cwd = activeConv?.workdir;
                if (!cwd) return null;
                const shortCwd = cwd.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
                return (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40 max-w-[260px] truncate -mt-1 pb-1">
                    <span className="truncate">{shortCwd}</span>
                  </span>
                );
              })()}
            </div>
            {/* Right — device pill + refresh + new chat */}
            <div className="ml-auto flex items-center gap-3">
              {/* Relay health pill */}
              {(() => {
                const s = relayHealth.status;
                const dotColor =
                  s === "healthy" ? "bg-green-500" :
                  s === "degraded" ? "bg-yellow-500" :
                  s === "unreachable" ? "bg-destructive" :
                  "bg-muted-foreground/40";
                const label =
                  s === "checking" ? "Checking relay…" :
                  s === "healthy" ? `Relay · ${relayHealth.connectors} connector${relayHealth.connectors !== 1 ? "s" : ""}` :
                  s === "degraded" ? "Relay · no connectors" :
                  "Relay unreachable";
                const tooltip =
                  s === "healthy"
                    ? `${relayHealth.connectors} connector(s) · ${relayHealth.sessions} session(s)${relayHealth.uptime ? ` · up ${Math.floor(relayHealth.uptime / 60)}m` : ""}`
                    : s === "unreachable"
                    ? (relayHealth.error ?? "Cannot reach relay server")
                    : label;
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={refreshRelayHealth}
                        className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors",
                          s === "healthy" ? "text-foreground/70 hover:bg-accent" :
                          s === "checking" ? "text-muted-foreground" :
                          "text-destructive/80 hover:bg-destructive/10"
                        )}
                      >
                        {s === "checking"
                          ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          : <span className={cn("w-2 h-2 rounded-full shrink-0", dotColor, s === "healthy" && "animate-pulse")} />
                        }
                        <span className="hidden sm:inline">{label}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">{tooltip}</TooltipContent>
                  </Tooltip>
                );
              })()}

              {/* Device pill — opens right panel */}
              <button
                onClick={() => setDevicePanelOpen(true)}
                className="flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-medium transition-all duration-150 hover:bg-accent text-foreground/80 hover:text-foreground"
              >
                {(() => {
                  const dev = devices.find((d) => d.id === selectedDeviceId);
                  return dev ? (
                    <>
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dev.status === "online" ? "bg-status-online animate-pulse" : "bg-muted-foreground/40"}`} />
                      <span className="hidden sm:inline max-w-[140px] truncate">{dev.name}</span>
                    </>
                  ) : (
                    <span className="opacity-50 hidden sm:inline">No device</span>
                  );
                })()}
              </button>
              <button
                onClick={() => window.location.reload()}
                className="hidden sm:flex w-9 h-9 rounded-full items-center justify-center text-foreground/50 hover:text-foreground hover:bg-accent transition-all duration-150"
                title="Refresh page">

                <RefreshCw className="h-5 w-5" />
              </button>
              <button
                onClick={() => setActiveConvId(null)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-accent text-foreground transition-all duration-150"
                title="New conversation">

                <SquarePen className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Relay reconnection banner */}
          {(relayStatus === "retrying" || relayStatus === "failed") &&
          <div
            className="shrink-0 flex items-center justify-center gap-2 py-1.5 px-4 text-xs font-medium transition-all duration-300"
            style={{
              background: relayStatus === "failed" ?
              "hsl(var(--destructive) / 0.12)" :
              "hsl(var(--primary) / 0.10)",
              borderBottom: relayStatus === "failed" ?
              "1px solid hsl(var(--destructive) / 0.25)" :
              "1px solid hsl(var(--primary) / 0.18)",
              color: relayStatus === "failed" ?
              "hsl(var(--destructive))" :
              "hsl(var(--primary))"
            }}>

              {relayStatus === "retrying" ?
            <>
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <span>
                    Relay disconnected — reconnecting
                    {relayRetryCountRef.current > 0 ? ` (attempt ${relayRetryCountRef.current} of 3)` : ""}
                    …
                  </span>
                </> :

            <>
                  <WifiOff className="h-3 w-3 shrink-0" />
                  <span>Could not reach relay — check your connection</span>
                </>
            }
            </div>
          }

          {/* Messages / Terminal area */}
          {agent === "terminal" ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              {selectedDeviceId ? (
                <EmbeddedTerminal deviceId={selectedDeviceId} />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground/50 text-sm">
                  Select a device to open a terminal
                </div>
              )}
            </div>
          ) : (
          <div ref={scrollRef} onScroll={handleScroll} className={`flex-1 overflow-y-auto ${messages.length === 0 && !thinking ? "flex items-center justify-center" : "py-8 sm:py-10"}`}>
            <div key={activeConvId ?? "new"} className="max-w-[900px] mx-auto px-4 sm:px-8 animate-fade-in">
              {messages.length === 0 && !thinking &&
              <div className="flex flex-col items-center justify-center min-h-[70vh] sm:min-h-[80vh] text-center">

                  {/* ── No device paired: inline quick-start ─────────────── */}
                  {devices.length === 0 ?
                <div className="flex flex-col items-center gap-6 w-full max-w-xl px-2">
                      <QuickStart
                    userId={user?.id ?? ""}
                    projectId={projectId || undefined}
                    onDeviceOnline={(dev) => {
                      setDevices((prev) => [...prev, dev]);
                      setSelectedDeviceId(dev.id);
                    }} />

                    </div> : (


                /* ── Has device, no messages: normal empty state ────── */
                <>
                      <div className="relative mb-6 animate-fade-in" style={{ animationDelay: "0ms", animationFillMode: "both" }}>
                        <div className="absolute inset-0 rounded-3xl blur-xl scale-110 bg-foreground/10" />
                        <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center bg-muted/40 border border-border/40 shadow-sm outline outline-1 outline-border/30">
                          <img src={agent === "openclaw" ? openclawImg : agent === "codex" ? codexImg : claudecodeImg} alt={agent} className="w-full h-full object-cover rounded-3xl" />
                        </div>
                      </div>
                      <h3 className="heading-3 text-foreground mb-2 animate-fade-in" style={{ animationDelay: "120ms", animationFillMode: "both" }}>
                        {agent === "openclaw" ? "OpenClaw" : agent === "codex" ? "Codex" : "Claude Code"}
                      </h3>
                      <p className="body-base text-muted-foreground max-w-sm mb-8 animate-fade-in" style={{ animationDelay: "220ms", animationFillMode: "both" }}>
                        {agent === "openclaw" ?
                    "Ask your local OpenClaw agent anything. Commands run on your selected device." :
                    agent === "codex" ?
                    "Send prompts directly to OpenAI Codex CLI running on your device." :
                    "Send prompts directly to Claude Code running on your device."}
                      </p>

                      {/* Starter prompt cards */}
                      <div className="grid grid-cols-2 gap-2.5 w-full max-w-lg mx-auto animate-fade-in" style={{ animationDelay: "340ms", animationFillMode: "both" }}>
                        {(agent === "openclaw" ? [
                    { icon: "📂", title: "List files", prompt: "List all files in the current directory" },
                    { icon: "🔍", title: "Search code", prompt: "Search for TODO comments in the codebase" },
                    { icon: "💻", title: "System info", prompt: "Show system info: OS, CPU, memory usage" },
                    { icon: "🌿", title: "Git status", prompt: "Show the current git status and recent commits" }] :
                    agent === "codex" ? [
                    { icon: "🐛", title: "Fix a bug", prompt: "Find and fix the bug in my code" },
                    { icon: "✍️", title: "Write tests", prompt: "Write unit tests for the current file" },
                    { icon: "♻️", title: "Refactor", prompt: "Refactor this code to be cleaner and more readable" },
                    { icon: "📖", title: "Explain code", prompt: "Explain what this code does step by step" }] :
                    [
                    { icon: "🐛", title: "Debug code", prompt: "Help me debug an issue in my code" },
                    { icon: "✍️", title: "Write tests", prompt: "Write unit tests for the current file" },
                    { icon: "♻️", title: "Refactor", prompt: "Refactor this code to be cleaner and more readable" },
                    { icon: "📖", title: "Explain code", prompt: "Explain what this code does" }]).
                    map(({ icon, title, prompt }, i) =>
                    <button
                      key={title}
                      onClick={() => setInput(prompt)}
                      disabled={!selectedDeviceId}
                      className="animate-fade-in group flex flex-col gap-1.5 px-4 py-3.5 rounded-xl border-2 border-border/40 bg-card hover:border-foreground/20 hover:bg-card transition-all duration-150 text-left disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ animationDelay: `${420 + i * 80}ms`, animationFillMode: "both" }}>

                            <span className="text-sm font-semibold text-foreground leading-tight">{icon} {title}</span>
                            <span className="text-xs text-muted-foreground/70 leading-snug line-clamp-2">{prompt}</span>
                          </button>
                    )}
                      </div>
                    </>)
                }
                </div>
              }
              <div className="space-y-1">
                {messages.map((msg, i) =>
                <div key={msg.id ?? i} className="animate-fade-in">
                    <ChatMessage
                    role={msg.role}
                    content={msg.content}
                    streaming={streamingMsgIndex === i}
                    activityStatus={streamingMsgIndex === i ? activityStatus : undefined}
                    toolCalls={streamingMsgIndex === i ? toolCalls : (msg.role === "assistant" ? toolCallsMapRef.current.get(i) : undefined)}
                    rawStdout={msg.role === "assistant" ? rawStdoutMapRef.current.get(i) : undefined}
                    thinkingContent={msg.role === "assistant" ? thinkingMapRef.current.get(i) : undefined}
                    thinkingDurationMs={msg.role === "assistant" ? thinkingDurationMapRef.current.get(i) : undefined}
                    createdAt={msg.created_at}
                    agent={(agent as string) === "terminal" ? "openclaw" : agent as "openclaw" | "claude" | "codex"}
                    onRegenerate={
                    msg.role === "assistant" &&
                    i === messages.length - 1 &&
                    !thinking &&
                    streamingMsgIndex === null ?
                    handleRegenerate :
                    undefined
                    } />

                  </div>
                )}
                {thinking &&
                <div className="animate-fade-in">
                    <ChatMessage role="assistant" content="" thinking activityStatus={activityStatus} toolCalls={toolCalls} agent={(agent as string) === "terminal" ? "openclaw" : agent as "openclaw" | "claude" | "codex"} />
                  </div>
                }
              </div>
            </div>
          </div>
          )} {/* end terminal/chat conditional */}

          {/* Jump-to-bottom FAB */}
          {isScrolledUp &&
          <div className="shrink-0 flex justify-end pr-4 py-1">
              <button
              onClick={scrollToBottom}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-background/80 backdrop-blur-md border border-border/60 text-muted-foreground hover:text-foreground shadow-md transition-colors duration-150">

                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          }

          {/* Floating composer — hidden in terminal mode */}
          {agent !== "terminal" && (
          <div className="sticky bottom-0 z-20 shrink-0 pt-2 backdrop-blur-md bg-background/80 border-t border-border/10" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
            <div className="max-w-[900px] mx-auto px-3 sm:px-8">
            <div className="max-w-[900px] mx-auto">
              {/* Git status bar */}
              {gitStatus && gitStatus !== "loading" && gitStatus.branch && (
                <div className="flex items-center gap-2 px-1 pb-1.5 text-[11px] text-muted-foreground/50 select-none flex-wrap">
                  {/* Branch */}
                  <span className="flex items-center gap-1">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="opacity-60 shrink-0"><path d="M11.75 2.5a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0zm.75 2.453a2.25 2.25 0 1 1 0-4.906A2.25 2.25 0 0 1 12.5 4.953V5.5a2.25 2.25 0 0 1-2.25 2.25H5.75A.75.75 0 0 0 5 8.5v1.547a2.25 2.25 0 1 1-1.5 0V7.25a.75.75 0 0 1 0-1.5V5.047a2.25 2.25 0 1 1 1.5 0V5.75h4.5a.75.75 0 0 0 .75-.75v-.547zm-10.25.297a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0zM4.25 13a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z"/></svg>
                    <span className="font-mono">{gitStatus.branch}</span>
                  </span>
                  {gitStatus.files > 0 && (
                    <>
                      <span className="text-muted-foreground/20">·</span>
                      <span>{gitStatus.files} file{gitStatus.files !== 1 ? "s" : ""} changed</span>
                      {gitStatus.insertions > 0 && (
                        <span className="text-[hsl(var(--chart-2))]">+{gitStatus.insertions}</span>
                      )}
                      {gitStatus.deletions > 0 && (
                        <span className="text-destructive/70">−{gitStatus.deletions}</span>
                      )}
                    </>
                  )}
                  {gitStatus.files === 0 && (
                    <>
                      <span className="text-muted-foreground/20">·</span>
                      <span className="text-muted-foreground/30">clean</span>
                    </>
                  )}
                  <button
                    onClick={() => { gitFetchedForRef.current = null; setGitRefreshTick(t => t + 1); }}
                    className="ml-auto opacity-40 hover:opacity-80 transition-opacity"
                    title="Refresh git status"
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>
                  </button>
                </div>
              )}
              {gitStatus === "loading" && (
                <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] text-muted-foreground/30 select-none">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="animate-spin opacity-50"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>
                  <span>Fetching git status…</span>
                </div>
              )}
              {/* Stop streaming button — now handled by composer send button */}
              <ComposerBox
                textareaRef={textareaRef}
                fileInputRef={fileInputRef}
                isStreaming={!!(thinking || streamingMsgIndex !== null)}
                onAbort={handleAbort}
                input={input}
                setInput={setInput}
                onKeyDown={handleKeyDown}
                onSend={handleSend}
                disabled={!selectedDeviceId}
                sendDisabled={!input.trim() && attachedFiles.length === 0}
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
                deviceId={selectedDeviceId ?? null} />

              <p className="hidden sm:block text-center text-[10px] text-muted-foreground/40 mt-2 select-none whitespace-nowrap">
                Enter to send · Shift+Enter for newline · <span className="font-mono">/</span> for commands
              </p>
            </div>
            </div>{/* end max-w centering wrapper */}
          </div>
          )} {/* end agent !== terminal */}

        </div>

        {/* Agent switch confirmation */}
        <AlertDialog open={!!agentSwitchPending} onOpenChange={(open) => {if (!open) setAgentSwitchPending(null);}}>
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
          {projectId &&
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
            onSkip={() => setShowWizard(false)} />

          }
        </DialogContent>
      </Dialog>

      <DevicePanel
        open={devicePanelOpen}
        onClose={() => setDevicePanelOpen(false)}
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={(id) => { setSelectedDeviceId(id); }}
        userId={user?.id ?? ""}
        projectId={projectId || undefined}
        onDeviceAdded={(d) => {
          setDevices((prev) => {
            const exists = prev.find((x) => x.id === d.id);
            return exists ? prev.map((x) => x.id === d.id ? d : x) : [...prev, d];
          });
          setSelectedDeviceId(d.id);
        }}
        onDeviceDeleted={(id) => {
          setDevices((prev) => prev.filter((x) => x.id !== id));
          if (selectedDeviceId === id) {
            const remaining = devices.filter((x) => x.id !== id);
            const next = remaining.find((d) => d.status === "online") ?? remaining[0];
            if (next) setSelectedDeviceId(next.id);
          }
        }}
      />
    </AppLayout>);

}