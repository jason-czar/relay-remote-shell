import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ChatProvider } from "@/contexts/ChatContext";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Landing from "./pages/Landing";
import ProjectView from "./pages/ProjectView";
import TerminalSession from "./pages/TerminalSession";
import SessionPlayback from "./pages/SessionPlayback";
import Settings from "./pages/Settings";
import MultiSession from "./pages/MultiSession";
import Install from "./pages/Install";
import Chat from "./pages/Chat";
import NotFound from "./pages/NotFound";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";

const queryClient = new QueryClient();

function InactivityGuard({ children }: { children: React.ReactNode }) {
  useInactivityTimeout();
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><p className="text-muted-foreground">Loading...</p></div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <InactivityGuard>{children}</InactivityGuard>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function HomeRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><p className="text-muted-foreground">Loading...</p></div>;
  if (!user) return <Landing />;
  return <InactivityGuard><Chat /></InactivityGuard>;
}


const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ChatProvider>
        <TooltipProvider>
          <ErrorBoundary>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<HomeRoute />} />
                
                <Route path="/auth" element={<AuthRoute><Auth /></AuthRoute>} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/dashboard" element={<ProtectedRoute><Navigate to="/settings?tab=dashboard" replace /></ProtectedRoute>} />
                <Route path="/projects" element={<ProtectedRoute><Navigate to="/settings?tab=projects" replace /></ProtectedRoute>} />
                <Route path="/project/:projectId" element={<ProtectedRoute><ProjectView /></ProtectedRoute>} />
                <Route path="/terminal/:deviceId" element={<ProtectedRoute><TerminalSession /></ProtectedRoute>} />
                <Route path="/playback/:sessionId" element={<ProtectedRoute><SessionPlayback /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                <Route path="/skill/privaclaw" element={<ProtectedRoute><Navigate to="/settings?tab=privaclaw" replace /></ProtectedRoute>} />
                <Route path="/multi-session" element={<ProtectedRoute><MultiSession /></ProtectedRoute>} />
                <Route path="/devices" element={<ProtectedRoute><Navigate to="/settings?tab=devices" replace /></ProtectedRoute>} />
                <Route path="/chat" element={<Navigate to="/" replace />} />
                <Route path="/docs" element={<Navigate to="/settings?tab=docs" replace />} />
                <Route path="/terms" element={<TermsOfService />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/install" element={<Install />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </ErrorBoundary>
        </TooltipProvider>
        </ChatProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
