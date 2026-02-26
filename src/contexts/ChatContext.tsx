import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface Conversation {
  id: string;
  title: string;
  agent: string;
  created_at: string;
}

interface ChatContextValue {
  conversations: Conversation[];
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  activeConvId: string | null;
  setActiveConvId: (id: string | null) => void;
  handleDelete: (id: string) => Promise<void>;
  handleNew: () => void;
  onNewCallback: (() => void) | null;
  registerNewCallback: (fn: () => void) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [newCallback, setNewCallback] = useState<(() => void) | null>(null);

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

  const handleDelete = useCallback(async (id: string) => {
    await supabase.from("chat_conversations").delete().eq("id", id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) setActiveConvId(null);
  }, [activeConvId]);

  const handleNew = useCallback(() => {
    setActiveConvId(null);
    newCallback?.();
  }, [newCallback]);

  const registerNewCallback = useCallback((fn: () => void) => {
    setNewCallback(() => fn);
  }, []);

  return (
    <ChatContext.Provider value={{
      conversations,
      setConversations,
      activeConvId,
      setActiveConvId,
      handleDelete,
      handleNew,
      onNewCallback: newCallback,
      registerNewCallback,
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
