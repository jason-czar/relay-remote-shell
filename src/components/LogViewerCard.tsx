import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, ScrollText, AlertCircle, Info, AlertTriangle, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogEntry {
  function: string;
  timestamp: number | string;
  level: string;
  event_type: string;
  message: string;
}

const LEVEL_CONFIG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  error: { label: "Error", className: "text-destructive border-destructive/40 bg-destructive/10", icon: AlertCircle },
  warn:  { label: "Warn",  className: "text-yellow-400 border-yellow-400/40 bg-yellow-400/10", icon: AlertTriangle },
  info:  { label: "Info",  className: "text-blue-400 border-blue-400/40 bg-blue-400/10", icon: Info },
  log:   { label: "Log",   className: "text-muted-foreground border-border/40 bg-transparent", icon: Info },
};

function levelConfig(level: string) {
  return LEVEL_CONFIG[level] ?? LEVEL_CONFIG.log;
}

function formatTimestamp(ts: number | string): string {
  const ms = typeof ts === "number"
    ? ts > 1e12 ? ts / 1000 : ts * 1000  // handle both microseconds and seconds
    : new Date(ts).getTime();
  return new Date(ms).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function isErrorLike(entry: LogEntry): boolean {
  return (
    entry.level === "error" ||
    entry.level === "warn" ||
    entry.message.toLowerCase().includes("[start-session]") ||
    entry.message.toLowerCase().includes("[end-session]") ||
    entry.message.toLowerCase().includes("[pair-device]")
  );
}

export function LogViewerCard() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(60);
  const [filterFn, setFilterFn] = useState<string>("all");
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [functions, setFunctions] = useState<string[]>([]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: "100" };
      if (filterFn !== "all") params.function = filterFn;
      if (filterLevel !== "all") params.level = filterLevel;

      const { data, error } = await supabase.functions.invoke("fetch-logs", {
        headers: {},
      });

      // Build URL manually for query params since invoke doesn't support them
      const { data: { session } } = await supabase.auth.getSession();
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const url = new URL(`https://${projectId}.supabase.co/functions/v1/fetch-logs`);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

      const resp = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json();
      setLogs(result.logs ?? []);
      setFunctions(result.functions ?? []);
      setLastFetched(new Date());
      setSecondsUntilRefresh(60);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, [filterFn, filterLevel]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 60_000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Countdown ticker
  useEffect(() => {
    const ticker = setInterval(() => {
      setSecondsUntilRefresh((s) => (s <= 1 ? 60 : s - 1));
    }, 1000);
    return () => clearInterval(ticker);
  }, []);

  // Client-side filter on top of fetched data
  const keyword = search.trim().toLowerCase();
  const displayed = logs.filter((l) => {
    const fnMatch = filterFn === "all" || l.function === filterFn;
    const lvlMatch = filterLevel === "all" || l.level === filterLevel || (filterLevel === "error" && isErrorLike(l));
    const kwMatch = !keyword || l.message.toLowerCase().includes(keyword) || l.function.includes(keyword);
    return fnMatch && lvlMatch && kwMatch;
    return fnMatch && lvlMatch;
  });

  const errorCount = logs.filter((l) => l.level === "error").length;
  const warnCount = logs.filter((l) => l.level === "warn").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="heading-4 flex items-center gap-2">
            <ScrollText className="h-4 w-4" />
            Backend Function Logs
          </CardTitle>
          <CardDescription className="body-sm flex items-center gap-3 mt-1">
            {lastFetched
              ? `Last fetched ${lastFetched.toLocaleTimeString()} · refreshes in ${secondsUntilRefresh}s`
              : "Loading…"}
            {errorCount > 0 && (
              <Badge variant="destructive" className="text-xs px-1.5 py-0">{errorCount} error{errorCount > 1 ? "s" : ""}</Badge>
            )}
            {warnCount > 0 && (
              <Badge className="text-xs px-1.5 py-0 bg-yellow-400/15 text-yellow-400 border-yellow-400/30 hover:bg-yellow-400/20">{warnCount} warning{warnCount > 1 ? "s" : ""}</Badge>
            )}
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchLogs} disabled={loading} className="h-8 w-8 shrink-0">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search logs…"
              className="h-8 pl-8 pr-7 text-xs"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Select value={filterFn} onValueChange={setFilterFn}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="All functions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All functions</SelectItem>
              {functions.map((fn) => (
                <SelectItem key={fn} value={fn}>{fn}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterLevel} onValueChange={setFilterLevel}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="All levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="log">Log</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-xs text-muted-foreground self-center ml-auto">
            {displayed.length} {keyword ? `of ${logs.length} ` : ""}entries
          </span>
        </div>

        {/* Log list */}
        <div className="rounded-xl border border-border/40 overflow-hidden">
          {loading && displayed.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" /> Loading logs…
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground gap-2">
              <ScrollText className="h-6 w-6 opacity-40" />
              No log entries found
            </div>
          ) : (
            <div className="divide-y divide-border/30 max-h-[480px] overflow-y-auto">
              {displayed.map((entry, idx) => {
                const cfg = levelConfig(entry.level);
                const Icon = cfg.icon;
                const isExpanded = expandedIdx === idx;
                const isStructured = entry.message.startsWith("[");

                return (
                  <div
                    key={idx}
                    className={cn(
                      "px-3 py-2 text-xs font-mono transition-colors",
                      isExpanded ? "bg-muted/30" : "hover:bg-muted/20",
                      (entry.level === "error") && "bg-destructive/5 hover:bg-destructive/10",
                    )}
                  >
                    <div
                      className="flex items-start gap-2 cursor-pointer select-none"
                      onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                    >
                      <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", cfg.className.split(" ")[0])} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("px-1.5 py-0 rounded text-[10px] border font-sans", cfg.className)}>
                            {cfg.label}
                          </span>
                          <span className="text-muted-foreground/70 font-sans text-[10px] shrink-0">
                            {formatTimestamp(entry.timestamp)}
                          </span>
                          <span className="text-primary/70 font-sans text-[10px] shrink-0 truncate">
                            {entry.function}
                          </span>
                        </div>
                        <p className={cn(
                          "mt-1 break-all leading-relaxed",
                          isExpanded ? "whitespace-pre-wrap" : "truncate",
                          entry.level === "error" ? "text-destructive" : entry.level === "warn" ? "text-yellow-400" : "text-foreground/80"
                        )}>
                          {entry.message}
                        </p>
                      </div>
                      {entry.message.length > 80 && (
                        <span className="text-muted-foreground/50 shrink-0 mt-0.5">
                          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
