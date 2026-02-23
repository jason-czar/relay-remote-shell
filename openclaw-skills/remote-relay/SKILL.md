# remote-relay

Enables secure remote communication between an OpenClaw instance and a relay server without exposing ports, requiring SSH, or relying on Telegram/Discord.

## Description

The `remote-relay` skill registers your local OpenClaw instance as a **managed remote node** on a relay network. Once connected, the node can receive prompts, execute workflows, report health, and be restarted — all through a secure, outbound-only WebSocket channel.

This skill replaces external messaging-based control layers such as Telegram or Discord with a native, secure relay channel for OpenClaw interaction.

## Node Lifecycle

When the skill is enabled, the OpenClaw instance registers as a remote-capable node with the relay and maintains an active session.

The node can be in one of three states:

| State | Description |
|---|---|
| **Online** | Authenticated and accepting relay commands |
| **Reconnecting** | Connection lost; auto-reconnecting with exponential backoff |
| **Offline** | Skill disabled or relay unreachable after max retries |

Relay commands are only accepted while the node is **authenticated and online**. Commands received during reconnection are discarded by the relay.

## Capabilities

| Capability | Description |
|---|---|
| `remote_chat` | Receive and execute prompts remotely, streaming tokens back in real time |
| `remote_status` | Report node health: uptime, active tasks, last error, connection state |
| `remote_restart` | Safely restart the OpenClaw process without manual intervention. Pending executions are cancelled and reported before restart occurs. |
| `remote_trigger` | Execute OpenClaw workflows/tasks triggered remotely |

Remote commands are limited to declared capabilities and cannot execute arbitrary system-level operations.

## Configuration

| Key | Required | Description |
|---|---|---|
| `relay_url` | ✅ | WebSocket URL of the relay server |
| `node_id` | ✅ | Unique identifier for this OpenClaw node |
| `auth_token` | ✅ | Secret token for authenticating with the relay |

## Message Protocol

### Incoming (Relay → Node)

| `type` | Action |
|---|---|
| `prompt` | Execute via OpenClaw prompt runner, stream response tokens back |
| `status` | Return node health payload |
| `restart` | Cancel pending tasks, report them, then gracefully restart |
| `workflow` | Execute a named OpenClaw task/workflow |

### Outgoing (Node → Relay)

- **Heartbeat** (every 15s):
  ```json
  { "node_id": "...", "uptime": 3600, "active_tasks": 2, "last_error": null, "connection_state": "online" }
  ```
- **Response stream**: `{ "type": "token", "request_id": "...", "content": "..." }` per token
- **Response complete**: `{ "type": "done", "request_id": "..." }`
- **Status**: Full heartbeat payload with `request_id`

## Security

All connections are **outbound only** — the node never exposes ports or accepts inbound traffic.

- Every connection is authenticated via `auth_token`
- Unknown message types are rejected and logged
- Auto-reconnect with exponential backoff on disconnection
- Connection loss does not interrupt local execution — the node continues processing independently
- Remote control resumes automatically after reconnect
- Remote actions are **capability-scoped** and cannot execute arbitrary system-level operations

## Operational Guarantees

- **Local AI execution continues** even if the relay disconnects
- **Relay does not expose the node** to inbound traffic
- **Remote actions are capability-scoped** — only declared capabilities can be invoked
- **Pending tasks are reported** before any restart occurs — no silent failures

## Installation

1. Add the skill to your OpenClaw instance
2. Configure `relay_url`, `node_id`, and `auth_token`
3. Start OpenClaw — the relay connection is established automatically

## Intended Use

This skill replaces external messaging-based control layers such as Telegram or Discord with a native, secure relay channel for OpenClaw interaction. It is designed for teams and individuals who need reliable remote access to their OpenClaw nodes without exposing infrastructure.
