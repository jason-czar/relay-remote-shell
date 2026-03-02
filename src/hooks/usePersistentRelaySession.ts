/**
 * usePersistentRelaySession
 *
 * Reuses the same PTY session ID across all messages in a conversation.
 * Each command gets its own short-lived WebSocket (how the relay works),
 * but they all share the same session_id → same PTY process → shell state
 * (CWD, env vars) persists between messages.
 *
 * The session ID is mirrored to localStorage so clicking "Open Terminal"
 * resumes the exact same PTY the chat has been using.
 */

import { useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com";
const SILENCE_MS = 8000;
const RELAY_TIMEOUT_MS = 90000;
const PROMPT_RE = /(?:[%$#➜❯>]\s*$)|(?:\$\s+$)/m;
const PROMPT_TIMEOUT_MS = 8000;
const MAX_SUBSTANTIVE_WAITS = 8;
// Matches when the agent is waiting for user input (approval prompts)
const AWAITING_INPUT_RE = /\b(yes|no|approve|deny|allow|reject|y\/n|proceed|confirm)\b.*[?:]\s*$|>\s*$/im;
// How long to keep the WS open while waiting for user to click Approve/Deny (5 min)
const AWAIT_INPUT_HOLD_MS = 5 * 60 * 1000;

type SessionStatus = "idle" | "ready" | "busy" | "offline";

interface SendOptions {
  isOpenClaw?: boolean;
  onChunk?: (chunk: string) => void;
}

function mirrorSessionId(deviceId: string, sessionId: string) {
  const key = `relay-session-${deviceId}`;
  sessionStorage.setItem(key, sessionId);
  localStorage.setItem(key, sessionId);
}

function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
    .replace(/\x1b[^[\]]/g, "")
    .replace(/\x1b/g, "");
}

export function usePersistentRelaySession() {
  // The logical session — just a session ID + device; no persistent WS
  const sessionIdRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  // Active WS for the current in-flight command (for Ctrl+C / option inject)
  const activeWsRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<SessionStatus>("idle");

  // Silence-detection state for the current command
  const outputBufferRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const substantiveWaitsRef = useRef(0);
  const isOpenClawRef = useRef(false);
  const onChunkRef = useRef<((chunk: string) => void) | null>(null);
  const finishRef = useRef<((result: string | Error) => void) | null>(null);

  const resetSilence = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    const buf = outputBufferRef.current;
    if (/^Error:/m.test(buf) || /^error:/im.test(buf)) { finishRef.current?.(buf); return; }

    // Detect if the agent is waiting for user input (Approve/Deny style prompts).
    // If so, hold the WS open much longer so the user has time to click a button.
    const stripped = stripAnsi(buf);
    const isAwaitingInput = AWAITING_INPUT_RE.test(stripped);
    const delay = isAwaitingInput ? AWAIT_INPUT_HOLD_MS : SILENCE_MS;

    silenceTimerRef.current = setTimeout(() => {
      const cur = outputBufferRef.current;
      if (isOpenClawRef.current) {
        if (!cur.includes("{")) {
          if (substantiveWaitsRef.current++ < MAX_SUBSTANTIVE_WAITS) { resetSilence(); return; }
        }
        const fb = cur.indexOf("{");
        let depth = 0, inStr = false, esc = false;
        for (let i = fb; i < cur.length; i++) {
          const c = cur[i];
          if (esc) { esc = false; continue; }
          if (c === "\\" && inStr) { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === "{") depth++;
          else if (c === "}") { depth--; if (depth === 0) { finishRef.current?.(cur); return; } }
        }
        return;
      }
      const s = cur.replace(/\x1b[\s\S]{1,10}/g, "").replace(/[%$#>\[\]?;=\r\n\s]/g, "");
      if (s.length < 10) {
        if (substantiveWaitsRef.current++ < MAX_SUBSTANTIVE_WAITS) { resetSilence(); return; }
      }
      finishRef.current?.(cur);
    }, delay);
  }, []);

  // ── Ensure we have a session ID for this device ──────────────────────────
  const ensureSessionId = useCallback(async (deviceId: string): Promise<string | null> => {
    // Reuse existing session for same device
    if (sessionIdRef.current && deviceIdRef.current === deviceId) {
      // Verify it's still active in DB
      const { data } = await supabase.from("sessions").select("id, status")
        .eq("id", sessionIdRef.current).single();
      if (data?.status === "active") return sessionIdRef.current;
      // Session ended — fall through to find/create a new one
      sessionIdRef.current = null;
    }

    // Try any active session for this device
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: active } = await supabase.from("sessions").select("id")
        .eq("device_id", deviceId).eq("user_id", user.id).eq("status", "active")
        .order("started_at", { ascending: false }).limit(1);
      if (active?.length) {
        sessionIdRef.current = active[0].id;
        deviceIdRef.current = deviceId;
        mirrorSessionId(deviceId, active[0].id);
        return active[0].id;
      }
    }

    // Create a fresh session
    const { data: sesData, error } = await supabase.functions.invoke("start-session", {
      body: { device_id: deviceId },
    });
    if (error || !sesData?.session_id) return null;
    sessionIdRef.current = sesData.session_id;
    deviceIdRef.current = deviceId;
    mirrorSessionId(deviceId, sesData.session_id);
    return sesData.session_id;
  }, []);

  // ── Run one command over a fresh WS, resuming the existing PTY ───────────
  const runCommand = useCallback(async (
    deviceId: string,
    sessionId: string,
    command: string,
    opts: SendOptions,
    isResume: boolean,
  ): Promise<string> => {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const jwt = authSession?.access_token;
    if (!jwt) throw new Error("No auth session");

    return new Promise<string>((resolve, reject) => {
      outputBufferRef.current = "";
      substantiveWaitsRef.current = 0;
      isOpenClawRef.current = !!opts.isOpenClaw;
      onChunkRef.current = opts.onChunk ?? null;
      statusRef.current = "busy";

      let settled = false;
      const finish = (result: string | Error) => {
        if (settled) return;
        settled = true;
        finishRef.current = null;
        if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
        // Close WS WITHOUT sending session_end so PTY stays alive in the relay
        if (ws.readyState === WebSocket.OPEN) ws.close();
        activeWsRef.current = null;
        statusRef.current = "ready";
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      finishRef.current = finish;
      hardTimeoutRef.current = setTimeout(() => finish(new Error("Response timed out")), RELAY_TIMEOUT_MS);

      const ws = new WebSocket(`${RELAY_URL}/session`);
      activeWsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", data: { token: jwt, session_id: sessionId, device_id: deviceId } }));
      };

      let commandSent = false;
      let promptBuffer = "";

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "auth_ok") {
            if (isResume) {
              // Resume: send resize to attach to the existing PTY
              ws.send(JSON.stringify({ type: "resize", data: { session_id: sessionId, cols: 200, rows: 50 } }));
            } else {
              // New session: start the PTY
              ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: 200, rows: 50 } }));
            }

            // Wait for shell prompt before sending command
            const promptDeadline = setTimeout(() => {
              if (!commandSent) {
                commandSent = true;
                outputBufferRef.current = "";
                ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(command) } }));
                resetSilence();
              }
            }, PROMPT_TIMEOUT_MS);

            const tryPrompt = () => {
              if (commandSent) return;
              const plain = stripAnsi(promptBuffer);
              if (PROMPT_RE.test(plain)) {
                clearTimeout(promptDeadline);
                commandSent = true;
                outputBufferRef.current = "";
                ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64: btoa(command) } }));
                resetSilence();
              }
            };

            // Patch onmessage to run prompt check on every stdout chunk
            const base = ws.onmessage;
            ws.onmessage = (ev) => {
              base?.call(ws, ev);
              if (!commandSent) tryPrompt();
            };

          } else if (msg.type === "stdout" && msg.data) {
            const { data_b64 } = msg.data as { data_b64: string };
            if (!data_b64) return;
            let chunk = "";
            try { chunk = decodeURIComponent(escape(atob(data_b64))); } catch { chunk = atob(data_b64); }

            if (!commandSent) {
              promptBuffer += chunk;
            } else {
              outputBufferRef.current += chunk;
              onChunkRef.current?.(chunk);
              substantiveWaitsRef.current = 0;
              resetSilence();
            }
          } else if (msg.type === "scrollback") {
            // Scrollback on resume — add to prompt buffer so prompt detection works
            const d = (msg.data ?? {}) as { data_b64?: string; frames?: { d: string }[] };
            if (d.data_b64) {
              try { promptBuffer += decodeURIComponent(escape(atob(d.data_b64))); } catch { promptBuffer += atob(d.data_b64 ?? ""); }
            }
          } else if (msg.type === "session_end") {
            // PTY ended — next command needs a fresh session
            sessionIdRef.current = null;
            finish(outputBufferRef.current || new Error("Session ended by relay"));
          } else if (msg.type === "error") {
            const message = (msg.data as { message?: string })?.message ?? "Relay error";
            // If relay says session not found on resume, try fresh session next time
            if (isResume && /not found|unknown session/i.test(message)) {
              sessionIdRef.current = null;
            }
            finish(new Error(message));
          }
        } catch { /* ignore */ }
      };

      ws.onerror = () => {};
      ws.onclose = (e) => {
        if (!settled) finish(outputBufferRef.current || new Error(`WebSocket closed (code ${e.code})`));
      };
    });
  }, [resetSilence]);

  // ── Public: send a command ───────────────────────────────────────────────
  const sendCommand = useCallback(async (
    deviceId: string,
    command: string,
    opts: SendOptions = {},
  ): Promise<string> => {
    if (!deviceId) throw new Error("No device selected");

    const prevSessionId = sessionIdRef.current;
    const sessionId = await ensureSessionId(deviceId);
    if (!sessionId) throw new Error("Could not establish relay session");

    // isResume = we reused an existing active session (not just created one)
    const isResume = prevSessionId === sessionId;

    return runCommand(deviceId, sessionId, command, opts, isResume);
  }, [ensureSessionId, runCommand]);

  // ── Expose session info ──────────────────────────────────────────────────
  const getSessionId = useCallback((): string | null => sessionIdRef.current, []);
  const getSessionStatus = useCallback((): SessionStatus => statusRef.current, []);

  // ── Inject raw stdin (Stop / option buttons) ─────────────────────────────
  // If the active WS is still open (agent is mid-stream waiting), inject directly.
  // If it was already closed (silence timer fired early), open a short-lived WS
  // just to resume the PTY and inject the keystroke, then leave it open so the
  // agent's response can be streamed back through the existing runCommand promise
  // (which is already resolved) — the new WS just delivers the input.
  const sendRawStdin = useCallback(async (sessionId: string, data_b64: string) => {
    const ws = activeWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64 } }));
      return;
    }

    // Fallback: open a transient WS to deliver the keystroke to the live PTY.
    // We need the device id for auth.
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const jwt = authSession?.access_token;
    if (!jwt) return;

    const fallbackWs = new WebSocket(`${RELAY_URL}/session`);
    activeWsRef.current = fallbackWs;

    fallbackWs.onopen = () => {
      fallbackWs.send(JSON.stringify({ type: "auth", data: { token: jwt, session_id: sessionId, device_id: deviceId } }));
    };

    fallbackWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "auth_ok") {
          // Resume the existing PTY
          fallbackWs.send(JSON.stringify({ type: "resize", data: { session_id: sessionId, cols: 200, rows: 50 } }));
          // Small delay for PTY attach, then send the keystroke
          setTimeout(() => {
            fallbackWs.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64 } }));
          }, 150);
        } else if (msg.type === "stdout" && msg.data) {
          // Route output back through the normal chunk handler so the chat updates
          const { data_b64: b64 } = msg.data as { data_b64: string };
          if (!b64) return;
          let chunk = "";
          try { chunk = decodeURIComponent(escape(atob(b64))); } catch { chunk = atob(b64); }
          outputBufferRef.current += chunk;
          onChunkRef.current?.(chunk);
          substantiveWaitsRef.current = 0;
          resetSilence();
        } else if (msg.type === "session_end") {
          sessionIdRef.current = null;
          fallbackWs.close();
          activeWsRef.current = null;
        }
      } catch { /* ignore */ }
    };

    fallbackWs.onerror = () => { fallbackWs.close(); activeWsRef.current = null; };
    fallbackWs.onclose = () => { if (activeWsRef.current === fallbackWs) activeWsRef.current = null; };
  }, [resetSilence]);

  // ── Reset on device switch ───────────────────────────────────────────────
  const disconnect = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (hardTimeoutRef.current) clearTimeout(hardTimeoutRef.current);
    if (activeWsRef.current?.readyState === WebSocket.OPEN) activeWsRef.current.close();
    activeWsRef.current = null;
    sessionIdRef.current = null;
    deviceIdRef.current = null;
    statusRef.current = "idle";
  }, []);

  useEffect(() => () => { disconnect(); }, [disconnect]);

  return { sendCommand, sendRawStdin, getSessionId, getSessionStatus, disconnect };
}
