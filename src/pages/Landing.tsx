import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Terminal, Shield, Wifi, Users, Zap, ArrowRight, Monitor } from "lucide-react";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold tracking-tight">Relay Terminal</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate("/auth")}>
              Sign In
            </Button>
            <Button onClick={() => navigate("/auth")}>
              Get Started <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-1.5 text-sm text-muted-foreground mb-8">
          <Zap className="h-3.5 w-3.5 text-primary" />
          Secure remote terminal access
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight max-w-3xl mx-auto">
          Access any machine,
          <br />
          <span className="text-primary">from anywhere.</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto mt-6 leading-relaxed">
          Relay Terminal Cloud gives your team instant, browser-based terminal sessions
          to remote servers, workstations, and IoT devices — no VPN or SSH config needed.
        </p>
        <div className="flex items-center justify-center gap-4 mt-10">
          <Button size="lg" onClick={() => navigate("/auth")} className="gap-2 text-base px-8">
            Start for Free <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="lg" variant="outline" onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })} className="text-base px-8">
            See Features
          </Button>
        </div>

        {/* Terminal mock */}
        <div className="mt-16 max-w-2xl mx-auto rounded-xl border border-border bg-card overflow-hidden shadow-2xl shadow-primary/5">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/50">
            <div className="h-3 w-3 rounded-full bg-destructive/60" />
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: "hsl(var(--status-connecting) / 0.6)" }} />
            <div className="h-3 w-3 rounded-full bg-primary/60" />
            <span className="ml-2 text-xs text-muted-foreground font-mono">production-server — relay session</span>
          </div>
          <div className="p-6 text-left font-mono text-sm leading-relaxed bg-card text-primary" style={{ background: "hsl(220 30% 6%)" }}>
            <p><span className="text-primary">$</span> relay connect production-server</p>
            <p className="text-muted-foreground">⟳ Authenticating via Relay Terminal Cloud...</p>
            <p className="text-primary">✓ Connected to production-server (session a3f8c2d1)</p>
            <p className="mt-2"><span className="text-primary">root@prod</span>:<span className="text-accent-foreground">~</span># systemctl status nginx</p>
            <p className="text-muted-foreground">● nginx.service - A high performance web server</p>
            <p className="text-muted-foreground">&nbsp;&nbsp;Active: <span className="text-primary">active (running)</span> since Mon 2026-02-22 08:15:32 UTC</p>
            <p className="mt-2"><span className="text-primary">root@prod</span>:<span className="text-accent-foreground">~</span># <span className="animate-pulse">▋</span></p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <h2 className="text-3xl font-bold tracking-tight text-center mb-4">
            Everything you need for remote access
          </h2>
          <p className="text-muted-foreground text-center max-w-lg mx-auto mb-16">
            A complete platform for managing and connecting to your infrastructure from the browser.
          </p>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Terminal,
                title: "Browser Terminal",
                desc: "Full xterm.js terminal in your browser with copy/paste, scrollback, and resizable panels.",
              },
              {
                icon: Shield,
                title: "Secure by Default",
                desc: "End-to-end encrypted sessions with JWT authentication. No ports to open, no SSH keys to manage.",
              },
              {
                icon: Monitor,
                title: "Device Management",
                desc: "Add devices with one-time pairing codes. Monitor online status in real-time across all your machines.",
              },
              {
                icon: Users,
                title: "Team Collaboration",
                desc: "Invite team members with role-based access. Owners manage devices, members connect securely.",
              },
              {
                icon: Wifi,
                title: "Real-time Status",
                desc: "Live device connectivity indicators. Know instantly which machines are online and ready.",
              },
              {
                icon: Zap,
                title: "Instant Sessions",
                desc: "One-click connect to any online device. Resume active sessions automatically on reconnect.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border border-border bg-card p-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-24 text-center">
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Ready to connect?
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-8">
            Set up your first project in under a minute. No credit card required.
          </p>
          <Button size="lg" onClick={() => navigate("/auth")} className="gap-2 text-base px-8">
            Get Started Free <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Terminal className="h-4 w-4" />
            Relay Terminal Cloud
          </div>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
