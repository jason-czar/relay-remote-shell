import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RelayHealthStatus = "checking" | "healthy" | "degraded" | "unreachable";

export interface RelayHealth {
  status: RelayHealthStatus;
  connectors: number;
  sessions: number;
  uptime: number | null;
  memory: number | null;
  lastChecked: Date | null;
  error: string | null;
}

const POLL_INTERVAL = 30_000; // 30 seconds

export function useRelayHealth(enabled = true) {
  const [health, setHealth] = useState<RelayHealth>({
    status: "checking",
    connectors: 0,
    sessions: 0,
    uptime: null,
    memory: null,
    lastChecked: null,
    error: null,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const check = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const { data, error } = await supabase.functions.invoke("relay-health");
      if (!mountedRef.current) return;
      if (error) throw error;

      const isUnreachable = data?.status === "unreachable" || !data;
      setHealth({
        status: isUnreachable
          ? "unreachable"
          : data.connectors === 0
          ? "degraded"
          : "healthy",
        connectors: data?.connectors ?? 0,
        sessions: data?.sessions ?? 0,
        uptime: data?.uptime ?? null,
        memory: data?.memory ?? null,
        lastChecked: new Date(),
        error: isUnreachable ? (data?.error ?? "Relay unreachable") : null,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setHealth((prev) => ({
        ...prev,
        status: "unreachable",
        lastChecked: new Date(),
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    check();
    timerRef.current = setInterval(check, POLL_INTERVAL);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled, check]);

  return { health, refresh: check };
}
