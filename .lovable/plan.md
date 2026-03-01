
## Plan: Production-Grade One-Liner Installer

### Two files to change

---

**1. `supabase/functions/download-connector/index.ts`**

Add a new `?install=full` branch at line 577 (before the existing `?install=1` check). The new branch serves a single bash script that does everything:

```
if (url.searchParams.get("install") === "full") {
  const SUPABASE_URL = ...
  const baseUrl = `${SUPABASE_URL}/storage/v1/object/public/connector-binaries`;
  const apiUrl = `${SUPABASE_URL}/functions/v1`;
  return fullInstallScript
}
```

The script content:

```bash
#!/bin/bash
set -e

PAIR_CODE="$1"
API_URL="https://psmglvwvoygaadjajvoq.supabase.co/functions/v1"
BASE_URL="https://psmglvwvoygaadjajvoq.supabase.co/storage/v1/object/public/connector-binaries"

if [ -z "$PAIR_CODE" ]; then
  echo "❌ Usage: curl ... | bash -s -- YOUR_PAIR_CODE"
  exit 1
fi

# Detect OS/arch
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$OS" in
  linux)  PLATFORM="linux" ;;
  darwin) PLATFORM="darwin" ;;
  *) echo "❌ Unsupported OS: $OS"; exit 1 ;;
esac
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "❌ Unsupported architecture: $ARCH"; exit 1 ;;
esac

DEST_DIR="$HOME/relay-connector"
BINARY_PATH="$DEST_DIR/relay-connector"
BINARY_NAME="relay-connector-${PLATFORM}-${ARCH}"
BINARY_URL="${BASE_URL}/${BINARY_NAME}"

echo "📦 Installing PrivaClaw Connector (${PLATFORM}/${ARCH})..."
mkdir -p "$DEST_DIR"

HTTP_CODE=$(curl -sL -w "%{http_code}" -o "$BINARY_PATH" "$BINARY_URL")
if [ "$HTTP_CODE" != "200" ]; then
  rm -f "$BINARY_PATH"
  echo "❌ Download failed (HTTP $HTTP_CODE). Binary may not be available for ${PLATFORM}/${ARCH}."
  exit 1
fi
chmod +x "$BINARY_PATH"

# Resolve absolute path (POSIX-safe, no realpath dependency)
FULL_BINARY="$(cd "$(dirname "$BINARY_PATH")"; pwd)/$(basename "$BINARY_PATH")"

# Pair device (idempotent — skip if already paired)
CONFIG="$HOME/.relay-connector.json"
if [ -f "$CONFIG" ] && grep -q '"device_id"' "$CONFIG" 2>/dev/null; then
  echo "ℹ️  Already paired — skipping pairing step"
else
  echo "🔗 Pairing device..."
  "$FULL_BINARY" --pair "$PAIR_CODE" --api "$API_URL" --name "$(hostname)"
fi

# Ensure log directory exists
mkdir -p "$DEST_DIR"
FULL_LOG="$DEST_DIR/relay.log"

# Register service
if [ "$PLATFORM" = "darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.privaclaw.connector.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  
  cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.privaclaw.connector</string>
  <key>ProgramArguments</key>
  <array>
    <string>${FULL_BINARY}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${FULL_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${FULL_LOG}</string>
</dict>
</plist>
EOF

  USER_ID=$(id -u)
  # Only bootout if already registered (prevents noise on fresh install)
  launchctl print "gui/$USER_ID" 2>/dev/null | grep -q "com.privaclaw.connector" && \
    launchctl bootout "gui/$USER_ID" "$PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$USER_ID" "$PLIST"
  launchctl enable "gui/$USER_ID/com.privaclaw.connector"
  launchctl kickstart -k "gui/$USER_ID/com.privaclaw.connector"

elif [ "$PLATFORM" = "linux" ]; then
  SERVICE_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SERVICE_DIR"
  
  cat > "$SERVICE_DIR/privaclaw-connector.service" << EOF
[Unit]
Description=PrivaClaw Connector
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${FULL_BINARY}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

  # Enable linger so service persists across logout
  loginctl enable-linger "$USER" 2>/dev/null || true
  systemctl --user daemon-reload
  systemctl --user enable privaclaw-connector
  systemctl --user start privaclaw-connector
fi

echo ""
echo "✅ PrivaClaw installed and running!"
echo "   Connector auto-starts on login."
```

---

**2. `src/components/SetupWizard.tsx`**

Replace lines 82–86 (the three `cmd1`/`cmd2`/`cmd3` variables) with a single `cmdFull`:

```typescript
const cmdFull = device?.pairing_code
  ? `curl -fsSL "${API_URL}/download-connector?install=full" | bash -s -- "${device.pairing_code}"`
  : "";
```

Replace lines 162–202 (step 2 command block) with:
- Updated subtitle: `"One command — installs, pairs, and registers as a background service."`
- Single command block with label `"Run this on your machine"` and copy button
- Keep the Gatekeeper note and status polling unchanged

No database changes, no new secrets, no RLS changes needed.
