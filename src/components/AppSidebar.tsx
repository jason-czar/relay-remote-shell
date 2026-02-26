import { LayoutDashboard, FolderOpen, Settings, LogOut, Sun, Moon, Plug, BookOpen, Columns2, MessageSquare, ChevronDown } from "lucide-react";
import logo from "@/assets/logo.png";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
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
  const [setupOpen, setSetupOpen] = useState(true);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <Sidebar collapsible="icon">
      {/* Logo header */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            <div className="flex items-center gap-2">
              <img src={logo} alt="PrivaClaw" className="h-5 w-5 rounded" />
              {!collapsed && <span className="font-mono text-sm font-bold">PrivaClaw</span>}
            </div>
          </SidebarGroupLabel>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {/* Setup dropdown */}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setSetupOpen((o) => !o)}
              tooltip="Setup"
              className="font-medium"
            >
              <Settings className="h-4 w-4" />
              <span className="flex-1">Setup</span>
              {!collapsed && (
                <ChevronDown
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${setupOpen ? "rotate-180" : ""}`}
                />
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Dropdown items */}
          {setupOpen && setupItems.map((item) => (
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

