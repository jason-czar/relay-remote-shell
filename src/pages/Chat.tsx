import { useState, useEffect, useRef, useCallback } from "react";
import { classifyReplStartupError, formatReplError } from "@/lib/replClassifier";
import { usePersistentRelaySession, ENTER_TO_CONFIRM_SENTINEL } from "@/hooks/usePersistentRelaySession";
import openclawImg from "@/assets/openclaw.png";
import claudecodeImg from "@/assets/claudecode.png";
import codexImg from "@/assets/codex.png";
import terminalIconImg from "@/assets/terminal-icon.png";
import { EmbeddedTerminal, type EmbeddedTerminalHandle } from "@/components/EmbeddedTerminal";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useScribe } from "@elevenlabs/react";
import { cn } from "@/lib/utils";
import { AppLayout } from "@/components/AppLayout";
import { ChatMessage, EMPTY_RESPONSE_TEXT, type LiveLogEntry } from "@/components/ChatMessage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Send, ChevronDown, ChevronUp, Paperclip, X, FileText, Image, Plus, Monitor, Terminal, Loader2, WifiOff, Square, Mic, ArrowUp, RefreshCw, SquarePen, FolderOpen, GitFork, ChevronRight, Home, Eye, EyeOff, KeyRound, Code2 } from "lucide-react";
import { PreviewPanel } from "@/components/PreviewPanel";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
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
import { useIsMobile } from "@/hooks/use-mobile";

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
  rawCommand: () => `codex exec --skip-git-repo-check --resume\n`
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
  onPreview?: () => void;
  previewActive?: boolean;
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

function ComposerBox({ textareaRef, fileInputRef, input, setInput, onKeyDown, onSend, disabled, sendDisabled, placeholder, attachedFiles, onRemoveFile, onFileSelect, agent, model, onSlashCommand, onAgentChange, onModelChange, isStreaming, onAbort, deviceId, onPreview, previewActive }: ComposerBoxProps) {
  const [focused, setFocused] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [isDictating, setIsDictating] = useState(false);
  const [dictateError, setDictateError] = useState<string | null>(null);

  const { models: deviceModels, loading: modelsLoading, error: modelsError, fetch: fetchModels } = useDeviceModels();

  // Base (static) models per agent — fallback when dynamic fetch unavailable
  const staticModels = agent === "openclaw" ? OPENCLAW_MODELS : agent === "claude" ? CLAUDE_MODELS : CODEX_MODELS;
  // Merge: prepend Auto, then dynamic models; fall back to static if no device or fetch failed
  const displayModels: AgentModel[] = deviceModels && deviceModels.length > 0 ?
  [{ id: "auto", label: "Auto", description: `Use ${agent === "openclaw" ? "OpenClaw" : agent === "codex" ? "Codex" : "Claude Code"}'s default model` }, ...deviceModels] :
  staticModels;

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
                  {deviceId && agent !== "terminal" &&
                  <button
                    onClick={() => {if (deviceId) {invalidateDeviceModelCache(deviceId, agent);fetchModels(deviceId, agent);}}}
                    disabled={modelsLoading}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors disabled:opacity-40"
                    title="Refresh model list from device">
                    
                      <RefreshCw className={cn("h-3 w-3", modelsLoading && "animate-spin")} />
                      {modelsLoading ? "Loading…" : "Refresh"}
                    </button>
                  }
                </div>
                {modelsError &&
                <div className="px-2 py-1.5 mb-1">
                    <p className="text-[10px] text-muted-foreground/50 italic">Could not fetch models — showing defaults</p>
                  </div>
                }
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

          {/* Right: preview + send */}
          <div className="flex items-center gap-2">
          {onPreview && deviceId &&
            <button
              type="button"
              onClick={onPreview}
              title="Open live preview"
              className={cn(
                "flex items-center gap-1.5 h-10 px-4 rounded-full transition-colors text-[15px] font-medium",
                previewActive ?
                "bg-foreground text-background hover:opacity-80" :
                "bg-foreground text-background hover:opacity-80"
              )}>
              
              <Monitor size={16} />
              <span>Preview</span>
            </button>
            }
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
    </div>
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
  todo_write: "Todo", notebook_edit: "Edit notebook"
};

function friendlyToolName(raw: string): string {
  const key = raw.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return TOOL_LABELS[key] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Chunk → activity status + tool name parser ────────────────────────────────
function parseChunkActivity(chunk: string): {status: "thinking" | "writing" | "running" | null;toolName: string | null;} {
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

// ── Raw chunk → structured live log entry ─────────────────────────────────────
function parseChunkForLog(chunk: string, acc: string): LiveLogEntry | null {
  const combined = acc + chunk;

  // ── Stream-json JSONL: try to parse each line as a complete JSON object ───
  for (const raw of chunk.split("\n")) {
    const t = raw.trim();
    if (!t.startsWith("{")) continue;
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      // tool_use: emit a structured tool_call card
      if (obj.type === "tool_use") {
        const name = typeof obj.name === "string" ? obj.name : "tool";
        const rawInput = obj.input as Record<string, unknown> | undefined;
        return {
          type: "tool_call",
          label: friendlyToolName(name),
          toolCallData: {
            id: typeof obj.id === "string" ? obj.id : undefined,
            name: friendlyToolName(name),
            input: rawInput && Object.keys(rawInput).length > 0 ? rawInput : undefined,
            startedAt: Date.now()
          }
        };
      }
      // tool_result: we handle this via the _tool_result_ sentinel (see onChunkActivity)
      if (obj.type === "tool_result") {
        const content = obj.content;
        let resultText = "";
        if (typeof content === "string") {
          resultText = content;
        } else if (Array.isArray(content)) {
          resultText = content.
          map((b: Record<string, unknown>) => b.type === "text" ? b.text : "").
          join("").
          trim();
        }
        const isError = obj.is_error === true;
        return {
          type: "tool_call",
          label: "__tool_result__",
          toolCallData: {
            id: typeof obj.tool_use_id === "string" ? obj.tool_use_id : undefined,
            name: "__result__",
            result: resultText || (isError ? "Error" : "Done"),
            isError
          }
        };
      }
    } catch {/* not complete JSON */}
  }

  // ── Claude Code / OpenClaw: JSON tool_use events ──────────────────────────
  if (/\"type\"\s*:\s*\"tool_use\"/.test(combined)) {
    const nameMatch = combined.match(/"name"\s*:\s*"([^"]+)"/);
    const inputMatch = combined.match(/"input"\s*:\s*\{([^}]{0,200})/);
    const toolName = nameMatch ? friendlyToolName(nameMatch[1]) : "Tool";

    // Bash: try to pull out the command
    if (nameMatch && /bash|shell|run|exec/i.test(nameMatch[1])) {
      const cmdMatch = combined.match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      return { type: "bash", label: "Bash", detail: cmdMatch ? cmdMatch[1].replace(/\\n/g, "\n").slice(0, 200) : undefined };
    }
    // File write/edit
    if (nameMatch && /write|edit|create|str_replace/i.test(nameMatch[1])) {
      const pathMatch = combined.match(/"(?:path|file_path|filename)"\s*:\s*"([^"]+)"/);
      return { type: "write", label: toolName, detail: pathMatch?.[1] };
    }
    // File read
    if (nameMatch && /read|cat|view/i.test(nameMatch[1])) {
      const pathMatch = combined.match(/"(?:path|file_path|filename)"\s*:\s*"([^"]+)"/);
      return { type: "read", label: toolName, detail: pathMatch?.[1] };
    }
    // Search / grep
    if (nameMatch && /search|grep|find|ripgrep/i.test(nameMatch[1])) {
      const patternMatch = combined.match(/"(?:pattern|query|regex)"\s*:\s*"([^"]+)"/);
      return { type: "tool", label: toolName, detail: patternMatch?.[1] };
    }
    // Generic tool
    return { type: "tool", label: toolName, detail: inputMatch ? `{${inputMatch[1]}}`.slice(0, 120) : undefined };
  }

  // ── Codex JSONL lines ─────────────────────────────────────────────────────
  for (const line of chunk.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const obj = JSON.parse(t);
      // function_call / tool_call
      if (obj.type === "function_calls" || obj.type === "tool_call") {
        const name = obj.name ?? obj.function?.name ?? "Tool";
        const args = obj.arguments ?? obj.function?.arguments ?? obj.input ?? {};
        if (/bash|shell|exec|run/i.test(name)) {
          const cmd = typeof args === "string" ? JSON.parse(args).command : args?.command;
          return { type: "bash", label: "Bash", detail: cmd?.slice(0, 200) };
        }
        if (/write|edit|create/i.test(name)) {
          const path = typeof args === "string" ? JSON.parse(args).path : args?.path ?? args?.file_path;
          return { type: "write", label: friendlyToolName(name), detail: path };
        }
        return { type: "tool", label: friendlyToolName(name) };
      }
      // Codex shell output block
      if (obj.type === "shell" && obj.command) {
        return { type: "bash", label: "Bash", detail: String(obj.command).slice(0, 200) };
      }
    } catch {/* not JSON */}
  }

  // ── Plain text patterns ───────────────────────────────────────────────────
  // Thinking block open tag
  if (/<thinking>/i.test(chunk)) return { type: "think", label: "Thinking…" };
  // Tool result (output)
  if (/"type"\s*:\s*"tool_result"/.test(chunk)) return { type: "output", label: "Tool result" };

  return null;
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
  // ── REPL agent runtime state (keyed by PTY sessionId) ────────────────────
  const runtimeAgentsRef = useRef<Record<string, {
    agent: "codex" | "claude";
    ready: boolean;
    approvalMode?: string;
  }>>({});
  // ── Per-session pending message queue (flushed after agent readiness) ─────
  const pendingQueueRef = useRef<Record<string, string[]>>({});
  // ── Deferred first message — stored when sessionId is unknown at send time ─
  // Structured so onChunkActivity doesn't rely on potentially-stale React agent state.
  const deferredFirstMsgRef = useRef<{agent: "codex" | "claude";text: string;} | null>(null);
  // ── tmux attach flag — true when we're attaching to a live Claude tmux session ─
  const attachingToTmuxRef = useRef<boolean>(false);
  // ── PTY death cleanup — aligned with real terminal lifecycle ─────────────
  const handleSessionReset = useCallback((deadSessionId?: string) => {
    if (!deadSessionId) return;
    delete runtimeAgentsRef.current[deadSessionId];
    delete pendingQueueRef.current[deadSessionId];
    setAwaitingApproval(null);
  }, []);
  // ── Readiness detection regexes ───────────────────────────────────────────
  const AGENT_READY_RE = {
    // Broader pattern to catch various Codex startup banner formats
    codex: /Approval mode:|Model:|workdir:|session id:|Session \w{4,}:|openai\/codex|codex\s+v\d/i,
    claude: /Type your message|Claude Code\s+\d|>\s*$|✓|Restored session:/i
  };
  const TRUST_BLOCK_RE = /Not inside a trusted directory|Working with untrusted|Is this a project you|Quick safety check/i;
  // Store tool call log entries (tool_use/tool_result cards) per message
  const toolCallEntriesMapRef = useRef<Map<number, LiveLogEntry[]>>(new Map());
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
  // Persistent relay session — one WebSocket+PTY for the lifetime of the chat view
  const relay = usePersistentRelaySession();
  // Reactive PTY session ID — poll so the header pill stays in sync
  const [ptySessionId, setPtySessionId] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const sid = relay.getSessionId();
      setPtySessionId((prev) => prev !== sid ? sid : prev);
    }, 1000);
    return () => clearInterval(id);
  }, [relay]);

  // Scope the relay's PTY to the active conversation
  useEffect(() => {
    relay.setConvId(activeConvId);
  }, [activeConvId, relay]);

  // ── Global PTY stdout listener — backup trust gate detection ──────────
  // Fires for ALL stdout chunks; the primary detection is in onChunkActivity
  // which uses the accumulated buffer. This catches any edge cases.
  useEffect(() => {
    relay.setGlobalChunkListener((chunk: string) => {
      const stripped = chunk.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
      if (!/Enter to confirm/i.test(stripped)) return;
      const sid = relay.getSessionId();
      if (!sid) return;
      if (trustGateHandledRef.current === sid) return; // already handled
      trustGateHandledRef.current = sid;
      const autoTrusted = selectedDeviceId && localStorage.getItem(`agent-trust-${selectedDeviceId}`) === "true";
      if (autoTrusted) {
        console.log("[REPL] Auto-trust (global listener): sending \\r to bypass trust gate");
        relay.sendRawStdin(sid, btoa("\r"));
      } else {
        console.log("[REPL] Trust gate detected via global listener — showing approval UI");
        setAwaitingApproval({ sessionId: sid, options: [ENTER_TO_CONFIRM_SENTINEL] });
      }
    });
    return () => relay.setGlobalChunkListener(null);
  }, [relay, selectedDeviceId]);

  const [thinking, setThinking] = useState(false);
  const [agentSwitchPending, setAgentSwitchPending] = useState<"openclaw" | "claude" | "codex" | "terminal" | null>(null);
  const [streamingMsgIndex, setStreamingMsgIndex] = useState<number | null>(null);
  const [activityStatus, setActivityStatus] = useState<"thinking" | "writing" | "running" | null>(null);
  const activityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [toolCalls, setToolCalls] = useState<string[]>([]);
  const [liveLog, setLiveLog] = useState<LiveLogEntry[]>([]);
  // Tracks which message indices the user has already responded to (hides option buttons)
  const [answeredMsgIndices, setAnsweredMsgIndices] = useState<Set<number>>(new Set());
  const liveLogAccRef = useRef<string>("");
  // Blocking PTY prompt awaiting user choice (trust gate, [Y/n], etc.)
  const [awaitingApproval, setAwaitingApproval] = useState<{sessionId: string;options: string[];} | null>(null);
  // Ref to guard against duplicate trust-gate triggers within same session
  const trustGateHandledRef = useRef<string | null>(null); // stores sessionId when handled
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showTerminalDrawer, setShowTerminalDrawer] = useState(false);
  const [terminalDrawerHeight, setTerminalDrawerHeight] = useState(380);
  const terminalDragRef = useRef<{startY: number;startH: number;} | null>(null);
  const drawerTerminalRef = useRef<EmbeddedTerminalHandle>(null);
  const [connectorOffline, setConnectorOffline] = useState(false);
  const [expandedScrollback, setExpandedScrollback] = useState<Set<number>>(new Set());
  const [showWizard, setShowWizard] = useState(false);
  const [projectId, setProjectId] = useState<string>("");
  const [relayStatus, setRelayStatus] = useState<"idle" | "connecting" | "retrying" | "failed">("idle");
  const relayRetryCountRef = useRef(0);
  // REPL debug overlay — live snapshot of runtimeAgentsRef
  const [showReplDebug, setShowReplDebug] = useState(false);
  const [replDebugSnapshot, setReplDebugSnapshot] = useState<Record<string, {agent: string;ready: boolean;approvalMode?: string;}>>({});
  // Poll runtimeAgentsRef into state when debug overlay is open
  useEffect(() => {
    if (!showReplDebug) return;
    setReplDebugSnapshot({ ...runtimeAgentsRef.current });
    const id = setInterval(() => setReplDebugSnapshot({ ...runtimeAgentsRef.current }), 500);
    return () => clearInterval(id);
  }, [showReplDebug]);
  const [gitStatus, setGitStatus] = useState<{
    branch: string;
    files: number;
    insertions: number;
    deletions: number;
  } | null | "loading">(null);
  const gitFetchedForRef = useRef<string | null>(null);
  const [gitRefreshTick, setGitRefreshTick] = useState(0);

  // ── Open Project dialog ───────────────────────────────────────────────
  const [openProjectOpen, setOpenProjectOpen] = useState(false);
  const [folderPath, setFolderPath] = useState<string>("");
  const [folderItems, setFolderItems] = useState<{name: string;isDir: boolean;}[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);

  // ── Clone Repo dialog ────────────────────────────────────────────────
  const [cloneRepoOpen, setCloneRepoOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneDir, setCloneDir] = useState("");
  const [cloneToken, setCloneToken] = useState(() => {
    try {return localStorage.getItem("gh-clone-token") ?? "";} catch {return "";}
  });
  const [showCloneToken, setShowCloneToken] = useState(false);
  const [cloning, setCloning] = useState(false);


  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortStreamRef = useRef(false);
  const pendingAutoSendRef = useRef<string | null>(null);
  const pendingCloneInfoRef = useRef<{url: string;dest: string;} | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // ── Recent projects (workdir history per device) ─────────────────────────
  const getRecentProjects = useCallback((deviceId: string): string[] => {
    try {
      const raw = localStorage.getItem(`recent-projects-${deviceId}`);
      return raw ? JSON.parse(raw) as string[] : [];
    } catch {return [];}
  }, []);

  const addRecentProject = useCallback((deviceId: string, path: string) => {
    try {
      const existing = getRecentProjects(deviceId).filter((p) => p !== path);
      const updated = [path, ...existing].slice(0, 8);
      localStorage.setItem(`recent-projects-${deviceId}`, JSON.stringify(updated));
    } catch {/* */}
  }, [getRecentProjects]);

  // ── Open Project folder browser ───────────────────────────────────────────
  const browseFolderViaRelay = useCallback(async (path: string) => {
    if (!selectedDeviceId) return;
    setFolderLoading(true);
    try {
      const cmd = `python3 -c "import os,json; base=os.path.expanduser('${path || "~"}'); entries=[{'name':e,'isDir':os.path.isdir(os.path.join(base,e))} for e in sorted(os.listdir(base)) if not e.startswith('.')]; print(json.dumps({'path':os.path.abspath(base),'entries':entries}))" 2>/dev/null\n`;
      const { data: sesData } = await supabase.functions.invoke("start-session", { body: { device_id: selectedDeviceId } });
      if (!sesData?.session_id) return;
      const relayUrl = import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com";
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const jwt = authSession?.access_token;
      if (!jwt) return;
      await new Promise<void>((resolve) => {
        const ws = new WebSocket(`${relayUrl}/session`);
        let buf = "";let done = false;let cmdSent = false;
        let silTimer: ReturnType<typeof setTimeout> | null = null;
        const PROMPT_RE = /[$%#>]\s*$/m;

        const finish = () => {
          if (!done) {
            done = true;
            if (silTimer) clearTimeout(silTimer);
            ws.close();
            supabase.functions.invoke("end-session", { body: { session_id: sesData.session_id } }).catch(() => {});
            resolve();
          }
        };

        // Hard deadline — give plenty of time for -lic shell startup + command
        const hardDeadline = setTimeout(finish, 18000);

        const resetSilence = () => {
          if (silTimer) clearTimeout(silTimer);
          // Once the command has been sent, finish 1.5s after last stdout chunk
          if (cmdSent) silTimer = setTimeout(() => {clearTimeout(hardDeadline);finish();}, 1500);
        };

        ws.onopen = () => ws.send(JSON.stringify({ type: "auth", data: { token: jwt, session_id: sesData.session_id, device_id: selectedDeviceId } }));
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "auth_ok") {
              ws.send(JSON.stringify({ type: "session_start", data: { session_id: sesData.session_id, cols: 220, rows: 50 } }));
            } else if (msg.type === "stdout") {
              const d = (msg.data as {data_b64?: string;})?.data_b64;
              if (d) {try {buf += decodeURIComponent(escape(atob(d)));} catch {buf += atob(d);}}

              // Wait for shell prompt before sending command (handles slow -lic startup)
              if (!cmdSent && PROMPT_RE.test(buf)) {
                cmdSent = true;
                ws.send(JSON.stringify({ type: "stdin", data: { session_id: sesData.session_id, data_b64: btoa(cmd) } }));
              }
              resetSilence();
            }
          } catch {/* */}
        };
        ws.onclose = () => {
          const clean = buf.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "").replace(/\x1b[^[\]]/g, "");
          const s = clean.indexOf("{");const end = clean.lastIndexOf("}");
          if (s !== -1 && end !== -1) {
            try {
              const parsed = JSON.parse(clean.slice(s, end + 1)) as {path: string;entries: {name: string;isDir: boolean;}[];};
              setFolderPath(parsed.path);
              setFolderItems(parsed.entries);
            } catch {/* */}
          }
          finish();
        };
      });
    } catch {/* */} finally {setFolderLoading(false);}
  }, [selectedDeviceId]);

  const handleOpenProject = useCallback(async (chosenPath: string) => {
    if (!selectedDeviceId) return;
    await supabase.from("devices").update({ workdir: chosenPath }).eq("id", selectedDeviceId);
    addRecentProject(selectedDeviceId, chosenPath);
    setOpenProjectOpen(false);
    setInput(`I'm working in ${chosenPath}. Give me an overview of the project structure.`);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [selectedDeviceId]);

  const handleCloneRepo = useCallback(() => {
    if (!cloneUrl.trim() || !selectedDeviceId) return;
    // Build authenticated URL if a GitHub token is provided
    let effectiveUrl = cloneUrl.trim();
    if (cloneToken.trim() && effectiveUrl.startsWith("https://")) {
      try {
        const u = new URL(effectiveUrl);
        u.username = cloneToken.trim();
        u.password = "x-oauth-basic";
        effectiveUrl = u.toString();
      } catch {/* use original url */}
    }
    // Persist token for next time (stored only locally)
    try {localStorage.setItem("gh-clone-token", cloneToken);} catch {/* */}
    const cloneCmd = `git clone ${effectiveUrl}${cloneDir.trim() ? ` ${cloneDir.trim()}` : ""}`;
    // Derive the repo folder name for later workdir update
    const urlPart = cloneUrl.trim().replace(/\.git$/, "").replace(/\/$/, "");
    const repoName = urlPart.split("/").pop() || "";
    pendingCloneInfoRef.current = { url: cloneUrl.trim(), dest: cloneDir.trim() || repoName };
    setCloneRepoOpen(false);
    setCloneUrl("");setCloneDir("");
    setInput(cloneCmd);
    pendingAutoSendRef.current = cloneCmd;
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [cloneUrl, cloneDir, cloneToken, selectedDeviceId]);

  // ── Activity status helpers ───────────────────────────────────────────────
  const startActivity = useCallback(() => {
    if (activityTimerRef.current) clearInterval(activityTimerRef.current);
    activityTimerRef.current = null;
    setActivityStatus("thinking");
    setToolCalls([]);
  }, []);

  // Called for each live stdout chunk — promotes status based on content
  const stopActivity = useCallback(() => {
    if (activityTimerRef.current) {clearInterval(activityTimerRef.current);activityTimerRef.current = null;}
    setActivityStatus(null);
    setToolCalls([]);
  }, []);

  const detectedPortRef = useRef<string | null>(null);
  const [detectedPreviewPort, setDetectedPreviewPort] = useState<string | null>(null);

  const onChunkActivity = useCallback((chunk: string) => {
    const { status, toolName } = parseChunkActivity(chunk);
    if (status) setActivityStatus(status);
    if (toolName) setToolCalls((prev) => [...prev, toolName]);
    // Parse for structured live log entry
    liveLogAccRef.current += chunk;
    const entry = parseChunkForLog(chunk, liveLogAccRef.current);

    // ── REPL readiness detection ─────────────────────────────────────────
    // Check if a Codex/Claude agent just emitted its startup banner.
    // Only mark ready if the trust-block gate is NOT active in the buffer.
    const sessionId = relay.getSessionId();

    // ── Deferred first-message migration ─────────────────────────────────
    // If buildCommand ran before the PTY existed, it stored the first message
    // in deferredFirstMsgRef. Once sessionId appears, register runtime state
    // and queue the message — then apply the same 20s boot-timeout guard.
    // ── TMUX_NOT_FOUND sentinel ───────────────────────────────────────────
    if (chunk.includes("TMUX_NOT_FOUND")) {
      toast({ title: "tmux not found", description: "tmux is not installed on this device. Please install tmux to use Claude Code sessions.", variant: "destructive" });
    }

    // ── Deferred first-message migration ─────────────────────────────────
    // If buildCommand ran before the PTY existed, it stored the first message
    // in deferredFirstMsgRef. Once sessionId appears, register runtime state
    // and either fast-path ready (tmux attach) or apply 20s boot-timeout guard.
    if (sessionId && deferredFirstMsgRef.current && !runtimeAgentsRef.current[sessionId]) {
      const { agent: deferredAgent, text: deferredText } = deferredFirstMsgRef.current;
      deferredFirstMsgRef.current = null;
      runtimeAgentsRef.current[sessionId] = { agent: deferredAgent, ready: false };

      if (attachingToTmuxRef.current) {
        // Attaching to a live tmux session — Claude's REPL is already running.
        // Mark ready immediately and flush the deferred message.
        // If the tmux session was dead and the fallback spawned fresh, the flag
        // being true is still safe: the message sits in PTY stdin buffer and is
        // read by Claude when its REPL reaches the input prompt (PTY buffering).
        attachingToTmuxRef.current = false;
        runtimeAgentsRef.current[sessionId].ready = true;
        relay.sendRawStdin(sessionId, btoa(deferredText + "\n"));
      } else {
        pendingQueueRef.current[sessionId] = [deferredText];
        setTimeout(() => {
          const s = runtimeAgentsRef.current[sessionId];
          if (s && !s.ready) {
            console.warn("[REPL] Deferred boot timeout — forcing ready for session", sessionId);
            s.ready = true;
            const queue = pendingQueueRef.current[sessionId] ?? [];
            delete pendingQueueRef.current[sessionId];
            for (const q of queue) relay.sendRawStdin(sessionId, btoa(q + "\n"));
          }
        }, 20_000);
      }
    }

    if (sessionId) {
      const state = runtimeAgentsRef.current[sessionId];
      if (state && !state.ready) {
        // Extract approval mode if present
        const modeMatch = chunk.match(/Approval mode:\s*(\S+)/i);
        if (modeMatch) state.approvalMode = modeMatch[1].toLowerCase();

        const buf = liveLogAccRef.current;
        if (AGENT_READY_RE[state.agent].test(chunk) && !TRUST_BLOCK_RE.test(buf)) {
          state.ready = true;
          // Flush any queued messages
          const queue = pendingQueueRef.current[sessionId] ?? [];
          delete pendingQueueRef.current[sessionId];
          for (const queuedText of queue) {
            relay.sendRawStdin(sessionId, btoa(queuedText + "\n"));
          }
        }
      }

      // ── Trust gate detection in REPL mode ──────────────────────────────
      // Claude's trust gate is a TUI screen with ANSI positioning codes —
      // the text may be fragmented across chunks. Test the accumulated buffer
      // after stripping ALL ANSI escape sequences (SGR, OSC, CSI positioning).
      const stripAllAnsi = (s: string) =>
      s.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, "") // CSI sequences (colors, cursor, erase)
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC sequences
      .replace(/\x1b[^[\]]/g, ""); // other 2-char escapes
      const accStripped = stripAllAnsi(liveLogAccRef.current);
      console.debug("[REPL][TrustGate] sessionId:", sessionId, "accLen:", liveLogAccRef.current.length, "hasEnterToConfirm:", /Enter to confirm/i.test(accStripped), "handled:", trustGateHandledRef.current);
      if (/Enter to confirm/i.test(accStripped) && trustGateHandledRef.current !== sessionId) {
        trustGateHandledRef.current = sessionId;
        const autoTrusted = selectedDeviceId && localStorage.getItem(`agent-trust-${selectedDeviceId}`) === "true";
        if (autoTrusted) {
          console.log("[REPL] Auto-trust: sending \\r to bypass trust gate");
          relay.sendRawStdin(sessionId, btoa("\r"));
        } else {
          console.log("[REPL] Trust gate detected in accumulated buffer — showing approval UI");
          setAwaitingApproval({ sessionId, options: [ENTER_TO_CONFIRM_SENTINEL] });
        }
      }
    }
    if (entry) {
      // tool_result: patch the matching tool_call entry rather than appending
      if (entry.type === "tool_call" && entry.toolCallData?.name === "__result__") {
        const resultId = entry.toolCallData.id;
        setLiveLog((prev) => {
          // Find last tool_call entry with matching id (or last tool_call if no id)
          const idx = resultId ?
          [...prev].reverse().findIndex((e) => e.type === "tool_call" && e.toolCallData?.id === resultId) :
          [...prev].reverse().findIndex((e) => e.type === "tool_call" && !e.toolCallData?.result);
          if (idx === -1) return prev;
          const realIdx = prev.length - 1 - idx;
          const updated = [...prev];
          updated[realIdx] = {
            ...updated[realIdx],
            toolCallData: {
              ...updated[realIdx].toolCallData!,
              result: entry.toolCallData!.result,
              isError: entry.toolCallData!.isError,
              durationMs: updated[realIdx].toolCallData?.startedAt ?
              Date.now() - updated[realIdx].toolCallData!.startedAt! :
              undefined
            }
          };
          return updated;
        });
      } else {
        // Deduplicate: don't add same label+detail twice in a row
        setLiveLog((prev) => {
          const last = prev[prev.length - 1];
          if (last?.label === entry.label && last?.detail === entry.detail) return prev;
          return [...prev, entry];
        });
      }
    }
    // Detect dev server port from stdout (Vite, Next, CRA, etc.)
    const portMatch = chunk.match(
      /(?:localhost|127\.0\.0\.1):(\d{4,5})|Local:\s+https?:\/\/(?:localhost|127\.0\.0\.1):(\d{4,5})/i
    );
    if (portMatch) {
      const port = portMatch[1] ?? portMatch[2];
      if (port && port !== detectedPortRef.current) {
        detectedPortRef.current = port;
        setDetectedPreviewPort(port);
      }
    }
  }, [relay]);
  const prevMsgCountRef = useRef(0);

  const isMobile = useIsMobile();
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewInputPort, setPreviewInputPort] = useState("3000");
  const [previewTab, setPreviewTab] = useState<"chat" | "preview">("preview");
  const [previewPopoverOpen, setPreviewPopoverOpen] = useState(false);
  const [previewAutoDetecting, setPreviewAutoDetecting] = useState(false);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const { health: relayHealth, refresh: refreshRelayHealth } = useRelayHealth(true);

  // ── Device selection with per-device agent persistence ───────────────
  const setSelectedDeviceId = useCallback((id: string) => {
    setSelectedDeviceIdState(id);
    localStorage.setItem("chat-device-id", id);
    setConnectorOffline(false);
    // Disconnect the persistent relay so the next command creates a fresh session
    // for the new device instead of reusing the old one.
    relay.disconnect();
    // Restore the agent & model last used with this device
    const savedAgent = localStorage.getItem(`chat-agent-${id}`);
    // Only restore device-level agent/model when there's no active conversation
    // (conversation's stored agent takes priority and will be synced separately)
    if (savedAgent && !activeConvId) setAgent(savedAgent as "openclaw" | "claude" | "codex" | "terminal");
    const savedModel = localStorage.getItem(`chat-model-${id}`);
    if (savedModel) setModel(savedModel);
  }, [relay]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ref to suppress device-localStorage write when agent is set by conversation sync (not user)
  const agentFromConvRef = useRef(false);

  // Persist agent selection keyed by device whenever either changes
  useEffect(() => {
    if (selectedDeviceId) {
      // Only persist to device localStorage when the agent was set by the user, not by conv sync
      if (!agentFromConvRef.current) {
        localStorage.setItem(`chat-agent-${selectedDeviceId}`, agent);
        localStorage.setItem(`chat-model-${selectedDeviceId}`, model);
      }
      agentFromConvRef.current = false;
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
    if (!activeConvId) {setMessages([]);setAnsweredMsgIndices(new Set());setDetectedPreviewPort(null);detectedPortRef.current = null;return;}
    supabase.
    from("chat_messages").
    select("id, role, content, created_at, raw_stdout").
    eq("conversation_id", activeConvId).
    order("created_at", { ascending: true }).
    then(({ data }) => {
      if (data) {
        setMessages(data.map((msg: any) =>
        msg.role === "system" && msg.content?.startsWith("**Session resumed**") ?
        { ...msg, type: "scrollback_replay" } :
        msg
        ) as Message[]);
        // Restore raw_stdout for the debug panel on historical messages
        rawStdoutMapRef.current.clear();
        toolCallsMapRef.current.clear();
        toolCallEntriesMapRef.current.clear();
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
    if (!activeConvId || !selectedDeviceId) {setGitStatus(null);return;}
    if (gitFetchedForRef.current === activeConvId) return;
    gitFetchedForRef.current = activeConvId;
    setGitStatus("loading");
    (async () => {
      try {
        const cmd = `git branch --show-current 2>/dev/null && git diff --stat HEAD 2>/dev/null | tail -1`;
        const { data: sesData } = await supabase.functions.invoke("start-session", { body: { device_id: selectedDeviceId } });
        if (!sesData?.session_id) {setGitStatus(null);return;}
        const sessionId: string = sesData.session_id;
        const relayUrl = import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com";
        const { data: { session: authSession } } = await supabase.auth.getSession();
        const jwt = authSession?.access_token;
        if (!jwt) {setGitStatus(null);return;}
        const raw = await new Promise<string>((resolve) => {
          const ws = new WebSocket(`${relayUrl}/session`);
          let buf = "";let done = false;let silTimer: ReturnType<typeof setTimeout> | null = null;
          const finish = (v: string) => {if (done) return;done = true;if (silTimer) clearTimeout(silTimer);if (ws.readyState === WebSocket.OPEN) {ws.send(JSON.stringify({ type: "session_end", data: { session_id: sessionId, reason: "done" } }));ws.close();}supabase.functions.invoke("end-session", { body: { session_id: sessionId } }).catch(() => {});resolve(v);};
          const resetSil = () => {if (silTimer) clearTimeout(silTimer);silTimer = setTimeout(() => finish(buf), 2500);};
          setTimeout(() => finish(buf), 12000);
          let promptSent = false;
          ws.onopen = () => ws.send(JSON.stringify({ type: "auth", data: { token: jwt, session_id: sessionId, device_id: selectedDeviceId } }));
          ws.onmessage = (e) => {
            try {
              const msg = JSON.parse(e.data);
              if (msg.type === "auth_ok") {
                ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: 200, rows: 10 } }));
                const PROMPT_RE = /(?:[%$#➜❯>]\s*$)/m;
                const trySend = () => {if (promptSent) return;const plain = buf.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "").replace(/\x1b[^[\]]/g, "");if (PROMPT_RE.test(plain)) {promptSent = true;buf = "";ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(cmd + "\n") } }));resetSil();}};
                setTimeout(() => {if (!promptSent) {promptSent = true;buf = "";ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(cmd + "\n") } }));resetSil();}}, 4000);
                const origH = ws.onmessage;ws.onmessage = (ev) => {origH?.call(ws, ev);trySend();};
              } else if (msg.type === "stdout") {const { data_b64 } = (msg.data ?? {}) as {data_b64: string;};if (data_b64) {try {buf += decodeURIComponent(escape(atob(data_b64)));} catch {buf += atob(data_b64);}resetSil();}
              } else if (msg.type === "session_end") {finish(buf);}
            } catch {/* ignore */}
          };
          ws.onerror = () => finish(buf);
        });
        const clean = raw.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "").replace(/\x1b[^[\]]/g, "").replace(/\r/g, "");
        const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
        const branch = lines[0] ?? "";
        const statLine = lines.find((l) => l.includes("changed")) ?? "";
        const filesMatch = statLine.match(/(\d+)\s+files? changed/);
        const insMatch = statLine.match(/(\d+)\s+insertions?\(\+\)/);
        const delMatch = statLine.match(/(\d+)\s+deletions?\(-\)/);
        if (!branch || branch.includes(" ") || branch.length > 100) {setGitStatus(null);return;}
        setGitStatus({ branch, files: filesMatch ? parseInt(filesMatch[1]) : 0, insertions: insMatch ? parseInt(insMatch[1]) : 0, deletions: delMatch ? parseInt(delMatch[1]) : 0 });
      } catch {setGitStatus(null);}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, selectedDeviceId, gitRefreshTick]);

  // Restore agent + model when switching to a conversation so the header dropdown always matches
  useEffect(() => {
    if (!activeConvId) return;
    const conv = conversations.find((c) => c.id === activeConvId);
    if (!conv) return;
    const convAgent = conv.agent as "openclaw" | "claude" | "codex" | "terminal" | undefined;
    if (convAgent) {
      agentFromConvRef.current = true; // suppress device-localStorage write
      setAgent(convAgent);
    }
    if (conv.model) {
      agentFromConvRef.current = true;
      setModel(conv.model);
    }
  }, [activeConvId, conversations]); // eslint-disable-line react-hooks/exhaustive-deps



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
          toolCallsMapRef.current.clear();
          toolCallEntriesMapRef.current.clear();
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

  // ── Trust-prompt detector (used for auto-trust) ───────────────────────────
  const TRUST_PROMPT_RE = /Do you trust|Not inside a trusted directory|Working with untrusted|trust this directory|trust this folder|Is this a project you|Enter to confirm/i;

  // ── Relay send — delegates to the persistent session hook ───────────────
  const sendViaRelay = useCallback(async (command: string, isOpenClaw = false, onChunk?: (chunk: string) => void): Promise<string> => {
    if (!selectedDeviceId) throw new Error("No device selected");
    setRelayStatus("connecting");
    relayRetryCountRef.current = 0;
    try {
      const result = await relay.sendCommand(selectedDeviceId, command, {
        isOpenClaw,
        onChunk,
        onAwaitingInput: (options: string[]) => {
          const sid = relay.getSessionId();
          if (!sid) return;
          // Auto-trust: if the user previously trusted this device and it's a
          // trust-type prompt, silently send "1\n" without showing UI
          const promptText = options.join(" ");
          const isTrustPrompt = TRUST_PROMPT_RE.test(promptText) || options.some((o) => TRUST_PROMPT_RE.test(o));
          if (isTrustPrompt && selectedDeviceId && localStorage.getItem(`agent-trust-${selectedDeviceId}`) === "true") {
            // "Enter to confirm" style needs bare \r; numbered-choice style needs "1\n"
            const isEnterStyle = options.includes(ENTER_TO_CONFIRM_SENTINEL);
            relay.sendRawStdin(sid, btoa(isEnterStyle ? "\r" : "1\n"));
            return;
          }
          // Only show approval UI for suggest/auto-edit modes (or unknown/boot phase)
          const agentState = runtimeAgentsRef.current[sid];
          const mode = agentState?.approvalMode;
          if (mode === "never" || mode === "full-auto") return;
          setAwaitingApproval({ sessionId: sid, options });
        },
        onSessionReset: handleSessionReset,
        onScrollback: (scrollbackText: string) => {
          // Strip ANSI and inject a system message showing what happened during the disconnect
          const stripped = scrollbackText.
          replace(/\x1b\[\d*[JKH]/g, "").
          replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").
          replace(/\x1b\[(\d+)C/g, (_, n) => " ".repeat(Math.min(Number(n), 4))).
          replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "").
          replace(/\x1b[^[\]]/g, "").
          replace(/\x1b/g, "").
          trim();
          if (!stripped) return;
          const content = `**Session resumed** — output since last disconnect:\n\`\`\`\n${stripped}\n\`\`\``;
          const resumeMsg: Message = {
            role: "system" as any,
            content,
            type: "scrollback_replay"
          };
          setMessages((prev) => [...prev, resumeMsg]);
          // Persist to DB so it survives page reloads
          if (activeConvId) {
            supabase.from("chat_messages").insert({
              conversation_id: activeConvId,
              role: "system",
              content
            } as any).then(() => {
              supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", activeConvId);
            });
          }
        }
      });
      setRelayStatus("idle");
      return result;
    } catch (err) {
      setRelayStatus("failed");
      throw err;
    }
  }, [selectedDeviceId, relay]);

  // ── Race-safe tmux session name allocator (Claude: cc-, Codex: cx-) ────────
  const ensureTmuxSession = useCallback(async (convId: string, prefix: string): Promise<string> => {
    const { data: row } = await supabase
      .from("chat_conversations")
      .select("tmux_session_name")
      .eq("id", convId)
      .single();
    if (row?.tmux_session_name) return row.tmux_session_name;

    const name = `${prefix}${convId.replace(/-/g, "").substring(0, 8)}`;
    const { data: updated } = await supabase
      .from("chat_conversations")
      .update({ tmux_session_name: name })
      .eq("id", convId)
      .is("tmux_session_name", null)
      .select("tmux_session_name");

    let resolved: string;
    if (updated && updated.length > 0) {
      resolved = updated[0].tmux_session_name!;
    } else {
      const { data: final } = await supabase
        .from("chat_conversations")
        .select("tmux_session_name")
        .eq("id", convId)
        .single();
      resolved = final?.tmux_session_name ?? name;
    }
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, tmux_session_name: resolved } : c
    ));
    return resolved;
  }, []);

  // ── Build command string (REPL spawn model for Codex + Claude) ───────────
  const buildCommand = useCallback(async (text: string, convId: string, selectedModel: string): Promise<string> => {
    const { data: conv } = await supabase.
    from("chat_conversations").
    select("agent, openclaw_session_id, claude_session_id, tmux_session_name").
    eq("id", convId).
    single();
    if (!conv) throw new Error("Conversation not found");

    // Single-quote wrapping: safest POSIX shell escape (no interpolation possible)
    const shellEscape = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    // "auto" = omit --model flag entirely, let the CLI use its configured default
    const modelFlag = selectedModel !== "auto" ? `--model ${selectedModel}` : "";

    if (conv.agent === "openclaw") {
      let sid = conv.openclaw_session_id;
      if (!sid) {
        const candidate = crypto.randomUUID();
        const { data: updated } = await supabase
          .from("chat_conversations")
          .update({ openclaw_session_id: candidate })
          .eq("id", convId)
          .is("openclaw_session_id", null)
          .select("openclaw_session_id");

        if (updated && updated.length > 0) {
          // We won the race
          sid = updated[0].openclaw_session_id;
        } else {
          // We lost the race — re-read the winner's stored value
          const { data: row } = await supabase
            .from("chat_conversations")
            .select("openclaw_session_id")
            .eq("id", convId)
            .single();
          sid = row?.openclaw_session_id ?? candidate;
        }

        // Sync local state so subsequent messages in this render cycle reuse sid
        setConversations(prev => prev.map(c =>
          c.id === convId ? { ...c, openclaw_session_id: sid! } : c
        ));
      }
      const modelPart = modelFlag ? ` ${modelFlag}` : "";
      return `openclaw agent --agent main --session-id ${sid}${modelPart} --message ${shellEscape(text)} --json --local\n`;
    }

    // ── REPL spawn model for Codex + Claude ──────────────────────────────
    // The PTY is the command channel. We spawn the REPL once via tmux; subsequent
    // messages are delivered via tmux send-keys on that same PTY.
    const sessionId = relay.getSessionId();
    const tmuxCheck = `command -v tmux >/dev/null 2>&1 || { echo 'TMUX_NOT_FOUND'; exit 1; }`;

    // Helper: build the send-keys command for a message
    const sendKeysCmd = (name: string, msg: string) =>
      `tmux send-keys -t ${name} ${shellEscape(msg)} && sleep 1 && tmux send-keys -t ${name} '' Enter`;

    if (conv.agent === "codex") {
      const modelPart = modelFlag ? ` --model ${selectedModel}` : "";
      const tmuxName = await ensureTmuxSession(convId, "cx-");

      if (!sessionId) {
        // No PTY yet — store the first message so onChunkActivity can flush it
        deferredFirstMsgRef.current = { agent: "codex", text };
        console.log("[REPL] Spawning Codex in new tmux session:", tmuxName);
        return `${tmuxCheck} && tmux new-session -d -s ${tmuxName} codex${modelPart} && sleep 1 && tmux send-keys -t ${tmuxName} Enter ""\n`;
      }
      const state = runtimeAgentsRef.current[sessionId];
      if (!state) {
        // First message on this PTY — register, queue, start tmux session
        runtimeAgentsRef.current[sessionId] = { agent: "codex", ready: false };
        pendingQueueRef.current[sessionId] = [text];
        setTimeout(() => {
          const s = runtimeAgentsRef.current[sessionId];
          if (s && !s.ready) {
            console.warn("[REPL] Boot timeout — forcing ready for session", sessionId);
            s.ready = true;
            const queue = pendingQueueRef.current[sessionId] ?? [];
            delete pendingQueueRef.current[sessionId];
            for (const queuedText of queue) {
              relay.sendRawStdin(sessionId, btoa(sendKeysCmd(tmuxName, queuedText) + "\n"));
            }
          }
        }, 20_000);
        console.log("[REPL] Spawning Codex in new tmux session (PTY exists):", tmuxName);
        return `${tmuxCheck} && tmux new-session -d -s ${tmuxName} codex${modelPart} && sleep 1 && tmux send-keys -t ${tmuxName} Enter ""\n`;
      }
      if (!state.ready) {
        pendingQueueRef.current[sessionId] = [...(pendingQueueRef.current[sessionId] ?? []), text];
        return "";
      }
      // REPL ready — deliver via send-keys
      return sendKeysCmd(tmuxName, text) + "\n";
    }

    if (conv.agent === "claude") {
      const modelPart = modelFlag ? ` ${modelFlag}` : "";
      const resumeFlag = conv.claude_session_id ? ` --resume ${conv.claude_session_id}` : "";
      const tmuxName = await ensureTmuxSession(convId, "cc-");

      if (!sessionId) {
        // No PTY yet — defer first message
        deferredFirstMsgRef.current = { agent: "claude", text };

        if (conv.tmux_session_name) {
          // Resume path — probe liveness, attach if alive, spawn fresh if dead
          attachingToTmuxRef.current = true;
          const spawnFresh = `tmux new-session -d -s ${tmuxName} claude${resumeFlag}${modelPart} && sleep 1 && tmux send-keys -t ${tmuxName} Enter ""`;
          console.log("[REPL] Resuming Claude tmux session:", tmuxName);
          return `${tmuxCheck} && (tmux has-session -t ${tmuxName} 2>/dev/null && tmux send-keys -t ${tmuxName} '' Enter && tmux attach -t ${tmuxName} || (${spawnFresh}))\n`;
        } else {
          // First-time path — fresh spawn
          console.log("[REPL] Spawning Claude in new tmux session:", tmuxName);
          return `${tmuxCheck} && tmux new-session -d -s ${tmuxName} claude${modelPart} && sleep 1 && tmux send-keys -t ${tmuxName} Enter ""\n`;
        }
      }
      const state = runtimeAgentsRef.current[sessionId];
      if (!state) {
        // PTY exists but no runtime state yet — first message on this PTY
        runtimeAgentsRef.current[sessionId] = { agent: "claude", ready: false };
        pendingQueueRef.current[sessionId] = [text];
        setTimeout(() => {
          const s = runtimeAgentsRef.current[sessionId];
          if (s && !s.ready) {
            console.warn("[REPL] Claude boot timeout — forcing ready for session", sessionId);
            s.ready = true;
            const queue = pendingQueueRef.current[sessionId] ?? [];
            delete pendingQueueRef.current[sessionId];
            for (const queuedText of queue) {
              relay.sendRawStdin(sessionId, btoa(sendKeysCmd(tmuxName, queuedText) + "\n"));
            }
          }
        }, 20_000);
        console.log("[REPL] Spawning Claude in new tmux session (PTY exists):", tmuxName);
        return `${tmuxCheck} && tmux new-session -d -s ${tmuxName} claude${modelPart} && sleep 1 && tmux send-keys -t ${tmuxName} Enter ""\n`;
      }
      if (!state.ready) {
        pendingQueueRef.current[sessionId] = [...(pendingQueueRef.current[sessionId] ?? []), text];
        return "";
      }
      // REPL ready — deliver via send-keys
      return sendKeysCmd(tmuxName, text) + "\n";
    }

    // Fallback (should not reach here for known agents)
    return `${conv.agent} ${shellEscape(text)}\n`;
  }, [relay, ensureTmuxSession]);


  // ── Parse Claude/Claude Code session id from stdout ─────────────────
  // Claude emits the session ID in several formats depending on mode:
  //   Interactive REPL first launch : "Session ID: <uuid>" or standalone UUID line
  //   Interactive REPL resume       : "Restored session: <id>"  (most reliable)
  //   stream-json mode              : {"type":"result","session_id":"<id>",...}
  //   Post-response prompt noise    : "> <uuid>" or ANSI-wrapped UUID line
  // UUID regex: standard 8-4-4-4-12 hex format.
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  // Strip ANSI/OSC escape sequences for clean line matching
  const stripAnsiForSession = (s: string) =>
    s.replace(/\x1b\[[0-9;?<>!]*[a-zA-Z]/g, "")
     .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
     .replace(/\x1b[()][A-Z0-9]/g, "")
     .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, "");
  const extractClaudeSessionId = (stdout: string): string | null => {
    // 0a. REPL resume banner: "Restored session: <uuid-or-id>"
    const restored = stdout.match(/Restored session:\s*([a-z0-9-]+)/i);
    if (restored) {console.log("[REPL] Claude session ID captured (resume banner):", restored[1]);return restored[1];}

    // 0b. First-launch and context-window banner variants:
    //   "Session ID: <uuid>"  /  "session: <uuid>"  /  "New session: <uuid>"
    //   "Context: <uuid>"  /  "context_id: <uuid>"
    const sessionLabel = stdout.match(/(?:New session|Session(?:\s+ID)?|Context(?:\s+id)?|context_id)\s*:\s*([a-z0-9-]+)/i);
    if (sessionLabel) {console.log("[REPL] Claude session ID captured (session label):", sessionLabel[1]);return sessionLabel[1];}

    // 0c. UUID on its own line, tolerating ANSI noise and leading prompt chars ("> <uuid>")
    for (const line of stdout.split("\n")) {
      // Strip ANSI then strip leading prompt chars: >, ✓, whitespace
      const t = stripAnsiForSession(line).replace(/^[>\s✓•·]+/, "").trim();
      if (UUID_RE.test(t) && t.replace(UUID_RE, "").trim() === "") {
        console.log("[REPL] Claude session ID captured (ANSI-stripped UUID line):", t);
        return t;
      }
    }

    // 1. JSONL result line (stream-json mode) — most reliable
    for (const line of stdout.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        const obj = JSON.parse(t) as Record<string, unknown>;
        if (obj.type === "result" && typeof obj.session_id === "string" && obj.session_id) {
          return obj.session_id;
        }
      } catch {/* skip */}
    }
    // 2. Any session_id field in JSON
    const match = stdout.match(/"session_id"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  };

  // ── Parse Codex session id from stdout ───────────────────────────────
  // `codex exec` emits a banner header: "session id: <uuid>"
  // It also emits JSONL lines with "session_id" fields or rs_/msg_ id prefixes.
  // We prefer the banner UUID (most reliable), then JSONL fields, then id prefixes.
  const extractCodexSessionId = (stdout: string): string | null => {
    // 0. Plain-text header banner: "session id: 019caf88-df39-7880-90df-6da242fd2ee3"
    //    Emitted by `codex exec` at the top of output
    const banner = stdout.match(/session\s+id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (banner) return banner[1];

    // 1. Explicit session_id field in any JSONL line
    const explicit = stdout.match(/"session_id"\s*:\s*"([^"]+)"/);
    if (explicit) return explicit[1];

    // 2. Full id value from first reasoning or message object (Codex accepts full id for --resume)
    const lines = stdout.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof obj.id === "string" && (obj.type === "reasoning" || obj.type === "message")) {
          return obj.id as string;
        }
      } catch {/* not valid JSON, skip */}
    }
    return null;
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
    setAwaitingApproval(null);
    setThinking(true);
    startActivity();
    setLiveLog([]);
    liveLogAccRef.current = "";
    trustGateHandledRef.current = null;

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
      // Clear-screen / erase-display sequences (ESC[2J, ESC[3J, ESC[H etc.) — strip wholesale
      replace(/\x1b\[\d*[JKH]/g, "").
      // OSC sequences: ESC ] ... BEL or ESC \
      replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").
      // Cursor-forward (ESC [ n C) used by Claude Code as word spacing → replace with space
      replace(/\x1b\[(\d+)C/g, (_, n) => " ".repeat(Math.min(Number(n), 4))).
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
          // Extract all top-level JSON objects from cleaned output (handles multiple objects)
          const extractJsonObjects = (s: string): string[] => {
            const results: string[] = [];
            let i = s.indexOf("{");
            while (i >= 0 && i < s.length) {
              let depth = 0;let inStr = false;let esc = false;
              let j = i;
              for (; j < s.length; j++) {
                const c = s[j];
                if (esc) {esc = false;continue;}
                if (c === "\\" && inStr) {esc = true;continue;}
                if (c === '"') {inStr = !inStr;continue;}
                if (inStr) continue;
                if (c === "{") depth++;else
                if (c === "}") {depth--;if (depth === 0) {results.push(s.slice(i, j + 1));break;}}
              }
              i = s.indexOf("{", j + 1);
            }
            return results;
          };
          const candidates = extractJsonObjects(cleaned);
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
          // Primary: parse --output-format stream-json JSONL lines
          // Each line is a JSON object; we want type:"assistant" content blocks
          // and type:"thinking" blocks for the thinking panel.
          // Final line is type:"result" which carries session_id.
          const claudeJsonlTextParts: string[] = [];
          const claudeJsonlThinkingParts: string[] = [];
          for (const line of cleaned.split("\n")) {
            const t = line.trim();
            if (!t.startsWith("{")) continue;
            try {
              const obj = JSON.parse(t) as Record<string, unknown>;
              // Stream-json thinking block: {"type":"thinking","thinking":"..."}
              if (obj.type === "thinking" && typeof obj.thinking === "string") {
                claudeJsonlThinkingParts.push(obj.thinking.trim());
                continue;
              }
              // Stream-json assistant message — flat array in obj.message
              if (obj.type === "assistant" && Array.isArray(obj.message)) {
                for (const block of obj.message as Record<string, unknown>[]) {
                  if (block.type === "text" && typeof block.text === "string") {
                    claudeJsonlTextParts.push(block.text);
                  }
                  if (block.type === "thinking" && typeof block.thinking === "string") {
                    claudeJsonlThinkingParts.push((block.thinking as string).trim());
                  }
                }
              }
              // Some versions nest content inside obj.message.content
              if (obj.type === "assistant") {
                const msg = obj.message as Record<string, unknown> | undefined;
                if (msg && Array.isArray(msg.content)) {
                  for (const block of msg.content as Record<string, unknown>[]) {
                    if (block.type === "text" && typeof block.text === "string") {
                      claudeJsonlTextParts.push(block.text);
                    }
                    if (block.type === "thinking" && typeof block.thinking === "string") {
                      claudeJsonlThinkingParts.push((block.thinking as string).trim());
                    }
                  }
                }
              }
            } catch {/* not JSON */}
          }
          // Merge JSONL thinking with any XML <thinking> blocks (JSONL takes precedence / deduplicates)
          if (claudeJsonlThinkingParts.length > 0) {
            claudeThinking = claudeJsonlThinkingParts.join("\n\n");
          }

          if (claudeJsonlTextParts.length > 0) {
            responseText = claudeJsonlTextParts.join("").trim();
          } else {
            // Fallback: plain-text stripping (non-JSON output or very old claude versions)
            responseText = cleaned.
            split("\n").
            filter((line) => {
              const t = line.trim();
              if (!t) return false;
              if (/^[%$#>→➜❯]\s*$/.test(t)) return false;
              if (/^[%$#>→➜❯]\s/.test(t)) return false;
              if (/^Restored session:/i.test(t)) return false;
              if (/^c?claude\s+(-p|-c|--print|--resume|--output)/i.test(t)) return false;
              if (/^\[[\d;?<>!]*[a-zA-Z]/.test(t)) return false;
              if (/^[=\-\+\*~\s]+$/.test(t)) return false;
              if (/\w+@\w+/.test(t) && /[~\/]/.test(t)) return false;
              if (/^\]\d+;/.test(t)) return false;
              if (/^\?2004[hl]$/.test(t)) return false;
              // Skip raw JSON lines (stream-json noise if JSONL parser above missed them)
              if (t.startsWith("{") && t.endsWith("}")) return false;
              // Skip lines that are purely Unicode block/box-drawing characters (Claude Code startup logo)
              if (/^[\u2580-\u259F\u2500-\u257F\s]+$/.test(t)) return false;
              // Skip Claude Code startup banner lines:
              //   "Claude Code  v2.1.63", "Sonnet  4.6  ·  Claude Pro", cwd paths
              if (/^claude\s+code\b/i.test(t)) return false;
              if (/^claude\s+code\s+v\d/i.test(t)) return false;
              if (/\bv\d+\.\d+\.\d+\b/.test(t) && !/\w{4,}/.test(t.replace(/v\d[\d.]+/, "").trim())) return false;
              if (/\b(sonnet|haiku|opus|claude)\b.*\bpro\b/i.test(t) && t.length < 80) return false;
              if (/^\/(?:Users|home|root|tmp|var|opt)\//i.test(t)) return false;
              return true;
            }).
            join("\n").
            trim();
          }
        }

        // ── Session ID capture (all agents) ─────────────────────────────────
        // Always attempt extraction so that a failed --resume (old session expired,
        // Claude starts fresh) or a first-message extraction failure gets corrected
        // on the very next spawn that produces a banner.
        if (convData?.agent === "claude" || convData?.agent === "codex") {
          const extractedId = convData.agent === "codex" ?
          extractCodexSessionId(stdout) :
          extractClaudeSessionId(stdout);
          if (extractedId && extractedId !== convData?.claude_session_id) {
            console.log(`[REPL] ${convData.agent} session ID updated → --resume ready:`, extractedId);
            await supabase.from("chat_conversations").update({ claude_session_id: extractedId }).eq("id", jobConvId);
            setConversations((prev) => prev.map((c) => c.id === jobConvId ? { ...c, claude_session_id: extractedId } : c));
          } else if (!extractedId && !convData?.claude_session_id) {
            console.warn(`[REPL] No session ID found in ${convData.agent} stdout (length: ${stdout.length}) — next spawn will not use --resume`);
          }
        }

        // ── Extract cwd from OSC 7 shell escape and persist to device ───────
        const detectedCwd = extractCwd(stdout);
        if (detectedCwd && convData?.device_id) {
          await supabase.from("devices").update({ workdir: detectedCwd }).eq("id", convData.device_id);
          setConversations((prev) => prev.map((c) => c.id === jobConvId ? { ...c, workdir: detectedCwd } : c));
        }

        // ── Auth/startup error classification ───────────────────────────────
        // Run BEFORE the auto-retry so auth failures return actionable messages
        // instead of triggering a pointless re-spawn that would hide the error.
        if (!responseText.trim() && (convData?.agent === "codex" || convData?.agent === "claude")) {
          const classifierErr = classifyReplStartupError(stdout, convData.agent as "codex" | "claude");
          if (classifierErr) {
            responseText = formatReplError(classifierErr);
          }
        }

        // ── Auto-retry on empty response ────────────────────────────────────
        if (!responseText.trim()) {
          console.warn("[Chat] Empty response detected, retrying once…");
          try {
            const retryStdout = await sendViaRelay(command, convData?.agent === "openclaw", onChunkActivity);
            const retryCleaned = stripAnsi(retryStdout);

            if (convData?.agent === "openclaw") {
              // Re-use proper object extractor for retry
              const extractObjs = (s: string): string[] => {
                const res: string[] = [];let i = s.indexOf("{");
                while (i >= 0) {let d = 0;let inStr = false;let esc = false;let j = i;
                  for (; j < s.length; j++) {const c = s[j];if (esc) {esc = false;continue;}if (c === "\\" && inStr) {esc = true;continue;}if (c === '"') {inStr = !inStr;continue;}if (inStr) continue;if (c === "{") d++;else if (c === "}") {d--;if (d === 0) {res.push(s.slice(i, j + 1));break;}}}i = s.indexOf("{", j + 1);}
                return res;
              };
              for (const candidate of extractObjs(retryCleaned).reverse()) {
                try {
                  const parsed = JSON.parse(candidate);
                  if (Array.isArray(parsed?.payloads)) {
                    const textPayload = parsed.payloads.find((p: {type: string;text?: string;}) => p.type === "text" && p.text);
                    if (textPayload?.text) {responseText = String(textPayload.text);break;}
                  }
                  const payloadText = parsed?.payloads?.[0]?.text;
                  if (payloadText) {responseText = String(payloadText);break;}
                  const fallback = parsed.content ?? parsed.message ?? parsed.response ?? parsed.text ?? parsed.result;
                  if (fallback && typeof fallback === "string") {responseText = fallback;break;}
                } catch {/* try next */}
              }
            } else if (convData?.agent === "codex") {
              // Use proper JSONL parser (same as primary path)
              const retryTextParts: string[] = [];
              for (const line of retryCleaned.split("\n")) {
                const t = line.trim();
                if (!t || !t.startsWith("{")) continue;
                try {
                  const obj = JSON.parse(t);
                  if (obj.type === "message" && obj.role === "assistant" && Array.isArray(obj.content)) {
                    for (const part of obj.content) {
                      if (part.type === "output_text" && typeof part.text === "string") retryTextParts.push(part.text);
                    }
                  } else if (obj.type === "text" && typeof obj.text === "string") {
                    retryTextParts.push(obj.text);
                  }
                } catch {/* skip */}
              }
              responseText = retryTextParts.join("\n").trim();
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

        responseText = responseText.trim() || EMPTY_RESPONSE_TEXT;

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
            // Snapshot structured tool call log entries (cards)
            const toolCallEntries = liveLog.filter((e) => e.type === "tool_call");
            if (toolCallEntries.length > 0) {
              toolCallEntriesMapRef.current.set(revealedIdx, toolCallEntries);
            }
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
          stopActivity();setActivityStatus("writing");

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
            }})();}

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

  // ── Auto-send pending clone command ────────────────────────────────────────
  useEffect(() => {
    if (pendingAutoSendRef.current && input === pendingAutoSendRef.current) {
      pendingAutoSendRef.current = null;
      setTimeout(() => handleSend(), 80);
    }
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── After clone finishes, update workdir to the cloned folder ────────────
  const prevIsStreamingRef = useRef(false);
  useEffect(() => {
    const currentlyStreaming = !!(thinking || streamingMsgIndex !== null);
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = currentlyStreaming;
    if (wasStreaming && !currentlyStreaming && pendingCloneInfoRef.current && selectedDeviceId) {
      const { dest } = pendingCloneInfoRef.current;
      pendingCloneInfoRef.current = null;
      if (!dest) return;
      const currentDevice = devices.find((d) => d.id === selectedDeviceId);
      const base = currentDevice?.workdir || "~";
      const clonedPath = dest.startsWith("/") ? dest : `${base}/${dest}`;
      supabase.from("devices").update({ workdir: clonedPath }).eq("id", selectedDeviceId).then(() => {
        toast({ title: "Working directory updated", description: `Now in ${clonedPath}` });
      });
    }
  }, [thinking, streamingMsgIndex]); // eslint-disable-line react-hooks/exhaustive-deps


  // ── Abort streaming ────────────────────────────────────────────────────
  const handleAbort = useCallback(() => {
    // Send Ctrl+C (\x03) to the active PTY session so the agent process actually terminates
    const sessionId = relay.getSessionId();
    if (sessionId) {
      relay.sendRawStdin(sessionId, btoa("\x03"));
    }
    abortStreamRef.current = true;
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    setStreamingMsgIndex(null);
    setThinking(false);
    stopActivity();
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [stopActivity, relay]);

  // ── Option-select: inject stdin directly into the active PTY session ──────
  // This is the correct way to respond to agent prompts (tool approvals, yes/no, etc.)
  // The agent is literally waiting for keyboard input on the PTY — we send it as stdin.
  const handleOptionSelect = useCallback((opt: string, msgIndex: number) => {
    // Mark this message as answered so its option buttons disappear
    setAnsweredMsgIndices((prev) => new Set([...prev, msgIndex]));
    const sessionId = relay.getSessionId();
    // Send even if status is "ready" — sendRawStdin now opens a fallback WS if needed
    if (sessionId) {
      // Normalize: map friendly labels back to the single-char / short form the agent expects
      // e.g. "Approve" → "y", "Deny" → "n", "Yes" → "y", "No" → "n"
      const normalized = (() => {
        const lower = opt.toLowerCase().trim();
        if (lower === "yes" || lower === "approve" || lower === "allow" || lower === "confirm" || lower === "proceed") return "y";
        if (lower === "no" || lower === "deny" || lower === "reject" || lower === "decline" || lower === "abort") return "n";
        return opt.trim();
      })();
      const payload = normalized + "\n";
      relay.sendRawStdin(sessionId, btoa(payload));
      // Show the selected option as a user message for visual context
      setMessages((prev) => [...prev, { role: "user", content: opt }]);
      // Re-enter thinking state so the live activity feed shows agent is processing
      setThinking(true);
      startActivity();
      setLiveLog([]);
      liveLogAccRef.current = "";
      trustGateHandledRef.current = null;
    } else {
      // Fallback: no active session (agent already finished), start a new message
      setInput(opt);
      setTimeout(() => handleSend(), 50);
    }
  }, [startActivity]);

  // ── Approval choice: respond to a blocking PTY prompt from the composer ──
  const handleApprovalChoice = useCallback((choice: string) => {
    if (!awaitingApproval) return;
    const { sessionId } = awaitingApproval;

    // Normalize choice to single char the CLI expects
    const normalized = (() => {
      if (choice === ENTER_TO_CONFIRM_SENTINEL) return "\r"; // bare Enter for Claude's trust gate
      const lower = choice.toLowerCase().trim();
      if (lower === "yes" || lower === "approve" || lower === "allow" || lower === "confirm" || lower === "proceed" || lower === "trust") return "1";
      if (lower === "no" || lower === "deny" || lower === "reject" || lower === "decline" || lower === "abort" || lower === "quit") return "2";
      return choice.trim();
    })();

    relay.sendRawStdin(sessionId, btoa(normalized + "\n"));

    // If user trusted — remember it so future trust prompts auto-resolve
    const isTrustChoice = /yes|approve|allow|trust/i.test(choice);
    if (isTrustChoice && selectedDeviceId) {
      localStorage.setItem(`agent-trust-${selectedDeviceId}`, "true");
    }

    setMessages((prev) => [...prev, { role: "user", content: choice }]);
    setAwaitingApproval(null);
    setThinking(true);
    startActivity();
    setLiveLog([]);
    liveLogAccRef.current = "";
    trustGateHandledRef.current = null;
  }, [awaitingApproval, selectedDeviceId, relay, startActivity]);

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
        s.replace(/\x1b\[\d*[JKH]/g, "").
        replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").
        replace(/\x1b\[(\d+)C/g, (_, n) => " ".repeat(Math.min(Number(n), 4))).
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
          // Shared JSON object extractor (same as primary send path)
          const extractObjs = (s: string): string[] => {
            const res: string[] = [];let idx = s.indexOf("{");
            while (idx >= 0) {let d = 0;let inStr = false;let esc = false;let j = idx;
              for (; j < s.length; j++) {const c = s[j];if (esc) {esc = false;continue;}if (c === "\\" && inStr) {esc = true;continue;}if (c === '"') {inStr = !inStr;continue;}if (inStr) continue;if (c === "{") d++;else if (c === "}") {d--;if (d === 0) {res.push(s.slice(idx, j + 1));break;}}}idx = s.indexOf("{", j + 1);}
            return res;
          };
          if (convData?.agent === "openclaw") {
            for (const candidate of extractObjs(cleaned).reverse()) {
              try {
                const parsed = JSON.parse(candidate);
                if (Array.isArray(parsed?.payloads)) {
                  const tp = parsed.payloads.find((p: {type: string;text?: string;}) => p.type === "text" && p.text);
                  if (tp?.text) {responseText = String(tp.text);break;}
                }
                const payloadText = parsed?.payloads?.[0]?.text;
                if (payloadText) {responseText = String(payloadText);break;}
                const fallback = parsed.content ?? parsed.message ?? parsed.response ?? parsed.text ?? parsed.result;
                if (fallback && typeof fallback === "string") {responseText = fallback;break;}
              } catch {/* next */}
            }
          } else if (convData?.agent === "codex") {
            // Proper JSONL parser for Codex output
            const codexParts: string[] = [];
            for (const line of cleaned.split("\n")) {
              const t = line.trim();
              if (!t || !t.startsWith("{")) continue;
              try {
                const obj = JSON.parse(t);
                if (obj.type === "message" && obj.role === "assistant" && Array.isArray(obj.content)) {
                  for (const part of obj.content) {
                    if (part.type === "output_text" && typeof part.text === "string") codexParts.push(part.text);
                  }
                } else if (obj.type === "text" && typeof obj.text === "string") {
                  codexParts.push(obj.text);
                }
              } catch {/* skip */}
            }
            responseText = codexParts.join("\n").trim();
          } else {
            // Claude: JSONL stream-json primary, plain-text fallback
            const claudeParts: string[] = [];
            for (const line of cleaned.split("\n")) {
              const t = line.trim();
              if (!t.startsWith("{")) continue;
              try {
                const obj = JSON.parse(t) as Record<string, unknown>;
                if (obj.type === "assistant") {
                  const msg = obj.message as Record<string, unknown> | undefined;
                  const content = msg?.content ?? obj.message;
                  if (Array.isArray(content)) {
                    for (const block of content as Record<string, unknown>[]) {
                      if (block.type === "text" && typeof block.text === "string") claudeParts.push(block.text);
                    }
                  }
                }
              } catch {/* not JSON */}
            }
            if (claudeParts.length > 0) {
              responseText = claudeParts.join("").trim();
            } else {
              responseText = cleaned.split("\n").filter((line) => {
                const t = line.trim();
                if (!t) return false;
                if (/^[%$#>→➜❯]\s*$/.test(t)) return false;
                if (/^[%$#>→➜❯]\s/.test(t)) return false;
                if (/^Restored session:/i.test(t)) return false;
                if (/^c?claude\s+(-p|-c|--print|--resume|--output)/i.test(t)) return false;
                if (/^\[[\d;?<>!]*[a-zA-Z]/.test(t)) return false;
                if (/^[=\-\+\*~\s]+$/.test(t)) return false;
                if (t.startsWith("{") && t.endsWith("}")) return false;
                return true;
              }).join("\n").trim();
            }
          }
          // ── Session ID capture for regenerate path (all agents) ────────────
          if (convData?.agent === "claude" || convData?.agent === "codex") {
            const extractedId = convData.agent === "codex" ?
            extractCodexSessionId(stdout) :
            extractClaudeSessionId(stdout);
            if (extractedId && extractedId !== convData?.claude_session_id) {
              console.log(`[REPL] ${convData.agent} session ID updated (regen) → --resume ready:`, extractedId);
              await supabase.from("chat_conversations").update({ claude_session_id: extractedId }).eq("id", jobConvId);
              setConversations((prev) => prev.map((c) => c.id === jobConvId ? { ...c, claude_session_id: extractedId } : c));
            }
          }
          responseText = responseText.trim() || EMPTY_RESPONSE_TEXT;
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
    // Reset all per-conversation UI state so the new blank conversation is clean.
    // Any running background job for the previous conversation continues unaffected —
    // it checks activeConvIdRef.current === jobConvId before touching UI state.
    setMessages([]);
    setInput("");
    setThinking(false);
    stopActivity();
    setLiveLog([]);
    liveLogAccRef.current = "";
    trustGateHandledRef.current = null;
    setAwaitingApproval(null);
    setStreamingMsgIndex(null);
    setAgentSwitchPending(null);
    setTimeout(() => textareaRef.current?.focus(), 50);
    // Pre-warm a PTY for the new conversation in the background so the first
    // message doesn't have to wait for shell startup.
    if (selectedDeviceId) {
      relay.prewarmSession(selectedDeviceId, null);
    }
  }, [stopActivity, selectedDeviceId, relay]);

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
      setModel("auto");
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
        (c) => c.agents.includes("both") || agent !== "terminal" && c.agents.includes(agent)
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

  // ── Live preview helper ───────────────────────────────────────────────
  const handleOpenPreview = useCallback(async (port?: string) => {
    const targetPort = port ?? previewInputPort;
    // Open immediately with the target port — no waiting
    setPreviewUrl(`http://127.0.0.1:${targetPort}`);
    setPreviewInputPort(targetPort);
    setShowPreview(true);
    setPreviewTab("preview");
    setPreviewPopoverOpen(false);
    // Auto-detect in the background and silently update port if different
    try {
      setPreviewAutoDetecting(true);
      const detectCmd = `(\n  command -v lsof >/dev/null && lsof -iTCP -sTCP:LISTEN -n -P\n) || (\n  command -v ss >/dev/null && ss -ltn\n) || (\n  netstat -ltn 2>/dev/null\n) | grep -oE ':(3000|5173|8080|4200|8000|8888|4000|3001)\\b' | head -1 | tr -d ':'\n`;
      const stdout = await sendViaRelay(detectCmd, false);
      const detected = stdout.replace(/\x1b\[[\d;]*[a-zA-Z]/g, "").trim();
      if (detected && detected !== targetPort && !isNaN(Number(detected))) {
        setPreviewUrl(`http://127.0.0.1:${detected}`);
        setPreviewInputPort(detected);
      }
    } catch {

      // silently ignore — preview is already open with targetPort
    } finally {setPreviewAutoDetecting(false);
    }
  }, [previewInputPort, sendViaRelay]);

  // ── Key handler ───────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // If trust gate is showing, Enter confirms it (matches the ↵ button)
      if (awaitingApproval?.options.includes(ENTER_TO_CONFIRM_SENTINEL)) {
        handleApprovalChoice(ENTER_TO_CONFIRM_SENTINEL);
        return;
      }
      handleSend();
    }
  };

  return (
    <AppLayout>
      <div className="flex h-full overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-w-0">
          <ResizablePanel defaultSize={showPreview ? 50 : 100} minSize={30}>
        {/* Main chat area — sidebar is now in AppSidebar */}
        <div
              className={`flex flex-col h-full relative transition-all duration-150 ${isDragOver ? "ring-2 ring-primary/40 ring-inset" : ""}`}
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
                className="absolute top-0 left-0 right-0 z-20 border-b border-border/10 flex items-center px-5 relative backdrop-blur-md bg-background/80"
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
                    
                  </span>);

                  })()}
            </div>
            {/* Right — device pill + refresh + new chat */}
            <div className="ml-auto flex items-center gap-3">

              {/* Session resume badge — shown when conversation has a stored session ID */}
              {(() => {
                    const activeConv = conversations.find((c) => c.id === activeConvId);
                    const sessionId = agent === "openclaw" ?
                    activeConv?.openclaw_session_id ?? null :
                    activeConv?.claude_session_id ?? null;
                    if (!sessionId || agent === "terminal") return null;
                    const short = sessionId.slice(0, 8);
                    const agentLabel = agent === "openclaw" ? "OpenClaw" : agent === "codex" ? "Codex" : "Claude";
                    // Session age from conversation's last update time
                    const sessionAge = (() => {
                      const ts = activeConv?.updated_at;
                      if (!ts) return null;
                      const diff = (Date.now() - new Date(ts).getTime()) / 1000;
                      if (diff < 60) return "just now";
                      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                      return `${Math.floor(diff / 86400)}d ago`;
                    })();
                    const isStale = (() => {
                      const ts = activeConv?.updated_at;
                      if (!ts) return false;
                      return Date.now() - new Date(ts).getTime() > 6 * 3600 * 1000; // >6h
                    })();
                    const handleClearSession = async () => {
                      if (!activeConvId) return;
                      const field = agent === "openclaw" ? "openclaw_session_id" : "claude_session_id";
                      await supabase.from("chat_conversations").update({ [field]: null }).eq("id", activeConvId);
                      setConversations((prev) => prev.map((c) =>
                      c.id === activeConvId ?
                      { ...c, claude_session_id: agent !== "openclaw" ? null : c.claude_session_id, openclaw_session_id: agent === "openclaw" ? null : c.openclaw_session_id } :
                      c
                      ));
                    };
                    return (
                      <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="hidden sm:flex items-center gap-0 rounded-full text-xs font-medium text-primary/70 bg-primary/8 border border-primary/15 overflow-hidden">
                        {/* Session info side */}
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 select-none cursor-default">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-70">
                            <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5z" />
                          </svg>
                          <div className="flex flex-col leading-none gap-[2px]">
                            <span>Resuming · <span className="font-mono opacity-80">{short}…</span></span>
                            {sessionAge &&
                                <span className={cn(
                                  "text-[9px] font-mono",
                                  isStale ? "text-[hsl(38_90%_58%)]" : "opacity-45"
                                )}>
                                {isStale ? "⚠ " : ""}{sessionAge}
                              </span>
                                }
                          </div>
                        </div>
                        {/* Divider */}
                        <div className="w-px h-4 bg-primary/20 self-center" />
                        {/* Clear button */}
                        <button
                              onClick={handleClearSession}
                              title={`Clear ${agentLabel} session — next message starts fresh`}
                              className="flex items-center justify-center px-2 py-1.5 text-primary/50 hover:text-destructive hover:bg-destructive/10 transition-colors duration-150">
                              
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      <span className="font-mono">{agentLabel} session: {sessionId}</span>
                      <span className="block text-muted-foreground mt-0.5">Click × to start a fresh session</span>
                    </TooltipContent>
                  </Tooltip>);

                  })()}

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
                    s === "healthy" ?
                    `${relayHealth.connectors} connector(s) · ${relayHealth.sessions} session(s)${relayHealth.uptime ? ` · up ${Math.floor(relayHealth.uptime / 60)}m` : ""}` :
                    s === "unreachable" ?
                    relayHealth.error ?? "Cannot reach relay server" :
                    label;
                    return (
                      <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                            onClick={refreshRelayHealth}
                            className={cn(
                              "hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors",
                              s === "healthy" ? "text-foreground/70 hover:bg-accent" :
                              s === "checking" ? "text-muted-foreground" :
                              "text-destructive/80 hover:bg-destructive/10"
                            )}>
                            
                        {s === "checking" ?
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> :
                            <span className={cn("w-2 h-2 rounded-full shrink-0", dotColor, s === "healthy" && "animate-pulse")} />
                            }
                        <span className="hidden sm:inline">{label}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">{tooltip}</TooltipContent>
                  </Tooltip>);

                  })()}

              {/* PTY session pill — shared terminal session indicator */}
              {ptySessionId && selectedDeviceId &&
                  <Tooltip>
                  <TooltipTrigger asChild>
                     <button
                        onClick={() => {
                          setShowTerminalDrawer((v) => {
                            if (!v) setTimeout(() => drawerTerminalRef.current?.focus(), 100);
                            return !v;
                          });
                        }}
                        className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium text-[hsl(var(--status-online)/0.8)] bg-[hsl(var(--status-online)/0.08)] border border-[hsl(var(--status-online)/0.18)] hover:bg-[hsl(var(--status-online)/0.15)] hover:border-[hsl(var(--status-online)/0.3)] transition-colors cursor-pointer select-none">
                      <Terminal className="h-3 w-3 shrink-0" />
                      <span className="font-mono">{ptySessionId.slice(0, 8)}…</span>
                      <span className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0 bg-[hsl(var(--status-online))]",
                          thinking ? "animate-pulse" : "opacity-50"
                        )} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs max-w-xs">
                    <p className="font-semibold mb-0.5">{showTerminalDrawer ? "Hide" : "Show"} terminal drawer</p>
                    <p className="font-mono text-muted-foreground break-all">{ptySessionId}</p>
                    <p className="text-muted-foreground mt-1">Chat &amp; terminal share this PTY — shell state persists between messages.</p>
                  </TooltipContent>
                 </Tooltip>
                  }

              {/* REPL debug overlay button */}
              <Popover open={showReplDebug} onOpenChange={setShowReplDebug}>
                <PopoverTrigger asChild>
                  <button
                        className={cn(
                          "hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors",
                          showReplDebug ?
                          "bg-primary/10 text-primary border border-primary/20" :
                          "text-foreground/40 hover:text-foreground hover:bg-accent"
                        )}
                        title="REPL agent runtime state">
                        
                    <Code2 className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="end" className="w-80 p-0 font-mono text-xs overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                    <span className="font-sans font-semibold text-foreground text-[11px] tracking-wide uppercase">REPL Runtime State</span>
                    <span className="text-muted-foreground text-[10px]">polling 500ms</span>
                  </div>
                  {Object.keys(replDebugSnapshot).length === 0 ?
                      <div className="px-3 py-4 text-center text-muted-foreground text-[11px] font-sans">
                      <p className="mb-1">No active REPL agents</p>
                      <p className="text-muted-foreground/60">Send a Codex or Claude message to spawn a REPL session</p>
                    </div> :

                      <div className="divide-y divide-border">
                      {Object.entries(replDebugSnapshot).map(([sid, state]) =>
                        <div key={sid} className="px-3 py-2.5 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground truncate text-[10px]" title={sid}>{sid.slice(0, 8)}…{sid.slice(-4)}</span>
                            <span className={cn(
                              "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium",
                              state.ready ?
                              "bg-[hsl(142_76%_36%/0.15)] text-[hsl(142_76%_45%)]" :
                              "bg-[hsl(38_90%_50%/0.12)] text-[hsl(38_90%_58%)]"
                            )}>
                              {state.ready ? "● READY" : "○ BOOTING"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px]">
                            <span>
                              <span className="text-muted-foreground">agent </span>
                              <span className="text-foreground">{state.agent}</span>
                            </span>
                            {state.approvalMode &&
                            <span>
                                <span className="text-muted-foreground">mode </span>
                                <span className={cn(
                                state.approvalMode === "never" || state.approvalMode === "full-auto" ? "text-muted-foreground" : "text-primary"
                              )}>{state.approvalMode}</span>
                              </span>
                            }
                          </div>
                          {sid === ptySessionId &&
                          <div className="text-[10px] text-primary/60">← active PTY</div>
                          }
                        </div>
                        )}
                    </div>
                      }
                  <div className="px-3 py-2 border-t bg-muted/20 flex items-center justify-between gap-2">
                    <span className="font-sans text-[10px] text-muted-foreground">PTY: <span className="font-mono">{ptySessionId ? `${ptySessionId.slice(0, 8)}…` : "none"}</span></span>
                    <button
                          onClick={() => {Object.keys(runtimeAgentsRef.current).forEach((k) => delete runtimeAgentsRef.current[k]);setReplDebugSnapshot({});}}
                          className="font-sans text-[10px] text-destructive/70 hover:text-destructive transition-colors">
                          
                      Clear state
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Terminal drawer toggle */}
              {selectedDeviceId && agent !== "terminal" &&
                  <button
                    onClick={() => {
                      setShowTerminalDrawer((v) => {
                        if (!v) setTimeout(() => drawerTerminalRef.current?.focus(), 100);
                        return !v;
                      });
                    }}
                    className={cn(
                      "hidden sm:flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-colors",
                      showTerminalDrawer ? "bg-primary/10 text-primary" : "text-foreground/50 hover:text-foreground hover:bg-accent"
                    )}
                    title="Toggle terminal">
                  <Terminal className="h-3.5 w-3.5" />
                </button>
                  }

              {/* Preview button */}
              {selectedDeviceId &&
                  <Popover open={previewPopoverOpen} onOpenChange={setPreviewPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                        className={cn(
                          "hidden sm:flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-colors",
                          showPreview ? "bg-primary/10 text-primary" : "text-foreground/50 hover:text-foreground hover:bg-accent"
                        )}
                        title={showPreview ? `Live preview · :${previewInputPort}` : "Live preview"}>
                      {previewAutoDetecting ?
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                        <Monitor className="h-3.5 w-3.5" />}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="end" className="w-64 p-3">
                    <p className="text-xs font-medium mb-2">Open live preview</p>
                    <div className="flex gap-2 mb-2">
                      <Input
                          className="h-8 text-sm"
                          placeholder="Port (e.g. 3000)"
                          value={previewInputPort}
                          onChange={(e) => setPreviewInputPort(e.target.value.replace(/\D/g, ""))}
                          onKeyDown={(e) => e.key === "Enter" && handleOpenPreview()} />
                        
                      <Button size="sm" className="h-8 shrink-0" onClick={() => handleOpenPreview()}>Open</Button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {["3000", "5173", "8080", "4200", "8000"].map((p) =>
                        <button key={p} onClick={() => handleOpenPreview(p)}
                        className="text-xs px-2 py-0.5 rounded-full border hover:bg-accent transition-colors">:{p}</button>
                        )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">Auto-detects running dev server on your device.</p>
                  </PopoverContent>
                </Popover>
                  }

              {/* Claude session resume chip */}
              {(() => {
                    const conv = conversations.find((c) => c.id === activeConvId);
                    if (conv?.agent === "claude" && conv.claude_session_id) {
                      const short = conv.claude_session_id.slice(0, 8);
                      return (
                        <span
                          title={`Resuming Claude session ${conv.claude_session_id}`}
                          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-primary/20 bg-primary/8 text-primary/80 select-none">
                          
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
                      Resuming {short}…
                    </span>);

                    }
                    return null;
                  })()}

              {/* Device pill — opens right panel */}
              <button
                    onClick={() => setDevicePanelOpen(true)}
                    className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150 hover:bg-accent text-foreground/80 hover:text-foreground"
                    title={(() => { const dev = devices.find((d) => d.id === selectedDeviceId); return dev ? dev.name : "No device"; })()}>
                {(() => {
                      const dev = devices.find((d) => d.id === selectedDeviceId);
                      return dev ?
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dev.status === "online" ? "bg-status-online animate-pulse" : "bg-muted-foreground/40"}`} /> :
                      <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-muted-foreground/20" />;
                    })()}
              </button>
              <button
                    onClick={() => window.location.reload()}
                    className="hidden sm:flex w-9 h-9 rounded-full items-center justify-center text-foreground/50 hover:text-foreground hover:bg-accent transition-all duration-150"
                    title="Refresh page">

                <RefreshCw className="h-5 w-5" />
              </button>
              <button
                    onClick={() => {setActiveConvId(null);handleNew();}}
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
          {agent === "terminal" ?
              <div className="flex-1 min-h-0 overflow-hidden">
              {selectedDeviceId ?
                <EmbeddedTerminal deviceId={selectedDeviceId} convId={activeConvId} /> :

                <div className="flex items-center justify-center h-full text-muted-foreground/50 text-sm">
                  Select a device to open a terminal
                </div>
                }
            </div> :

              <>
          {/* Dev server detected banner */}
          {detectedPreviewPort && !showPreview &&
                <div className="animate-fade-in flex items-center gap-2 px-4 py-2 mx-4 mt-3 rounded-lg border border-primary/30 bg-primary/5 text-sm">
              <Monitor className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="flex-1 text-muted-foreground">Dev server detected on <span className="font-medium text-foreground">:{detectedPreviewPort}</span></span>
              <Button
                    size="sm"
                    variant="default"
                    className="h-6 px-2.5 text-xs"
                    onClick={() => {
                      setPreviewUrl(`http://127.0.0.1:${detectedPreviewPort}`);
                      setPreviewInputPort(detectedPreviewPort);
                      setShowPreview(true);
                    }}>
                    
                Open Preview
              </Button>
              <button
                    onClick={() => {setDetectedPreviewPort(null);detectedPortRef.current = null;}}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Dismiss">
                    
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
                }
          <div ref={scrollRef} onScroll={handleScroll} className={`flex-1 overflow-y-auto ${messages.length === 0 && !thinking ? "flex items-center justify-center pt-16" : "pt-20 pb-8 sm:pb-10"}`}>
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

                      {/* Open Project + Clone Repo actions — claude, codex & openclaw */}
                      {(agent === "claude" || agent === "codex" || agent === "openclaw") && selectedDeviceId &&
                        <div className="flex gap-3 mb-6 animate-fade-in" style={{ animationDelay: "280ms", animationFillMode: "both" }}>
                          <button
                            onClick={() => {
                              setFolderPath("");setFolderItems([]);setOpenProjectOpen(true);browseFolderViaRelay("~");
                              // seed current workdir into recents
                              const dev = devices.find((d) => d.id === selectedDeviceId);
                              if (dev?.workdir && selectedDeviceId) addRecentProject(selectedDeviceId, dev.workdir);
                            }}
                            className="flex items-center gap-2.5 px-5 py-3 rounded-xl border-2 border-border/40 bg-card hover:border-foreground/25 hover:bg-accent/40 transition-all duration-150 text-sm font-medium text-foreground/80 hover:text-foreground">
                            
                            <FolderOpen size={16} className="text-primary/70" />
                            Open project
                          </button>
                          <button
                            onClick={() => {setCloneUrl("");setCloneDir("");setCloneRepoOpen(true);}}
                            className="flex items-center gap-2.5 px-5 py-3 rounded-xl border-2 border-border/40 bg-card hover:border-foreground/25 hover:bg-accent/40 transition-all duration-150 text-sm font-medium text-foreground/80 hover:text-foreground">
                            
                            <GitFork size={16} className="text-primary/70" />
                            Clone repo
                          </button>
                        </div>
                        }

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
                    {msg.type === "scrollback_replay" ? (() => {
                          const rawText = msg.content.replace(/^\*\*Session resumed\*\*.*?```\n?/s, "").replace(/\n?```$/, "");
                          const allLines = rawText.split("\n");
                          const PREVIEW_LINES = 50;
                          const isExpanded = expandedScrollback.has(i);
                          const visibleLines = isExpanded ? allLines : allLines.slice(-PREVIEW_LINES);
                          const truncated = !isExpanded && allLines.length > PREVIEW_LINES;
                          return (
                            <div className="max-w-[900px] mx-auto px-3 sm:px-6 py-2">
                          <div className="rounded-lg border border-border/30 bg-muted/30 px-4 py-3 text-xs">
                            <div className="flex items-center gap-2 mb-2 text-muted-foreground/70 font-medium">
                              <RefreshCw className="h-3 w-3" />
                              <span>Session resumed — output since last disconnect:</span>
                              {truncated &&
                                  <span className="ml-auto text-muted-foreground/50 text-[10px]">{allLines.length - PREVIEW_LINES} lines hidden</span>
                                  }
                            </div>
                            <pre className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground/60 max-h-[300px] overflow-y-auto">{visibleLines.join("\n")}</pre>
                            {truncated &&
                                <button
                                  onClick={() => setExpandedScrollback((prev) => new Set([...prev, i]))}
                                  className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors">
                                  
                                <ChevronDown className="h-3 w-3" />
                                Show full output ({allLines.length} lines)
                              </button>
                                }
                            {isExpanded && allLines.length > PREVIEW_LINES &&
                                <button
                                  onClick={() => setExpandedScrollback((prev) => {const n = new Set(prev);n.delete(i);return n;})}
                                  className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors">
                                  
                                <ChevronUp className="h-3 w-3" />
                                Show less
                              </button>
                                }
                          </div>
                        </div>);

                        })() :
                        <ChatMessage
                          role={msg.role}
                          content={msg.content}
                          streaming={streamingMsgIndex === i}
                          activityStatus={streamingMsgIndex === i ? activityStatus : undefined}
                          toolCalls={streamingMsgIndex === i ? toolCalls : msg.role === "assistant" ? toolCallsMapRef.current.get(i) : undefined}
                          liveLog={streamingMsgIndex === i ? liveLog : undefined}
                          completedToolCalls={streamingMsgIndex !== i && msg.role === "assistant" ? toolCallEntriesMapRef.current.get(i) : undefined}
                          rawStdout={msg.role === "assistant" ? rawStdoutMapRef.current.get(i) : undefined}
                          thinkingContent={msg.role === "assistant" ? thinkingMapRef.current.get(i) : undefined}
                          thinkingDurationMs={msg.role === "assistant" ? thinkingDurationMapRef.current.get(i) : undefined}
                          createdAt={msg.created_at}
                          agent={agent as string === "terminal" ? "openclaw" : agent as "openclaw" | "claude" | "codex"}
                          onRegenerate={
                          msg.role === "assistant" &&
                          !thinking &&
                          streamingMsgIndex === null && (
                          i === messages.length - 1 || msg.content === EMPTY_RESPONSE_TEXT) ?
                          handleRegenerate :
                          undefined
                          }
                          onOptionSelect={msg.role === "assistant" && !answeredMsgIndices.has(i) ? (opt) => handleOptionSelect(opt, i) : undefined} />

                        }
                  </div>
                      )}
                {thinking &&
                      <div className="animate-fade-in">
                    <ChatMessage role="assistant" content="" thinking activityStatus={activityStatus} toolCalls={toolCalls} liveLog={liveLog} agent={agent as string === "terminal" ? "openclaw" : agent as "openclaw" | "claude" | "codex"} />
                  </div>
                      }
              </div>
            </div>
          </div>
          </>} {/* end terminal/chat conditional */}

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
          {agent !== "terminal" &&
              <div className="sticky bottom-0 z-20 shrink-0 pt-2 backdrop-blur-md bg-background/80 border-t border-border/10" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
            {/* ── Connector offline reconnecting banner ── */}
            {connectorOffline && selectedDeviceId &&
                <div className="max-w-[900px] mx-auto px-3 sm:px-8 mb-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs text-orange-400/90">
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <span>Device connector is offline. Reconnecting automatically — your session will resume when it comes back online.</span>
                </div>
              </div>
                }
            <div className="max-w-[900px] mx-auto px-3 sm:px-8">
            <div className="max-w-[900px] mx-auto">
              {/* Git status bar */}
              {gitStatus && gitStatus !== "loading" && gitStatus.branch &&
                    <div className="flex items-center gap-2 px-1 pb-1.5 text-[11px] text-muted-foreground/50 select-none flex-wrap">
                  {/* Branch */}
                  <span className="flex items-center gap-1">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="opacity-60 shrink-0"><path d="M11.75 2.5a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0zm.75 2.453a2.25 2.25 0 1 1 0-4.906A2.25 2.25 0 0 1 12.5 4.953V5.5a2.25 2.25 0 0 1-2.25 2.25H5.75A.75.75 0 0 0 5 8.5v1.547a2.25 2.25 0 1 1-1.5 0V7.25a.75.75 0 0 1 0-1.5V5.047a2.25 2.25 0 1 1 1.5 0V5.75h4.5a.75.75 0 0 0 .75-.75v-.547zm-10.25.297a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0zM4.25 13a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z" /></svg>
                    <span className="font-mono">{gitStatus.branch}</span>
                  </span>
                  {gitStatus.files > 0 &&
                      <>
                      <span className="text-muted-foreground/20">·</span>
                      <span>{gitStatus.files} file{gitStatus.files !== 1 ? "s" : ""} changed</span>
                      {gitStatus.insertions > 0 &&
                        <span className="text-[hsl(var(--chart-2))]">+{gitStatus.insertions}</span>
                        }
                      {gitStatus.deletions > 0 &&
                        <span className="text-destructive/70">−{gitStatus.deletions}</span>
                        }
                    </>
                      }
                  {gitStatus.files === 0 &&
                      <>
                      <span className="text-muted-foreground/20">·</span>
                      <span className="text-muted-foreground/30">clean</span>
                    </>
                      }
                  <button
                        onClick={() => {gitFetchedForRef.current = null;setGitRefreshTick((t) => t + 1);}}
                        className="ml-auto opacity-40 hover:opacity-80 transition-opacity"
                        title="Refresh git status">
                        
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z" /><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" /></svg>
                  </button>
                </div>
                    }
              {gitStatus === "loading" &&
                    <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] text-muted-foreground/30 select-none">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="animate-spin opacity-50"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z" /><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" /></svg>
                  <span>Fetching git status…</span>
                </div>
                    }
              {/* Stop streaming button — now handled by composer send button */}

              {/* ── Approval prompt UI ── shown when a blocking PTY prompt is detected */}
              {awaitingApproval &&
                    <div className="mb-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs text-warning/80 font-medium">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                    Agent is waiting for your input
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {awaitingApproval.options.includes(ENTER_TO_CONFIRM_SENTINEL) ?
                        // Claude trust gate: "Enter to confirm · Esc to cancel"
                        <>
                        <button
                            onClick={() => handleApprovalChoice(ENTER_TO_CONFIRM_SENTINEL)}
                            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-md border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 font-medium transition-colors">
                            
                          <span>↵</span> Confirm (Enter)
                        </button>
                        <button
                            onClick={() => {relay.sendRawStdin(awaitingApproval.sessionId, btoa("\x1b"));setAwaitingApproval(null);}}
                            className="px-3 py-1 text-xs rounded-md border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 font-medium transition-colors">
                            
                          Esc — Cancel
                        </button>
                      </> :
                        awaitingApproval.options.length > 0 ?
                        awaitingApproval.options.map((opt) =>
                        <button
                          key={opt}
                          onClick={() => handleApprovalChoice(opt)}
                          className={cn(
                            "px-3 py-1 text-xs rounded-md border font-medium transition-colors",
                            /yes|approve|allow|trust|continue|proceed/i.test(opt) ?
                            "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20" :
                            "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
                          )}>
                          
                          {opt}
                        </button>
                        ) :

                        <>
                        <button onClick={() => handleApprovalChoice("Yes")} className="px-3 py-1 text-xs rounded-md border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 font-medium transition-colors">Yes</button>
                        <button onClick={() => handleApprovalChoice("No")} className="px-3 py-1 text-xs rounded-md border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 font-medium transition-colors">No</button>
                      </>
                        }
                    <button
                          onClick={() => setAwaitingApproval(null)}
                          className="ml-auto px-2 py-1 text-xs rounded-md border border-border/50 text-muted-foreground hover:bg-muted/30 transition-colors"
                          title="Dismiss">
                          
                      Dismiss
                    </button>
                  </div>
                </div>
                    }

              <ComposerBox
                      textareaRef={textareaRef}
                      fileInputRef={fileInputRef}
                      onPreview={() => showPreview ? (setShowPreview(false), setPreviewUrl("")) : handleOpenPreview()}
                      previewActive={showPreview}
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
              } {/* end agent !== terminal */}

          {/* ── Bottom Terminal Drawer — in normal flow so composer stays visible ── */}
          {showTerminalDrawer && selectedDeviceId && agent !== "terminal" &&
              <div
                className="relative shrink-0 flex flex-col border-t border-border/40 bg-background"
                style={{ height: terminalDrawerHeight }}>
                
              {/* Drag handle + header */}
              <div
                  className="flex items-center justify-between px-4 py-2 cursor-ns-resize shrink-0 select-none border-b border-border/20"
                  onMouseDown={(e) => {
                    terminalDragRef.current = { startY: e.clientY, startH: terminalDrawerHeight };
                    const onMove = (mv: MouseEvent) => {
                      if (!terminalDragRef.current) return;
                      const delta = terminalDragRef.current.startY - mv.clientY;
                      const newH = Math.max(160, Math.min(window.innerHeight * 0.75, terminalDragRef.current.startH + delta));
                      setTerminalDrawerHeight(newH);
                    };
                    const onUp = () => {
                      terminalDragRef.current = null;
                      window.removeEventListener("mousemove", onMove);
                      window.removeEventListener("mouseup", onUp);
                    };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                  }}
                  onTouchStart={(e) => {
                    const touch = e.touches[0];
                    terminalDragRef.current = { startY: touch.clientY, startH: terminalDrawerHeight };
                    const onMove = (mv: TouchEvent) => {
                      if (!terminalDragRef.current) return;
                      const delta = terminalDragRef.current.startY - mv.touches[0].clientY;
                      const newH = Math.max(160, Math.min(window.innerHeight * 0.75, terminalDragRef.current.startH + delta));
                      setTerminalDrawerHeight(newH);
                    };
                    const onUp = () => {
                      terminalDragRef.current = null;
                      window.removeEventListener("touchmove", onMove);
                      window.removeEventListener("touchend", onUp);
                    };
                    window.addEventListener("touchmove", onMove);
                    window.addEventListener("touchend", onUp);
                  }}>
                  
                {/* Drag pill */}
                <div className="absolute left-1/2 top-2 -translate-x-1/2 w-10 h-1 rounded-full bg-border/60" />
                <div className="flex items-center gap-2 mt-1">
                  <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Terminal</span>
                  {ptySessionId &&
                    <button
                      onClick={() => {navigator.clipboard?.writeText(ptySessionId);}}
                      title="Copy session ID"
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] text-[hsl(var(--status-online)/0.7)] bg-[hsl(var(--status-online)/0.08)] border border-[hsl(var(--status-online)/0.2)] hover:bg-[hsl(var(--status-online)/0.15)] transition-colors">
                      
                      <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--status-online))] animate-pulse shrink-0" />
                      {ptySessionId.slice(0, 8)}…
                    </button>
                    }
                </div>
                <button
                    onClick={() => setShowTerminalDrawer(false)}
                    className="mt-1 flex items-center justify-center w-6 h-6 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="Close terminal">
                    
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>

              {/* Terminal itself */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <EmbeddedTerminal
                    ref={drawerTerminalRef}
                    deviceId={selectedDeviceId}
                    convId={activeConvId}
                    onConnectorDisconnected={() => setConnectorOffline(true)}
                    onConnectorReconnected={() => setConnectorOffline(false)} />
                  
              </div>
            </div>
              }

        </div>
          </ResizablePanel>
          {showPreview && !isMobile &&
          <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={50} minSize={25}>
                <PreviewPanel
                deviceId={selectedDeviceId}
                deviceName={devices.find((d) => d.id === selectedDeviceId)?.name}
                initialUrl={previewUrl}
                onClose={() => {setShowPreview(false);setPreviewUrl("");}}
                activeTab="preview"
                onSwitchToChat={() => setShowPreview(false)}
                onTabChange={(tab) => {if (tab === "chat") setShowPreview(false);}} />
              
              </ResizablePanel>
            </>
          }
        </ResizablePanelGroup>

        {/* Mobile full-screen preview overlay */}
        {showPreview && isMobile &&
        <div className={cn(
          "absolute inset-0 z-30 flex flex-col",
          previewTab === "chat" ? "pointer-events-none" : ""
        )}>
            <PreviewPanel
            deviceId={selectedDeviceId}
            deviceName={devices.find((d) => d.id === selectedDeviceId)?.name}
            initialUrl={previewUrl}
            onClose={() => {setShowPreview(false);setPreviewUrl("");setPreviewTab("preview");}}
            activeTab={previewTab}
            onSwitchToChat={() => setPreviewTab("chat")}
            onTabChange={(tab) => setPreviewTab(tab)} />
          
          </div>
        }
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
              setModel("auto");
              setAgentSwitchPending(null);
              setActiveConvId(null);
              handleNew();
              // Pre-warm PTY for this new chat immediately
              if (selectedDeviceId) relay.prewarmSession(selectedDeviceId, null);
            }}>
                Start New Chat
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      {/* ── Open Project Dialog ─────────────────────────────────────────────── */}
      <Dialog open={openProjectOpen} onOpenChange={setOpenProjectOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FolderOpen size={18} className="text-primary/70" /> Open project</DialogTitle>
          </DialogHeader>

          {/* Recent projects */}
          {selectedDeviceId && (() => {
            const recents = getRecentProjects(selectedDeviceId);
            if (recents.length === 0) return null;
            return (
              <div className="mb-1">
                <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Recent</p>
                <div className="space-y-0.5">
                  {recents.map((p) =>
                  <button
                    key={p}
                    onClick={() => handleOpenProject(p)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-left hover:bg-accent transition-colors group">
                    
                      <FolderOpen size={14} className="text-primary/60 shrink-0" />
                      <span className="font-mono truncate flex-1">{p}</span>
                      <ChevronRight size={12} className="ml-auto text-muted-foreground/40 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  )}
                </div>
                <div className="border-t border-border/30 mt-2 mb-2" />
              </div>);

          })()}

          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-accent/30 border border-border/30 text-xs text-muted-foreground font-mono overflow-x-auto whitespace-nowrap mb-2">
            <button onClick={() => browseFolderViaRelay("~")} className="hover:text-foreground transition-colors"><Home size={12} /></button>
            {folderPath.split("/").filter(Boolean).map((part, i, arr) =>
            <span key={i} className="flex items-center gap-1">
                <ChevronRight size={10} className="opacity-40" />
                <button
                onClick={() => browseFolderViaRelay("/" + arr.slice(0, i + 1).join("/"))}
                className="hover:text-foreground transition-colors">
                {part}</button>
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0 max-h-[280px]">
            {folderLoading ?
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 size={18} className="animate-spin mr-2" /> Listing folders…</div> :
            folderItems.length === 0 ?
            <div className="py-10 text-center text-sm text-muted-foreground">Empty directory</div> :
            folderItems.map(({ name, isDir }) =>
            <button
              key={name}
              onClick={() => isDir ? browseFolderViaRelay(`${folderPath}/${name}`) : undefined}
              onDoubleClick={() => isDir && handleOpenProject(`${folderPath}/${name}`)}
              disabled={!isDir}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-left transition-colors",
                isDir ? "hover:bg-accent cursor-pointer" : "opacity-40 cursor-default"
              )}>
              
                {isDir ? <FolderOpen size={14} className="text-primary/60 shrink-0" /> : <FileText size={14} className="text-muted-foreground/50 shrink-0" />}
                <span className="truncate font-mono">{name}</span>
                {isDir && <ChevronRight size={12} className="ml-auto text-muted-foreground/40 shrink-0" />}
              </button>
            )}
          </div>
          <div className="flex gap-2 pt-3 border-t border-border/30">
            <Button variant="outline" size="sm" onClick={() => setOpenProjectOpen(false)} className="flex-1">Cancel</Button>
            <Button size="sm" onClick={() => handleOpenProject(folderPath)} disabled={!folderPath} className="flex-1">
              Open <span className="font-mono text-xs ml-1 opacity-70 truncate max-w-[120px]">{folderPath.split("/").pop()}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Clone Repo Dialog ───────────────────────────────────────────────── */}
      <Dialog open={cloneRepoOpen} onOpenChange={setCloneRepoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitFork size={18} className="text-primary/70" /> Clone repository</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Repository URL</label>
              <Input
                placeholder="https://github.com/user/repo.git"
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && !cloning && cloneUrl.trim() && handleCloneRepo()} />
              
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Destination folder <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                placeholder="my-project (leave blank for default)"
                value={cloneDir}
                onChange={(e) => setCloneDir(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !cloning && cloneUrl.trim() && handleCloneRepo()} />
              
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <KeyRound size={13} className="text-muted-foreground" />
                  GitHub token <span className="text-muted-foreground font-normal">(for private repos)</span>
                </label>
                {cloneToken &&
                <button
                  type="button"
                  onClick={() => {
                    setCloneToken("");
                    try {localStorage.removeItem("gh-clone-token");} catch {/* */}
                  }}
                  className="text-xs text-destructive hover:text-destructive/80 transition-colors">
                  
                    Clear token
                  </button>
                }
              </div>
              <div className="relative">
                <Input
                  type={showCloneToken ? "text" : "password"}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={cloneToken}
                  onChange={(e) => setCloneToken(e.target.value)}
                  className="pr-9 font-mono text-xs"
                  onKeyDown={(e) => e.key === "Enter" && !cloning && cloneUrl.trim() && handleCloneRepo()} />
                
                <button
                  type="button"
                  onClick={() => setShowCloneToken((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}>
                  
                  {showCloneToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground leading-snug">
                Your token is stored only in your browser and never sent to any server. For best security, use a{" "}<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-2 hover:text-foreground/80 transition-colors">fine-grained personal access token</a>{" "}scoped to <span className="font-medium text-foreground">Contents: Read-only</span> on the target repository.
              </p>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => setCloneRepoOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleCloneRepo} disabled={!cloneUrl.trim() || cloning || !selectedDeviceId} className="flex-1">
              {cloning ? <><Loader2 size={14} className="animate-spin mr-1.5" />Cloning…</> : "Clone"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
        onSelectDevice={(id) => {setSelectedDeviceId(id);}}
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
        }} />
      
    </AppLayout>);

}