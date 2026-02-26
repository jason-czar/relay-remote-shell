import {
  LayoutDashboard, FolderOpen, Settings, LogOut, Sun, Moon, Plug, BookOpen,
  Columns2, MessageSquare, ChevronDown, ChevronUp, Plus, Search, Trash2
} from "lucide-react";
import logo from "@/assets/logo.png";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "next-themes";
import { useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
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
  const { signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isChat = location.pathname === "/chat";

  const [setupOpen, setSetupOpen] = useState(true);
  const [convOpen, setConvOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
                <button
                  onClick={() => setConvOpen(o => !o)}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {convOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  Conversations
                </button>
                <button
                  onClick={() => { handleNew(); navigate("/chat"); }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
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
                <div className="px-2 pb-2">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-accent/30">
                    <Search className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search…"
                      className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/40 text-foreground min-w-0"
                    />
                  </div>
                </div>

                {/* Grouped conversations */}
                <div className="space-y-3 max-h-[40vh] overflow-y-auto px-1">
                  {conversations.length === 0 && (
                    <p className="text-xs text-muted-foreground/40 text-center py-4">No conversations yet</p>
                  )}
                  {groups.map(group => (
                    <div key={group.label}>
                      <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider px-2 pb-1">{group.label}</p>
                      {group.items.map(conv => (
                        <div
                          key={conv.id}
                          className={cn(
                            "group flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer transition-all duration-100 text-xs",
                            activeConvId === conv.id
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                          )}
                          onClick={() => { setActiveConvId(conv.id); navigate("/chat"); }}
                          onMouseEnter={() => setHoveredId(conv.id)}
                          onMouseLeave={() => setHoveredId(null)}
                        >
                          <span className="flex-1 truncate">{conv.title}</span>
                          <span className={cn(
                            "text-[9px] font-mono shrink-0 opacity-40",
                            conv.agent === "openclaw" ? "text-primary" : ""
                          )}>
                            {conv.agent === "openclaw" ? "OC" : "CC"}
                          </span>
                          {(hoveredId === conv.id || activeConvId === conv.id) && (
                            <button
                              className="shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive transition-all p-0.5 rounded"
                              onClick={e => { e.stopPropagation(); handleDelete(conv.id); }}
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
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

      {/* Footer with Setup + theme + signout */}
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

          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleTheme} tooltip={theme === "dark" ? "Light Mode" : "Dark Mode"}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} tooltip="Sign Out">
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
