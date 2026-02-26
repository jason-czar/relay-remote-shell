import {
  LayoutDashboard, FolderOpen, Settings, LogOut, Sun, Moon, Plug, BookOpen,
  Columns2, MessageSquare, ChevronDown, Plus, Search, Trash2, User, Pencil, Check, X
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import logo from "@/assets/logo.png";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "next-themes";
import { useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useChatContext } from "@/contexts/ChatContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

const setupItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Projects", url: "/projects", icon: FolderOpen },
  { title: "Multi-Session", url: "/multi-session", icon: Columns2 },
  { title: "Chat", url: "/", icon: MessageSquare },
  { title: "PrivaClaw", url: "/skill/privaclaw", icon: Plug },
  { title: "Docs", url: "/docs", icon: BookOpen },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut, user } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isChat = location.pathname === "/";

  const [setupOpen, setSetupOpen] = useState(true);
  const [convOpen, setConvOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const startEdit = (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    setEditingId(id);
    setEditValue(title);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) handleRename(editingId, editValue.trim());
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => { if (data?.display_name) setDisplayName(data.display_name); });
  }, [user]);

  const { conversations, activeConvId, setActiveConvId, handleDelete, handleNew, handleRename, activeJobs } = useChatContext();

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  // Group conversations by time
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const weekStart = new Date(todayStart.getTime() - 6 * 86400000);

  const groups = [
    { label: "Today", items: filtered.filter(c => new Date(c.created_at) >= todayStart) },
    { label: "Yesterday", items: filtered.filter(c => new Date(c.created_at) >= yesterdayStart && new Date(c.created_at) < todayStart) },
    { label: "Previous 7 days", items: filtered.filter(c => new Date(c.created_at) >= weekStart && new Date(c.created_at) < yesterdayStart) },
    { label: "Older", items: filtered.filter(c => new Date(c.created_at) < weekStart) },
  ].filter(g => g.items.length > 0);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <>
    <Sidebar collapsible="offcanvas">
      {/* Logo */}
      <SidebarContent className="flex flex-col min-h-0">
        <SidebarGroup>
          <SidebarGroupLabel>
            <div className="flex items-center gap-2">
              <img src={logo} alt="PrivaClaw" className="h-5 w-5 rounded" />
              {!collapsed && <span className="font-mono text-sm font-bold">PrivaClaw</span>}
            </div>
          </SidebarGroupLabel>
        </SidebarGroup>

        {/* Chat conversations section */}
          {isChat && !collapsed && (
          <SidebarGroup className="flex flex-col flex-1 min-h-0">
            <SidebarGroupLabel>
              <div className="flex items-center justify-between w-full pr-1">
                <span className="text-sm font-semibold text-foreground/70 tracking-tight">Conversations</span>
                <button
                  onClick={() => { handleNew(); navigate("/"); }}
                  className="flex items-center gap-1 text-xs text-primary/80 hover:text-primary font-medium transition-colors px-2 py-0.5 rounded-md hover:bg-primary/10"
                  title="New chat"
                >
                  <Plus className="h-3 w-3" />
                  New
                </button>
              </div>
            </SidebarGroupLabel>

            {convOpen && (
              <SidebarGroupContent className="flex flex-col flex-1 min-h-0">
                {/* Search */}
                <div className="px-2 pb-1">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/30 border border-border/40 focus-within:border-border/70 transition-colors">
                    <Search className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search…"
                      className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/40 text-foreground min-w-0"
                    />
                    {search && (
                      <button onClick={() => setSearch("")} className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Grouped conversations */}
                <div className="space-y-1 overflow-y-auto flex-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {conversations.length === 0 && (
                    <p className="text-xs text-muted-foreground/30 text-center py-6">No conversations yet</p>
                  )}
                  {conversations.length > 0 && groups.length === 0 && (
                    <p className="text-xs text-muted-foreground/40 text-center py-6">No results for "{search}"</p>
                  )}
                  {groups.map(group => (
                    <div key={group.label} className="mb-2">
                      <p className="text-xs font-semibold text-muted-foreground/30 uppercase tracking-wider px-2 pt-2 pb-1.5">{group.label}</p>
                      {group.items.map(conv => (
                        <div
                          key={conv.id}
                          className={cn(
                            "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-all duration-100",
                            activeConvId === conv.id
                              ? "bg-accent/80 text-foreground"
                              : "text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground"
                          )}
                          onClick={() => { if (editingId !== conv.id) { setActiveConvId(conv.id); navigate("/"); } }}
                          onMouseEnter={() => setHoveredId(conv.id)}
                          onMouseLeave={() => setHoveredId(null)}
                        >
                          {/* Active indicator */}
                          {activeConvId === conv.id && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full bg-primary" />
                          )}

                          {editingId === conv.id ? (
                            /* Inline rename */
                            <div className="flex items-center gap-1 flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                              <input
                                ref={editInputRef}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === "Enter") commitEdit();
                                  if (e.key === "Escape") cancelEdit();
                                }}
                                onBlur={commitEdit}
                                className="flex-1 min-w-0 bg-background/60 border border-primary/40 rounded px-1.5 py-0.5 text-sm text-foreground outline-none focus:border-primary/80 transition-colors"
                              />
                              <button onMouseDown={e => { e.preventDefault(); commitEdit(); }} className="p-0.5 rounded text-primary hover:bg-primary/10" title="Save">
                                <Check className="h-3 w-3" />
                              </button>
                              <button onMouseDown={e => { e.preventDefault(); cancelEdit(); }} className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/60" title="Cancel">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                              <>
                               <span className="flex-1 truncate text-sm leading-snug">{conv.title}</span>
                               <div className={cn(
                                 "shrink-0 flex items-center gap-0.5 transition-opacity",
                                 hoveredId === conv.id ? "opacity-100" : "opacity-0 pointer-events-none"
                               )}>
                                 <button
                                   className="p-0.5 rounded hover:text-foreground hover:bg-accent/60 transition-colors"
                                   onClick={e => startEdit(e, conv.id, conv.title)}
                                   title="Rename"
                                 >
                                   <Pencil className="h-3 w-3" />
                                 </button>
                                 <button
                                   className="p-0.5 rounded hover:text-destructive hover:bg-destructive/10 transition-colors"
                                   onClick={e => { e.stopPropagation(); setDeleteTargetId(conv.id); }}
                                   title="Delete"
                                 >
                                   <Trash2 className="h-3 w-3" />
                                 </button>
                               </div>
                               {activeJobs.has(conv.id) ? (
                                 <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-primary animate-pulse" title="Running…" />
                               ) : (
                                 <span className={cn(
                                   "shrink-0 text-[9px] font-mono font-semibold px-1 py-0.5 rounded",
                                   conv.agent === "openclaw"
                                     ? "text-primary bg-primary/10"
                                     : "text-muted-foreground/50 bg-muted/50"
                                 )}>
                                   {conv.agent === "openclaw" ? "OC" : "CC"}
                                 </span>
                               )}
                             </>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Footer with Setup + user profile */}
      <SidebarFooter>
        <SidebarMenu>
          {/* Nav items expand upward above the Setup button */}
          {setupOpen && setupItems.map(item => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild tooltip={item.title}>
                <NavLink
                  to={item.url}
                  end
                  className={`hover:bg-accent/50 ${!collapsed ? "pl-7" : ""}`}
                  activeClassName="bg-accent text-primary font-medium"
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}

          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setSetupOpen(o => !o)}
              tooltip="Setup"
              className="font-medium"
            >
              <Settings className="h-4 w-4" />
              <span className="flex-1">Setup</span>
              {!collapsed && (
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${setupOpen ? "" : "rotate-180"}`} />
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* User profile row */}
        <div className={cn(
          "mt-1 border-t border-border/50 pt-2 flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-accent/40 transition-colors cursor-default",
          collapsed && "justify-center px-0"
        )}>
          <div className="h-7 w-7 rounded-full bg-primary/20 ring-1 ring-primary/30 flex items-center justify-center shrink-0">
            <User className="h-3.5 w-3.5 text-primary" />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate leading-tight">
                {displayName ?? user?.email?.split("@")[0] ?? "User"}
              </p>
              <p className="text-[10px] text-muted-foreground/60 truncate leading-tight">
                {user?.email ?? ""}
              </p>
            </div>
          )}
          {!collapsed && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title={theme === "dark" ? "Light Mode" : "Dark Mode"}
              >
                {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={handleSignOut}
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Sign Out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>

    <AlertDialog open={!!deleteTargetId} onOpenChange={open => { if (!open) setDeleteTargetId(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this conversation and all its messages. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => { if (deleteTargetId) { handleDelete(deleteTargetId); setDeleteTargetId(null); } }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
