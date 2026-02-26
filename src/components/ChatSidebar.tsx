import { useState } from "react";
import { Plus, Trash2, Search, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface Conversation {
  id: string;
  title: string;
  agent: string;
  created_at: string;
}

interface ChatSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ChatSidebar({ conversations, activeId, onSelect, onNew, onDelete }: ChatSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      {/* Collapsed rail */}
      {!expanded && (
        <div
          className="flex flex-col items-center py-4 gap-3 h-full border-r border-border/40 w-14 shrink-0 cursor-pointer"
          onClick={() => setExpanded(true)}
          title="Expand sidebar"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onNew(); }}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 hover:bg-accent"
            title="New chat"
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
          </button>
          <div className="w-px h-px" />
          {conversations.slice(0, 12).map((conv) => (
            <button
              key={conv.id}
              onClick={(e) => { e.stopPropagation(); onSelect(conv.id); }}
              title={conv.title}
              className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-mono font-bold transition-all duration-200",
                activeId === conv.id
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {conv.agent === "openclaw" ? "OC" : "CC"}
            </button>
          ))}
        </div>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div
          className="flex flex-col h-full border-r border-border/40 w-64 shrink-0 transition-all duration-300"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          {/* Header */}
          <div className="p-3 flex items-center gap-2 border-b border-border/30">
            <button
              onClick={onNew}
              className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200"
            >
              <Plus className="h-3.5 w-3.5" />
              New Chat
            </button>
            <button
              onClick={() => setExpanded(false)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200 text-xs"
              title="Collapse"
            >
              ←
            </button>
          </div>

          {/* Search */}
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-accent/40">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 text-foreground"
              />
            </div>
          </div>

          {/* Conversations */}
          <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-center px-3">
                <MessageSquare className="h-7 w-7 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground/60">
                  {search ? "No results" : "No conversations yet"}
                </p>
              </div>
            )}
            {filtered.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-all duration-150 text-sm",
                  activeId === conv.id
                    ? "bg-accent/70 text-foreground"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                )}
                onClick={() => onSelect(conv.id)}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <span className="flex-1 truncate text-xs">{conv.title}</span>
                <span className={cn(
                  "text-[9px] px-1 py-0.5 rounded font-mono shrink-0 opacity-60",
                  conv.agent === "openclaw" ? "text-primary" : "text-muted-foreground"
                )}>
                  {conv.agent === "openclaw" ? "OC" : "CC"}
                </span>
                {(hoveredId === conv.id || activeId === conv.id) && (
                  <button
                    className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:text-destructive transition-all duration-150"
                    onClick={(e) => { e.stopPropagation(); setDeleteId(conv.id); }}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the conversation and all its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId) { onDelete(deleteId); setDeleteId(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
