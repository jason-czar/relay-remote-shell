import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useLocation } from "react-router-dom";

export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isChat = location.pathname === "/chat";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          {!isChat && (
            <header className="h-14 flex items-center border-b border-border px-4 shrink-0">
              <SidebarTrigger />
            </header>
          )}
          {isChat ? (
            <div className="flex-1 overflow-hidden relative">
              {/* Floating sidebar trigger for chat */}
              <div className="absolute top-3 left-3 z-10">
                <SidebarTrigger />
              </div>
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
