package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

// Config holds the connector's persistent configuration.
type Config struct {
	DeviceID string `json:"device_id"`
	Token    string `json:"token"`
	RelayURL string `json:"relay_url"`
}

func main() {
	pairingCode := flag.String("pair", "", "Pairing code from the web UI")
	name := flag.String("name", "", "Device name (optional, used during pairing)")
	apiURL := flag.String("api", "", "Supabase Edge Function base URL (e.g. https://xyz.supabase.co/functions/v1)")
	configPath := flag.String("config", defaultConfigPath(), "Path to config file")
	shell := flag.String("shell", defaultShell(), "Shell to spawn (default: $SHELL or /bin/sh)")
	workdir := flag.String("workdir", "", "Working directory for shell sessions (default: home directory)")
	flag.Parse()

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
