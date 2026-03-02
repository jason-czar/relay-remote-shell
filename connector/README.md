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
  --pair <code>          Pairing code from the web UI (pairs device, then exits)
  --name <name>          Device name (optional, used during pairing)
  --api <url>            Edge Function base URL (required for pairing)
  --config <path>        Config file path (default: ~/.relay-connector.json)
  --shell <path>         Shell to spawn (default: $SHELL or /bin/sh)
  --workdir <path>       Working directory for sessions (default: home directory)
  --install-agent        Register binary as a background service and start it
  --uninstall-agent      Stop and remove the background service
  --status               Print service install/running status
  --update               Download latest binary, replace self on disk, re-register service
  --self-update-check    Check whether a newer binary is available without downloading
```

## Shell Compatibility

The connector auto-detects your shell family and applies the appropriate launch flags. At startup it runs a quick **shell probe** (`echo ok`) and warns loudly in logs if the shell fails to respond.

| Shell family | Examples | Launch strategy |
|---|---|---|
| **bash / zsh** | `/bin/bash`, `/bin/zsh` | `-lic exec <shell>` — login + interactive, sources profiles |
| **POSIX sh** | `/bin/sh`, `/bin/dash`, `/bin/ash`, `ksh`, `mksh` | `-i` — interactive only |
| **fish** | `/usr/bin/fish` | `--login --interactive` |
| **PowerShell** | `pwsh`, `powershell.exe` | `-NoExit -Interactive` |

### Overriding the shell

Pass `--shell` to force a specific shell when the default is wrong or unsupported:

```bash
# Use bash explicitly (e.g. on systems where $SHELL is set to fish but you want bash)
./relay-connector --shell /bin/bash

# Use zsh
./relay-connector --shell /usr/bin/zsh

# Windows: use PowerShell Core
.\relay-connector.exe --shell "C:\Program Files\PowerShell\7\pwsh.exe"
```

### Per-OS recommendations

| OS | Recommended `--shell` value | Notes |
|---|---|---|
| **macOS** | `/bin/zsh` (default on macOS 10.15+) | `/bin/bash` works too; avoid `/bin/sh` for interactive use |
| **Ubuntu / Debian** | `/bin/bash` | `/bin/dash` is the default `sh` but lacks interactive features |
| **Alpine / BusyBox** | `/bin/sh` or `/bin/bash` (if installed) | BusyBox `ash` uses `-i` strategy; install bash for full compatibility |
| **Arch / Fedora** | `/bin/bash` or `/usr/bin/zsh` | |
| **Windows (WSL)** | `/bin/bash` inside WSL | Run the Linux connector build inside WSL |
| **Windows (native)** | `pwsh.exe` or `powershell.exe` | PowerShell Core (`pwsh`) recommended over Windows PowerShell |

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
