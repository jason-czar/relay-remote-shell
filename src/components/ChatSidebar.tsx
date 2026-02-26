import { useState } from "react";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="flex flex-col h-full border-r border-border bg-sidebar w-64 shrink-0">
      <div className="p-3 border-b border-border">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 justify-start"
          onClick={onNew}
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center px-3">
            <MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">No conversations yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Click "New Chat" to start</p>
          </div>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={cn(
              "group flex items-center gap-2 rounded-md px-2.5 py-2 cursor-pointer transition-colors text-sm",
              activeId === conv.id
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
            )}
            onClick={() => onSelect(conv.id)}
            onMouseEnter={() => setHoveredId(conv.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <span className="flex-1 truncate text-xs font-medium">{conv.title}</span>
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0",
              conv.agent === "openclaw"
                ? "bg-primary/15 text-primary"
                : "bg-secondary/30 text-secondary-foreground"
            )}>
              {conv.agent === "openclaw" ? "OC" : "CC"}
            </span>
            {(hoveredId === conv.id || activeId === conv.id) && (
              <button
                className="shrink-0 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors"
                onClick={(e) => { e.stopPropagation(); setDeleteId(conv.id); }}
                aria-label="Delete conversation"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
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
