import {
  LayoutDashboard, FolderOpen, Settings, LogOut, Sun, Moon, Plug, BookOpen,
  Columns2, MessageSquare, ChevronDown, Plus, Search, Trash2, User
} from "lucide-react";
import logo from "@/assets/logo.png";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "next-themes";
import { useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
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
  { title: "Chat", url: "/chat", icon: MessageSquare },
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
  const isChat = location.pathname === "/chat";

  const [setupOpen, setSetupOpen] = useState(true);
  const [convOpen, setConvOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => { if (data?.display_name) setDisplayName(data.display_name); });
  }, [user]);

  const { conversations, activeConvId, setActiveConvId, handleDelete, handleNew } = useChatContext();

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
    <Sidebar collapsible="icon">
      {/* Logo */}
      <SidebarContent>
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
          <SidebarGroup>
            <SidebarGroupLabel>
              <div className="flex items-center justify-between w-full pr-1">
                <span className="text-xs font-semibold text-foreground/70 tracking-tight">Conversations</span>
                <button
                  onClick={() => { handleNew(); navigate("/chat"); }}
                  className="flex items-center gap-1 text-xs text-primary/80 hover:text-primary font-medium transition-colors px-2 py-0.5 rounded-md hover:bg-primary/10"
                  title="New chat"
                >
                  <Plus className="h-3 w-3" />
                  New
                </button>
              </div>
            </SidebarGroupLabel>

            {convOpen && (
              <SidebarGroupContent>
                {/* Search */}
                <div className="px-2 pb-1">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border/30">
                    <Search className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search conversations…"
                      className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/30 text-foreground min-w-0"
                    />
                  </div>
                </div>

                {/* Grouped conversations */}
                <div className="space-y-1 max-h-[40vh] overflow-y-auto px-1 scrollbar-thin">
                  {conversations.length === 0 && (
                    <p className="text-xs text-muted-foreground/30 text-center py-6">No conversations yet</p>
                  )}
                  {groups.map(group => (
                    <div key={group.label} className="mb-2">
                      <p className="text-[10px] font-semibold text-muted-foreground/30 uppercase tracking-widest px-2 pt-2 pb-1.5">{group.label}</p>
                      {group.items.map(conv => (
                        <div
                          key={conv.id}
                          className={cn(
                            "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-all duration-100",
                            activeConvId === conv.id
                              ? "bg-accent/80 text-foreground"
                              : "text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground"
                          )}
                          onClick={() => { setActiveConvId(conv.id); navigate("/chat"); }}
                          onMouseEnter={() => setHoveredId(conv.id)}
                          onMouseLeave={() => setHoveredId(null)}
                        >
                          {/* Active indicator */}
                          {activeConvId === conv.id && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full bg-primary" />
                          )}
                          <span className="flex-1 truncate text-[12px] leading-snug">{conv.title}</span>
                          <span className={cn(
                            "shrink-0 text-[9px] font-mono font-semibold px-1 py-0.5 rounded",
                            conv.agent === "openclaw"
                              ? "text-primary bg-primary/10"
                              : "text-muted-foreground/50 bg-muted/50"
                          )}>
                            {conv.agent === "openclaw" ? "OC" : "CC"}
                          </span>
                          <button
                            className={cn(
                              "shrink-0 p-0.5 rounded hover:text-destructive transition-all",
                              hoveredId === conv.id ? "opacity-100" : "opacity-0 pointer-events-none"
                            )}
                            onClick={e => { e.stopPropagation(); handleDelete(conv.id); }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
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
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setSetupOpen(o => !o)}
              tooltip="Setup"
              className="font-medium"
            >
              <Settings className="h-4 w-4" />
              <span className="flex-1">Setup</span>
              {!collapsed && (
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${setupOpen ? "rotate-180" : ""}`} />
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>

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
  );
}
