package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
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
	pairingCode    := flag.String("pair",           "", "Pairing code from the web UI")
	name           := flag.String("name",           "", "Device name (optional, used during pairing)")
	apiURL         := flag.String("api",            "", "Supabase Edge Function base URL (e.g. https://xyz.supabase.co/functions/v1)")
	configPath     := flag.String("config",         defaultConfigPath(), "Path to config file")
	shell          := flag.String("shell",          defaultShell(), "Shell to spawn (default: $SHELL or /bin/sh)")
	workdir        := flag.String("workdir",        "", "Working directory for shell sessions (default: home directory)")
	installAgent   := flag.Bool("install-agent",    false, "Register binary as a background service and start it")
	uninstallAgent := flag.Bool("uninstall-agent",  false, "Stop and remove the background service")
	statusAgent    := flag.Bool("status",           false, "Print service install/running status")
	updateAgent       := flag.Bool("update",             false, "Download latest binary, replace self on disk, re-register service")
	updateCheckAgent  := flag.Bool("self-update-check",  false, "Check whether a newer binary is available without downloading")
	flag.Parse()

	// --- self-update-check ---
	if *updateCheckAgent {
		if *apiURL == "" {
			log.Fatal("--api is required for --self-update-check (e.g. https://xyz.supabase.co/functions/v1)")
		}
		if err := selfUpdateCheck(*apiURL); err != nil {
			log.Fatalf("update check failed: %v", err)
		}
		return
	}

	// --- update ---
	if *updateAgent {
		if *apiURL == "" {
			log.Fatal("--api is required for --update (e.g. https://xyz.supabase.co/functions/v1)")
		}
		if err := selfUpdate(*apiURL); err != nil {
			log.Fatalf("update failed: %v", err)
		}
		return
	}

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

	// Background startup version check – warn if a newer binary is available.
	// Derives the API URL from the relay URL (same Supabase project).
	go func() {
		apiURL := deriveAPIURL(cfg.RelayURL)
		if apiURL == "" {
			return
		}
		available, reason, err := checkUpdateAvailable(apiURL)
		if err != nil {
			// Non-fatal: silently ignore network/server errors on startup.
			return
		}
		if available {
			fmt.Printf("\n⚠️  A newer version of the connector is available (%s).\n", reason)
			fmt.Printf("   Run: %s --update --api %s\n\n", os.Args[0], apiURL)
		}
	}()

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
    <string>connect</string>
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
	// Remove Gatekeeper quarantine flag so launchctl can exec the binary.
	// Both -d (specific attr) and -c (clear all) are run to handle all quarantine variants.
	_ = exec.Command("xattr", "-d", "com.apple.quarantine", exe).Run()
	_ = exec.Command("xattr", "-c", exe).Run()

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

// ─── Self-update ──────────────────────────────────────────────────────────────

// selfUpdate downloads the latest binary for this OS/arch from the
// download-connector edge function, atomically replaces the running binary on
// disk, marks it executable, then execs --install-agent to re-register the
// background service with the new binary path.
func selfUpdate(apiURL string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot resolve executable path: %w", err)
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return fmt.Errorf("cannot resolve symlinks: %w", err)
	}

	// Build download URL: GET <api>/download-connector?os=<goos>&arch=<goarch>
	downloadURL := fmt.Sprintf("%s/download-connector?os=%s&arch=%s",
		apiURL, runtime.GOOS, runtime.GOARCH)
	fmt.Printf("⬇  Downloading latest binary from %s\n", downloadURL)

	resp, err := http.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("download request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	// Write to a temp file in the same directory so rename is atomic.
	dir := filepath.Dir(exe)
	tmp, err := os.CreateTemp(dir, ".connector-update-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		tmp.Close()
		os.Remove(tmpName) // no-op if rename succeeded
	}()

	if _, err := io.Copy(tmp, resp.Body); err != nil {
		return fmt.Errorf("write download: %w", err)
	}
	if err := tmp.Chmod(0755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}
	tmp.Close()

	// Atomic replace.
	if err := os.Rename(tmpName, exe); err != nil {
		return fmt.Errorf("replace binary: %w", err)
	}
	fmt.Printf("✅ Binary updated: %s\n", exe)

	// Remove macOS Gatekeeper quarantine flag so the new binary isn't killed on exec.
	if runtime.GOOS == "darwin" {
		fmt.Println("🔓 Removing macOS quarantine...")
		// Ignore errors: attribute may not exist (idempotent).
		_ = exec.Command("xattr", "-d", "com.apple.quarantine", exe).Run()
	}

	// Re-register the service with the new binary.
	fmt.Println("🔄 Re-registering service...")
	cmd := exec.Command(exe, "--install-agent")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("--install-agent after update: %w", err)
	}
	return nil
}

// ─── deriveAPIURL ─────────────────────────────────────────────────────────────
// Derives the Supabase Edge Function base URL from a relay URL.
// The relay URL is typically wss://xyz.supabase.co/... or https://...
// We just need https://<host>/functions/v1
func deriveAPIURL(relayURL string) string {
	if relayURL == "" {
		return ""
	}
	// Normalise scheme: wss → https, ws → http
	url := relayURL
	if len(url) >= 6 && url[:6] == "wss://" {
		url = "https://" + url[6:]
	} else if len(url) >= 5 && url[:5] == "ws://" {
		url = "http://" + url[5:]
	}
	// Strip any path after the host
	// Find third slash (after scheme://)
	schemeEnd := 0
	for i := 0; i < len(url)-2; i++ {
		if url[i] == '/' && url[i+1] == '/' {
			schemeEnd = i + 2
			break
		}
	}
	hostEnd := len(url)
	for i := schemeEnd; i < len(url); i++ {
		if url[i] == '/' {
			hostEnd = i
			break
		}
	}
	return url[:hostEnd] + "/functions/v1"
}

// checkUpdateAvailable performs a HEAD request to compare the running binary's
// SHA-256 against the ETag returned by the download-connector edge function.
// Returns (updateAvailable, description, error).
func checkUpdateAvailable(apiURL string) (bool, string, error) {
	exe, err := os.Executable()
	if err != nil {
		return false, "", err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return false, "", err
	}

	f, err := os.Open(exe)
	if err != nil {
		return false, "", err
	}
	h := sha256.New()
	_, err = io.Copy(h, f)
	f.Close()
	if err != nil {
		return false, "", err
	}
	localHash := hex.EncodeToString(h.Sum(nil))

	checkURL := fmt.Sprintf("%s/download-connector?os=%s&arch=%s", apiURL, runtime.GOOS, runtime.GOARCH)
	req, err := http.NewRequest(http.MethodHead, checkURL, nil)
	if err != nil {
		return false, "", err
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, "", err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, "", fmt.Errorf("server HTTP %d", resp.StatusCode)
	}

	etag := resp.Header.Get("ETag")
	if etag == "" {
		// No ETag – conservatively assume update is available.
		return true, "server ETag unavailable", nil
	}
	serverHash := etag
	if len(serverHash) >= 2 && serverHash[0] == '"' && serverHash[len(serverHash)-1] == '"' {
		serverHash = serverHash[1 : len(serverHash)-1]
	}

	// Also check X-Connector-Version header for a human-readable version string.
	version := resp.Header.Get("X-Connector-Version")
	desc := "sha256 mismatch"
	if version != "" {
		desc = "server version " + version
	}

	if serverHash != localHash {
		return true, desc, nil
	}
	return false, "", nil
}

// ─── selfUpdateCheck ──────────────────────────────────────────────────────────
// Compares the ETag (SHA-256) returned by the server with a SHA-256 hash of the
// running binary.  Prints one of:
//   update-available: true   (hashes differ or no local ETag to compare)
//   update-available: false  (running binary matches server)
//
// The server is expected to return an ETag header whose value is a hex-encoded
// SHA-256 of the binary, e.g. `"abc123..."` (with or without quotes).
func selfUpdateCheck(apiURL string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot resolve executable: %w", err)
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return fmt.Errorf("cannot resolve symlinks: %w", err)
	}

	// 1. Compute SHA-256 of the running binary.
	f, err := os.Open(exe)
	if err != nil {
		return fmt.Errorf("open binary: %w", err)
	}
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		f.Close()
		return fmt.Errorf("hash binary: %w", err)
	}
	f.Close()
	localHash := hex.EncodeToString(h.Sum(nil))

	// 2. HEAD request to the download endpoint – get ETag without downloading.
	checkURL := fmt.Sprintf("%s/download-connector?os=%s&arch=%s", apiURL, runtime.GOOS, runtime.GOARCH)
	req, err := http.NewRequest(http.MethodHead, checkURL, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("HEAD request failed: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned HTTP %d", resp.StatusCode)
	}

	// 3. Extract ETag, strip surrounding quotes if present.
	etag := resp.Header.Get("ETag")
	if etag == "" {
		// No ETag means we cannot compare – assume update available.
		fmt.Printf("update-available: true\nreason: server did not return an ETag\nlocal-sha256: %s\n", localHash)
		return nil
	}
	serverHash := etag
	if len(serverHash) >= 2 && serverHash[0] == '"' && serverHash[len(serverHash)-1] == '"' {
		serverHash = serverHash[1 : len(serverHash)-1]
	}

	// 4. Compare.
	if serverHash == localHash {
		fmt.Printf("update-available: false\nlocal-sha256:  %s\nserver-sha256: %s\n", localHash, serverHash)
	} else {
		fmt.Printf("update-available: true\nlocal-sha256:  %s\nserver-sha256: %s\n", localHash, serverHash)
	}
	return nil
}

