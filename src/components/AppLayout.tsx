import { ReactNode, useRef, useState, useCallback, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useLocation } from "react-router-dom";

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 260;
const LS_KEY = "sidebar-width";
// Only trigger open-swipe when touch starts within this many px of the left edge
const EDGE_THRESHOLD = 28;

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

/** Inner layout — needs access to useSidebar which must be inside SidebarProvider */
function Inner({ children, sidebarWidth, onMouseDown, isChat }: {
  children: ReactNode;
  sidebarWidth: number;
  onMouseDown: (e: React.MouseEvent) => void;
  isChat: boolean;
}) {
  const { openMobile, setOpenMobile, isMobile } = useSidebar();
  const MOBILE_SIDEBAR_WIDTH = 288; // matches SIDEBAR_WIDTH_MOBILE = "18rem"

  const touchStartX = useRef<number | null>(null);
  const openMobileRef = useRef(openMobile);
  useEffect(() => { openMobileRef.current = openMobile; }, [openMobile]);

  // Single global swipe handler on the root element
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const startX = touchStartX.current;
    const dx = e.changedTouches[0].clientX - startX;
    touchStartX.current = null;

    if (!isMobile) return;

    // Swipe right from left edge → open
    if (dx >= 50 && startX <= EDGE_THRESHOLD && !openMobileRef.current) {
      if ("vibrate" in navigator) navigator.vibrate(8);
      setOpenMobile(true);
    }
    // Swipe left anywhere when open → close
    if (dx <= -50 && openMobileRef.current) {
      if ("vibrate" in navigator) navigator.vibrate(8);
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);

  const mobileShift = isMobile && openMobile ? MOBILE_SIDEBAR_WIDTH : 0;

  return (
    <div
      className="h-screen flex w-full overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Mobile scrim */}
      {isMobile && (
        <div
          className={`fixed inset-0 z-30 bg-black transition-opacity duration-300 ${openMobile ? "opacity-40 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          onClick={() => setOpenMobile(false)}
        />
      )}
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
      <main
        className="flex-1 flex flex-col overflow-hidden transition-transform duration-300 ease-in-out"
        style={isMobile ? { transform: `translateX(${mobileShift}px)` } : undefined}
      >
        {!isChat && (
          <header className="h-12 flex items-center border-b border-border px-3 shrink-0">
            <SidebarTrigger />
          </header>
        )}
        {isChat ? (
          <div className="flex-1 overflow-hidden relative">
            {children}
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-2 sm:p-4">
            {children}
          </div>
        )}
      </main>
    </div>
  );
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
      <Inner isChat={isChat} sidebarWidth={sidebarWidth} onMouseDown={onMouseDown}>
        {children}
      </Inner>
    </SidebarProvider>
  );
}
