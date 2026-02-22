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
