import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface Conversation {
  id: string;
  title: string;
  agent: string;
  model: string;
  created_at: string;
  updated_at?: string;
  workdir?: string | null;
  device_id?: string | null;
  device_status?: "online" | "offline" | null;
  claude_session_id?: string | null;
  openclaw_session_id?: string | null;
}


interface ChatContextValue {
  conversations: Conversation[];
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  activeConvId: string | null;
  setActiveConvId: (id: string | null) => void;
  handleDelete: (id: string) => Promise<void>;
  handleRename: (id: string, title: string) => Promise<void>;
  handleNew: () => void;
  onNewCallback: (() => void) | null;
  registerNewCallback: (fn: () => void) => void;
  activeJobs: Set<string>;
  addJob: (convId: string) => void;
  removeJob: (convId: string) => void;
  isSyncingClaudeHistory: boolean;
  syncClaudeHistory: (deviceId: string) => Promise<{ imported: number; updated: number }>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

// ── Relay helper ──────────────────────────────────────────────────────────────
async function runRelayCommand(deviceId: string, command: string): Promise<string> {
  const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", {
    body: { device_id: deviceId },
  });
  if (sesErr || !sesData?.session_id) throw new Error(sesData?.error || sesErr?.message || "Failed to start session");
  const sessionId: string = sesData.session_id;

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
      if (result instanceof Error) reject(result); else resolve(result);
    };

    const resetSilence = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => finish(outputBuffer), 3000);
    };

    hardTimeout = setTimeout(() => finish(new Error("Sync timed out")), 90000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", data: { token: jwt, session_id: sessionId, device_id: deviceId } }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "auth_ok") {
          ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: 220, rows: 50 } }));
          let promptSent = false;
          const PROMPT_RE = /(?:[%$#➜❯>]\s*$)|(?:\$\s+$)/m;
          const deadline = setTimeout(() => { if (!promptSent) { promptSent = true; send(); } }, 5000);
          const checkPrompt = () => {
            if (promptSent) return;
            const plain = outputBuffer
              .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
              .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
              .replace(/\x1b[^[\]]/g, "");
            if (PROMPT_RE.test(plain)) {
              clearTimeout(deadline);
              promptSent = true;
              send();
            }
          };
          const send = () => {
            outputBuffer = "";
            ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(command) } }));
            resetSilence();
          };
          const orig = ws.onmessage;
          ws.onmessage = (e) => { orig?.call(ws, e); if (!promptSent) checkPrompt(); };
        } else if (msg.type === "stdout") {
          const { data_b64 } = (msg.data ?? {}) as { data_b64: string };
          if (data_b64) {
            try { outputBuffer += decodeURIComponent(escape(atob(data_b64))); } catch { outputBuffer += atob(data_b64); }
            resetSilence();
          }
        } else if (msg.type === "session_end") {
          finish(outputBuffer);
        } else if (msg.type === "error") {
          const { message } = (msg.data ?? {}) as { message?: string };
          finish(new Error(message ?? "Relay error"));
        }
      } catch {/* ignore */}
    };

    ws.onerror = () => finish(new Error("WebSocket error"));
    ws.onclose = (e) => {
      if (silenceTimer || hardTimeout) finish(outputBuffer || new Error(`WebSocket closed (${e.code})`));
    };
  });
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvIdState] = useState<string | null>(() => {
    return localStorage.getItem("activeConvId") ?? null;
  });
  const [newCallback, setNewCallback] = useState<(() => void) | null>(null);
  const [activeJobs, setActiveJobs] = useState<Set<string>>(new Set());
  const [isSyncingClaudeHistory, setIsSyncingClaudeHistory] = useState(false);

  const setActiveConvId = useCallback((id: string | null) => {
    setActiveConvIdState(id);
    if (id) localStorage.setItem("activeConvId", id);
    else localStorage.removeItem("activeConvId");
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase
    .from("chat_conversations")
      .select("id, title, agent, model, created_at, updated_at, device_id, claude_session_id, openclaw_session_id, devices(workdir, status)")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        if (data) {
          const mapped = (data as unknown as Array<{
            id: string; title: string; agent: string; model: string;
            created_at: string; updated_at: string; device_id: string | null;
            devices: { workdir: string | null; status: string | null } | null;
          }>).map(({ devices, ...rest }) => ({
            ...rest,
            workdir: devices?.workdir ?? null,
            device_status: (devices?.status as "online" | "offline" | null) ?? null,
          }));
          setConversations(mapped as Conversation[]);
          const saved = localStorage.getItem("activeConvId");
          if (saved && !data.find((c) => c.id === saved)) {
            setActiveConvId(null);
          }
        }
      });
  }, [user, setActiveConvId]);

  const handleDelete = useCallback(async (id: string) => {
    await supabase.from("chat_conversations").delete().eq("id", id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) setActiveConvId(null);
  }, [activeConvId]);

  const handleRename = useCallback(async (id: string, title: string) => {
    await supabase.from("chat_conversations").update({ title }).eq("id", id);
    setConversations((prev) => prev.map((c) => c.id === id ? { ...c, title } : c));
  }, []);

  const handleNew = useCallback(() => {
    setActiveConvId(null);
    newCallback?.();
  }, [newCallback]);

  const registerNewCallback = useCallback((fn: () => void) => {
    setNewCallback(() => fn);
  }, []);

  const addJob = useCallback((convId: string) => {
    setActiveJobs((prev) => new Set([...prev, convId]));
  }, []);

  const removeJob = useCallback((convId: string) => {
    setActiveJobs((prev) => { const next = new Set(prev); next.delete(convId); return next; });
  }, []);

  // ── Sync Claude + Codex + OpenClaw history from a device via relay PTY ──
  const syncClaudeHistory = useCallback(async (deviceId: string): Promise<{ imported: number; updated: number }> => {
    if (!user || !deviceId) throw new Error("No user or device");
    setIsSyncingClaudeHistory(true);
    let imported = 0;
    let updated = 0;
    try {
      // Reads ~/.claude/sessions, ~/.codex/sessions, ~/.openclaw/sessions
      // OpenClaw also checks ~/.config/openclaw/sessions as alternate path
      const py = `python3 -c "
import os,json
def read_sessions(base,max_s=30):
  if not os.path.exists(base):return []
  dirs=sorted([d for d in os.listdir(base) if os.path.isdir(os.path.join(base,d))],key=lambda x:os.path.getmtime(os.path.join(base,x)),reverse=True)[:max_s]
  out=[]
  for sid in dirs:
    d=os.path.join(base,sid)
    meta={}
    mf=os.path.join(d,'meta.json')
    if os.path.isfile(mf):
      try:meta=json.load(open(mf))
      except:pass
    msgs=[]
    for fn in ['messages.jsonl','conversation.jsonl','history.jsonl']:
      jf=os.path.join(d,fn)
      if os.path.isfile(jf):
        try:
          for l in open(jf):
            l=l.strip()
            if l:
              try:msgs.append(json.loads(l))
              except:pass
        except:pass
        break
    if not msgs:
      for fn in ['conversation.json','messages.json']:
        jf=os.path.join(d,fn)
        if os.path.isfile(jf):
          try:
            data=json.load(open(jf))
            msgs=data if isinstance(data,list) else data.get('messages',[])
          except:pass
          break
    out.append({'id':sid,'meta':meta,'messages':msgs})
  return out
h=os.path.expanduser
oc_base=h('~/.openclaw/sessions') if os.path.exists(h('~/.openclaw/sessions')) else h('~/.config/openclaw/sessions')
print(json.dumps({'claude':read_sessions(h('~/.claude/sessions')),'codex':read_sessions(h('~/.codex/sessions')),'openclaw':read_sessions(oc_base)}))
" 2>/dev/null
`;
      const raw = await runRelayCommand(deviceId, py + "\n");

      // Strip ANSI sequences
      const clean = raw
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
        .replace(/\x1b[^[\]]/g, "")
        .replace(/\x1b/g, "");

      const jsonStart = clean.indexOf("{");
      const jsonEnd = clean.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) throw new Error("No session data found on device");

      type RawMsg = { role?: string; content?: string | Array<{ type: string; text?: string }> };
      type RawSession = { id: string; meta: { title?: string; created_at?: string }; messages: RawMsg[] };
      type SyncPayload = { claude: RawSession[]; codex: RawSession[]; openclaw: RawSession[] };
      const payload: SyncPayload = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));

      const extractText = (content: RawMsg["content"]): string => {
        if (!content) return "";
        if (typeof content === "string") return content;
        return content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      };

      // Upsert sessions for claude/codex — uses claude_session_id column
      const upsertExternalSessions = async (
        sessions: RawSession[],
        agentName: "claude" | "codex",
      ) => {
        if (!sessions.length) return;
        const { data: existing } = await supabase
          .from("chat_conversations")
          .select("id, claude_session_id, updated_at")
          .eq("user_id", user.id)
          .eq("agent", agentName)
          .not("claude_session_id", "is", null);
        const existingMap = new Map((existing ?? []).map((c) => [c.claude_session_id!, c]));

        for (const session of sessions) {
          if (!session.messages.length) continue;
          const userMsgs = session.messages.filter((m) => m.role === "user");
          const firstText = extractText(userMsgs[0]?.content);
          const title = session.meta?.title ||
            (firstText ? firstText.slice(0, 40) + (firstText.length > 40 ? "…" : "") : session.id.slice(0, 8));
          const createdAt = session.meta?.created_at ?? new Date().toISOString();
          const existingConv = existingMap.get(session.id);
          let convId: string;
          if (existingConv) {
            await supabase.from("chat_conversations").update({ title, updated_at: new Date().toISOString() }).eq("id", existingConv.id);
            convId = existingConv.id;
            updated++;
          } else {
            const { data: newConv, error } = await supabase.from("chat_conversations").insert({
              user_id: user.id, agent: agentName, model: "auto", title,
              claude_session_id: session.id, device_id: deviceId,
              created_at: createdAt, updated_at: createdAt,
            }).select("id").single();
            if (error || !newConv) continue;
            convId = newConv.id;
            imported++;
            const msgs = session.messages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({ conversation_id: convId, role: m.role as string, content: extractText(m.content) || "(empty)" }))
              .filter((m) => m.content !== "(empty)");
            for (let i = 0; i < msgs.length; i += 50) await supabase.from("chat_messages").insert(msgs.slice(i, i + 50));
          }
        }
      };

      // Upsert OpenClaw sessions — uses openclaw_session_id column (native field)
      const upsertOpenClawSessions = async (sessions: RawSession[]) => {
        if (!sessions.length) return;
        const { data: existing } = await supabase
          .from("chat_conversations")
          .select("id, openclaw_session_id, updated_at")
          .eq("user_id", user.id)
          .eq("agent", "openclaw")
          .not("openclaw_session_id", "is", null);
        const existingMap = new Map((existing ?? []).map((c) => [c.openclaw_session_id!, c]));

        for (const session of sessions) {
          if (!session.messages.length) continue;
          const userMsgs = session.messages.filter((m) => m.role === "user");
          const firstText = extractText(userMsgs[0]?.content);
          const title = session.meta?.title ||
            (firstText ? firstText.slice(0, 40) + (firstText.length > 40 ? "…" : "") : session.id.slice(0, 8));
          const createdAt = session.meta?.created_at ?? new Date().toISOString();
          const existingConv = existingMap.get(session.id);
          let convId: string;
          if (existingConv) {
            await supabase.from("chat_conversations").update({ title, updated_at: new Date().toISOString() }).eq("id", existingConv.id);
            convId = existingConv.id;
            updated++;
          } else {
            const { data: newConv, error } = await supabase.from("chat_conversations").insert({
              user_id: user.id, agent: "openclaw", model: "auto", title,
              openclaw_session_id: session.id, device_id: deviceId,
              created_at: createdAt, updated_at: createdAt,
            }).select("id").single();
            if (error || !newConv) continue;
            convId = newConv.id;
            imported++;
            const msgs = session.messages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({ conversation_id: convId, role: m.role as string, content: extractText(m.content) || "(empty)" }))
              .filter((m) => m.content !== "(empty)");
            for (let i = 0; i < msgs.length; i += 50) await supabase.from("chat_messages").insert(msgs.slice(i, i + 50));
          }
        }
      };

      await upsertExternalSessions(payload.claude ?? [], "claude");
      await upsertExternalSessions(payload.codex ?? [], "codex");
      await upsertOpenClawSessions(payload.openclaw ?? []);

      // Refresh sidebar
      const { data } = await supabase
        .from("chat_conversations")
        .select("id, title, agent, model, created_at, updated_at, device_id, claude_session_id, openclaw_session_id, devices(workdir, status)")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (data) {
        const mapped = (data as unknown as Array<{
          id: string; title: string; agent: string; model: string;
          created_at: string; updated_at: string; device_id: string | null;
          devices: { workdir: string | null; status: string | null } | null;
        }>).map(({ devices, ...rest }) => ({
          ...rest,
          workdir: devices?.workdir ?? null,
          device_status: (devices?.status as "online" | "offline" | null) ?? null,
        }));
        setConversations(mapped as Conversation[]);
      }

      return { imported, updated };
    } finally {
      setIsSyncingClaudeHistory(false);
    }
  }, [user]);

  return (
    <ChatContext.Provider value={{
      conversations,
      setConversations,
      activeConvId,
      setActiveConvId,
      handleDelete,
      handleRename,
      handleNew,
      onNewCallback: newCallback,
      registerNewCallback,
      activeJobs,
      addJob,
      removeJob,
      isSyncingClaudeHistory,
      syncClaudeHistory,
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}
