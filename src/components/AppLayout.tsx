import { ReactNode, useRef, useState, useCallback } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useLocation } from "react-router-dom";

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 260;
const LS_KEY = "sidebar-width";

function getInitialWidth() {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch {}
  return DEFAULT_WIDTH;
}

export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isChat = location.pathname === "/chat" || location.pathname === "/";
  const [sidebarWidth, setSidebarWidth] = useState(getInitialWidth);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX));
      setSidebarWidth(newWidth);
      try { localStorage.setItem(LS_KEY, String(newWidth)); } catch {}
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
  }, []);

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
      <div className="h-screen flex w-full overflow-hidden">
        <div className="relative flex shrink-0">
          <AppSidebar />
          {/* Drag handle — desktop only */}
          <div
            onMouseDown={onMouseDown}
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize z-50 group hidden md:block"
          >
            <div className="h-full w-px bg-border/0 group-hover:bg-border/60 transition-colors duration-150" />
          </div>
        </div>
        <main className="flex-1 flex flex-col overflow-hidden">
          {!isChat && (
            <header className="h-14 flex items-center border-b border-border px-4 shrink-0">
              <SidebarTrigger />
            </header>
          )}
          {isChat ? (
            <div className="flex-1 overflow-hidden relative">
              {children}
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-3 sm:p-6">
              {children}
            </div>
          )}
        </main>
      </div>
    </SidebarProvider>
  );
}
