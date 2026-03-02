import "dotenv/config";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

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

// request_id → { resolve, reject, timer } for pending HTTP proxy requests
const pendingProxyRequests = new Map();
const PROXY_TIMEOUT_MS = 30000;

// tunnel_id → browser WebSocket for WS proxy tunnels
const wsTunnels = new Map();

// session_id → setTimeout handle (grace period before ending session in DB)
const sessionGraceTimers = new Map();
const SESSION_GRACE_MS = 600_000; // 10 minutes to reconnect before session is ended

// ─── HTTP Server ─────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  // CORS headers for all HTTP endpoints
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
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
      ws_tunnels: wsTunnels.size,
      memory_mb: Math.round(mem.rss / 1024 / 1024),
      version: "1.2.0",
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

  // ─── HTTP Proxy: /proxy/:deviceId/... ──────────────────────────────
  const proxyMatch = req.url.match(/^\/proxy\/([a-f0-9-]+)\/(.*)$/);
  if (proxyMatch) {
    const deviceId = proxyMatch[1];
    const targetPath = "/" + proxyMatch[2];

    // Authenticate: Authorization header OR ?token= query param (for sub-resources)
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const authHeader = req.headers.authorization;
    const queryToken = parsedUrl.searchParams.get("token");
    let token;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    } else if (queryToken) {
      token = queryToken;
    } else {
      res.writeHead(401, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ error: "Missing authorization" }));
      return;
    }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      res.writeHead(403, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ error: "Invalid token" }));
      return;
    }

    // Check connector is online
    const connectorWs = connectors.get(deviceId);
    if (!connectorWs || connectorWs.readyState !== 1) {
      res.writeHead(502, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ error: "Device connector offline" }));
      return;
    }

    // Read request body if present
    let bodyChunks = [];
    for await (const chunk of req) {
      bodyChunks.push(chunk);
    }
    const bodyBuffer = Buffer.concat(bodyChunks);
    const bodyB64 = bodyBuffer.length > 0 ? bodyBuffer.toString("base64") : undefined;

    // Build and send proxy request to connector
    const requestId = randomUUID();
    const proxyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingProxyRequests.delete(requestId);
        reject(new Error("Proxy timeout"));
      }, PROXY_TIMEOUT_MS);
      pendingProxyRequests.set(requestId, { resolve, reject, timer });
    });

    // Forward relevant headers (strip hop-by-hop)
    const forwardHeaders = {};
    for (const [key, val] of Object.entries(req.headers)) {
      if (!["host", "connection", "upgrade", "authorization", "transfer-encoding"].includes(key)) {
        forwardHeaders[key] = val;
      }
    }

    send(connectorWs, {
      type: "http_request",
      data: {
        request_id: requestId,
        method: req.method,
        path: targetPath,
        headers: forwardHeaders,
        body_b64: bodyB64,
      },
    });

    try {
      const proxyRes = await proxyPromise;
      const responseHeaders = { ...cors };
      if (proxyRes.headers) {
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (!["transfer-encoding", "connection"].includes(k.toLowerCase())) {
            responseHeaders[k] = v;
          }
        }
      }
      res.writeHead(proxyRes.status_code || 200, responseHeaders);
      if (proxyRes.body_b64) {
        res.end(Buffer.from(proxyRes.body_b64, "base64"));
      } else {
        res.end();
      }
    } catch (err) {
      res.writeHead(504, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ─── WebSocket Servers ───────────────────────────────────────────────
const connectorWSS = new WebSocketServer({ noServer: true });
const browserWSS = new WebSocketServer({ noServer: true });
const wsProxyWSS = new WebSocketServer({ noServer: true });

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
  } else if (url.pathname.startsWith("/ws-proxy/")) {
    // WebSocket proxy: /ws-proxy/:deviceId/:host/:port/path?token=jwt
    wsProxyWSS.handleUpgrade(req, socket, head, (ws) => {
      wsProxyWSS.emit("connection", ws, req);
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
        .select("id, device_token, name, workdir")
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
      send(ws, { type: "hello_ok", data: { workdir: device.workdir || "" } });
      return;
    }

    if (!authenticated) {
      return send(ws, { type: "error", data: { message: "Send hello first" } });
    }

    // ── Update heartbeat timestamp on any message from connector ──
    const meta = connectorMeta.get(deviceId);
    if (meta) meta.last_heartbeat = new Date().toISOString();

    // ── http_response from connector (proxy reply) ──
    if (msg.type === "http_response") {
      const requestId = msg.data?.request_id;
      const pending = pendingProxyRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingProxyRequests.delete(requestId);
        pending.resolve(msg.data);
      }
      return;
    }

    // ── ws_frame from connector → browser (WS proxy) ──
    if (msg.type === "ws_frame") {
      const tunnelId = msg.data?.tunnel_id;
      const tunnel = wsTunnels.get(tunnelId);
      if (tunnel?.readyState === WebSocket.OPEN) {
        if (msg.data.binary) {
          tunnel.send(Buffer.from(msg.data.data_b64, "base64"));
        } else {
          tunnel.send(Buffer.from(msg.data.data_b64, "base64").toString("utf-8"));
        }
      }
      return;
    }

    // ── ws_opened from connector (WS proxy tunnel confirmed) ──
    if (msg.type === "ws_opened") {
      const tunnelId = msg.data?.tunnel_id;
      console.log(`[ws-proxy] tunnel ${tunnelId?.slice(0, 8)} opened on connector`);
      return;
    }

    // ── ws_close from connector (remote WS closed) ──
    if (msg.type === "ws_close") {
      const tunnelId = msg.data?.tunnel_id;
      const tunnel = wsTunnels.get(tunnelId);
      if (tunnel) {
        console.log(`[ws-proxy] tunnel ${tunnelId?.slice(0, 8)} closed by connector`);
        tunnel.close(1000, msg.data?.reason || "remote closed");
        wsTunnels.delete(tunnelId);
      }
      return;
    }

    // ── ws_error from connector ──
    if (msg.type === "ws_error") {
      const tunnelId = msg.data?.tunnel_id;
      const tunnel = wsTunnels.get(tunnelId);
      if (tunnel) {
        console.log(`[ws-proxy] tunnel ${tunnelId?.slice(0, 8)} error: ${msg.data?.message}`);
        tunnel.close(1011, msg.data?.message || "remote error");
        wsTunnels.delete(tunnelId);
      }
      return;
    }

    // ── meta_update from connector — store in connectorMeta and fan-out to browsers ──
    if (msg.type === "meta_update") {
      const existingMeta = connectorMeta.get(deviceId) || {};
      connectorMeta.set(deviceId, { ...existingMeta, ...(msg.data || {}) });
      console.log(`[connector] ${deviceId.slice(0, 8)} meta_update:`, msg.data);
      // Broadcast to all browser sessions currently connected to this device
      for (const [, session] of browserSessions) {
        if (session.device_id === deviceId && session.browser?.readyState === 1) {
          send(session.browser, { type: "device_meta", data: { device_id: deviceId, ...(msg.data || {}) } });
        }
      }
      return;
    }

    // ── error from connector → browser (terminal session scoped) ──
    if (msg.type === "error") {
      const sessionId = msg.data?.session_id;
      const session = browserSessions.get(sessionId);
      if (session?.browser?.readyState === 1) {
        send(session.browser, msg);
      }
      return;
    }

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
      const endedAt = new Date().toISOString();
      for (const [sessionId, session] of browserSessions) {
        if (session.device_id === deviceId) {
          if (session.browser?.readyState === 1) {
            send(session.browser, {
              type: "session_end",
              data: { session_id: sessionId, reason: "connector_disconnected" },
            });
          }
          browserSessions.delete(sessionId);
          await saveRecording(sessionId);
        }
      }

      // Connector disconnect means PTYs are unavailable: hard-end device sessions in DB.
      await supabase
        .from("sessions")
        .update({ status: "ended", ended_at: endedAt })
        .eq("device_id", deviceId)
        .eq("status", "active");

      // Close all WS proxy tunnels for this device
      for (const [tunnelId, tunnel] of wsTunnels) {
        // We store device_id on the tunnel object
        if (tunnel._deviceId === deviceId) {
          tunnel.close(1001, "connector_disconnected");
          wsTunnels.delete(tunnelId);
        }
      }
    }
  });

  ws.on("error", (err) => console.error(`[connector] error:`, err.message));
});

// ─── WebSocket Proxy Connections ─────────────────────────────────────
wsProxyWSS.on("connection", async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Path: /ws-proxy/:deviceId/:hostPort/rest/of/path
  const pathParts = url.pathname.replace(/^\/ws-proxy\//, "").split("/");
  const deviceId = pathParts[0];
  const remaining = pathParts.slice(1).join("/");
  const token = url.searchParams.get("token");

  if (!token || !deviceId || !remaining) {
    ws.close(4000, "Missing token, deviceId, or target path");
    return;
  }

  // Authenticate JWT
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    ws.close(4001, "Invalid auth token");
    return;
  }

  // Check connector is online
  const connectorWs = connectors.get(deviceId);
  if (!connectorWs || connectorWs.readyState !== 1) {
    ws.close(4003, "Connector offline");
    return;
  }

  // Create tunnel
  const tunnelId = randomUUID();
  ws._deviceId = deviceId;
  wsTunnels.set(tunnelId, ws);

  // Construct the target local WebSocket URL
  // remaining = "localhost:3000/path" → ws://localhost:3000/path
  const targetUrl = `ws://${remaining}`;

  // Collect protocols from the browser WebSocket request
  const protocols = req.headers["sec-websocket-protocol"] || "";

  console.log(`[ws-proxy] tunnel ${tunnelId.slice(0, 8)}: ${user.email} → ${deviceId.slice(0, 8)} → ${targetUrl}`);

  // Tell connector to open a local WebSocket
  send(connectorWs, {
    type: "ws_open",
    data: {
      tunnel_id: tunnelId,
      url: targetUrl,
      protocols: protocols ? protocols.split(",").map(s => s.trim()) : [],
    },
  });

  // Forward browser → connector frames
  ws.on("message", (data, isBinary) => {
    const cws = connectors.get(deviceId);
    if (cws?.readyState === 1) {
      const payload = {
        tunnel_id: tunnelId,
        data_b64: Buffer.from(data).toString("base64"),
        binary: isBinary,
      };
      send(cws, { type: "ws_frame", data: payload });
    }
  });

  ws.on("close", (code, reason) => {
    wsTunnels.delete(tunnelId);
    const cws = connectors.get(deviceId);
    if (cws?.readyState === 1) {
      send(cws, {
        type: "ws_close",
        data: { tunnel_id: tunnelId, code, reason: reason?.toString() || "" },
      });
    }
    console.log(`[ws-proxy] tunnel ${tunnelId.slice(0, 8)} browser closed`);
  });

  ws.on("error", (err) => {
    console.error(`[ws-proxy] tunnel ${tunnelId.slice(0, 8)} error:`, err.message);
  });
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

      // Canonicalize device_id from the session record (don't trust client-provided value)
      const canonicalDeviceId = session.device_id;
      if (device_id !== canonicalDeviceId) {
        console.warn(`[browser] session ${session_id.slice(0, 8)} device_id mismatch: client=${device_id?.slice(0, 8)} db=${canonicalDeviceId?.slice(0, 8)} — using DB value`);
      }

      // Check connector is online using the canonical device_id from DB
      const connectorWs = connectors.get(canonicalDeviceId);
      if (!connectorWs || connectorWs.readyState !== 1) {
        console.warn(`[browser] connector offline for device ${canonicalDeviceId?.slice(0, 8)} (session ${session_id.slice(0, 8)})`);
        send(ws, { type: "error", data: { message: "Device connector is not online" } });
        ws.close(4003, "Connector offline");
        return;
      }

      sessionId = session_id;
      deviceId = canonicalDeviceId;
      authenticated = true;
      browserSessions.set(session_id, { browser: ws, device_id: canonicalDeviceId });

      // Cancel any pending grace-period timer for this session (iOS app-switch reconnect)
      const graceTimer = sessionGraceTimers.get(session_id);
      if (graceTimer) {
        clearTimeout(graceTimer);
        sessionGraceTimers.delete(session_id);
        console.log(`[browser] session ${session_id.slice(0, 8)} resumed within grace period`);
      }

      // Initialize recording buffer
      if (!sessionRecordings.has(session_id)) {
        sessionRecordings.set(session_id, {
          frames: [],
          startedAt: Date.now(),
          sizeBytes: 0,
        });
      }

      console.log(`[browser] auth_ok session ${session_id.slice(0, 8)} → device ${canonicalDeviceId.slice(0, 8)} (client sent ${device_id?.slice(0, 8)})`);

      // Send scrollback buffer if there's existing output for this session
      const existingRec = sessionRecordings.get(session_id);
      if (existingRec && existingRec.frames.length > 0) {
        console.log(`[browser] replaying ${existingRec.frames.length} scrollback frames for session ${session_id.slice(0, 8)}`);
        send(ws, {
          type: "scrollback",
          data: { frames: existingRec.frames },
        });
      }

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
      console.log(`[browser] session ${sessionId.slice(0, 8)} disconnected — grace period ${SESSION_GRACE_MS / 1000}s`);
      browserSessions.delete(sessionId);

      // Give the browser (especially iOS) a grace window to reconnect before ending the session
      const timer = setTimeout(async () => {
        sessionGraceTimers.delete(sessionId);
        console.log(`[browser] session ${sessionId.slice(0, 8)} grace expired — ending`);

        // Notify connector the session is over
        const connectorWs = connectors.get(deviceId);
        if (connectorWs?.readyState === 1) {
          send(connectorWs, {
            type: "session_end",
            data: { session_id: sessionId, reason: "browser_disconnected" },
          });
        }

        await saveRecording(sessionId);

        // Update DB
        await supabase
          .from("sessions")
          .update({ status: "ended", ended_at: new Date().toISOString() })
          .eq("id", sessionId);
      }, SESSION_GRACE_MS);

      sessionGraceTimers.set(sessionId, timer);
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
  console.log(`[relay] HTTP proxy:         http://localhost:${PORT}/proxy/:deviceId/...`);
  console.log(`[relay] WS proxy:           ws://localhost:${PORT}/ws-proxy/:deviceId/...`);
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
  for (const [id, tunnel] of wsTunnels) {
    tunnel.close(1001, "Server shutting down");
  }
  server.close(() => process.exit(0));
});
