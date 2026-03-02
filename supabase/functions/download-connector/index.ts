import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Bump this whenever MAIN_GO or CLIENT_GO changes so --self-update-check can detect stale binaries.
const SOURCE_VERSION = "2026-03-01T00:00:00Z";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "X-Connector-Version": SOURCE_VERSION,
};

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
\t"crypto/sha256"
\t"encoding/hex"
\t"encoding/json"
\t"flag"
\t"fmt"
\t"io"
\t"log"
\t"net/http"
\t"os"
\t"os/exec"
\t"os/signal"
\t"path/filepath"
\t"runtime"
\t"syscall"
\t"text/template"
\t"time"
)

// VERSION is stamped at build time by the download-connector edge function.
// --self-update-check compares this against the server's X-Connector-Version header.
const VERSION = "${SOURCE_VERSION}"

// Config holds the connector's persistent configuration.
type Config struct {
\tDeviceID string \`json:"device_id"\`
\tToken    string \`json:"token"\`
\tRelayURL string \`json:"relay_url"\`
}

func main() {
\tpairingCode      := flag.String("pair",              "", "Pairing code from the web UI")
\tname             := flag.String("name",              "", "Device name (optional, used during pairing)")
\tapiURL           := flag.String("api",               "", "Supabase Edge Function base URL")
\tconfigPath       := flag.String("config",            defaultConfigPath(), "Path to config file")
\tshell            := flag.String("shell",             defaultShell(), "Shell to spawn (default: $SHELL or /bin/sh)")
\tworkdir          := flag.String("workdir",           "", "Working directory for shell sessions")
\tinstallAgent     := flag.Bool("install-agent",       false, "Register binary as a background service and start it")
\tuninstallAgent   := flag.Bool("uninstall-agent",     false, "Stop and remove the background service")
\tstatusAgent      := flag.Bool("status",              false, "Print service install/running status")
\tupdateAgent      := flag.Bool("update",              false, "Download latest binary, replace self on disk, re-register service")
\tupdateCheckAgent := flag.Bool("self-update-check",   false, "Check whether a newer binary is available without downloading")
\tflag.Parse()

\tif *updateCheckAgent {
\t\tif *apiURL == "" {
\t\t\tlog.Fatal("--api is required for --self-update-check")
\t\t}
\t\tif err := selfUpdateCheck(*apiURL); err != nil { log.Fatalf("update check failed: %v", err) }
\t\treturn
\t}

\tif *updateAgent {
\t\tif *apiURL == "" {
\t\t\tlog.Fatal("--api is required for --update")
\t\t}
\t\tif err := selfUpdate(*apiURL); err != nil { log.Fatalf("update failed: %v", err) }
\t\treturn
\t}

\tif *installAgent {
\t\texe, err := os.Executable()
\t\tif err != nil { log.Fatalf("Cannot resolve executable path: %v", err) }
\t\texe, err = filepath.EvalSymlinks(exe)
\t\tif err != nil { log.Fatalf("Cannot resolve symlinks: %v", err) }
\t\tif err := installAgentService(exe); err != nil { log.Fatalf("install-agent failed: %v", err) }
\t\treturn
\t}
\tif *uninstallAgent {
\t\tif err := uninstallAgentService(); err != nil { log.Fatalf("uninstall-agent failed: %v", err) }
\t\treturn
\t}
\tif *statusAgent {
\t\tif err := agentStatus(); err != nil { log.Fatalf("status failed: %v", err) }
\t\treturn
\t}

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
\tif *workdir != "" { fmt.Printf("Workdir: %s\\n", *workdir) }

\tsigCh := make(chan os.Signal, 1)
\tsignal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

\tconst (
\t\tinitialDelay = 1 * time.Second
\t\tmaxDelay     = 30 * time.Second
\t)
\tdelay := initialDelay

\tfor {
\t\tclient := NewRelayClient(cfg, *shell, *workdir)

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

// ─── Service management ───────────────────────────────────────────────────────

func installAgentService(exe string) error {
\tswitch runtime.GOOS {
\tcase "darwin":  return installAgentDarwin(exe)
\tcase "linux":   return installAgentLinux(exe)
\tcase "windows": return installAgentWindows(exe)
\tdefault:        return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
\t}
}
func uninstallAgentService() error {
\tswitch runtime.GOOS {
\tcase "darwin":  return uninstallAgentDarwin()
\tcase "linux":   return uninstallAgentLinux()
\tcase "windows": return uninstallAgentWindows()
\tdefault:        return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
\t}
}
func agentStatus() error {
\tswitch runtime.GOOS {
\tcase "darwin":  return agentStatusDarwin()
\tcase "linux":   return agentStatusLinux()
\tcase "windows": return agentStatusWindows()
\tdefault:        return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
\t}
}

// ─── macOS ────────────────────────────────────────────────────────────────────

const plistTmpl = \`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.privaclaw.connector</string>
  <key>ProgramArguments</key>
  <array><string>{{.Exe}}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{{.Log}}</string>
  <key>StandardErrorPath</key><string>{{.Log}}</string>
</dict>
</plist>\`

func plistPath() string {
\thome, _ := os.UserHomeDir()
\treturn filepath.Join(home, "Library", "LaunchAgents", "com.privaclaw.connector.plist")
}

func installAgentDarwin(exe string) error {
\thome, _ := os.UserHomeDir()
\tlogPath := filepath.Join(home, "relay-connector", "relay.log")
\tos.MkdirAll(filepath.Dir(logPath), 0755)
\tos.MkdirAll(filepath.Dir(plistPath()), 0755)
\tt, _ := template.New("p").Parse(plistTmpl)
\tf, err := os.Create(plistPath())
\tif err != nil { return err }
\tdefer f.Close()
\tt.Execute(f, struct{ Exe, Log string }{exe, logPath})
\t// Strip Gatekeeper quarantine before launchctl spawns the binary.
\t// Without this the OS sends SIGKILL (Killed: 9) to the service process.
\trun("xattr", "-d", "com.apple.quarantine", exe)
\trun("xattr", "-c", exe)
\tuid := fmt.Sprintf("gui/%d", os.Getuid())
\tlabel := "com.privaclaw.connector"
\trun("launchctl", "bootout", uid+"/"+label)
\tif err := runMust("launchctl", "bootstrap", uid, plistPath()); err != nil { return err }
\trunMust("launchctl", "enable", uid+"/"+label)
\trunMust("launchctl", "kickstart", "-k", uid+"/"+label)
\tfmt.Printf("✅ Service installed (macOS LaunchAgent).\\n   Plist: %s\\n   Log:   %s\\n", plistPath(), logPath)
\treturn nil
}

func uninstallAgentDarwin() error {
\tuid := fmt.Sprintf("gui/%d", os.Getuid())
\trun("launchctl", "bootout", uid+"/com.privaclaw.connector")
\trun("launchctl", "disable", uid+"/com.privaclaw.connector")
\tos.Remove(plistPath())
\tfmt.Println("✅ Service uninstalled (macOS LaunchAgent removed).")
\treturn nil
}

func agentStatusDarwin() error {
\tif _, err := os.Stat(plistPath()); os.IsNotExist(err) { fmt.Println("installed: false"); return nil }
\tfmt.Printf("installed: true\\nplist:     %s\\n", plistPath())
\tout, _ := exec.Command("launchctl", "print", fmt.Sprintf("gui/%d/com.privaclaw.connector", os.Getuid())).CombinedOutput()
\tif len(out) > 0 { fmt.Printf("running:   true\\n%s\\n", out) } else { fmt.Println("running:   false") }
\treturn nil
}

// ─── Linux ────────────────────────────────────────────────────────────────────

const unitTmpl = \`[Unit]
Description=PrivaClaw Connector
After=network-online.target
Wants=network-online.target

[Service]
ExecStart={{.Exe}}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target\`

func unitPath() string {
\thome, _ := os.UserHomeDir()
\treturn filepath.Join(home, ".config", "systemd", "user", "privaclaw-connector.service")
}

func installAgentLinux(exe string) error {
\tos.MkdirAll(filepath.Dir(unitPath()), 0755)
\tt, _ := template.New("u").Parse(unitTmpl)
\tf, err := os.Create(unitPath())
\tif err != nil { return err }
\tdefer f.Close()
\tt.Execute(f, struct{ Exe string }{exe})
\trun("loginctl", "enable-linger", os.Getenv("USER"))
\trunMust("systemctl", "--user", "daemon-reload")
\trunMust("systemctl", "--user", "enable", "privaclaw-connector")
\trunMust("systemctl", "--user", "restart", "privaclaw-connector")
\tfmt.Printf("✅ Service installed (systemd --user).\\n   Unit: %s\\n", unitPath())
\treturn nil
}

func uninstallAgentLinux() error {
\trun("systemctl", "--user", "stop", "privaclaw-connector")
\trun("systemctl", "--user", "disable", "privaclaw-connector")
\tos.Remove(unitPath())
\trun("systemctl", "--user", "daemon-reload")
\tfmt.Println("✅ Service uninstalled (systemd unit removed).")
\treturn nil
}

func agentStatusLinux() error {
\tif _, err := os.Stat(unitPath()); os.IsNotExist(err) { fmt.Println("installed: false"); return nil }
\tfmt.Printf("installed: true\\nunit:      %s\\n", unitPath())
\tout, _ := exec.Command("systemctl", "--user", "status", "privaclaw-connector").CombinedOutput()
\tfmt.Printf("%s\\n", out)
\treturn nil
}

// ─── Windows ─────────────────────────────────────────────────────────────────

const taskName = "PrivaClawConnector"

func installAgentWindows(exe string) error {
\trun("schtasks", "/Delete", "/TN", taskName, "/F")
\tif err := runMust("schtasks", "/Create", "/TN", taskName, "/TR", exe, "/SC", "ONLOGON",
\t\t"/RU", os.Getenv("USERNAME"), "/RL", "LIMITED", "/F"); err != nil { return err }
\trunMust("schtasks", "/Run", "/TN", taskName)
\tfmt.Printf("✅ Service installed (Windows Scheduled Task: %s).\\n", taskName)
\treturn nil
}

func uninstallAgentWindows() error {
\trun("schtasks", "/End", "/TN", taskName)
\tif err := runMust("schtasks", "/Delete", "/TN", taskName, "/F"); err != nil { return err }
\tfmt.Println("✅ Service uninstalled (Scheduled Task removed).")
\treturn nil
}

func agentStatusWindows() error {
\tout, err := exec.Command("schtasks", "/Query", "/TN", taskName, "/FO", "LIST").CombinedOutput()
\tif err != nil { fmt.Println("installed: false"); return nil }
\tfmt.Printf("installed: true\\n%s\\n", out)
\treturn nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func run(name string, args ...string) { _ = exec.Command(name, args...).Run() }

func runMust(name string, args ...string) error {
\tout, err := exec.Command(name, args...).CombinedOutput()
\tif err != nil { return fmt.Errorf("%s %v: %w\\n%s", name, args, err, out) }
\treturn nil
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

func selfUpdate(apiURL string) error {
\texe, err := os.Executable()
\tif err != nil { return fmt.Errorf("cannot resolve executable: %w", err) }
\texe, err = filepath.EvalSymlinks(exe)
\tif err != nil { return fmt.Errorf("cannot resolve symlinks: %w", err) }

\tdownloadURL := fmt.Sprintf("%s/download-connector?os=%s&arch=%s", apiURL, runtime.GOOS, runtime.GOARCH)
\tfmt.Printf("⬇  Downloading latest binary from %s\\n", downloadURL)

\tresp, err := http.Get(downloadURL)
\tif err != nil { return fmt.Errorf("download request failed: %w", err) }
\tdefer resp.Body.Close()
\tif resp.StatusCode != http.StatusOK { return fmt.Errorf("download failed: HTTP %d", resp.StatusCode) }

\tdir := filepath.Dir(exe)
\ttmp, err := os.CreateTemp(dir, ".connector-update-*")
\tif err != nil { return fmt.Errorf("create temp file: %w", err) }
\ttmpName := tmp.Name()
\tdefer func() { tmp.Close(); os.Remove(tmpName) }()

\tif _, err := io.Copy(tmp, resp.Body); err != nil { return fmt.Errorf("write download: %w", err) }
\tif err := tmp.Chmod(0755); err != nil { return fmt.Errorf("chmod: %w", err) }
\ttmp.Close()

\tif err := os.Rename(tmpName, exe); err != nil { return fmt.Errorf("replace binary: %w", err) }
\tfmt.Printf("✅ Binary updated: %s\\n", exe)

\tfmt.Println("🔄 Re-registering service...")
\tcmd := exec.Command(exe, "--install-agent")
\tcmd.Stdout = os.Stdout
\tcmd.Stderr = os.Stderr
\tif err := cmd.Run(); err != nil { return fmt.Errorf("--install-agent after update: %w", err) }
\treturn nil
}

// selfUpdateCheck performs a lightweight HEAD request to the download-connector
// endpoint and compares the server's X-Connector-Version header against the
// VERSION constant baked into this binary at build time.
//
// Output lines (always printed to stdout):
//   update-available: true|false
//   local-version:    <VERSION embedded in this binary>
//   server-version:   <X-Connector-Version from server>
//   sha256:           <SHA-256 hex of this binary>
func selfUpdateCheck(apiURL string) error {
\texe, err := os.Executable()
\tif err != nil { return fmt.Errorf("cannot resolve executable: %w", err) }
\texe, err = filepath.EvalSymlinks(exe)
\tif err != nil { return fmt.Errorf("cannot resolve symlinks: %w", err) }

\t// Hash the running binary (informational — not used for comparison).
\tf, err := os.Open(exe)
\tif err != nil { return fmt.Errorf("open binary: %w", err) }
\th := sha256.New()
\tif _, err := io.Copy(h, f); err != nil { f.Close(); return fmt.Errorf("hash binary: %w", err) }
\tf.Close()
\tlocalSHA := hex.EncodeToString(h.Sum(nil))

\t// HEAD request — no download, just grab headers.
\tcheckURL := fmt.Sprintf("%s/download-connector", apiURL)
\treq, _ := http.NewRequest(http.MethodHead, checkURL, nil)
\tclient := &http.Client{Timeout: 15 * time.Second}
\tresp, err := client.Do(req)
\tif err != nil { return fmt.Errorf("HEAD request failed: %w", err) }
\tresp.Body.Close()
\tif resp.StatusCode != http.StatusOK { return fmt.Errorf("server returned HTTP %d", resp.StatusCode) }

\tserverVersion := resp.Header.Get("X-Connector-Version")
\tif serverVersion == "" {
\t\tfmt.Printf("update-available: unknown\\nreason: server did not return X-Connector-Version\\nlocal-version: %s\\nsha256: %s\\n", VERSION, localSHA)
\t\treturn nil
\t}

\tif VERSION == serverVersion {
\t\tfmt.Printf("update-available: false\\nlocal-version:  %s\\nserver-version: %s\\nsha256: %s\\n", VERSION, serverVersion, localSHA)
\t} else {
\t\tfmt.Printf("update-available: true\\nlocal-version:  %s\\nserver-version: %s\\nsha256: %s\\n", VERSION, serverVersion, localSHA)
\t}
\treturn nil
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
        ...CORS_HEADERS,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
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
          ...CORS_HEADERS,
          "Location": storagePath,
        },
      });
    }

    return new Response(
      JSON.stringify({ error: `Binary not available for ${platform}/${arch}. Use the build-from-source option instead.` }),
      {
        status: 404,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
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

    return new Response(JSON.stringify({ available, source_version: SOURCE_VERSION }), {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
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

# Remove macOS Gatekeeper quarantine flag (prevents Killed: 9)
if [[ "$(uname)" == "Darwin" ]]; then
  echo "🔓 Removing macOS quarantine..."
  xattr -d com.apple.quarantine "$BINARY_PATH" 2>/dev/null || true
fi

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

# Remove quarantine again right before launch (launchctl spawns a fresh process
# which macOS re-checks; stripping here ensures the spawned service is not killed)
if [[ "$(uname)" == "Darwin" ]]; then
  xattr -d com.apple.quarantine "$FULL_BINARY" 2>/dev/null || true
  xattr -c "$FULL_BINARY" 2>/dev/null || true
fi

# Register service (binary owns all platform-specific service logic)
echo "⚙️  Registering background service..."
"$FULL_BINARY" --install-agent

echo ""
echo "✅ PrivaClaw installed and running!"
echo "   Connector auto-starts on login."
`;
    return new Response(fullScript, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/x-shellscript",
        "Content-Disposition": "inline; filename=install.sh",
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
  echo "  1. Pair:    cd relay-connector && ./relay-connector --pair <PAIRING_CODE> --api <API_URL> --name \\"MyDevice\\""
  echo "  2. Connect: ./relay-connector"
else
  rm -f "$DEST"
  echo "⚠  Pre-built binary not available for \${PLATFORM}/\${ARCH}."
  echo "   Falling back to build-from-source..."
  echo ""

  if ! command -v go &> /dev/null; then
    echo "❌ Go is not installed. Install Go 1.22+ from https://go.dev/dl/"
    exit 1
  fi

  echo "🔨 Building from source..."
  # (source files would be written here in the full installer)
  echo "   Run the build-from-source installer instead."
fi
`;

    return new Response(smartScript, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/x-shellscript",
        "Content-Disposition": 'attachment; filename="install-connector.sh"',
      },
    });
  }

  // PowerShell installer for Windows
  if (url.searchParams.get("install") === "ps1") {
    const baseUrl = `${SUPABASE_URL}/storage/v1/object/public/connector-binaries`;
    const psScript = `
$arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }
$url = "${baseUrl}/relay-connector-windows-$arch.exe"
$dest = "relay-connector\\relay-connector.exe"

New-Item -ItemType Directory -Force -Path "relay-connector" | Out-Null

Write-Host "📦 Downloading PrivaClaw Connector (windows/$arch)..." -ForegroundColor Cyan
Write-Host ""

try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -ErrorAction Stop
    Write-Host "✅ Installed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Location: .\\$dest"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host '  1. Pair:    cd relay-connector; .\\relay-connector.exe --pair <PAIRING_CODE> --api <API_URL> --name "MyDevice"'
    Write-Host "  2. Connect: cd relay-connector; .\\relay-connector.exe"
} catch {
    Write-Host "❌ Download failed. Binary may not be available for windows/$arch." -ForegroundColor Red
    Write-Host "   Download manually from the web UI or build from source with Go 1.22+."
    exit 1
}
`;

    return new Response(psScript.trim(), {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/plain",
        "Content-Disposition": 'attachment; filename="install-connector.ps1"',
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
      ...CORS_HEADERS,
      "Content-Type": "application/x-shellscript",
      "Content-Disposition": 'attachment; filename="install-connector.sh"',
    },
  });
});
