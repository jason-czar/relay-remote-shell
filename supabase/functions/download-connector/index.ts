import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GO_MOD = `module github.com/relay-terminal/connector

go 1.22

require (
\tgithub.com/creack/pty v1.1.21
\tgithub.com/gorilla/websocket v1.5.3
)
`;

const MAIN_GO = `package main

import (
\t"bytes"
\t"encoding/json"
\t"flag"
\t"fmt"
\t"log"
\t"net/http"
\t"os"
\t"os/signal"
\t"path/filepath"
\t"syscall"
\t"time"
)

// Config holds the connector's persistent configuration.
type Config struct {
\tDeviceID string \`json:"device_id"\`
\tToken    string \`json:"token"\`
\tRelayURL string \`json:"relay_url"\`
}

func main() {
\tpairingCode := flag.String("pair", "", "Pairing code from the web UI")
\tname := flag.String("name", "", "Device name (optional, used during pairing)")
\tapiURL := flag.String("api", "", "Supabase Edge Function base URL")
\tconfigPath := flag.String("config", defaultConfigPath(), "Path to config file")
\tshell := flag.String("shell", defaultShell(), "Shell to spawn (default: $SHELL or /bin/sh)")
\tflag.Parse()

\tif *pairingCode != "" {
\t\tif *apiURL == "" {
\t\t\tlog.Fatal("--api is required when pairing")
\t\t}
\t\tcfg, err := pairDevice(*apiURL, *pairingCode, *name)
\t\tif err != nil {
\t\t\tlog.Fatalf("Pairing failed: %v", err)
\t\t}
\t\tif err := saveConfig(*configPath, cfg); err != nil {
\t\t\tlog.Fatalf("Failed to save config: %v", err)
\t\t}
\t\tfmt.Printf("✓ Paired successfully! Device ID: %s\\n", cfg.DeviceID)
\t\tfmt.Printf("  Config saved to: %s\\n", *configPath)
\t\tfmt.Println("\\nRun again without --pair to connect.")
\t\treturn
\t}

\tcfg, err := loadConfig(*configPath)
\tif err != nil {
\t\tlog.Fatalf("No config found at %s. Run with --pair <code> first.\\n", *configPath)
\t}

\tfmt.Printf("Connecting to relay: %s\\n", cfg.RelayURL)
\tfmt.Printf("Device ID: %s\\n", cfg.DeviceID)
\tfmt.Printf("Shell: %s\\n", *shell)

\tsigCh := make(chan os.Signal, 1)
\tsignal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

\tconst (
\t\tinitialDelay = 1 * time.Second
\t\tmaxDelay     = 30 * time.Second
\t)
\tdelay := initialDelay

\tfor {
\t\tclient := NewRelayClient(cfg, *shell)

\t\tgo func() {
\t\t\tselect {
\t\t\tcase <-sigCh:
\t\t\t\tfmt.Println("\\nShutting down...")
\t\t\t\tclient.Close()
\t\t\t\tos.Exit(0)
\t\t\tcase <-client.done:
\t\t\t}
\t\t}()

\t\terr := client.Run()
\t\tif err == nil {
\t\t\treturn
\t\t}

\t\tlog.Printf("Connection lost: %v", err)
\t\tlog.Printf("Reconnecting in %s...", delay)
\t\ttime.Sleep(delay)

\t\tdelay = delay * 2
\t\tif delay > maxDelay {
\t\t\tdelay = maxDelay
\t\t}
\t}
}

func pairDevice(apiURL, code, name string) (*Config, error) {
\tbody := map[string]string{"pairing_code": code}
\tif name != "" {
\t\tbody["name"] = name
\t}
\tjsonBody, _ := json.Marshal(body)
\tresp, err := http.Post(apiURL+"/pair-device", "application/json", bytes.NewReader(jsonBody))
\tif err != nil {
\t\treturn nil, fmt.Errorf("request failed: %w", err)
\t}
\tdefer resp.Body.Close()

\tvar result struct {
\t\tDeviceID string \`json:"device_id"\`
\t\tToken    string \`json:"token"\`
\t\tRelayURL string \`json:"relay_url"\`
\t\tError    string \`json:"error"\`
\t}
\tif err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
\t\treturn nil, fmt.Errorf("invalid response: %w", err)
\t}
\tif result.Error != "" {
\t\treturn nil, fmt.Errorf("server error: %s", result.Error)
\t}
\tif result.DeviceID == "" || result.Token == "" || result.RelayURL == "" {
\t\treturn nil, fmt.Errorf("incomplete response from server")
\t}
\treturn &Config{DeviceID: result.DeviceID, Token: result.Token, RelayURL: result.RelayURL}, nil
}

func defaultConfigPath() string {
\thome, _ := os.UserHomeDir()
\treturn filepath.Join(home, ".relay-connector.json")
}

func defaultShell() string {
\tif s := os.Getenv("SHELL"); s != "" {
\t\treturn s
\t}
\treturn "/bin/sh"
}

func saveConfig(path string, cfg *Config) error {
\tdata, _ := json.MarshalIndent(cfg, "", "  ")
\treturn os.WriteFile(path, data, 0600)
}

func loadConfig(path string) (*Config, error) {
\tdata, err := os.ReadFile(path)
\tif err != nil {
\t\treturn nil, err
\t}
\tvar cfg Config
\tif err := json.Unmarshal(data, &cfg); err != nil {
\t\treturn nil, err
\t}
\treturn &cfg, nil
}
`;

const CLIENT_GO = `package main

import (
\t"encoding/base64"
\t"encoding/json"
\t"fmt"
\t"log"
\t"net/http"
\t"os"
\t"os/exec"
\t"strings"
\t"sync"
\t"syscall"
\t"time"

\t"github.com/creack/pty"
\t"github.com/gorilla/websocket"
)

type Message struct {
\tType string          \`json:"type"\`
\tData json.RawMessage \`json:"data,omitempty"\`
}

type SessionStartData struct {
\tSessionID string \`json:"session_id"\`
\tCols      int    \`json:"cols"\`
\tRows      int    \`json:"rows"\`
}

type StdinData struct {
\tSessionID string \`json:"session_id"\`
\tDataB64   string \`json:"data_b64"\`
}

type ResizeData struct {
\tSessionID string \`json:"session_id"\`
\tCols      int    \`json:"cols"\`
\tRows      int    \`json:"rows"\`
}

type SessionEndData struct {
\tSessionID string \`json:"session_id"\`
\tReason    string \`json:"reason"\`
}

type RelayClient struct {
\tconfig        *Config
\tshell         string
\tconn          *websocket.Conn
\tsessions      map[string]*PTYSession
\tmu            sync.Mutex
\tdone          chan struct{}
\tauthenticated bool
}

type PTYSession struct {
\tid   string
\tptmx *os.File
\tcmd  *exec.Cmd
\tdone chan struct{}
}

func NewRelayClient(cfg *Config, shell string) *RelayClient {
\treturn &RelayClient{
\t\tconfig:   cfg,
\t\tshell:    shell,
\t\tsessions: make(map[string]*PTYSession),
\t\tdone:     make(chan struct{}),
\t}
}

func (c *RelayClient) Run() error {
\trelayURL := strings.TrimRight(c.config.RelayURL, "/")
\trelayURL = strings.Replace(relayURL, "https://", "wss://", 1)
\trelayURL = strings.Replace(relayURL, "http://", "ws://", 1)
\tconnectURL := relayURL + "/connect"
\tlog.Printf("Connecting to %s", connectURL)

\theader := http.Header{}
\tconn, _, err := websocket.DefaultDialer.Dial(connectURL, header)
\tif err != nil {
\t\treturn fmt.Errorf("websocket dial failed: %w", err)
\t}
\tc.conn = conn
\tdefer conn.Close()

\thelloData, _ := json.Marshal(map[string]interface{}{
\t\t"device_id": c.config.DeviceID,
\t\t"token":     c.config.Token,
\t\t"meta":      map[string]string{"name": "connector"},
\t})
\tc.sendMessage("hello", helloData)

\tfor {
\t\tselect {
\t\tcase <-c.done:
\t\t\treturn nil
\t\tdefault:
\t\t}

\t\t_, raw, err := conn.ReadMessage()
\t\tif err != nil {
\t\t\tselect {
\t\t\tcase <-c.done:
\t\t\t\treturn nil
\t\t\tdefault:
\t\t\t\treturn fmt.Errorf("read error: %w", err)
\t\t\t}
\t\t}

\t\tvar msg Message
\t\tif err := json.Unmarshal(raw, &msg); err != nil {
\t\t\tlog.Printf("Invalid message: %v", err)
\t\t\tcontinue
\t\t}

\t\tc.handleMessage(msg)
\t}
}

func (c *RelayClient) Close() {
\tselect {
\tcase <-c.done:
\t\treturn
\tdefault:
\t\tclose(c.done)
\t}

\tc.mu.Lock()
\tdefer c.mu.Unlock()

\tfor id, sess := range c.sessions {
\t\tc.cleanupSession(id, sess)
\t}

\tif c.conn != nil {
\t\tc.conn.WriteMessage(
\t\t\twebsocket.CloseMessage,
\t\t\twebsocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
\t\t)
\t\tc.conn.Close()
\t}
}

func (c *RelayClient) handleMessage(msg Message) {
\tswitch msg.Type {
\tcase "hello_ok":
\t\tlog.Println("✓ Authenticated with relay")
\t\tc.authenticated = true

\tcase "session_start":
\t\tvar data SessionStartData
\t\tif err := json.Unmarshal(msg.Data, &data); err != nil {
\t\t\tlog.Printf("Invalid session_start: %v", err)
\t\t\treturn
\t\t}
\t\tc.startSession(data)

\tcase "stdin":
\t\tvar data StdinData
\t\tif err := json.Unmarshal(msg.Data, &data); err != nil {
\t\t\tlog.Printf("Invalid stdin: %v", err)
\t\t\treturn
\t\t}
\t\tc.handleStdin(data)

\tcase "resize":
\t\tvar data ResizeData
\t\tif err := json.Unmarshal(msg.Data, &data); err != nil {
\t\t\tlog.Printf("Invalid resize: %v", err)
\t\t\treturn
\t\t}
\t\tc.handleResize(data)

\tcase "session_end":
\t\tvar data SessionEndData
\t\tif err := json.Unmarshal(msg.Data, &data); err != nil {
\t\t\tlog.Printf("Invalid session_end: %v", err)
\t\t\treturn
\t\t}
\t\tc.endSession(data.SessionID, data.Reason)

\tcase "error":
\t\tlog.Printf("Relay error: %s", string(msg.Data))

\tdefault:
\t\tlog.Printf("Unknown message type: %s", msg.Type)
\t}
}

func (c *RelayClient) startSession(data SessionStartData) {
\tlog.Printf("Starting session %s (%dx%d)", data.SessionID, data.Cols, data.Rows)

\tcmd := exec.Command(c.shell)
\tcmd.Env = append(os.Environ(), "TERM=xterm-256color")

\twinSize := &pty.Winsize{
\t\tCols: uint16(data.Cols),
\t\tRows: uint16(data.Rows),
\t}

\tptmx, err := pty.StartWithSize(cmd, winSize)
\tif err != nil {
\t\tlog.Printf("Failed to start PTY: %v", err)
\t\tendData, _ := json.Marshal(map[string]string{
\t\t\t"session_id": data.SessionID,
\t\t\t"reason":     "pty_error",
\t\t})
\t\tc.sendMessage("session_end", endData)
\t\treturn
\t}

\tsess := &PTYSession{
\t\tid:   data.SessionID,
\t\tptmx: ptmx,
\t\tcmd:  cmd,
\t\tdone: make(chan struct{}),
\t}

\tc.mu.Lock()
\tc.sessions[data.SessionID] = sess
\tc.mu.Unlock()

\tackData, _ := json.Marshal(map[string]string{"session_id": data.SessionID})
\tc.sendMessage("session_started", ackData)

\tgo c.readPTY(sess)

\tgo func() {
\t\t_ = cmd.Wait()
\t\tlog.Printf("Session %s: shell exited", data.SessionID)
\t\tendData, _ := json.Marshal(map[string]string{
\t\t\t"session_id": data.SessionID,
\t\t\t"reason":     "exit",
\t\t})
\t\tc.sendMessage("session_end", endData)
\t\tc.mu.Lock()
\t\tdelete(c.sessions, data.SessionID)
\t\tc.mu.Unlock()
\t\tclose(sess.done)
\t}()
}

func (c *RelayClient) readPTY(sess *PTYSession) {
\tbuf := make([]byte, 4096)
\tfor {
\t\tselect {
\t\tcase <-sess.done:
\t\t\treturn
\t\tdefault:
\t\t}

\t\tn, err := sess.ptmx.Read(buf)
\t\tif err != nil {
\t\t\treturn
\t\t}
\t\tif n > 0 {
\t\t\tencoded := base64.StdEncoding.EncodeToString(buf[:n])
\t\t\tdata, _ := json.Marshal(map[string]string{
\t\t\t\t"session_id": sess.id,
\t\t\t\t"data_b64":   encoded,
\t\t\t})
\t\t\tc.sendMessage("stdout", data)
\t\t}
\t}
}

func (c *RelayClient) handleStdin(data StdinData) {
\tc.mu.Lock()
\tsess, ok := c.sessions[data.SessionID]
\tc.mu.Unlock()
\tif !ok {
\t\treturn
\t}

\tdecoded, err := base64.StdEncoding.DecodeString(data.DataB64)
\tif err != nil {
\t\tlog.Printf("Invalid base64 stdin: %v", err)
\t\treturn
\t}
\tsess.ptmx.Write(decoded)
}

func (c *RelayClient) handleResize(data ResizeData) {
\tc.mu.Lock()
\tsess, ok := c.sessions[data.SessionID]
\tc.mu.Unlock()
\tif !ok {
\t\treturn
\t}

\tpty.Setsize(sess.ptmx, &pty.Winsize{
\t\tCols: uint16(data.Cols),
\t\tRows: uint16(data.Rows),
\t})
}

func (c *RelayClient) endSession(sessionID, reason string) {
\tlog.Printf("Ending session %s: %s", sessionID, reason)
\tc.mu.Lock()
\tsess, ok := c.sessions[sessionID]
\tif ok {
\t\tc.cleanupSession(sessionID, sess)
\t}
\tc.mu.Unlock()
}

func (c *RelayClient) cleanupSession(id string, sess *PTYSession) {
\tsess.ptmx.Close()
\tif sess.cmd.Process != nil {
\t\tsess.cmd.Process.Signal(syscall.SIGTERM)
\t\tgo func() {
\t\t\ttime.Sleep(2 * time.Second)
\t\t\tsess.cmd.Process.Kill()
\t\t}()
\t}
\tdelete(c.sessions, id)
}

func (c *RelayClient) sendMessage(msgType string, data json.RawMessage) {
\tmsg := Message{Type: msgType, Data: data}
\traw, _ := json.Marshal(msg)

\tif c.conn != nil {
\t\tif err := c.conn.WriteMessage(websocket.TextMessage, raw); err != nil {
\t\t\tlog.Printf("Write error: %v", err)
\t\t}
\t}
}
`;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  const url = new URL(req.url);
  const platform = url.searchParams.get("platform"); // linux, darwin, windows
  const arch = url.searchParams.get("arch"); // amd64, arm64

  // If platform/arch specified, serve pre-built binary from storage
  if (platform && arch) {
    const ext = platform === "windows" ? ".exe" : "";
    const fileName = `relay-connector-${platform}-${arch}${ext}`;
    const storagePath = `${SUPABASE_URL}/storage/v1/object/public/connector-binaries/${fileName}`;

    // Check if binary exists by doing a HEAD request
    const check = await fetch(storagePath, { method: "HEAD" });
    if (check.ok) {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": storagePath,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response(
      JSON.stringify({ error: `Binary not available for ${platform}/${arch}. Use the build-from-source option instead.` }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  // If ?list=1, return available binaries
  if (url.searchParams.get("list") === "1") {
    const platforms = [
      { platform: "linux", arch: "amd64", label: "Linux (x86_64)" },
      { platform: "linux", arch: "arm64", label: "Linux (ARM64)" },
      { platform: "darwin", arch: "amd64", label: "macOS (Intel)" },
      { platform: "darwin", arch: "arm64", label: "macOS (Apple Silicon)" },
      { platform: "windows", arch: "amd64", label: "Windows (x86_64)" },
    ];

    const available = [];
    for (const p of platforms) {
      const ext = p.platform === "windows" ? ".exe" : "";
      const fileName = `relay-connector-${p.platform}-${p.arch}${ext}`;
      const storagePath = `${SUPABASE_URL}/storage/v1/object/public/connector-binaries/${fileName}`;
      const check = await fetch(storagePath, { method: "HEAD" });
      if (check.ok) {
        available.push({ ...p, url: storagePath });
      }
    }

    return new Response(JSON.stringify({ available }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Full one-liner: download, pair, and register as a background service
  if (url.searchParams.get("install") === "full") {
    const baseUrl = `${SUPABASE_URL}/storage/v1/object/public/connector-binaries`;
    const apiUrl = `${SUPABASE_URL}/functions/v1`;
    const fullScript = `#!/bin/bash
set -e

PAIR_CODE="$1"
API_URL="${apiUrl}"
BASE_URL="${baseUrl}"

if [ -z "$PAIR_CODE" ]; then
  echo "❌ Usage: curl -fsSL \\"...\\" | bash -s -- YOUR_PAIR_CODE"
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
  x86_64|amd64)  ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "❌ Unsupported architecture: $ARCH"; exit 1 ;;
esac

DEST_DIR="$HOME/relay-connector"
BINARY_PATH="$DEST_DIR/relay-connector"
BINARY_NAME="relay-connector-\${PLATFORM}-\${ARCH}"
BINARY_URL="\${BASE_URL}/\${BINARY_NAME}"

echo "📦 Installing PrivaClaw Connector (\${PLATFORM}/\${ARCH})..."
mkdir -p "$DEST_DIR"

HTTP_CODE=$(curl -sL -w "%{http_code}" -o "$BINARY_PATH" "$BINARY_URL")
if [ "$HTTP_CODE" != "200" ]; then
  rm -f "$BINARY_PATH"
  echo "❌ Download failed (HTTP $HTTP_CODE). Binary may not be available for \${PLATFORM}/\${ARCH}."
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

  cat > "$PLIST" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.privaclaw.connector</string>
  <key>ProgramArguments</key>
  <array>
    <string>$FULL_BINARY</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$FULL_LOG</string>
  <key>StandardErrorPath</key>
  <string>$FULL_LOG</string>
</dict>
</plist>
PLISTEOF

  USER_ID=$(id -u)
  # Only bootout if already registered (prevents noise on fresh install)
  launchctl print "gui/$USER_ID" 2>/dev/null | grep -q "com.privaclaw.connector" && \\
    launchctl bootout "gui/$USER_ID" "$PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$USER_ID" "$PLIST"
  launchctl enable "gui/$USER_ID/com.privaclaw.connector"
  launchctl kickstart -k "gui/$USER_ID/com.privaclaw.connector"

elif [ "$PLATFORM" = "linux" ]; then
  SERVICE_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SERVICE_DIR"

  cat > "$SERVICE_DIR/privaclaw-connector.service" << SVCEOF
[Unit]
Description=PrivaClaw Connector
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$FULL_BINARY
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
SVCEOF

  # Enable linger so service persists across logout
  loginctl enable-linger "$USER" 2>/dev/null || true
  systemctl --user daemon-reload
  systemctl --user enable privaclaw-connector
  systemctl --user start privaclaw-connector
fi

echo ""
echo "✅ PrivaClaw installed and running!"
echo "   Connector auto-starts on login."
`;
    return new Response(fullScript, {
      headers: {
        "Content-Type": "text/x-shellscript",
        "Content-Disposition": "inline; filename=install.sh",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Smart install script: auto-detects OS/arch, downloads binary or falls back to source
  if (url.searchParams.get("install") === "1") {
    const baseUrl = `${SUPABASE_URL}/storage/v1/object/public/connector-binaries`;
    const smartScript = `#!/bin/bash
set -e

echo "📦 PrivaClaw Connector — Smart Installer"
echo ""

# Detect OS
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$OS" in
  linux)  PLATFORM="linux" ;;
  darwin) PLATFORM="darwin" ;;
  mingw*|msys*|cygwin*) PLATFORM="windows" ;;
  *) echo "❌ Unsupported OS: $OS"; exit 1 ;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)  ARCH="amd64" ;;
  arm64|aarch64)  ARCH="arm64" ;;
  *) echo "❌ Unsupported architecture: $ARCH"; exit 1 ;;
esac

EXT=""
if [ "$PLATFORM" = "windows" ]; then EXT=".exe"; fi

BINARY="relay-connector-\${PLATFORM}-\${ARCH}\${EXT}"
URL="${baseUrl}/\${BINARY}"
DEST_DIR="relay-connector"
DEST="\${DEST_DIR}/relay-connector\${EXT}"

echo "  Detected: \${PLATFORM}/\${ARCH}"
echo "  Downloading: \${BINARY}"
echo ""

mkdir -p "$DEST_DIR"

# Try downloading pre-built binary
HTTP_CODE=$(curl -sL -w "%{http_code}" -o "$DEST" "$URL")

if [ "$HTTP_CODE" = "200" ]; then
  chmod +x "$DEST"
  echo "✅ Installed successfully!"
  echo ""
  echo "  Location: ./$DEST"
  echo ""
  echo "Next steps:"
  echo "  1. Pair:    cd $DEST_DIR && ./relay-connector\${EXT} --pair <PAIRING_CODE> --api <API_URL> --name \\"MyDevice\\""
  echo "  2. Connect: cd $DEST_DIR && ./relay-connector\${EXT}"
else
  rm -f "$DEST"
  echo "⚠️  No pre-built binary for \${PLATFORM}/\${ARCH}."
  echo ""
  echo "Falling back to building from source (requires Go 1.22+)..."
  echo ""

  if ! command -v go &> /dev/null; then
    echo "❌ Go is not installed. Install it from https://go.dev/dl/ and retry."
    exit 1
  fi

  curl -fsSL "${SUPABASE_URL}/functions/v1/download-connector" | bash
fi
`;

    return new Response(smartScript, {
      headers: {
        "Content-Type": "application/x-shellscript",
        "Content-Disposition": 'attachment; filename="install-connector.sh"',
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // PowerShell smart installer for Windows
  if (url.searchParams.get("install") === "ps") {
    const baseUrl = `${SUPABASE_URL}/storage/v1/object/public/connector-binaries`;
    const psScript = `
Write-Host "📦 PrivaClaw Connector — Smart Installer" -ForegroundColor Cyan
Write-Host ""

$arch = if ([System.Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }
$binary = "relay-connector-windows-$arch.exe"
$url = "${baseUrl}/$binary"
$destDir = "relay-connector"
$dest = Join-Path $destDir "relay-connector.exe"

Write-Host "  Detected: windows/$arch"
Write-Host "  Downloading: $binary"
Write-Host ""

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -ErrorAction Stop
    Write-Host "✅ Installed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Location: .\\\\$dest"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host '  1. Pair:    cd relay-connector; .\\\\relay-connector.exe --pair <PAIRING_CODE> --api <API_URL> --name "MyDevice"'
    Write-Host "  2. Connect: cd relay-connector; .\\\\relay-connector.exe"
} catch {
    Write-Host "❌ Download failed. Binary may not be available for windows/$arch." -ForegroundColor Red
    Write-Host "   Download manually from the web UI or build from source with Go 1.22+."
    exit 1
}
`;

    return new Response(psScript.trim(), {
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": 'attachment; filename="install-connector.ps1"',
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Default: return shell install script (build from source)
  const script = `#!/bin/bash
set -e

echo "📦 Downloading PrivaClaw Connector..."
echo ""

DEST="relay-connector"
mkdir -p "$DEST"
cd "$DEST"

# go.mod
cat > go.mod << 'GOMODEOF'
${GO_MOD.trim()}
GOMODEOF

# main.go
cat > main.go << 'MAINEOF'
${MAIN_GO.trim()}
MAINEOF

# client.go
cat > client.go << 'CLIENTEOF'
${CLIENT_GO.trim()}
CLIENTEOF

echo "✓ Source files created in ./$DEST/"
echo ""

# Check if Go is installed
if command -v go &> /dev/null; then
  echo "🔨 Building connector..."
  go mod tidy
  go build -o relay-connector .
  echo "✓ Built successfully!"
  echo ""
  echo "Next steps:"
  echo "  1. Pair:    cd relay-connector && ./relay-connector --pair <PAIRING_CODE> --api <API_URL> --name \\"MyDevice\\""
  echo "  2. Connect: ./relay-connector"
else
  echo ""
  echo "⚠  Go is not installed."
  echo "   Install Go 1.22+ from https://go.dev/dl/ then run:"
  echo "   cd $DEST && go mod tidy && go build -o relay-connector ."
fi
`;

  return new Response(script, {
    headers: {
      "Content-Type": "application/x-shellscript",
      "Content-Disposition": 'attachment; filename="install-connector.sh"',
      "Access-Control-Allow-Origin": "*",
    },
  });
});
