package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"text/template"
	"time"
)

// Config holds the connector's persistent configuration.
type Config struct {
	DeviceID string `json:"device_id"`
	Token    string `json:"token"`
	RelayURL string `json:"relay_url"`
}

func main() {
	pairingCode    := flag.String("pair",             "", "Pairing code from the web UI")
	name           := flag.String("name",             "", "Device name (optional, used during pairing)")
	apiURL         := flag.String("api",              "", "Supabase Edge Function base URL (e.g. https://xyz.supabase.co/functions/v1)")
	configPath     := flag.String("config",           defaultConfigPath(), "Path to config file")
	shell          := flag.String("shell",            defaultShell(), "Shell to spawn (default: $SHELL or /bin/sh)")
	workdir        := flag.String("workdir",          "", "Working directory for shell sessions (default: home directory)")
	installAgent   := flag.Bool("install-agent",      false, "Register binary as a background service and start it")
	uninstallAgent := flag.Bool("uninstall-agent",    false, "Stop and remove the background service")
	statusAgent    := flag.Bool("status",             false, "Print service install/running status")
	flag.Parse()

	// --- install-agent ---
	if *installAgent {
		exe, err := os.Executable()
		if err != nil {
			log.Fatalf("Cannot resolve executable path: %v", err)
		}
		// Resolve symlinks so the service file always points at the real binary.
		exe, err = filepath.EvalSymlinks(exe)
		if err != nil {
			log.Fatalf("Cannot resolve symlinks: %v", err)
		}
		if err := installAgentService(exe); err != nil {
			log.Fatalf("install-agent failed: %v", err)
		}
		return
	}

	// --- uninstall-agent ---
	if *uninstallAgent {
		if err := uninstallAgentService(); err != nil {
			log.Fatalf("uninstall-agent failed: %v", err)
		}
		return
	}

	// --- status ---
	if *statusAgent {
		if err := agentStatus(); err != nil {
			log.Fatalf("status failed: %v", err)
		}
		return
	}

	// If pairing code provided, pair first
	if *pairingCode != "" {
		if *apiURL == "" {
			log.Fatal("--api is required when pairing (e.g. https://xyz.supabase.co/functions/v1)")
		}
		cfg, err := pairDevice(*apiURL, *pairingCode, *name)
		if err != nil {
			log.Fatalf("Pairing failed: %v", err)
		}
		if err := saveConfig(*configPath, cfg); err != nil {
			log.Fatalf("Failed to save config: %v", err)
		}
		fmt.Printf("✓ Paired successfully! Device ID: %s\n", cfg.DeviceID)
		fmt.Printf("  Config saved to: %s\n", *configPath)
		fmt.Printf("  Relay URL: %s\n", cfg.RelayURL)
		fmt.Println("\nRun again without --pair to connect to the relay.")
		return
	}

	// Load existing config
	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatalf("No config found at %s. Run with --pair <code> first.\n", *configPath)
	}

	fmt.Printf("Connecting to relay: %s\n", cfg.RelayURL)
	fmt.Printf("Device ID: %s\n", cfg.DeviceID)
	fmt.Printf("Shell: %s\n", *shell)
	if *workdir != "" {
		fmt.Printf("Workdir: %s\n", *workdir)
	}

	// Set up signal handling for clean shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Auto-reconnect loop with exponential backoff
	const (
		initialDelay = 1 * time.Second
		maxDelay     = 30 * time.Second
	)
	delay := initialDelay

	for {
		client := NewRelayClient(cfg, *shell, *workdir)

		// Signal handler (reset per connection attempt)
		go func() {
			select {
			case <-sigCh:
				fmt.Println("\nShutting down...")
				client.Close()
				os.Exit(0)
			case <-client.done:
			}
		}()

		err := client.Run()
		if err == nil {
			// Clean shutdown (e.g. signal)
			return
		}

		log.Printf("Connection lost: %v", err)
		log.Printf("Reconnecting in %s...", delay)
		time.Sleep(delay)

		// Exponential backoff
		delay = delay * 2
		if delay > maxDelay {
			delay = maxDelay
		}
	}
}

// ─── Service management ───────────────────────────────────────────────────────

func installAgentService(exe string) error {
	switch runtime.GOOS {
	case "darwin":
		return installAgentDarwin(exe)
	case "linux":
		return installAgentLinux(exe)
	case "windows":
		return installAgentWindows(exe)
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

func uninstallAgentService() error {
	switch runtime.GOOS {
	case "darwin":
		return uninstallAgentDarwin()
	case "linux":
		return uninstallAgentLinux()
	case "windows":
		return uninstallAgentWindows()
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

func agentStatus() error {
	switch runtime.GOOS {
	case "darwin":
		return agentStatusDarwin()
	case "linux":
		return agentStatusLinux()
	case "windows":
		return agentStatusWindows()
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

// ─── macOS (launchctl) ────────────────────────────────────────────────────────

const plistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.privaclaw.connector</string>
  <key>ProgramArguments</key>
  <array>
    <string>{{.Exe}}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{{.LogPath}}</string>
  <key>StandardErrorPath</key>
  <string>{{.LogPath}}</string>
</dict>
</plist>
`

func plistPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", "com.privaclaw.connector.plist")
}

func installAgentDarwin(exe string) error {
	home, _ := os.UserHomeDir()
	logDir := filepath.Join(home, "relay-connector")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return err
	}
	logPath := filepath.Join(logDir, "relay.log")

	plistDir := filepath.Join(home, "Library", "LaunchAgents")
	if err := os.MkdirAll(plistDir, 0755); err != nil {
		return err
	}

	tmpl, err := template.New("plist").Parse(plistTemplate)
	if err != nil {
		return err
	}
	f, err := os.Create(plistPath())
	if err != nil {
		return err
	}
	defer f.Close()
	if err := tmpl.Execute(f, struct{ Exe, LogPath string }{exe, logPath}); err != nil {
		return err
	}

	uid := fmt.Sprintf("gui/%d", os.Getuid())
	label := "com.privaclaw.connector"

	// Bootout existing service if registered (ignore errors on fresh install)
	run("launchctl", "bootout", uid+"/"+label)
	if err := runMust("launchctl", "bootstrap", uid, plistPath()); err != nil {
		return fmt.Errorf("launchctl bootstrap: %w", err)
	}
	if err := runMust("launchctl", "enable", uid+"/"+label); err != nil {
		return fmt.Errorf("launchctl enable: %w", err)
	}
	if err := runMust("launchctl", "kickstart", "-k", uid+"/"+label); err != nil {
		return fmt.Errorf("launchctl kickstart: %w", err)
	}
	fmt.Println("✅ Service installed and started (macOS LaunchAgent).")
	fmt.Printf("   Plist:  %s\n", plistPath())
	fmt.Printf("   Log:    %s\n", logPath)
	return nil
}

func uninstallAgentDarwin() error {
	uid := fmt.Sprintf("gui/%d", os.Getuid())
	label := "com.privaclaw.connector"
	run("launchctl", "bootout", uid+"/"+label)
	run("launchctl", "disable", uid+"/"+label)
	p := plistPath()
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	fmt.Println("✅ Service uninstalled (macOS LaunchAgent removed).")
	return nil
}

func agentStatusDarwin() error {
	p := plistPath()
	if _, err := os.Stat(p); os.IsNotExist(err) {
		fmt.Println("installed: false")
		return nil
	}
	fmt.Println("installed: true")
	fmt.Printf("plist:     %s\n", p)
	uid := fmt.Sprintf("gui/%d", os.Getuid())
	label := "com.privaclaw.connector"
	out, _ := exec.Command("launchctl", "print", uid+"/"+label).CombinedOutput()
	if len(out) > 0 {
		fmt.Printf("running:   true\nlaunchctl:\n%s\n", string(out))
	} else {
		fmt.Println("running:   false")
	}
	return nil
}

// ─── Linux (systemd --user) ───────────────────────────────────────────────────

const unitTemplate = `[Unit]
Description=PrivaClaw Connector
After=network-online.target
Wants=network-online.target

[Service]
ExecStart={{.Exe}}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`

func unitPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "systemd", "user", "privaclaw-connector.service")
}

func installAgentLinux(exe string) error {
	unitDir := filepath.Dir(unitPath())
	if err := os.MkdirAll(unitDir, 0755); err != nil {
		return err
	}

	tmpl, err := template.New("unit").Parse(unitTemplate)
	if err != nil {
		return err
	}
	f, err := os.Create(unitPath())
	if err != nil {
		return err
	}
	defer f.Close()
	if err := tmpl.Execute(f, struct{ Exe string }{exe}); err != nil {
		return err
	}

	// Enable linger so service persists across logout
	run("loginctl", "enable-linger", os.Getenv("USER"))
	if err := runMust("systemctl", "--user", "daemon-reload"); err != nil {
		return fmt.Errorf("daemon-reload: %w", err)
	}
	if err := runMust("systemctl", "--user", "enable", "privaclaw-connector"); err != nil {
		return fmt.Errorf("systemctl enable: %w", err)
	}
	if err := runMust("systemctl", "--user", "restart", "privaclaw-connector"); err != nil {
		return fmt.Errorf("systemctl restart: %w", err)
	}
	fmt.Println("✅ Service installed and started (systemd --user).")
	fmt.Printf("   Unit: %s\n", unitPath())
	return nil
}

func uninstallAgentLinux() error {
	run("systemctl", "--user", "stop", "privaclaw-connector")
	run("systemctl", "--user", "disable", "privaclaw-connector")
	p := unitPath()
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	run("systemctl", "--user", "daemon-reload")
	fmt.Println("✅ Service uninstalled (systemd unit removed).")
	return nil
}

func agentStatusLinux() error {
	p := unitPath()
	if _, err := os.Stat(p); os.IsNotExist(err) {
		fmt.Println("installed: false")
		return nil
	}
	fmt.Println("installed: true")
	fmt.Printf("unit:      %s\n", p)
	out, _ := exec.Command("systemctl", "--user", "status", "privaclaw-connector").CombinedOutput()
	fmt.Printf("systemctl:\n%s\n", string(out))
	return nil
}

// ─── Windows (Scheduled Task) ─────────────────────────────────────────────────

const taskName = "PrivaClawConnector"

func installAgentWindows(exe string) error {
	// Remove existing task (idempotent)
	run("schtasks", "/Delete", "/TN", taskName, "/F")

	err := runMust("schtasks", "/Create",
		"/TN", taskName,
		"/TR", exe,
		"/SC", "ONLOGON",
		"/RU", os.Getenv("USERNAME"),
		"/RL", "LIMITED",
		"/F",
	)
	if err != nil {
		return fmt.Errorf("schtasks create: %w", err)
	}

	// Start immediately
	if err := runMust("schtasks", "/Run", "/TN", taskName); err != nil {
		return fmt.Errorf("schtasks run: %w", err)
	}
	fmt.Println("✅ Service installed and started (Windows Scheduled Task).")
	fmt.Printf("   Task: %s\n", taskName)
	return nil
}

func uninstallAgentWindows() error {
	run("schtasks", "/End", "/TN", taskName)
	if err := runMust("schtasks", "/Delete", "/TN", taskName, "/F"); err != nil {
		return fmt.Errorf("schtasks delete: %w", err)
	}
	fmt.Println("✅ Service uninstalled (Scheduled Task removed).")
	return nil
}

func agentStatusWindows() error {
	out, err := exec.Command("schtasks", "/Query", "/TN", taskName, "/FO", "LIST").CombinedOutput()
	if err != nil {
		fmt.Println("installed: false")
		return nil
	}
	fmt.Println("installed: true")
	fmt.Printf("schtasks:\n%s\n", string(out))
	return nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// run executes a command and ignores errors (used for best-effort cleanup).
func run(name string, args ...string) {
	_ = exec.Command(name, args...).Run()
}

// runMust executes a command and returns its combined output on failure.
func runMust(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %v: %w\n%s", name, args, err, string(out))
	}
	return nil
}

// ─── Existing helpers ─────────────────────────────────────────────────────────

func pairDevice(apiURL, code, name string) (*Config, error) {
	body := map[string]string{"pairing_code": code}
	if name != "" {
		body["name"] = name
	}

	jsonBody, _ := json.Marshal(body)
	resp, err := http.Post(apiURL+"/pair-device", "application/json", bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		DeviceID string `json:"device_id"`
		Token    string `json:"token"`
		RelayURL string `json:"relay_url"`
		Error    string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("invalid response: %w", err)
	}
	if result.Error != "" {
		return nil, fmt.Errorf("server error: %s", result.Error)
	}
	if result.DeviceID == "" || result.Token == "" || result.RelayURL == "" {
		return nil, fmt.Errorf("incomplete response from server")
	}

	return &Config{
		DeviceID: result.DeviceID,
		Token:    result.Token,
		RelayURL: result.RelayURL,
	}, nil
}

func defaultConfigPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".relay-connector.json")
}

func defaultShell() string {
	if s := os.Getenv("SHELL"); s != "" {
		return s
	}
	return "/bin/sh"
}

func saveConfig(path string, cfg *Config) error {
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(path, data, 0600)
}

func loadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
