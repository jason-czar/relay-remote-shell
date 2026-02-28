import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AgentModel } from "@/pages/Chat";

// Commands that list available models for each agent CLI
const LIST_COMMANDS: Record<string, string> = {
  codex: "codex models\n",
  claude: "claude models --json 2>/dev/null || claude --list-models 2>/dev/null\n",
  openclaw: "openclaw models 2>/dev/null || openclaw --list-models 2>/dev/null\n",
};

// Per-agent parsers — return [] if nothing useful found
function parseModels(agent: string, raw: string): AgentModel[] {
  // Strip ANSI escape sequences
  const clean = raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");

  if (agent === "codex") {
    // "codex models" outputs lines like:  gpt-5.3-codex   Latest Codex model
    const models: AgentModel[] = [];
    for (const line of clean.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.toLowerCase().includes("available")) continue;
      // Match: model-id   optional description
      const match = t.match(/^([\w.\-]+)\s*(.*)?$/);
      if (match && match[1].length > 2 && !match[1].startsWith("$") && !match[1].startsWith(">")) {
        models.push({ id: match[1], label: match[1], description: (match[2] ?? "").trim() });
      }
    }
    return models;
  }

  if (agent === "claude" || agent === "openclaw") {
    // Try JSON first (claude models --json)
    try {
      const jsonMatch = clean.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const arr = JSON.parse(jsonMatch[0]) as Array<{ id?: string; name?: string; description?: string }>;
        if (Array.isArray(arr) && arr.length) {
          return arr
            .filter((m) => m.id || m.name)
            .map((m) => ({
              id: m.id ?? m.name ?? "",
              label: m.id ?? m.name ?? "",
              description: m.description ?? "",
            }));
        }
      }
    } catch { /* fall through to line parsing */ }

    // Fallback: one model per line
    const models: AgentModel[] = [];
    for (const line of clean.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("$") || t.startsWith(">")) continue;
      if (t.toLowerCase().includes("error") || t.toLowerCase().includes("command not found")) break;
      const match = t.match(/^(claude[\w.\-]+|openclaw[\w.\-]*)\b/i);
      if (match) {
        models.push({ id: match[1], label: match[1], description: "" });
      }
    }
    return models;
  }

  return [];
}

interface UseDeviceModelsResult {
  models: AgentModel[] | null; // null = not yet fetched
  loading: boolean;
  error: string | null;
  fetch: (deviceId: string, agent: string) => Promise<void>;
}

const MEM_CACHE = new Map<string, AgentModel[]>();

const LS_PREFIX = "device_models:";

function lsRead(key: string): AgentModel[] | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const { models, ts } = JSON.parse(raw) as { models: AgentModel[]; ts: number };
    // Expire after 24h
    if (Date.now() - ts > 86_400_000) { localStorage.removeItem(LS_PREFIX + key); return null; }
    return models;
  } catch { return null; }
}

function lsWrite(key: string, models: AgentModel[]) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify({ models, ts: Date.now() })); } catch { /* quota */ }
}

export function useDeviceModels(): UseDeviceModelsResult {
  const [models, setModels] = useState<AgentModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (deviceId: string, agent: string) => {
    if (agent === "terminal") return;

    const cacheKey = `${deviceId}:${agent}`;

    // 1. In-memory cache (instant)
    if (MEM_CACHE.has(cacheKey)) {
      setModels(MEM_CACHE.get(cacheKey)!);
      return;
    }

    // 2. localStorage cache (available immediately, triggers background refresh)
    const persisted = lsRead(cacheKey);
    if (persisted) {
      MEM_CACHE.set(cacheKey, persisted);
      setModels(persisted);
      return;
    }

    const cmd = LIST_COMMANDS[agent];
    if (!cmd) return;

    setLoading(true);
    setError(null);
    setModels(null);

    try {
      // 1. Start a session on the device
      const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", {
        body: { device_id: deviceId },
      });
      if (sesErr || !sesData?.session_id) throw new Error(sesErr?.message ?? "Could not start session");

      const sessionId: string = sesData.session_id;
      const relayUrl = import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com";
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const jwt = authSession?.access_token;
      if (!jwt) throw new Error("Not authenticated");

      // 2. Connect and run the list-models command
      const raw = await new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`${relayUrl}/session`);
        let buf = "";
        let done = false;
        let silenceTimer: ReturnType<typeof setTimeout> | null = null;
        let promptSent = false;

        const finish = (val: string) => {
          if (done) return;
          done = true;
          if (silenceTimer) clearTimeout(silenceTimer);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "session_end", data: { session_id: sessionId, reason: "done" } }));
            ws.close();
          }
          supabase.functions.invoke("end-session", { body: { session_id: sessionId } }).catch(() => {});
          resolve(val);
        };

        const resetSilence = () => {
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => finish(buf), 4000);
        };

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, token: jwt } }));
        };

        ws.onerror = () => reject(new Error("WebSocket error"));
        ws.onclose = () => { if (!done) finish(buf); };

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data));
            if (msg.type === "stdout") {
              buf += msg.data ?? "";
              resetSilence();
              // Wait for a shell prompt before sending command
              if (!promptSent && /[%$#>→➜❯]\s*$/.test(buf.trimEnd())) {
                promptSent = true;
                buf = ""; // clear init noise
                ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data: cmd } }));
                resetSilence();
              }
            }
          } catch { /* ignore */ }
        };

        // Timeout after 15s
        setTimeout(() => { if (!done) reject(new Error("Timed out waiting for model list")); }, 15000);
      });

      // 3. Parse
      const parsed = parseModels(agent, raw);
      if (parsed.length === 0) throw new Error("No models found in output");

      MEM_CACHE.set(cacheKey, parsed);
      lsWrite(cacheKey, parsed);
      setModels(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { models, loading, error, fetch };
}

/** Invalidate the cache for a device+agent so next open re-fetches */
export function invalidateDeviceModelCache(deviceId: string, agent: string) {
  const key = `${deviceId}:${agent}`;
  MEM_CACHE.delete(key);
  try { localStorage.removeItem("device_models:" + key); } catch { /* ignore */ }
}
