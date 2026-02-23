# remote-relay

Enables secure remote communication between an OpenClaw instance and a relay server without exposing ports, requiring SSH, or relying on Telegram/Discord.

## Description

The `remote-relay` skill establishes a persistent outbound WebSocket connection to a relay server, allowing your local OpenClaw node to be remotely controlled. Incoming messages are routed to OpenClaw's prompt runner or command handler, and responses are streamed back in real time.

## Capabilities

| Capability | Description |
|---|---|
| `remote_chat` | Receive and execute prompts remotely, streaming tokens back |
| `remote_status` | Report node health (uptime, running tasks, last error) |
| `remote_restart` | Safely restart the OpenClaw process via relay command |
| `remote_trigger` | Execute OpenClaw workflows/tasks triggered remotely |

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
| `prompt` | Execute via OpenClaw prompt runner, stream response |
| `status` | Return node health payload |
| `restart` | Gracefully restart OpenClaw process |
| `workflow` | Execute an OpenClaw task/workflow |

### Outgoing (Node → Relay)

- **Heartbeat** (every 15s): `{ node_id, uptime, running_tasks, last_error }`
- **Response stream**: `{ type: "token", request_id, content }` per token
- **Response complete**: `{ type: "done", request_id }`
- **Status**: `{ type: "status", node_id, uptime, running_tasks, last_error }`

## Security

- All connections are **outbound only** — no ports exposed
- Every connection authenticated via `auth_token`
- Unknown message types are rejected and logged
- Auto-reconnect with exponential backoff on disconnection

## Installation

1. Add the skill to your OpenClaw instance
2. Configure `relay_url`, `node_id`, and `auth_token`
3. Start OpenClaw — the relay connection is established automatically
