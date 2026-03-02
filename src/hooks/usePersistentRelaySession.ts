/**
 * usePersistentRelaySession
 *
 * Maintains a SINGLE WebSocket + PTY session per device for the lifetime of
 * the chat view.  Every agent message reuses the same shell rather than
 * creating a brand-new session, so:
 *   - the working directory and shell state persist across messages
 *   - the Terminal page can join the exact same session at any time
 *   - the relay's 10-min grace period keeps it alive between messages
 */

import { useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "wss://relay.privaclaw.com";
const SILENCE_MS = 8000;
const RELAY_TIMEOUT_MS = 90000;
const PROMPT_RE = /(?:[%$#➜❯>]\s*$)|(?:\$\s+$)/m;
const PROMPT_TIMEOUT_MS = 8000;
const MAX_SUBSTANTIVE_WAITS = 8;

type Status = "idle" | "connecting" | "ready" | "busy" | "offline";

interface ActiveSession {
  ws: WebSocket;
  sessionId: string;
  deviceId: string;
  status: Status;
}

interface SendOptions {
  isOpenClaw?: boolean;
  onChunk?: (chunk: string) => void;
}

// Mirrors the session ID into the storage key that EmbeddedTerminal /
// TerminalSession.tsx both read, so they transparently resume this PTY.
function mirrorSessionId(deviceId: string, sessionId: string) {
  const key = `relay-session-${deviceId}`;
  sessionStorage.setItem(key, sessionId);
  localStorage.setItem(key, sessionId);
}

export function usePersistentRelaySession() {
  const sessionRef = useRef<ActiveSession | null>(null);
  // Queue: at most one pending command at a time (agent messages are sequential)
  const pendingRef = useRef<{
    command: string;
    opts: SendOptions;
    resolve: (v: string) => void;
    reject: (e: Error) => void;
  } | null>(null);

  // Buffer for the current command's stdout
  const outputBufferRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const substantiveWaitsRef = useRef(0);
  const promptSentRef = useRef(false);

  // ── Silence / finish helpers ─────────────────────────────────────────────
  const finishCommand = useCallback((result: string | Error) => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
    const pending = pendingRef.current;
    pendingRef.current = null;
    outputBufferRef.current = "";
    substantiveWaitsRef.current = 0;
    promptSentRef.current = false;

    if (sessionRef.current) sessionRef.current.status = "ready";

    if (pending) {
      if (result instanceof Error) pending.reject(result);
      else pending.resolve(result);
    }
  }, []);

  const resetSilence = useCallback((isOpenClaw: boolean) => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

    const buf = outputBufferRef.current;

    // Fast-finish on CLI error lines
    if (/^Error:/m.test(buf) || /^error:/im.test(buf)) {
      finishCommand(buf);
      return;
    }

    silenceTimerRef.current = setTimeout(() => {
      const currentBuf = outputBufferRef.current;

      if (isOpenClaw) {
        if (!currentBuf.includes("{")) {
          if (substantiveWaitsRef.current++ < MAX_SUBSTANTIVE_WAITS) { resetSilence(isOpenClaw); return; }
        }
        // Check if JSON is balanced
        const firstBrace = currentBuf.indexOf("{");
        let depth = 0, inStr = false, esc = false;
        for (let i = firstBrace; i < currentBuf.length; i++) {
          const c = currentBuf[i];
          if (esc) { esc = false; continue; }
          if (c === "\\" && inStr) { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === "{") depth++;
          else if (c === "}") { depth--; if (depth === 0) { finishCommand(currentBuf); return; } }
        }
        return; // JSON not yet complete — keep waiting
      }

      // Non-OpenClaw: wait for substantive content
      const stripped = currentBuf.replace(/\x1b[\s\S]{1,10}/g, "").replace(/[%$#>\[\]?;=\r\n\s]/g, "");
      if (stripped.length < 10) {
        if (substantiveWaitsRef.current++ < MAX_SUBSTANTIVE_WAITS) { resetSilence(isOpenClaw); return; }
      }

      finishCommand(currentBuf);
    }, SILENCE_MS);
  }, [finishCommand]);

  // ── Handle incoming stdout ────────────────────────────────────────────────
  const handleStdout = useCallback((data_b64: string) => {
    let chunk = "";
    try { chunk = decodeURIComponent(escape(atob(data_b64))); }
    catch { chunk = atob(data_b64); }

    outputBufferRef.current += chunk;
    pendingRef.current?.opts.onChunk?.(chunk);
    substantiveWaitsRef.current = 0;

    const pending = pendingRef.current;
    if (!pending) return;

    // If prompt hasn't been sent yet (very unusual for persistent session mid-flow), check now
    if (!promptSentRef.current) {
      const plain = outputBufferRef.current
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
        .replace(/\x1b[^[\]]/g, "").replace(/\x1b/g, "");
      if (PROMPT_RE.test(plain)) {
        promptSentRef.current = true;
        sendCurrentCommand();
      }
      return; // don't resetSilence until after prompt
    }

    resetSilence(!!pending.opts.isOpenClaw);
  }, [resetSilence]);

  // ── Send the buffered command into the open PTY ──────────────────────────
  const sendCurrentCommand = useCallback(() => {
    const pending = pendingRef.current;
    const sess = sessionRef.current;
    if (!pending || !sess || sess.ws.readyState !== WebSocket.OPEN) return;

    outputBufferRef.current = ""; // discard shell init / prompt noise
    sess.ws.send(JSON.stringify({
      type: "stdin",
      data: { session_id: sess.sessionId, data_b64: btoa(pending.command) },
    }));
    promptSentRef.current = true;
    resetSilence(!!pending.opts.isOpenClaw);
  }, [resetSilence]);

  // ── (Re-)connect to relay with an existing session ID ────────────────────
  const connectToSession = useCallback(async (deviceId: string, sessionId: string): Promise<boolean> => {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const jwt = authSession?.access_token;
    if (!jwt) return false;

    return new Promise((resolve) => {
      // Close any stale connection
      if (sessionRef.current?.ws.readyState === WebSocket.OPEN) {
        sessionRef.current.ws.close();
      }

      const ws = new WebSocket(`${RELAY_URL}/session`);
      const newSession: ActiveSession = { ws, sessionId, deviceId, status: "connecting" };
      sessionRef.current = newSession;

      const onAuthOk = () => {
        newSession.status = "ready";
        mirrorSessionId(deviceId, sessionId);
        // Attach stdout handler for live command streaming
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "stdout" && msg.data) {
              handleStdout((msg.data as { data_b64: string }).data_b64);
            } else if (msg.type === "session_end") {
              if (pendingRef.current) finishCommand(outputBufferRef.current || new Error("Session ended"));
              newSession.status = "offline";
              sessionRef.current = null;
            } else if (msg.type === "error") {
              const message = (msg.data as { message?: string })?.message ?? "Relay error";
              if (pendingRef.current) finishCommand(new Error(message));
            }
          } catch { /* ignore parse errors */ }
        };

        ws.onclose = () => {
          if (newSession.status !== "offline") {
            newSession.status = "offline";
            if (pendingRef.current) finishCommand(outputBufferRef.current || new Error("WebSocket closed"));
            sessionRef.current = null;
          }
        };

        resolve(true);
      };

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", data: { token: jwt, session_id: sessionId, device_id: deviceId } }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "auth_ok") {
            // Resume: just resize to announce ourselves (no session_start — PTY already exists)
            ws.send(JSON.stringify({ type: "resize", data: { session_id: sessionId, cols: 200, rows: 50 } }));
            onAuthOk();
          } else if (msg.type === "error") {
            ws.close();
            resolve(false);
          }
        } catch { resolve(false); }
      };

      ws.onerror = () => { ws.close(); resolve(false); };

      setTimeout(() => {
        if (newSession.status === "connecting") { ws.close(); resolve(false); }
      }, 10000);
    });
  }, [handleStdout, finishCommand]);

  // ── Create a brand-new session and connect ───────────────────────────────
  const createAndConnect = useCallback(async (deviceId: string): Promise<boolean> => {
    const { data: sesData, error: sesErr } = await supabase.functions.invoke("start-session", {
      body: { device_id: deviceId },
    });
    if (sesErr || !sesData?.session_id) return false;
    const sessionId: string = sesData.session_id;

    const { data: { session: authSession } } = await supabase.auth.getSession();
    const jwt = authSession?.access_token;
    if (!jwt) return false;

    return new Promise((resolve) => {
      const ws = new WebSocket(`${RELAY_URL}/session`);
      const newSession: ActiveSession = { ws, sessionId, deviceId, status: "connecting" };
      sessionRef.current = newSession;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", data: { token: jwt, session_id: sessionId, device_id: deviceId } }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "auth_ok") {
            // New session: send session_start and wait for first shell prompt
            ws.send(JSON.stringify({ type: "session_start", data: { session_id: sessionId, cols: 200, rows: 50 } }));

            // Wait for first shell prompt before declaring ready
            let promptBuffer = "";
            const promptTimeout = setTimeout(() => {
              // Give up waiting for prompt — declare ready anyway
              newSession.status = "ready";
              mirrorSessionId(deviceId, sessionId);
              attachMainHandlers(ws, newSession, sessionId, deviceId);
              resolve(true);
            }, PROMPT_TIMEOUT_MS);

            ws.onmessage = (ev) => {
              try {
                const m = JSON.parse(ev.data);
                if (m.type === "stdout" && m.data) {
                  let chunk = "";
                  try { chunk = decodeURIComponent(escape(atob((m.data as {data_b64:string}).data_b64))); }
                  catch { chunk = atob((m.data as {data_b64:string}).data_b64); }
                  promptBuffer += chunk;
                  const plain = promptBuffer
                    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
                    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "")
                    .replace(/\x1b[^[\]]/g, "").replace(/\x1b/g, "");
                  if (PROMPT_RE.test(plain)) {
                    clearTimeout(promptTimeout);
                    newSession.status = "ready";
                    mirrorSessionId(deviceId, sessionId);
                    attachMainHandlers(ws, newSession, sessionId, deviceId);
                    resolve(true);
                  }
                }
              } catch { /* ignore */ }
            };

            ws.onerror = () => { clearTimeout(promptTimeout); ws.close(); resolve(false); };
            ws.onclose = () => { clearTimeout(promptTimeout); resolve(false); };
          } else if (msg.type === "error") {
            ws.close();
            resolve(false);
          }
        } catch { resolve(false); }
      };

      ws.onerror = () => { ws.close(); resolve(false); };
      setTimeout(() => {
        if (newSession.status === "connecting") { ws.close(); resolve(false); }
      }, 20000);
    });
  }, [handleStdout, finishCommand]);

  const attachMainHandlers = useCallback((
    ws: WebSocket,
    sess: ActiveSession,
    sessionId: string,
    deviceId: string,
  ) => {
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "stdout" && msg.data) {
          handleStdout((msg.data as { data_b64: string }).data_b64);
        } else if (msg.type === "session_end") {
          if (pendingRef.current) finishCommand(outputBufferRef.current || new Error("Session ended"));
          sess.status = "offline";
          sessionRef.current = null;
        } else if (msg.type === "error") {
          const message = (msg.data as { message?: string })?.message ?? "Relay error";
          if (pendingRef.current) finishCommand(new Error(message));
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      if (sess.status !== "offline") {
        sess.status = "offline";
        if (pendingRef.current) finishCommand(outputBufferRef.current || new Error("WebSocket closed"));
        sessionRef.current = null;
      }
    };
  }, [handleStdout, finishCommand]);

  // ── Ensure we have a live session for deviceId ──────────────────────────
  const ensureSession = useCallback(async (deviceId: string): Promise<boolean> => {
    const sess = sessionRef.current;

    // Already connected to the right device and healthy
    if (sess && sess.deviceId === deviceId && sess.ws.readyState === WebSocket.OPEN && sess.status !== "offline") {
      return true;
    }

    // Try to resume from a persisted session ID
    const key = `relay-session-${deviceId}`;
    const persistedId = sessionStorage.getItem(key) ?? localStorage.getItem(key);

    if (persistedId) {
      // Verify it's still active in the DB
      const { data: existing } = await supabase.from("sessions").select("id, status").eq("id", persistedId).single();
      if (existing?.status === "active") {
        const ok = await connectToSession(deviceId, persistedId);
        if (ok) return true;
      }
    }

    // Also check for any active session for this device
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: activeSessions } = await supabase
        .from("sessions").select("id")
        .eq("device_id", deviceId).eq("user_id", user.id).eq("status", "active")
        .order("started_at", { ascending: false }).limit(1);
      if (activeSessions?.length) {
        const ok = await connectToSession(deviceId, activeSessions[0].id);
        if (ok) return true;
      }
    }

    // Create a fresh session
    return createAndConnect(deviceId);
  }, [connectToSession, createAndConnect]);

  // ── Public API: send a command, get back stdout ──────────────────────────
  const sendCommand = useCallback(async (
    deviceId: string,
    command: string,
    opts: SendOptions = {},
  ): Promise<string> => {
    if (!deviceId) throw new Error("No device selected");

    const ok = await ensureSession(deviceId);
    if (!ok) throw new Error("Could not establish relay session");

    const sess = sessionRef.current!;
    if (sess.status === "busy") throw new Error("Session is already busy");

    sess.status = "busy";
    outputBufferRef.current = "";
    promptSentRef.current = true; // persistent session is always at a prompt

    return new Promise<string>((resolve, reject) => {
      pendingRef.current = { command, opts, resolve, reject };

      // Hard timeout
      hardTimeoutRef.current = setTimeout(() => {
        finishCommand(new Error("Response timed out"));
      }, RELAY_TIMEOUT_MS);

      // Send immediately — the shell is already at a prompt
      sess.ws.send(JSON.stringify({
        type: "stdin",
        data: { session_id: sess.sessionId, data_b64: btoa(command) },
      }));

      resetSilence(!!opts.isOpenClaw);
    });
  }, [ensureSession, resetSilence, finishCommand]);

  // ── Expose session ID for the "Open Terminal" button ────────────────────
  const getSessionId = useCallback((): string | null => {
    return sessionRef.current?.sessionId ?? null;
  }, []);

  const getSessionStatus = useCallback((): Status => {
    return sessionRef.current?.status ?? "idle";
  }, []);

  // ── Inject raw stdin (for option buttons / Stop) ─────────────────────────
  const sendRawStdin = useCallback((sessionId: string, data_b64: string) => {
    const sess = sessionRef.current;
    if (!sess || sess.ws.readyState !== WebSocket.OPEN) return;
    sess.ws.send(JSON.stringify({ type: "stdin", data: { session_id: sessionId, data_b64 } }));
  }, []);

  // ── Disconnect / cleanup ─────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (hardTimeoutRef.current) clearTimeout(hardTimeoutRef.current);
    const sess = sessionRef.current;
    if (sess?.ws.readyState === WebSocket.OPEN) {
      sess.ws.close();
    }
    sessionRef.current = null;
  }, []);

  // Disconnect on unmount
  useEffect(() => () => { disconnect(); }, [disconnect]);

  return { sendCommand, sendRawStdin, getSessionId, getSessionStatus, disconnect };
}
