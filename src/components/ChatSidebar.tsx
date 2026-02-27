import { useState, useRef, useCallback, useEffect } from "react";
import openclawImg from "@/assets/openclaw.png";
import claudecodeImg from "@/assets/claudecode.png";
import { Plus, Trash2, Search, MessageSquare, ChevronLeft, Pencil, Check, X } from "lucide-react";
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
  onRename: (id: string, title: string) => void;
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 256;

export function ChatSidebar({ conversations, activeId, onSelect, onNew, onDelete, onRename }: ChatSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState<"all" | "openclaw" | "claude">("all");
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_WIDTH);

  const filtered = conversations.filter((c) => {
    const matchesSearch = c.title.toLowerCase().includes(search.toLowerCase());
    const matchesAgent = agentFilter === "all" || c.agent === agentFilter;
    return matchesSearch && matchesAgent;
  });

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingId) {
      setTimeout(() => editInputRef.current?.focus(), 0);
    }
  }, [editingId]);

  const startEdit = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditValue(conv.title);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - startX.current;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      setWidth(next);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width]);

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center py-4 gap-2 h-full border-r border-border/30 w-12 shrink-0"
        style={{ background: "rgba(255,255,255,0.015)" }}
      >
        <button
          onClick={() => setCollapsed(false)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-150"
          title="Expand sidebar"
        >
          <ChevronLeft className="h-4 w-4 rotate-180" />
        </button>
        <button
          onClick={onNew}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-150"
          title="New chat"
        >
          <Plus className="h-4 w-4" />
        </button>
        <div className="w-5 h-px bg-border/30 my-1" />
        {conversations.slice(0, 14).map((conv) => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            title={conv.title}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 overflow-hidden",
              activeId === conv.id
                ? "ring-1 ring-primary/40"
                : "opacity-60 hover:opacity-100"
            )}
          >
            <img src={conv.agent === "openclaw" ? openclawImg : claudecodeImg} alt={conv.agent} className="w-full h-full object-cover rounded-lg" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full relative shrink-0" style={{ width }}>
      <div
        className="flex flex-col h-full w-full border-r border-border/30 overflow-hidden"
        style={{ background: "rgba(255,255,255,0.015)" }}
      >
        {/* Header */}
        <div className="p-3 flex items-center gap-1.5 border-b border-border/20">
          <button
            onClick={onNew}
            className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all duration-150"
          >
            <Plus className="h-3.5 w-3.5" />
            New Chat
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:bg-accent/60 hover:text-foreground transition-all duration-150"
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-accent/30">
            <Search className="h-3 w-3 text-muted-foreground/50 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/40 text-foreground"
            />
          </div>
        </div>

        {/* Agent filter pills */}
        <div className="px-3 pb-2 flex items-center gap-1">
          {(["all", "openclaw", "claude"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setAgentFilter(f)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all duration-150",
                agentFilter === f
                  ? f === "openclaw"
                    ? "bg-primary/15 text-primary"
                    : f === "claude"
                    ? "bg-warning/15 text-warning"
                    : "bg-accent text-foreground"
                  : "text-muted-foreground/60 hover:bg-accent/40 hover:text-muted-foreground"
              )}
            >
              {f !== "all" && (
                <img
                  src={f === "openclaw" ? openclawImg : claudecodeImg}
                  alt={f}
                  className="w-3.5 h-3.5 rounded object-cover shrink-0"
                />
              )}
              {f === "all" ? "All" : f === "openclaw" ? "OpenClaw" : "Claude"}
            </button>
          ))}
        </div>

        {/* Conversations */}
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center px-3">
              <MessageSquare className="h-7 w-7 text-muted-foreground/20 mb-2" />
              <p className="text-xs text-muted-foreground/40">
                {search ? "No results" : "No conversations yet"}
              </p>
            </div>
          )}
          {filtered.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                "group flex items-center gap-1.5 rounded-lg px-2 py-2 cursor-pointer transition-all duration-150",
                activeId === conv.id
                  ? "bg-accent/60 text-foreground"
                  : "text-muted-foreground/50 hover:bg-accent/30 hover:text-muted-foreground"
              )}
              onClick={() => editingId !== conv.id && onSelect(conv.id)}
              onMouseEnter={() => setHoveredId(conv.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {editingId === conv.id ? (
                /* ── Inline rename input ── */
                <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={editInputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    onBlur={commitEdit}
                    className="flex-1 min-w-0 bg-background/60 border border-primary/40 rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-primary/80 transition-colors"
                  />
                  <button
                    onMouseDown={(e) => { e.preventDefault(); commitEdit(); }}
                    className="shrink-0 p-0.5 rounded text-primary hover:bg-primary/10 transition-colors"
                    title="Save"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}
                    className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                    title="Cancel"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                /* ── Normal row ── */
                <>
                  <span className="flex-1 truncate text-xs text-muted-foreground/50 group-hover:text-muted-foreground transition-colors duration-150">{conv.title}</span>
                  <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <button
                      className="p-0.5 rounded hover:text-foreground hover:bg-accent/60 transition-colors"
                      onClick={(e) => startEdit(e, conv)}
                      aria-label="Rename"
                      title="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      className="p-0.5 rounded hover:text-destructive hover:bg-destructive/10 transition-colors"
                      onClick={(e) => { e.stopPropagation(); setDeleteId(conv.id); }}
                      aria-label="Delete"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize flex items-center justify-center group z-10 hover:w-1.5"
        title="Drag to resize"
      >
        <div className="h-8 w-0.5 rounded-full bg-border/0 group-hover:bg-border/60 transition-all duration-150" />
      </div>

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
    </div>
  );
}
