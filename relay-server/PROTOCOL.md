# Relay Message Protocol

All messages are JSON with this envelope:

```json
{ "type": "message_type", "data": { ... } }
```

## Connector → Relay

### `hello` (on connect)
```json
{
  "type": "hello",
  "data": {
    "device_id": "uuid",
    "token": "device-token",
    "meta": { "name": "My Server" }
  }
}
```

### `session_started` (ack after session_start)
```json
{
  "type": "session_started",
  "data": { "session_id": "uuid" }
}
```

### `stdout` (terminal output)
```json
{
  "type": "stdout",
  "data": { "session_id": "uuid", "data_b64": "base64-encoded-bytes" }
}
```

### `session_end` (session closed by connector)
```json
{
  "type": "session_end",
  "data": { "session_id": "uuid", "reason": "exit" }
}
```

## Relay → Connector

### `hello_ok`
```json
{ "type": "hello_ok" }
```

### `session_start`
```json
{
  "type": "session_start",
  "data": { "session_id": "uuid", "cols": 120, "rows": 40 }
}
```

### `stdin` (user input from browser)
```json
{
  "type": "stdin",
  "data": { "session_id": "uuid", "data_b64": "base64-encoded-bytes" }
}
```

### `resize`
```json
{
  "type": "resize",
  "data": { "session_id": "uuid", "cols": 120, "rows": 40 }
}
```

### `session_end` (browser disconnected)
```json
{
  "type": "session_end",
  "data": { "session_id": "uuid", "reason": "user_disconnect" }
}
```

## Browser → Relay

### `auth` (on connect)
```json
{
  "type": "auth",
  "data": {
    "token": "supabase-jwt",
    "session_id": "uuid",
    "device_id": "uuid"
  }
}
```

### `stdin`, `resize`, `session_end`
Same format as Relay → Connector (forwarded directly).

## Relay → Browser

### `auth_ok`
```json
{ "type": "auth_ok" }
```

### `stdout`, `session_end`, `error`
Same format as Connector → Relay (forwarded directly).

## HTTP Proxy

The relay provides an HTTP proxy endpoint for browsing localhost URLs on remote devices.

### Endpoint
```
GET/POST/... /proxy/:deviceId/:host/:port/path
```

Requires `Authorization: Bearer <supabase-jwt>` header.

### Relay → Connector: `http_request`
```json
{
  "type": "http_request",
  "data": {
    "request_id": "uuid",
    "method": "GET",
    "path": "/localhost:3000/api/data",
    "headers": { "accept": "text/html" },
    "body_b64": "optional-base64-body"
  }
}
```

### Connector → Relay: `http_response`
```json
{
  "type": "http_response",
  "data": {
    "request_id": "uuid",
    "status_code": 200,
    "headers": { "content-type": "text/html" },
    "body_b64": "base64-encoded-response-body"
  }
}
```

## WebSocket Proxy

The relay tunnels WebSocket connections from the browser to the remote device's localhost, enabling HMR/live-reload for dev servers.

### Endpoint (WS upgrade)
```
ws(s)://relay/ws-proxy/:deviceId/:host/:port/path?token=jwt
```

Auth is via `token` query parameter (since WS upgrades cannot use Authorization headers).

### Relay → Connector: `ws_open`
```json
{
  "type": "ws_open",
  "data": {
    "tunnel_id": "uuid",
    "url": "ws://localhost:3000/ws",
    "protocols": ["vite-hmr"]
  }
}
```

### Connector → Relay: `ws_opened`
```json
{
  "type": "ws_opened",
  "data": { "tunnel_id": "uuid" }
}
```

### Bidirectional: `ws_frame`
```json
{
  "type": "ws_frame",
  "data": {
    "tunnel_id": "uuid",
    "data_b64": "base64-encoded-frame",
    "binary": false
  }
}
```

### Either direction: `ws_close`
```json
{
  "type": "ws_close",
  "data": {
    "tunnel_id": "uuid",
    "code": 1000,
    "reason": "normal closure"
  }
}
```

### Connector → Relay: `ws_error`
```json
{
  "type": "ws_error",
  "data": {
    "tunnel_id": "uuid",
    "message": "connection refused"
  }
}
```
