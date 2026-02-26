import { useState, useEffect, useRef, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { ChatSidebar, type Conversation } from "@/components/ChatSidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Send, Monitor } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
}

interface RelayMsg {
  type: string;
  data?: unknown;
}

const RELAY_TIMEOUT_MS = 30000;
const SILENCE_MS = 1500;

export default function Chat() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── State ──────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agent, setAgent] = useState<"openclaw" | "claude">("openclaw");
  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [agentSwitchPending, setAgentSwitchPending] = useState<"openclaw" | "claude" | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Load conversations ────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    supabase
      .from("chat_conversations")
      .select("id, title, agent, created_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        if (data) setConversations(data as Conversation[]);
      });
  }, [user]);

  // ── Load devices ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    supabase
      .from("devices")
      .select("id, name, status, project_id")
      .then(({ data }) => {
        if (data) {
          setDevices(data as Tables<"devices">[]);
          if (data.length > 0 && !selectedDeviceId) {
            const online = data.find((d) => d.status === "online");
            setSelectedDeviceId((online ?? data[0]).id);
          }
        }
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
    setConversations((prev) => [data as Conversation, ...prev]);
    setActiveConvId(data.id);
    return data.id;
  }, [user, selectedDeviceId, toast]);

  // ── Save message to DB ─────────────────────────────────────────────────
  const saveMessage = async (convId: string, role: "user" | "assistant", content: string) => {
    await supabase.from("chat_messages").insert({ conversation_id: convId, role, content });
    // bump updated_at
    await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
  };

  // ── Relay send ─────────────────────────────────────────────────────────
  const sendViaRelay = useCallback(async (command: string): Promise<string> => {
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
        // end session in DB
        supabase.functions.invoke("end-session", { body: { session_id: sessionId } }).catch(() => {});
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      const resetSilence = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => finish(outputBuffer), SILENCE_MS);
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
            // send command after session_start
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
    if (!text || thinking) return;
    if (!selectedDeviceId) {
      toast({ title: "Select a device first", variant: "destructive" });
      return;
    }

    setInput("");
    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setThinking(true);

    let convId = activeConvId;
    if (!convId) {
      convId = await createConversation(text, agent);
      if (!convId) { setThinking(false); return; }
    }

    await saveMessage(convId, "user", text);

    try {
      const command = await buildCommand(text, convId);
      const stdout = await sendViaRelay(command);

      // parse response
      let responseText = stdout.trim();

      // try to parse JSON for openclaw
      const { data: convData } = await supabase
        .from("chat_conversations")
        .select("agent, claude_session_id")
        .eq("id", convId)
        .single();

      if (convData?.agent === "openclaw") {
        try {
          // find last JSON object in stdout
          const jsonMatch = stdout.match(/\{[\s\S]*\}/g);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[jsonMatch.length - 1]);
            if (parsed.content || parsed.message || parsed.response || parsed.text) {
              responseText = parsed.content ?? parsed.message ?? parsed.response ?? parsed.text;
            }
          }
        } catch { /* use raw stdout */ }
      } else if (convData?.agent === "claude" && !convData.claude_session_id) {
        const claudeId = extractClaudeSessionId(stdout);
        if (claudeId) {
          await supabase.from("chat_conversations").update({ claude_session_id: claudeId }).eq("id", convId);
        }
      }

      // strip ANSI escape codes for display
      responseText = responseText.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim() || stdout.trim();

      const assistantMsg: Message = { role: "assistant", content: responseText || "(empty response)" };
      setMessages((prev) => [...prev, assistantMsg]);
      await saveMessage(convId, "assistant", responseText || "(empty response)");

      // Refresh conversation list order
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
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [input, thinking, selectedDeviceId, activeConvId, agent, createConversation, buildCommand, sendViaRelay, toast]);

  // ── Delete conversation ───────────────────────────────────────────────
  const handleDelete = useCallback(async (id: string) => {
    await supabase.from("chat_conversations").delete().eq("id", id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) {
      setActiveConvId(null);
      setMessages([]);
    }
  }, [activeConvId]);

  // ── New conversation ───────────────────────────────────────────────────
  const handleNew = () => {
    setActiveConvId(null);
    setMessages([]);
    setInput("");
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

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
        {/* Chat sidebar */}
        <ChatSidebar
          conversations={conversations}
          activeId={activeConvId}
          onSelect={(id) => {
            setActiveConvId(id);
            const conv = conversations.find((c) => c.id === id);
            if (conv) setAgent(conv.agent as "openclaw" | "claude");
          }}
          onNew={handleNew}
          onDelete={handleDelete}
        />

        {/* Main chat area */}
        <div className="flex flex-col flex-1 min-w-0 h-full">
          {/* Toolbar */}
          <div className="shrink-0 border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <ToggleGroup
              type="single"
              value={agent}
              onValueChange={handleAgentChange}
              className="gap-1"
            >
              <ToggleGroupItem
                value="openclaw"
                className="px-3 py-1.5 text-xs font-mono data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                OpenClaw
              </ToggleGroupItem>
              <ToggleGroupItem
                value="claude"
                className="px-3 py-1.5 text-xs font-mono data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground"
              >
                Claude Code
              </ToggleGroupItem>
            </ToggleGroup>

            <div className="flex items-center gap-2">
              <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                <SelectTrigger className="h-8 text-xs w-44">
                  <SelectValue placeholder="Select device…" />
                </SelectTrigger>
                <SelectContent>
                  {devices.length === 0 && (
                    <SelectItem value="_none" disabled>No devices found</SelectItem>
                  )}
                  {devices.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full ${
                            d.status === "online" ? "bg-green-500" : "bg-muted-foreground"
                          }`}
                        />
                        {d.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
            {messages.length === 0 && !thinking && (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <span className="text-2xl">🐾</span>
                </div>
                <h3 className="font-semibold text-foreground mb-1">
                  {agent === "openclaw" ? "OpenClaw Agent" : "Claude Code"}
                </h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  {agent === "openclaw"
                    ? "Ask your local OpenClaw agent anything. Commands run on your selected device."
                    : "Send prompts directly to Claude Code running on your device."}
                </p>
                {!selectedDeviceId && (
                  <p className="text-xs text-destructive mt-3">Select a device above to start</p>
                )}
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatMessage key={msg.id ?? i} role={msg.role} content={msg.content} />
            ))}
            {thinking && <ChatMessage role="assistant" content="" thinking />}
          </div>

          {/* Input area */}
          <div className="shrink-0 border-t border-border px-4 py-3">
            <div className="flex items-end gap-2 max-w-4xl mx-auto">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  selectedDeviceId
                    ? `Message ${agent === "openclaw" ? "OpenClaw" : "Claude Code"}… (Enter to send, Shift+Enter for newline)`
                    : "Select a device first…"
                }
                disabled={thinking || !selectedDeviceId}
                className="resize-none text-sm min-h-[44px] max-h-48 flex-1"
                rows={1}
              />
              <Button
                onClick={handleSend}
                disabled={thinking || !input.trim() || !selectedDeviceId}
                size="sm"
                className="shrink-0 h-10 gap-2"
              >
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">Send</span>
              </Button>
            </div>
            <p className="text-center text-[10px] text-muted-foreground/50 mt-1.5">
              Commands execute on your device via relay
            </p>
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
                  handleNew();
                }}>
                  Start New Chat
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
