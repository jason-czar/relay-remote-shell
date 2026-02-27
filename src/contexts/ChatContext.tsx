import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface Conversation {
  id: string;
  title: string;
  agent: string;
  model: string;
  created_at: string;
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
      .select("id, title, agent, model, created_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        if (data) {
          setConversations(data as Conversation[]);
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

  // ── Sync Claude Code local history from a device via relay PTY ───────────
  const syncClaudeHistory = useCallback(async (deviceId: string): Promise<{ imported: number; updated: number }> => {
    if (!user || !deviceId) throw new Error("No user or device");
    setIsSyncingClaudeHistory(true);
    let imported = 0;
    let updated = 0;
    try {
      // Single python3 one-liner — reads ~/.claude/sessions and outputs JSON
      const py = `python3 -c "import os,json\nbase=os.path.expanduser('~/.claude/sessions')\nif not os.path.exists(base):\n  print('[]')\nelse:\n  dirs=sorted([d for d in os.listdir(base) if os.path.isdir(os.path.join(base,d))],key=lambda x:os.path.getmtime(os.path.join(base,x)),reverse=True)[:40]\n  out=[]\n  for sid in dirs:\n    d=os.path.join(base,sid)\n    meta={}\n    mf=os.path.join(d,'meta.json')\n    if os.path.isfile(mf):\n      try:meta=json.load(open(mf))\n      except:pass\n    msgs=[]\n    jf=os.path.join(d,'messages.jsonl')\n    if os.path.isfile(jf):\n      try:\n        for l in open(jf):\n          l=l.strip()\n          if l:\n            try:msgs.append(json.loads(l))\n            except:pass\n      except:pass\n    out.append({'id':sid,'meta':meta,'messages':msgs})\n  print(json.dumps(out))\n" 2>/dev/null
`;
      const raw = await runRelayCommand(deviceId, py + "\n");

      // Strip ANSI sequences
      const clean = raw
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
        .replace(/\x1b[^[\]]/g, "")
        .replace(/\x1b/g, "");

      const jsonStart = clean.indexOf("[");
      const jsonEnd = clean.lastIndexOf("]");
      if (jsonStart === -1 || jsonEnd === -1) throw new Error("No session data found on device");

      type RawMsg = { role?: string; content?: string | Array<{ type: string; text?: string }> };
      type RawSession = { id: string; meta: { title?: string; created_at?: string }; messages: RawMsg[] };
      const sessions: RawSession[] = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));

      if (!sessions.length) return { imported: 0, updated: 0 };

      // Existing claude conversations keyed by claude_session_id
      const { data: existing } = await supabase
        .from("chat_conversations")
        .select("id, claude_session_id, updated_at")
        .eq("user_id", user.id)
        .eq("agent", "claude")
        .not("claude_session_id", "is", null);

      const existingMap = new Map((existing ?? []).map((c) => [c.claude_session_id!, c]));

      const extractText = (content: RawMsg["content"]): string => {
        if (!content) return "";
        if (typeof content === "string") return content;
        return content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
      };

      for (const session of sessions) {
        if (!session.messages.length) continue;

        const userMsgs = session.messages.filter((m) => m.role === "user");
        const firstText = extractText(userMsgs[0]?.content);
        const title = session.meta?.title ||
          (firstText ? firstText.slice(0, 40) + (firstText.length > 40 ? "…" : "") : session.id.slice(0, 8));
        const createdAt = session.meta?.created_at ?? new Date().toISOString();

        let convId: string;
        const existingConv = existingMap.get(session.id);

        if (existingConv) {
          await supabase
            .from("chat_conversations")
            .update({ title, updated_at: new Date().toISOString() })
            .eq("id", existingConv.id);
          convId = existingConv.id;
          updated++;
        } else {
          const { data: newConv, error } = await supabase
            .from("chat_conversations")
            .insert({
              user_id: user.id,
              agent: "claude",
              model: "auto",
              title,
              claude_session_id: session.id,
              device_id: deviceId,
              created_at: createdAt,
              updated_at: createdAt,
            })
            .select("id")
            .single();
          if (error || !newConv) continue;
          convId = newConv.id;
          imported++;

          // Insert messages for new conversations only
          const messagesToInsert = session.messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              conversation_id: convId,
              role: m.role as string,
              content: extractText(m.content) || "(empty)",
            }))
            .filter((m) => m.content !== "(empty)");

          for (let i = 0; i < messagesToInsert.length; i += 50) {
            await supabase.from("chat_messages").insert(messagesToInsert.slice(i, i + 50));
          }
        }
      }

      // Refresh sidebar
      const { data } = await supabase
        .from("chat_conversations")
        .select("id, title, agent, model, created_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (data) setConversations(data as Conversation[]);

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
