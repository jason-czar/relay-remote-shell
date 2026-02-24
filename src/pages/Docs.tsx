import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Terminal, ArrowLeft, BookOpen, Rocket, Shield, Monitor, Users, Plug,
  Wifi, Zap, Code, FileText, Server, Globe, Key, Copy, Check,
  ChevronRight, ExternalLink, Search, Settings2, HardDrive, RefreshCw,
  ArrowRight, Download, GitBranch, Lock, Eye, MessageSquare, Cpu,
  Network, Database, Workflow
} from "lucide-react";
import { Input } from "@/components/ui/input";

type Section = {
  id: string;
  title: string;
  icon: React.ElementType;
  subsections?: { id: string; title: string }[];
};

const sections: Section[] = [
  {
    id: "overview",
    title: "Overview",
    icon: BookOpen,
    subsections: [
      { id: "what-is-relay", title: "What is Relay Terminal?" },
      { id: "architecture", title: "Architecture" },
      { id: "key-concepts", title: "Key Concepts" },
    ],
  },
  {
    id: "getting-started",
    title: "Getting Started",
    icon: Rocket,
    subsections: [
      { id: "create-account", title: "Create an Account" },
      { id: "create-project", title: "Create a Project" },
      { id: "add-device", title: "Add a Device" },
      { id: "install-connector", title: "Install the Connector" },
      { id: "pair-device", title: "Pair Your Device" },
      { id: "connect-terminal", title: "Connect via Terminal" },
    ],
  },
  {
    id: "connector",
    title: "Connector Agent",
    icon: HardDrive,
    subsections: [
      { id: "connector-overview", title: "Overview" },
      { id: "connector-install", title: "Installation" },
      { id: "connector-pairing", title: "Pairing" },
      { id: "connector-usage", title: "Usage & Flags" },
      { id: "connector-config-file", title: "Configuration File" },
      { id: "connector-cross-compile", title: "Cross-Compilation" },
    ],
  },
  {
    id: "projects",
    title: "Projects & Devices",
    icon: Monitor,
    subsections: [
      { id: "project-management", title: "Project Management" },
      { id: "device-management", title: "Device Management" },
      { id: "pairing-codes", title: "Pairing Codes" },
      { id: "device-status", title: "Device Status & Realtime" },
    ],
  },
  {
    id: "terminal",
    title: "Terminal Sessions",
    icon: Terminal,
    subsections: [
      { id: "starting-session", title: "Starting a Session" },
      { id: "session-features", title: "Session Features" },
      { id: "reconnection", title: "Reconnection & Resilience" },
      { id: "session-history", title: "Session History" },
    ],
  },
  {
    id: "teams",
    title: "Teams & Collaboration",
    icon: Users,
    subsections: [
      { id: "roles", title: "Roles & Permissions" },
      { id: "inviting-members", title: "Inviting Members" },
      { id: "managing-team", title: "Managing Your Team" },
    ],
  },
  {
    id: "remote-relay",
    title: "Remote Relay Skill",
    icon: Plug,
    subsections: [
      { id: "skill-overview", title: "Overview" },
      { id: "skill-capabilities", title: "Capabilities" },
      { id: "skill-config", title: "Configuration" },
      { id: "multi-node", title: "Multi-Node Management" },
      { id: "skill-protocol", title: "Message Protocol" },
      { id: "skill-security", title: "Security & Privacy" },
    ],
  },
  {
    id: "relay-protocol",
    title: "Relay Protocol",
    icon: Network,
    subsections: [
      { id: "protocol-overview", title: "Protocol Overview" },
      { id: "connector-relay-messages", title: "Connector ↔ Relay" },
      { id: "browser-relay-messages", title: "Browser ↔ Relay" },
    ],
  },
  {
    id: "api-reference",
    title: "API Reference",
    icon: Code,
    subsections: [
      { id: "edge-functions", title: "Edge Functions" },
      { id: "api-pair-device", title: "POST /pair-device" },
      { id: "api-start-session", title: "POST /start-session" },
      { id: "api-end-session", title: "POST /end-session" },
      { id: "api-relay-nodes", title: "GET /relay-nodes" },
      { id: "api-invite-member", title: "POST /invite-member" },
      { id: "api-download-connector", title: "GET /download-connector" },
    ],
  },
  {
    id: "security",
    title: "Security",
    icon: Shield,
    subsections: [
      { id: "auth-model", title: "Authentication Model" },
      { id: "rls-policies", title: "Row-Level Security" },
      { id: "network-posture", title: "Network Posture" },
      { id: "data-privacy", title: "Data Privacy" },
    ],
  },
  {
    id: "self-hosting",
    title: "Self-Hosting",
    icon: Server,
    subsections: [
      { id: "relay-server-deploy", title: "Deploying the Relay Server" },
      { id: "relay-server-config", title: "Configuration" },
      { id: "fly-io-deploy", title: "Fly.io Deployment" },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: RefreshCw,
    subsections: [
      { id: "common-issues", title: "Common Issues" },
      { id: "faq", title: "FAQ" },
    ],
  },
];

function CodeBlock({ children, language = "json", copyable = true }: { children: string; language?: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group rounded-lg border border-border bg-[hsl(var(--terminal-bg))] overflow-hidden my-3">
      {copyable && (
        <button onClick={copy} className="absolute top-2 right-2 p-1.5 rounded bg-muted/20 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
      <pre className="p-4 text-sm font-mono text-[hsl(var(--terminal-fg))] overflow-x-auto leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Heading({ id, children, level = 2 }: { id: string; children: React.ReactNode; level?: 2 | 3 }) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag id={id} className={`scroll-mt-20 ${level === 2 ? "text-2xl font-bold tracking-tight mt-12 mb-4" : "text-lg font-semibold mt-8 mb-3"} flex items-center gap-2`}>
      {children}
      <a href={`#${id}`} className="text-muted-foreground/0 hover:text-muted-foreground transition-colors">#</a>
    </Tag>
  );
}

function InfoBox({ children, variant = "info" }: { children: React.ReactNode; variant?: "info" | "warning" | "tip" }) {
  const styles = {
    info: "border-primary/30 bg-primary/5 text-foreground",
    warning: "border-[hsl(var(--status-connecting))]/30 bg-[hsl(var(--status-connecting))]/5 text-foreground",
    tip: "border-primary/30 bg-primary/5 text-foreground",
  };
  const labels = { info: "ℹ️ Note", warning: "⚠️ Warning", tip: "💡 Tip" };
  return (
    <div className={`rounded-lg border p-4 my-4 ${styles[variant]}`}>
      <p className="text-sm font-semibold mb-1">{labels[variant]}</p>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

type SearchResult = {
  sectionId: string;
  sectionTitle: string;
  subsectionId?: string;
  subsectionTitle?: string;
  snippet: string;
};

function buildSearchIndex(): { id: string; parentId: string; title: string; text: string }[] {
  const index: { id: string; parentId: string; title: string; text: string }[] = [];
  for (const section of sections) {
    // Index main section
    const sectionEl = document.getElementById(section.id);
    if (sectionEl) {
      // Grab text between this heading and next h2
      let text = "";
      let sibling = sectionEl.nextElementSibling;
      while (sibling && sibling.tagName !== "H2") {
        if (sibling.tagName !== "H3") {
          text += " " + (sibling.textContent || "");
        }
        sibling = sibling.nextElementSibling;
      }
      index.push({ id: section.id, parentId: section.id, title: section.title, text: text.slice(0, 2000) });
    }
    // Index subsections
    for (const sub of section.subsections || []) {
      const subEl = document.getElementById(sub.id);
      if (subEl) {
        let text = "";
        let sibling = subEl.nextElementSibling;
        while (sibling && sibling.tagName !== "H2" && sibling.tagName !== "H3") {
          text += " " + (sibling.textContent || "");
          sibling = sibling.nextElementSibling;
        }
        index.push({ id: sub.id, parentId: section.id, title: sub.title, text: text.slice(0, 2000) });
      }
    }
  }
  return index;
}

function getSnippet(text: string, query: string, contextChars = 80): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, contextChars * 2).trim() + "…";
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + query.length + contextChars);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

export default function Docs() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState("overview");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchIndex, setSearchIndex] = useState<ReturnType<typeof buildSearchIndex>>([]);
  const [showResults, setShowResults] = useState(false);

  // Build search index after render
  useEffect(() => {
    const timer = setTimeout(() => setSearchIndex(buildSearchIndex()), 500);
    return () => clearTimeout(timer);
  }, []);

  // Perform content search
  useEffect(() => {
    if (!search.trim() || search.trim().length < 2) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    const q = search.trim().toLowerCase();
    const results: SearchResult[] = [];
    for (const entry of searchIndex) {
      const titleMatch = entry.title.toLowerCase().includes(q);
      const textMatch = entry.text.toLowerCase().includes(q);
      if (titleMatch || textMatch) {
        const parentSection = sections.find(s => s.id === entry.parentId);
        const isSubsection = entry.id !== entry.parentId;
        results.push({
          sectionId: entry.parentId,
          sectionTitle: parentSection?.title || entry.parentId,
          subsectionId: isSubsection ? entry.id : undefined,
          subsectionTitle: isSubsection ? entry.title : undefined,
          snippet: getSnippet(entry.text, search.trim()),
        });
      }
    }
    setSearchResults(results.slice(0, 15));
    setShowResults(true);
  }, [search, searchIndex]);

  // Scroll to hash on load
  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [location.hash]);

  // Track active section on scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            const parent = sections.find(s => s.id === id || s.subsections?.some(sub => sub.id === id));
            if (parent) setActiveSection(parent.id);
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px" }
    );
    const headings = document.querySelectorAll("h2[id], h3[id]");
    headings.forEach(h => observer.observe(h));
    return () => observer.disconnect();
  }, []);

  const filteredSections = search
    ? sections.filter(s =>
        s.title.toLowerCase().includes(search.toLowerCase()) ||
        s.subsections?.some(sub => sub.title.toLowerCase().includes(search.toLowerCase())) ||
        searchResults.some(r => r.sectionId === s.id)
      )
    : sections;

  const handleResultClick = (result: SearchResult) => {
    const targetId = result.subsectionId || result.sectionId;
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: "smooth" });
    setShowResults(false);
    setSearch("");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-primary" />
              <span className="font-bold tracking-tight">Relay Terminal</span>
              <Badge variant="secondary" className="text-xs">Docs</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>Home</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")}>Sign In</Button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto flex">
        {/* Sidebar Nav */}
        <aside className="hidden lg:block w-64 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] border-r border-border">
          <ScrollArea className="h-full py-6 px-4">
            <div className="mb-4 relative">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search all content..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onFocus={() => search.trim().length >= 2 && setShowResults(true)}
                  onBlur={() => setTimeout(() => setShowResults(false), 200)}
                  className="pl-8 h-9 text-sm"
                />
                {search && (
                  <button
                    onClick={() => { setSearch(""); setShowResults(false); }}
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <span className="text-xs">✕</span>
                  </button>
                )}
              </div>
              {showResults && searchResults.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-border bg-popover shadow-lg max-h-80 overflow-y-auto">
                  <div className="p-2 text-xs text-muted-foreground border-b border-border">
                    {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found
                  </div>
                  {searchResults.map((result, i) => (
                    <button
                      key={`${result.sectionId}-${result.subsectionId}-${i}`}
                      onClick={() => handleResultClick(result)}
                      className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{result.sectionTitle}</Badge>
                        {result.subsectionTitle && (
                          <>
                            <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                            <span className="text-xs font-medium text-foreground">{result.subsectionTitle}</span>
                          </>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed mt-1">
                        {result.snippet}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {showResults && search.trim().length >= 2 && searchResults.length === 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-border bg-popover shadow-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground">No results for "{search}"</p>
                </div>
              )}
            </div>
            <nav className="space-y-1">
              {filteredSections.map(section => (
                <div key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                      activeSection === section.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <section.icon className="h-3.5 w-3.5 shrink-0" />
                    {section.title}
                  </a>
                  {activeSection === section.id && section.subsections && (
                    <div className="ml-6 mt-1 space-y-0.5 border-l border-border pl-3">
                      {section.subsections.map(sub => (
                        <a
                          key={sub.id}
                          href={`#${sub.id}`}
                          className="block text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
                        >
                          {sub.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          </ScrollArea>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 px-6 lg:px-12 py-10 max-w-4xl">
          {/* Hero */}
          <div className="mb-12">
            <h1 className="text-4xl font-bold tracking-tight mb-4">Documentation</h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
              Everything you need to set up, configure, and operate Relay Terminal Cloud —
              from your first device to advanced OpenClaw relay integrations.
            </p>
            <div className="flex flex-wrap gap-2 mt-6">
              <a href="#getting-started"><Badge variant="outline" className="cursor-pointer hover:bg-muted gap-1"><Rocket className="h-3 w-3" /> Quick Start</Badge></a>
              <a href="#connector"><Badge variant="outline" className="cursor-pointer hover:bg-muted gap-1"><Download className="h-3 w-3" /> Install Connector</Badge></a>
              <a href="#remote-relay"><Badge variant="outline" className="cursor-pointer hover:bg-muted gap-1"><Plug className="h-3 w-3" /> Remote Relay</Badge></a>
              <a href="#api-reference"><Badge variant="outline" className="cursor-pointer hover:bg-muted gap-1"><Code className="h-3 w-3" /> API Reference</Badge></a>
            </div>
          </div>

          <Separator className="mb-8" />

          {/* ─── OVERVIEW ─── */}
          <Heading id="overview" level={2}>Overview</Heading>

          <Heading id="what-is-relay" level={3}>What is Relay Terminal?</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Relay Terminal Cloud is a platform for secure, browser-based terminal access to remote machines.
            It eliminates the need for VPNs, SSH key management, or exposed ports by using an <strong>outbound-only
            WebSocket relay</strong> architecture. Your machines connect <em>out</em> to the relay — nothing listens inbound.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            The platform consists of three components:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li><strong>Web App</strong> — Dashboard, project/device management, browser terminal (xterm.js)</li>
            <li><strong>Relay Server</strong> — Stateful WebSocket server that bridges browsers and connectors</li>
            <li><strong>Connector Agent</strong> — Lightweight Go binary that runs on your machine and spawns PTY sessions</li>
          </ul>

          <Heading id="architecture" level={3}>Architecture</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            The system follows a hub-and-spoke model where the relay server is the hub:
          </p>
          <CodeBlock language="text" copyable={false}>{`┌──────────────┐     WSS      ┌──────────────┐     WSS      ┌──────────────┐
│   Browser    │◄────────────►│ Relay Server │◄────────────►│  Connector   │
│  (xterm.js)  │              │  (Node.js)   │              │    (Go)      │
└──────────────┘              └──────┬───────┘              └──────┬───────┘
                                     │                             │
                              ┌──────┴───────┐              ┌──────┴───────┐
                              │   Supabase   │              │  Local PTY   │
                              │  (Auth, DB)  │              │   /bin/sh    │
                              └──────────────┘              └──────────────┘`}</CodeBlock>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li><strong>Control plane</strong> — Supabase Edge Functions handle pairing, session lifecycle, and team management</li>
            <li><strong>Data plane</strong> — The relay server handles persistent WebSocket connections and stdin/stdout forwarding</li>
            <li>All WebSocket connections use <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">wss://</code> (TLS encrypted)</li>
          </ul>

          <Heading id="key-concepts" level={3}>Key Concepts</Heading>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden my-4">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-semibold border-b border-border">Concept</th>
                  <th className="text-left p-3 font-semibold border-b border-border">Description</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border"><td className="p-3 font-medium">Project</td><td className="p-3 text-muted-foreground">A container for devices and team members. Each project has one owner.</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-medium">Device</td><td className="p-3 text-muted-foreground">A registered machine that can accept terminal sessions via the connector agent.</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-medium">Pairing Code</td><td className="p-3 text-muted-foreground">A one-time code used to authenticate the connector agent with a device entry.</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-medium">Connector</td><td className="p-3 text-muted-foreground">A Go binary that runs on the target machine, spawning PTY shells on demand.</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-medium">Session</td><td className="p-3 text-muted-foreground">An active terminal connection between a browser and a device through the relay.</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-medium">Relay Server</td><td className="p-3 text-muted-foreground">The WebSocket hub that bridges browser clients and connector agents.</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-medium">Remote Relay Skill</td><td className="p-3 text-muted-foreground">An OpenClaw skill that connects AI agents to the relay for remote prompting and control.</td></tr>
                <tr><td className="p-3 font-medium">Node</td><td className="p-3 text-muted-foreground">A configured OpenClaw instance connected via the remote-relay skill.</td></tr>
              </tbody>
            </table>
          </div>

          <Separator className="my-10" />

          {/* ─── GETTING STARTED ─── */}
          <Heading id="getting-started" level={2}>Getting Started</Heading>

          <Heading id="create-account" level={3}>1. Create an Account</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Navigate to <a href="/auth" className="text-primary hover:underline">/auth</a> and sign up with your email address. You'll receive a confirmation email — click the link to activate your account, then sign in.
          </p>

          <Heading id="create-project" level={3}>2. Create a Project</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            After signing in, go to <a href="/projects" className="text-primary hover:underline">Projects</a> and click <strong>"New Project"</strong>. Give it a descriptive name (e.g., "Home Lab", "Production Servers"). Projects are the top-level container for your devices and team members.
          </p>

          <Heading id="add-device" level={3}>3. Add a Device</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Inside your project, click <strong>"Add Device"</strong> and enter a name (e.g., "Ubuntu Server", "Raspberry Pi"). A one-time <strong>pairing code</strong> will be generated — you'll need this to connect your machine.
          </p>
          <InfoBox variant="tip">
            You can also use the <strong>Setup Wizard</strong> which walks you through the entire device setup process step by step, including downloading the connector and pairing.
          </InfoBox>

          <Heading id="install-connector" level={3}>4. Install the Connector</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Download or build the Go connector on the machine you want to access remotely:
          </p>
          <CodeBlock language="bash">{`# Clone and build
git clone <repo-url>
cd connector
go build -o relay-connector .

# Or use pre-built binaries from the dashboard download link`}</CodeBlock>

          <Heading id="pair-device" level={3}>5. Pair Your Device</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Run the connector with the pairing code from the web UI:
          </p>
          <CodeBlock language="bash">{`./relay-connector --pair ABCD1234 \\
  --api https://<your-supabase-url>/functions/v1 \\
  --name "My Server"`}</CodeBlock>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            This exchanges the pairing code for a persistent device token and saves it to <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">~/.relay-connector.json</code>. The device will show as "Paired" in the web UI.
          </p>

          <Heading id="connect-terminal" level={3}>6. Connect via Terminal</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Start the connector in persistent mode:
          </p>
          <CodeBlock language="bash">{`./relay-connector`}</CodeBlock>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            The device status will change to <Badge variant="default" className="text-xs px-1.5 py-0">online</Badge> in the dashboard. Click <strong>"Connect"</strong> next to the device to open a browser terminal session.
          </p>

          <Separator className="my-10" />

          {/* ─── CONNECTOR ─── */}
          <Heading id="connector" level={2}>Connector Agent</Heading>

          <Heading id="connector-overview" level={3}>Overview</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            The connector is a lightweight Go binary that runs on the target machine. It establishes an <strong>outbound-only</strong> WebSocket
            connection to the relay server, authenticates with its device token, and spawns PTY shell sessions on demand when users connect from the browser.
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li>No inbound ports required — firewall-friendly</li>
            <li>Supports multiple concurrent terminal sessions</li>
            <li>Automatic reconnection with exponential backoff</li>
            <li>Minimal resource footprint (~5MB binary)</li>
          </ul>

          <Heading id="connector-install" level={3}>Installation</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">Prerequisites: Go 1.22+ (for building from source).</p>
          <CodeBlock language="bash">{`cd connector
go mod tidy
go build -o relay-connector .`}</CodeBlock>

          <Heading id="connector-pairing" level={3}>Pairing</Heading>
          <CodeBlock language="bash">{`./relay-connector --pair <PAIRING_CODE> \\
  --api https://<supabase-url>/functions/v1 \\
  --name "Device Name"`}</CodeBlock>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            The pairing flow calls the <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">pair-device</code> edge function, which validates the code and returns a device ID, auth token, and relay URL. These are saved locally.
          </p>

          <Heading id="connector-usage" level={3}>Usage & Flags</Heading>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden my-4">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-semibold border-b border-border">Flag</th>
                  <th className="text-left p-3 font-semibold border-b border-border">Description</th>
                  <th className="text-left p-3 font-semibold border-b border-border">Default</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">--pair &lt;code&gt;</td><td className="p-3 text-muted-foreground">Pairing code from web UI</td><td className="p-3 text-muted-foreground">—</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">--name &lt;name&gt;</td><td className="p-3 text-muted-foreground">Device name (used during pairing)</td><td className="p-3 text-muted-foreground">—</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">--api &lt;url&gt;</td><td className="p-3 text-muted-foreground">Edge Function base URL</td><td className="p-3 text-muted-foreground">Required for pairing</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">--config &lt;path&gt;</td><td className="p-3 text-muted-foreground">Config file path</td><td className="p-3 text-muted-foreground">~/.relay-connector.json</td></tr>
                <tr><td className="p-3 font-mono text-xs">--shell &lt;path&gt;</td><td className="p-3 text-muted-foreground">Shell to spawn</td><td className="p-3 text-muted-foreground">$SHELL or /bin/sh</td></tr>
              </tbody>
            </table>
          </div>

          <Heading id="connector-config-file" level={3}>Configuration File</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2">
            Saved at <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">~/.relay-connector.json</code> with 0600 permissions:
          </p>
          <CodeBlock>{`{
  "device_id": "uuid",
  "token": "device-auth-token",
  "relay_url": "wss://relay-terminal-cloud.fly.dev"
}`}</CodeBlock>

          <Heading id="connector-cross-compile" level={3}>Cross-Compilation</Heading>
          <CodeBlock language="bash">{`# Linux (amd64)
GOOS=linux GOARCH=amd64 go build -o relay-connector-linux .

# macOS (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o relay-connector-mac .

# Windows
GOOS=windows GOARCH=amd64 go build -o relay-connector.exe .

# Raspberry Pi (ARM)
GOOS=linux GOARCH=arm GOARM=7 go build -o relay-connector-pi .`}</CodeBlock>

          <Separator className="my-10" />

          {/* ─── PROJECTS & DEVICES ─── */}
          <Heading id="projects" level={2}>Projects & Devices</Heading>

          <Heading id="project-management" level={3}>Project Management</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Projects are the top-level organizational unit. Each project has an <strong>owner</strong> (the creator) and can have
            multiple <strong>members</strong>. Owners can add/remove devices, invite members, and delete the project. Members can
            view devices and connect to terminal sessions.
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li>Create projects from the <a href="/projects" className="text-primary hover:underline">Projects</a> page</li>
            <li>Rename or delete projects from the project settings</li>
            <li>Each device belongs to exactly one project</li>
          </ul>

          <Heading id="device-management" level={3}>Device Management</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Devices represent machines that can be accessed remotely. Each device has:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li><strong>Name</strong> — Human-readable label (e.g., "Production API Server")</li>
            <li><strong>Status</strong> — Online or Offline, updated in real-time</li>
            <li><strong>Pairing Code</strong> — One-time code used during connector setup</li>
            <li><strong>Paired</strong> — Whether the connector has successfully authenticated</li>
          </ul>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Device actions (owner only): Rename, Regenerate Pairing Code, Delete.
          </p>

          <Heading id="pairing-codes" level={3}>Pairing Codes</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Pairing codes are 6-character alphanumeric strings generated when a device is added. They are single-use — once the
            connector pairs successfully, the code is consumed and the device receives a persistent token. If you need to re-pair
            a device (e.g., moved to a new machine), regenerate the pairing code from the device menu.
          </p>

          <Heading id="device-status" level={3}>Device Status & Realtime</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Device status updates are delivered in real-time via Supabase Realtime subscriptions. When a connector connects to
            the relay, the relay server updates the device status to <Badge variant="default" className="text-xs px-1.5 py-0">online</Badge>.
            When it disconnects, the status changes to <Badge variant="secondary" className="text-xs px-1.5 py-0">offline</Badge>.
            You'll see toast notifications in the dashboard when devices come online or go offline.
          </p>

          <Separator className="my-10" />

          {/* ─── TERMINAL SESSIONS ─── */}
          <Heading id="terminal" level={2}>Terminal Sessions</Heading>

          <Heading id="starting-session" level={3}>Starting a Session</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Click <strong>"Connect"</strong> on any online device to open a full terminal session in your browser. The system:
          </p>
          <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li>Creates a session record via the <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">start-session</code> edge function</li>
            <li>Opens a WebSocket connection to the relay server</li>
            <li>Authenticates with your JWT token</li>
            <li>The relay forwards a <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">session_start</code> message to the connector</li>
            <li>The connector spawns a PTY shell and begins streaming stdout</li>
          </ol>

          <Heading id="session-features" level={3}>Session Features</Heading>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li><strong>Full xterm.js terminal</strong> — Cursor blinking, scrollback, selection, colors</li>
            <li><strong>Copy/Paste</strong> — Clipboard buttons in the toolbar, or use native keyboard shortcuts</li>
            <li><strong>Responsive resizing</strong> — Terminal dimensions sync with browser window; resize events forwarded to PTY</li>
            <li><strong>Latency indicator</strong> — Real-time ping/pong measurements shown in the header</li>
            <li><strong>Session resumption</strong> — If you have an active session on a device, it will be automatically resumed</li>
          </ul>

          <Heading id="reconnection" level={3}>Reconnection & Resilience</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            If the WebSocket connection drops, the browser automatically reconnects with <strong>exponential backoff</strong>
            (1s → 2s → 4s → 8s → 16s → 30s max). The session is preserved on the relay side, so short disconnections
            don't lose your shell state. You can also manually reconnect via the toolbar button.
          </p>

          <Heading id="session-history" level={3}>Session History</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            All sessions are logged in the database with start time, end time, device, and user. View session history in the
            project view under the <strong>Sessions</strong> tab. Filter by device or status (active/ended).
          </p>

          <Separator className="my-10" />

          {/* ─── TEAMS ─── */}
          <Heading id="teams" level={2}>Teams & Collaboration</Heading>

          <Heading id="roles" level={3}>Roles & Permissions</Heading>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden my-4">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-semibold border-b border-border">Permission</th>
                  <th className="text-center p-3 font-semibold border-b border-border">Owner</th>
                  <th className="text-center p-3 font-semibold border-b border-border">Member</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border"><td className="p-3">View project & devices</td><td className="p-3 text-center">✅</td><td className="p-3 text-center">✅</td></tr>
                <tr className="border-b border-border"><td className="p-3">Connect to terminal sessions</td><td className="p-3 text-center">✅</td><td className="p-3 text-center">✅</td></tr>
                <tr className="border-b border-border"><td className="p-3">View team members</td><td className="p-3 text-center">✅</td><td className="p-3 text-center">✅</td></tr>
                <tr className="border-b border-border"><td className="p-3">Add/remove devices</td><td className="p-3 text-center">✅</td><td className="p-3 text-center">❌</td></tr>
                <tr className="border-b border-border"><td className="p-3">Invite/remove members</td><td className="p-3 text-center">✅</td><td className="p-3 text-center">❌</td></tr>
                <tr className="border-b border-border"><td className="p-3">Rename/delete project</td><td className="p-3 text-center">✅</td><td className="p-3 text-center">❌</td></tr>
                <tr><td className="p-3">Regenerate pairing codes</td><td className="p-3 text-center">✅</td><td className="p-3 text-center">❌</td></tr>
              </tbody>
            </table>
          </div>

          <Heading id="inviting-members" level={3}>Inviting Members</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Project owners can invite members by email from the <strong>Team</strong> tab in the project view. If the email
            matches an existing account, they are added immediately. Otherwise, an invitation is created and will be fulfilled
            when they sign up with that email address.
          </p>

          <Heading id="managing-team" level={3}>Managing Your Team</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Owners can remove members and cancel pending invitations from the Team tab.
            Members cannot transfer ownership or promote other members.
          </p>

          <Separator className="my-10" />

          {/* ─── REMOTE RELAY SKILL ─── */}
          <Heading id="remote-relay" level={2}>Remote Relay Skill (OpenClaw)</Heading>

          <Heading id="skill-overview" level={3}>Overview</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            The <strong>remote-relay</strong> skill (v1.0.1) enables secure remote communication between an OpenClaw instance
            and the relay server. It replaces external messaging layers (Telegram, Discord) with a native, encrypted WebSocket
            channel for remote AI agent control.
          </p>
          <InfoBox variant="info">
            Configure the skill through the visual setup wizard at <a href="/skill/remote-relay" className="text-primary hover:underline">/skill/remote-relay</a>.
            Your configurations are saved to your account and accessible from any device.
          </InfoBox>

          <Heading id="skill-capabilities" level={3}>Capabilities</Heading>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden my-4">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-semibold border-b border-border">Capability</th>
                  <th className="text-left p-3 font-semibold border-b border-border">Description</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">remote_chat</td><td className="p-3 text-muted-foreground">Receive and execute prompts remotely, streaming tokens back in real time</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">remote_status</td><td className="p-3 text-muted-foreground">Report node health: uptime, active tasks, last error, connection state</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">remote_restart</td><td className="p-3 text-muted-foreground">Safely restart the OpenClaw process. Pending tasks are cancelled and reported first.</td></tr>
                <tr><td className="p-3 font-mono text-xs">remote_trigger</td><td className="p-3 text-muted-foreground">Execute OpenClaw workflows/tasks triggered remotely</td></tr>
              </tbody>
            </table>
          </div>

          <Heading id="skill-config" level={3}>Configuration</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            The skill requires three configuration values:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden my-4">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-semibold border-b border-border">Key</th>
                  <th className="text-left p-3 font-semibold border-b border-border">Required</th>
                  <th className="text-left p-3 font-semibold border-b border-border">Description</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">relay_url</td><td className="p-3">✅</td><td className="p-3 text-muted-foreground">WebSocket URL of the relay server</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">node_id</td><td className="p-3">✅</td><td className="p-3 text-muted-foreground">Unique identifier for this OpenClaw node (UUID or custom)</td></tr>
                <tr><td className="p-3 font-mono text-xs">auth_token</td><td className="p-3">✅</td><td className="p-3 text-muted-foreground">Secret token for relay authentication (min 8 chars)</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            The config UI generates a JSON snippet you can paste into your OpenClaw skill config:
          </p>
          <CodeBlock>{`{
  "relay_url": "wss://relay-terminal-cloud.fly.dev",
  "node_id": "your-node-uuid",
  "auth_token": "your-secret-token"
}`}</CodeBlock>

          <Heading id="multi-node" level={3}>Multi-Node Management</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            You can save multiple independent node configurations for the same skill. This is useful when managing different
            OpenClaw instances across environments (dev, staging, prod) or different machines. Each node config is identified
            by a unique <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">(user_id, skill_slug, node_id)</code> tuple.
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li>Create new nodes with the <strong>"New Node"</strong> button</li>
            <li>Switch between nodes by clicking on them in the node selector</li>
            <li>Each node has its own relay URL, auth token, and settings</li>
            <li>Node IDs can be auto-generated UUIDs or custom identifiers</li>
            <li>Delete nodes with the trash icon (confirmation required)</li>
          </ul>

          <Heading id="skill-protocol" level={3}>Message Protocol</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2">
            <strong>Incoming (Relay → Node):</strong>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden my-4">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-semibold border-b border-border">Type</th>
                  <th className="text-left p-3 font-semibold border-b border-border">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">prompt</td><td className="p-3 text-muted-foreground">Execute via OpenClaw prompt runner, stream response tokens back</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">status</td><td className="p-3 text-muted-foreground">Return node health payload</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">restart</td><td className="p-3 text-muted-foreground">Cancel pending tasks, report them, then gracefully restart</td></tr>
                <tr><td className="p-3 font-mono text-xs">workflow</td><td className="p-3 text-muted-foreground">Execute a named OpenClaw task/workflow</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2">
            <strong>Outgoing (Node → Relay):</strong>
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li><strong>Heartbeat</strong> (every 15s): node_id, uptime, active_tasks, last_error, connection_state</li>
            <li><strong>Token stream</strong>: <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">{`{ "type": "token", "request_id": "...", "content": "..." }`}</code></li>
            <li><strong>Done</strong>: <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">{`{ "type": "done", "request_id": "..." }`}</code></li>
            <li><strong>Status</strong>: Full heartbeat payload with request_id</li>
          </ul>

          <Heading id="skill-security" level={3}>Security & Privacy</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2"><strong>What leaves your machine:</strong></p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">auth_token</code> — sent once during WebSocket handshake</li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">node_id</code> — sent with every heartbeat and response</li>
            <li>Heartbeat data — uptime, active task count, last error, connection state</li>
            <li>Prompt response tokens — streamed back to the relay</li>
          </ul>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2"><strong>What stays on your machine:</strong></p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li>All local AI model execution and inference</li>
            <li>Local file system contents — never transmitted</li>
            <li>Environment variables (except the three declared config keys)</li>
            <li>System information, IP addresses, hardware details — never collected</li>
          </ul>
          <InfoBox variant="warning">
            By installing this skill, you connect your OpenClaw instance to an external relay server.
            Prompt content and response tokens are transmitted through the relay in real time. Only install if you trust the relay operator.
          </InfoBox>

          <Separator className="my-10" />

          {/* ─── RELAY PROTOCOL ─── */}
          <Heading id="relay-protocol" level={2}>Relay Protocol</Heading>

          <Heading id="protocol-overview" level={3}>Protocol Overview</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            All messages between browsers, the relay server, and connectors use a JSON envelope:
          </p>
          <CodeBlock>{`{ "type": "message_type", "data": { ... } }`}</CodeBlock>

          <Heading id="connector-relay-messages" level={3}>Connector ↔ Relay</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2"><strong>Connector → Relay:</strong></p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden my-4">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-semibold border-b border-border">Type</th>
                  <th className="text-left p-3 font-semibold border-b border-border">When</th>
                  <th className="text-left p-3 font-semibold border-b border-border">Data</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">hello</td><td className="p-3 text-muted-foreground">On connect</td><td className="p-3 text-muted-foreground">device_id, token, meta.name</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">session_started</td><td className="p-3 text-muted-foreground">After spawning PTY</td><td className="p-3 text-muted-foreground">session_id</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">stdout</td><td className="p-3 text-muted-foreground">Terminal output</td><td className="p-3 text-muted-foreground">session_id, data_b64</td></tr>
                <tr><td className="p-3 font-mono text-xs">session_end</td><td className="p-3 text-muted-foreground">Shell exit</td><td className="p-3 text-muted-foreground">session_id, reason</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2"><strong>Relay → Connector:</strong></p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden my-4">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-semibold border-b border-border">Type</th>
                  <th className="text-left p-3 font-semibold border-b border-border">When</th>
                  <th className="text-left p-3 font-semibold border-b border-border">Data</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">hello_ok</td><td className="p-3 text-muted-foreground">Auth success</td><td className="p-3 text-muted-foreground">—</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">session_start</td><td className="p-3 text-muted-foreground">User connects</td><td className="p-3 text-muted-foreground">session_id, cols, rows</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">stdin</td><td className="p-3 text-muted-foreground">User types</td><td className="p-3 text-muted-foreground">session_id, data_b64</td></tr>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">resize</td><td className="p-3 text-muted-foreground">Browser resize</td><td className="p-3 text-muted-foreground">session_id, cols, rows</td></tr>
                <tr><td className="p-3 font-mono text-xs">session_end</td><td className="p-3 text-muted-foreground">User disconnects</td><td className="p-3 text-muted-foreground">session_id, reason</td></tr>
              </tbody>
            </table>
          </div>

          <Heading id="browser-relay-messages" level={3}>Browser ↔ Relay</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2"><strong>Browser → Relay:</strong></p>
          <CodeBlock>{`// Auth (on connect)
{ "type": "auth", "data": { "token": "jwt", "session_id": "uuid", "device_id": "uuid" } }

// stdin, resize, session_end — same format as Relay → Connector`}</CodeBlock>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2"><strong>Relay → Browser:</strong></p>
          <CodeBlock>{`// Auth acknowledgement
{ "type": "auth_ok" }

// stdout — forwarded from connector
{ "type": "stdout", "data": { "session_id": "uuid", "data_b64": "base64" } }

// Ping/pong for latency
{ "type": "pong" }

// Error
{ "type": "error", "data": { "message": "..." } }`}</CodeBlock>

          <Separator className="my-10" />

          {/* ─── API REFERENCE ─── */}
          <Heading id="api-reference" level={2}>API Reference</Heading>

          <Heading id="edge-functions" level={3}>Edge Functions</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            All backend operations are implemented as serverless edge functions. They are accessed at:
          </p>
          <CodeBlock copyable={false}>{`https://<project-url>/functions/v1/<function-name>`}</CodeBlock>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            All endpoints require a valid JWT token in the <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">Authorization: Bearer &lt;token&gt;</code> header
            and the anon key in the <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">apikey</code> header.
          </p>

          <Heading id="api-pair-device" level={3}>POST /pair-device</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2">Exchanges a pairing code for device credentials.</p>
          <CodeBlock>{`// Request
{
  "pairing_code": "ABCD1234",
  "name": "My Server"
}

// Response (200)
{
  "device_id": "uuid",
  "token": "device-auth-token",
  "relay_url": "wss://relay-terminal-cloud.fly.dev"
}`}</CodeBlock>

          <Heading id="api-start-session" level={3}>POST /start-session</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2">Creates a new terminal session for a device.</p>
          <CodeBlock>{`// Request
{ "device_id": "uuid" }

// Response (200)
{ "session_id": "uuid" }`}</CodeBlock>

          <Heading id="api-end-session" level={3}>POST /end-session</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2">Ends an active session.</p>
          <CodeBlock>{`// Request
{ "session_id": "uuid" }

// Response (200)
{ "ok": true }`}</CodeBlock>

          <Heading id="api-relay-nodes" level={3}>GET /relay-nodes</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2">Returns all nodes currently connected to the relay server.</p>
          <CodeBlock>{`// Response (200)
{
  "nodes": [
    {
      "device_id": "uuid",
      "name": "My Server",
      "kind": "connector",
      "connected_at": "ISO8601",
      "last_heartbeat": "ISO8601",
      "online": true
    }
  ]
}`}</CodeBlock>

          <Heading id="api-invite-member" level={3}>POST /invite-member</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2">Invites a user to a project by email.</p>
          <CodeBlock>{`// Request
{
  "project_id": "uuid",
  "email": "user@example.com"
}

// Response (200)
{
  "status": "added" | "invited",
  "message": "Member added to project" | "Invitation sent"
}`}</CodeBlock>

          <Heading id="api-download-connector" level={3}>GET /download-connector</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-2">
            Returns the connector binary or build instructions for the user's platform.
          </p>

          <Separator className="my-10" />

          {/* ─── SECURITY ─── */}
          <Heading id="security" level={2}>Security</Heading>

          <Heading id="auth-model" level={3}>Authentication Model</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            The platform uses JWT-based authentication. Users authenticate with email/password, receiving a JWT that is used
            for all API calls and WebSocket connections. The connector uses a device-specific token received during pairing.
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li><strong>Browser → Relay</strong>: JWT token from auth session</li>
            <li><strong>Connector → Relay</strong>: Device token from pairing</li>
            <li><strong>Edge Functions</strong>: JWT + anon key in headers</li>
          </ul>

          <Heading id="rls-policies" level={3}>Row-Level Security</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            All database tables are protected by Row-Level Security (RLS) policies. Key rules:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li><strong>Projects</strong>: Only visible to project members; only owners can modify</li>
            <li><strong>Devices</strong>: Only visible to project members; only owners can add/update/delete</li>
            <li><strong>Sessions</strong>: Users can view their own sessions or sessions for devices in their projects</li>
            <li><strong>Profiles</strong>: Users can only view and update their own profile</li>
            <li><strong>Skill Configs</strong>: Users can only CRUD their own configurations</li>
            <li><strong>Invitations</strong>: Visible to project members; only owners can create/modify</li>
          </ul>

          <Heading id="network-posture" level={3}>Network Posture</Heading>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-4 ml-2">
            <li><strong>Outbound only</strong> — Connectors never open listening ports or accept inbound connections</li>
            <li><strong>TLS encrypted</strong> — All WebSocket connections use <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">wss://</code> (TLS 1.2+)</li>
            <li><strong>No data persistence on relay</strong> — The relay server does not store terminal data; it forwards in real time</li>
            <li><strong>Credentials never in code</strong> — Service role keys and device tokens are stored securely, never in the repository</li>
          </ul>

          <Heading id="data-privacy" level={3}>Data Privacy</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Terminal session content (stdin/stdout) is forwarded in real time and never persisted by the relay server. The database
            stores session metadata (start/end times, device, user) but not terminal content. Skill configurations, including auth
            tokens, are stored encrypted in the database and are only accessible by the owning user via RLS policies.
          </p>

          <Separator className="my-10" />

          {/* ─── SELF-HOSTING ─── */}
          <Heading id="self-hosting" level={2}>Self-Hosting</Heading>

          <Heading id="relay-server-deploy" level={3}>Deploying the Relay Server</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            The relay server is a standalone Node.js application that can be deployed anywhere Docker runs.
            It requires two environment variables:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden my-4">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-semibold border-b border-border">Variable</th>
                  <th className="text-left p-3 font-semibold border-b border-border">Description</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border"><td className="p-3 font-mono text-xs">SUPABASE_URL</td><td className="p-3 text-muted-foreground">Your backend project URL</td></tr>
                <tr><td className="p-3 font-mono text-xs">SUPABASE_SERVICE_ROLE_KEY</td><td className="p-3 text-muted-foreground">Service role key for server-side operations</td></tr>
              </tbody>
            </table>
          </div>

          <Heading id="relay-server-config" level={3}>Configuration</Heading>
          <CodeBlock language="bash">{`# Clone the repo
cd relay-server

# Set environment variables
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-key

# Run with Docker
docker build -t relay-server .
docker run -p 8080:8080 relay-server`}</CodeBlock>

          <Heading id="fly-io-deploy" level={3}>Fly.io Deployment</Heading>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            The default relay runs on Fly.io. To deploy your own:
          </p>
          <CodeBlock language="bash">{`cd relay-server
fly launch
fly secrets set SUPABASE_URL=https://your-project.supabase.co
fly secrets set SUPABASE_SERVICE_ROLE_KEY=your-key
fly deploy`}</CodeBlock>
          <InfoBox variant="info">
            The default public relay is at <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">wss://relay-terminal-cloud.fly.dev</code>. For production use,
            we recommend deploying your own relay server for full control.
          </InfoBox>

          <Separator className="my-10" />

          {/* ─── TROUBLESHOOTING ─── */}
          <Heading id="troubleshooting" level={2}>Troubleshooting</Heading>

          <Heading id="common-issues" level={3}>Common Issues</Heading>
          <div className="space-y-4">
            <Card className="border-border">
              <CardContent className="p-4">
                <p className="font-semibold text-sm mb-1">Device stays offline after pairing</p>
                <p className="text-sm text-muted-foreground">Ensure the connector is running (<code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">./relay-connector</code> without --pair). Check that the relay URL in <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">~/.relay-connector.json</code> is reachable. Verify no firewall is blocking outbound WebSocket (port 443).</p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardContent className="p-4">
                <p className="font-semibold text-sm mb-1">Terminal shows "Connection timeout"</p>
                <p className="text-sm text-muted-foreground">The relay server may be down or unreachable. Try refreshing the page. Check the relay server status and logs. If self-hosting, ensure the relay container is running.</p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardContent className="p-4">
                <p className="font-semibold text-sm mb-1">"Failed to create session" error</p>
                <p className="text-sm text-muted-foreground">This usually means the device is offline or the edge function encountered an error. Verify the device is online in the dashboard. Check that the connector is running and authenticated.</p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardContent className="p-4">
                <p className="font-semibold text-sm mb-1">WebSocket handshake test fails in skill config</p>
                <p className="text-sm text-muted-foreground">Ensure the relay URL starts with <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">wss://</code> or <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">https://</code>. Check your browser's network tab for CORS or certificate errors. The relay must support the <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">/connect</code> endpoint.</p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardContent className="p-4">
                <p className="font-semibold text-sm mb-1">Skill configuration not saving</p>
                <p className="text-sm text-muted-foreground">Ensure you're signed in. The auth token must be at least 8 characters. Check the browser console for errors. The relay URL must be a valid wss:// or https:// URL.</p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardContent className="p-4">
                <p className="font-semibold text-sm mb-1">Can't invite team members</p>
                <p className="text-sm text-muted-foreground">Only project owners can invite members. Verify you are the project owner, not just a member. Check the email address is valid.</p>
              </CardContent>
            </Card>
          </div>

          <Heading id="faq" level={3}>FAQ</Heading>
          <div className="space-y-4">
            <div>
              <p className="font-semibold text-sm mb-1">Q: Do I need to open any ports on my machine?</p>
              <p className="text-sm text-muted-foreground">No. The connector only makes outbound connections to the relay server. No inbound ports are required.</p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">Q: Can I use the connector behind a corporate firewall/proxy?</p>
              <p className="text-sm text-muted-foreground">Yes, as long as outbound WebSocket connections (port 443) are allowed. The connector uses standard WSS which works through most proxies.</p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">Q: Is terminal data stored or logged?</p>
              <p className="text-sm text-muted-foreground">No. The relay server forwards stdin/stdout in real-time and does not persist any terminal content. Only session metadata (timestamps, device, user) is stored.</p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">Q: Can multiple users connect to the same device simultaneously?</p>
              <p className="text-sm text-muted-foreground">Yes. The connector supports multiple concurrent PTY sessions. Each user gets their own independent shell.</p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">Q: What shell does the connector spawn?</p>
              <p className="text-sm text-muted-foreground">By default, it uses the <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">$SHELL</code> environment variable, falling back to <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">/bin/sh</code>. Override with the <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">--shell</code> flag.</p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">Q: Can I use the remote-relay skill without the web app?</p>
              <p className="text-sm text-muted-foreground">Yes. The skill is a standalone OpenClaw component. You can configure it manually using the JSON config format without the web UI, though the visual wizard is recommended.</p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">Q: What is the default relay server URL?</p>
              <p className="text-sm text-muted-foreground"><code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">wss://relay-terminal-cloud.fly.dev</code> — operated by the project maintainers. For production, deploy your own.</p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">Q: How do I update my profile or change my password?</p>
              <p className="text-sm text-muted-foreground">Go to <a href="/settings" className="text-primary hover:underline">Settings</a> to update your display name, avatar, and password.</p>
            </div>
          </div>

          {/* Footer */}
          <Separator className="my-10" />
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">
              Need help? Found a bug? Open an issue or reach out to the team.
            </p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" size="sm" onClick={() => navigate("/auth")} className="gap-1.5">
                <ArrowRight className="h-3.5 w-3.5" /> Get Started
              </Button>
              <a href="https://clawhub.ai/skills/remote-relay" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" /> ClawHub
                </Button>
              </a>
            </div>
            <p className="text-xs text-muted-foreground mt-6">© {new Date().getFullYear()} Relay Terminal Cloud. All rights reserved.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
