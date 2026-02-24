import "dotenv/config";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { createClient } from "@supabase/supabase-js";

const PORT = parseInt(process.env.PORT || "8080");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const startedAt = Date.now();

// ─── State ───────────────────────────────────────────────────────────
// device_id → connector WebSocket
const connectors = new Map();
// device_id → { connected_at, last_heartbeat, meta }
const connectorMeta = new Map();
// session_id → { browser: ws, device_id: string }
const browserSessions = new Map();
// session_id → { frames: [{t, d}], startedAt: number }
const sessionRecordings = new Map();
const MAX_RECORDING_BYTES = 5 * 1024 * 1024; // 5MB limit per session

// ─── HTTP Server ─────────────────────────────────────────────────────
const server = createServer((req, res) => {
  // CORS headers for all HTTP endpoints
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.url === "/health") {
    const mem = process.memoryUsage();
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({
      status: "ok",
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      connectors: connectors.size,
      sessions: browserSessions.size,
      memory_mb: Math.round(mem.rss / 1024 / 1024),
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  if (req.url === "/nodes") {
    const nodes = [];
    for (const [deviceId, meta] of connectorMeta) {
      const ws = connectors.get(deviceId);
      nodes.push({
        device_id: deviceId,
        name: meta.name || deviceId.slice(0, 8),
        kind: meta.kind || "connector",
        connected_at: meta.connected_at,
        last_heartbeat: meta.last_heartbeat,
        online: !!ws && ws.readyState === 1,
      });
    }
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ nodes }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ─── WebSocket Servers ───────────────────────────────────────────────
const connectorWSS = new WebSocketServer({ noServer: true });
const browserWSS = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/connect") {
    connectorWSS.handleUpgrade(req, socket, head, (ws) => {
      connectorWSS.emit("connection", ws, req);
    });
  } else if (url.pathname === "/session") {
    browserWSS.handleUpgrade(req, socket, head, (ws) => {
      browserWSS.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// ─── Connector Connections ───────────────────────────────────────────
connectorWSS.on("connection", (ws) => {
  let deviceId = null;
  let authenticated = false;
  const heartbeat = setInterval(() => ws.ping(), 25000);

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "error", data: { message: "Invalid JSON" } });
    }

    // ── hello ──
    if (msg.type === "hello" && !authenticated) {
      const { device_id, token, meta } = msg.data || {};
      if (!device_id || !token) {
        return send(ws, { type: "error", data: { message: "Missing device_id or token" } });
      }

      // Validate device token
      const { data: device, error } = await supabase
        .from("devices")
        .select("id, device_token, name")
        .eq("id", device_id)
        .eq("paired", true)
        .single();

      if (error || !device || device.device_token !== token) {
        send(ws, { type: "error", data: { message: "Authentication failed" } });
        ws.close(4001, "Auth failed");
        return;
      }

      // Mark device online
      await supabase
        .from("devices")
        .update({ status: "online", last_seen: new Date().toISOString() })
        .eq("id", device_id);

      deviceId = device_id;
      authenticated = true;
      connectors.set(device_id, ws);
      connectorMeta.set(device_id, {
        name: meta?.name || device.name,
        kind: meta?.kind || "connector",
        connected_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
      });

      console.log(`[connector] ${device_id} online (${meta?.name || device.name})`);
      send(ws, { type: "hello_ok" });
      return;
    }

    if (!authenticated) {
      return send(ws, { type: "error", data: { message: "Send hello first" } });
    }

    // ── Update heartbeat timestamp on any message from connector ──
    const meta = connectorMeta.get(deviceId);
    if (meta) meta.last_heartbeat = new Date().toISOString();

    // ── Forwarded messages from connector → browser ──
    if (msg.type === "stdout" || msg.type === "session_started" || msg.type === "session_end") {
      const sessionId = msg.data?.session_id;
      const session = browserSessions.get(sessionId);
      if (session?.browser?.readyState === 1) {
        send(session.browser, msg);
      }

      // ── Record stdout frames ──
      if (msg.type === "stdout" && sessionId && msg.data?.data_b64) {
        const rec = sessionRecordings.get(sessionId);
        if (rec && rec.sizeBytes < MAX_RECORDING_BYTES) {
          const frame = { t: Date.now() - rec.startedAt, d: msg.data.data_b64 };
          const frameSize = msg.data.data_b64.length;
          rec.frames.push(frame);
          rec.sizeBytes += frameSize;
        }
      }

      // If session ended, clean up and save recording
      if (msg.type === "session_end" && sessionId) {
        browserSessions.delete(sessionId);
        await saveRecording(sessionId);
        // Update DB
        await supabase
          .from("sessions")
          .update({ status: "ended", ended_at: new Date().toISOString() })
          .eq("id", sessionId);
      }
    }
  });

  ws.on("close", async () => {
    clearInterval(heartbeat);
    if (deviceId) {
      connectors.delete(deviceId);
      connectorMeta.delete(deviceId);
      console.log(`[connector] ${deviceId} offline`);

      // Mark device offline
      await supabase
        .from("devices")
        .update({ status: "offline", last_seen: new Date().toISOString() })
        .eq("id", deviceId);

      // End all active sessions for this device
      for (const [sessionId, session] of browserSessions) {
        if (session.device_id === deviceId) {
          if (session.browser?.readyState === 1) {
            send(session.browser, {
              type: "session_end",
              data: { session_id: sessionId, reason: "connector_disconnected" },
            });
          }
          browserSessions.delete(sessionId);
        }
      }
    }
  });

  ws.on("error", (err) => console.error(`[connector] error:`, err.message));
});

// ─── Browser Connections ─────────────────────────────────────────────
browserWSS.on("connection", (ws) => {
  let authenticated = false;
  let sessionId = null;
  let deviceId = null;
  const heartbeat = setInterval(() => ws.ping(), 25000);

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "error", data: { message: "Invalid JSON" } });
    }

    // ── auth ──
    if (msg.type === "auth" && !authenticated) {
      const { token, session_id, device_id } = msg.data || {};
      if (!token || !session_id || !device_id) {
        return send(ws, { type: "error", data: { message: "Missing token, session_id, or device_id" } });
      }

      // Validate Supabase JWT
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        send(ws, { type: "error", data: { message: "Invalid auth token" } });
        ws.close(4001, "Auth failed");
        return;
      }

      // Validate session belongs to user
      const { data: session, error: sesErr } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", session_id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

      if (sesErr || !session) {
        send(ws, { type: "error", data: { message: "Session not found or unauthorized" } });
        ws.close(4002, "Session invalid");
        return;
      }

      // Check connector is online
      const connectorWs = connectors.get(device_id);
      if (!connectorWs || connectorWs.readyState !== 1) {
        send(ws, { type: "error", data: { message: "Device connector is not online" } });
        ws.close(4003, "Connector offline");
        return;
      }

      sessionId = session_id;
      deviceId = device_id;
      authenticated = true;
      browserSessions.set(session_id, { browser: ws, device_id });

      // Initialize recording buffer
      if (!sessionRecordings.has(session_id)) {
        sessionRecordings.set(session_id, {
          frames: [],
          startedAt: Date.now(),
          sizeBytes: 0,
        });
      }

      console.log(`[browser] session ${session_id.slice(0, 8)} → device ${device_id.slice(0, 8)}`);
      send(ws, { type: "auth_ok" });
      return;
    }

    if (!authenticated) {
      return send(ws, { type: "error", data: { message: "Send auth first" } });
    }

    // ── Forwarded messages from browser → connector ──
    if (msg.type === "session_start" || msg.type === "stdin" || msg.type === "resize" || msg.type === "session_end") {
      const connectorWs = connectors.get(deviceId);
      if (connectorWs?.readyState === 1) {
        send(connectorWs, msg);
      } else {
        send(ws, { type: "error", data: { message: "Connector disconnected" } });
      }

      if (msg.type === "session_end") {
        browserSessions.delete(sessionId);
      }
    }
  });

  ws.on("close", async () => {
    clearInterval(heartbeat);
    if (sessionId && deviceId) {
      console.log(`[browser] session ${sessionId.slice(0, 8)} disconnected`);

      // Notify connector
      const connectorWs = connectors.get(deviceId);
      if (connectorWs?.readyState === 1) {
        send(connectorWs, {
          type: "session_end",
          data: { session_id: sessionId, reason: "browser_disconnected" },
        });
      }

      browserSessions.delete(sessionId);
      await saveRecording(sessionId);

      // Update DB
      await supabase
        .from("sessions")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", sessionId);
    }
  });

  ws.on("error", (err) => console.error(`[browser] error:`, err.message));
});

// ─── Helpers ─────────────────────────────────────────────────────────
function send(ws, msg) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

async function saveRecording(sessionId) {
  const rec = sessionRecordings.get(sessionId);
  if (!rec || rec.frames.length === 0) {
    sessionRecordings.delete(sessionId);
    return;
  }

  const durationMs = rec.frames.length > 0
    ? rec.frames[rec.frames.length - 1].t
    : 0;

  try {
    const { error } = await supabase
      .from("session_recordings")
      .upsert({
        session_id: sessionId,
        frames: rec.frames,
        frame_count: rec.frames.length,
        size_bytes: rec.sizeBytes,
        duration_ms: durationMs,
      }, { onConflict: "session_id" });

    if (error) {
      console.error(`[recording] failed to save ${sessionId.slice(0, 8)}:`, error.message);
    } else {
      console.log(`[recording] saved ${sessionId.slice(0, 8)}: ${rec.frames.length} frames, ${Math.round(rec.sizeBytes / 1024)}KB, ${Math.round(durationMs / 1000)}s`);
    }
  } catch (err) {
    console.error(`[recording] error saving ${sessionId.slice(0, 8)}:`, err.message);
  }

  sessionRecordings.delete(sessionId);
}

// ─── Start ───────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[relay] listening on port ${PORT}`);
  console.log(`[relay] connector endpoint: ws://localhost:${PORT}/connect`);
  console.log(`[relay] browser endpoint:   ws://localhost:${PORT}/session`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[relay] shutting down...");
  for (const [id, ws] of connectors) {
    ws.close(1001, "Server shutting down");
  }
  for (const [id, session] of browserSessions) {
    session.browser?.close(1001, "Server shutting down");
  }
  server.close(() => process.exit(0));
});
