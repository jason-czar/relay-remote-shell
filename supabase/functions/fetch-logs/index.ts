import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const FUNCTIONS = [
  "start-session",
  "end-session",
  "pair-device",
  "relay-health",
  "relay-nodes",
  "generate-title",
  "download-connector",
  "invite-member",
  "delete-account",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Require auth
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const functionName = url.searchParams.get("function");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
  const level = url.searchParams.get("level"); // "error" | "warn" | "info" | null (all)

  const projectRef = Deno.env.get("SUPABASE_URL")!
    .replace("https://", "")
    .replace(".supabase.co", "");

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Fetch logs from Supabase Management API
  const functionsToFetch = functionName && FUNCTIONS.includes(functionName)
    ? [functionName]
    : FUNCTIONS;

  const results = await Promise.allSettled(
    functionsToFetch.map(async (fn) => {
      const logsUrl = `https://api.supabase.com/v1/projects/${projectRef}/functions/${fn}/logs?limit=${limit}`;
      const resp = await fetch(logsUrl, {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
      });
      if (!resp.ok) {
        return { function: fn, logs: [] };
      }
      const data = await resp.json();
      const logs = (data.logs ?? data ?? []).map((entry: any) => ({
        function: fn,
        timestamp: entry.timestamp,
        level: entry.level ?? "log",
        event_type: entry.event_type,
        message: entry.event_message ?? entry.message ?? "",
      }));
      return { function: fn, logs };
    })
  );

  // Flatten and sort all logs
  const allLogs: any[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allLogs.push(...result.value.logs);
    }
  }

  // Filter by level if requested
  const filtered = level
    ? allLogs.filter((l) => l.level === level || l.message.toLowerCase().includes(level))
    : allLogs;

  // Sort by timestamp descending
  filtered.sort((a, b) => {
    const ta = typeof a.timestamp === "number" ? a.timestamp : new Date(a.timestamp).getTime();
    const tb = typeof b.timestamp === "number" ? b.timestamp : new Date(b.timestamp).getTime();
    return tb - ta;
  });

  return json({
    logs: filtered.slice(0, limit),
    functions: FUNCTIONS,
    total: filtered.length,
  });
});
