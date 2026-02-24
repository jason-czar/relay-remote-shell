# PrivaClaw — Go Connector

A lightweight agent that runs on your local machine or server, pairing it with the PrivaClaw web app and spawning PTY shell sessions on demand.

## Prerequisites

- Go 1.22+
- A device registered in the web app with a pairing code

## Quick Start

```bash
cd connector
go mod tidy

# Step 1: Pair with your device using the code from the web UI
go run . --pair ABCD1234 \
         --api https://psmglvwvoygaadjajvoq.supabase.co/functions/v1 \
         --name "My Server"

# Step 2: Connect to the relay (uses saved config)
go run .
```

## Build

```bash
go build -o relay-connector .
```

## Usage

```
relay-connector [flags]

Flags:
  --pair <code>     Pairing code from the web UI (pairs device, then exits)
  --name <name>     Device name (optional, used during pairing)
  --api <url>       Edge Function base URL (required for pairing)
  --config <path>   Config file path (default: ~/.relay-connector.json)
  --shell <path>    Shell to spawn (default: $SHELL or /bin/sh)
  --workdir <path>  Working directory for sessions (default: home directory)
```

## How It Works

1. **Pairing**: The connector calls the `pair-device` edge function with the one-time code displayed in the web UI. It receives a device ID, auth token, and relay WebSocket URL, saved to `~/.relay-connector.json`.

2. **Connecting**: On subsequent runs, the connector reads its config and connects to the relay server via WebSocket, sending a `hello` message with its credentials.

3. **Sessions**: When a user opens a terminal in the browser, the relay sends a `session_start` message. The connector spawns a PTY shell and bridges stdin/stdout over the WebSocket using base64-encoded messages.

4. **Lifecycle**: Sessions end when the user disconnects or the shell process exits. The connector supports multiple concurrent sessions.

## Configuration File

Stored at `~/.relay-connector.json` (permissions: 0600):

```json
{
  "device_id": "uuid",
  "token": "device-auth-token",
  "relay_url": "wss://your-relay.fly.dev"
}
```

## Cross-Compilation

```bash
# Linux (amd64)
GOOS=linux GOARCH=amd64 go build -o relay-connector-linux .

# macOS (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o relay-connector-mac .

# Windows
GOOS=windows GOARCH=amd64 go build -o relay-connector.exe .
```
