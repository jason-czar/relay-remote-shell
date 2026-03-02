package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

// Message is the relay protocol envelope.
type Message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

// SessionStartData is the payload for session_start messages.
type SessionStartData struct {
	SessionID string `json:"session_id"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
}

// StdinData is the payload for stdin messages.
type StdinData struct {
	SessionID string `json:"session_id"`
	DataB64   string `json:"data_b64"`
}

// ResizeData is the payload for resize messages.
type ResizeData struct {
	SessionID string `json:"session_id"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
	Probe     bool   `json:"probe,omitempty"`
}

// SessionEndData is the payload for session_end messages.
type SessionEndData struct {
	SessionID string `json:"session_id"`
	Reason    string `json:"reason"`
}

// HTTPRequestData is the payload for http_request messages (proxy).
type HTTPRequestData struct {
	RequestID string            `json:"request_id"`
	Method    string            `json:"method"`
	Path      string            `json:"path"`
	Headers   map[string]string `json:"headers,omitempty"`
	BodyB64   string            `json:"body_b64,omitempty"`
}

// HTTPResponseData is the payload for http_response messages (proxy reply).
type HTTPResponseData struct {
	RequestID  string            `json:"request_id"`
	StatusCode int               `json:"status_code"`
	Headers    map[string]string `json:"headers,omitempty"`
	BodyB64    string            `json:"body_b64,omitempty"`
}

// WSOpenData is the payload for ws_open messages (WebSocket proxy).
type WSOpenData struct {
	TunnelID  string   `json:"tunnel_id"`
	URL       string   `json:"url"`
	Protocols []string `json:"protocols,omitempty"`
}

// WSFrameData is the payload for ws_frame messages.
type WSFrameData struct {
	TunnelID string `json:"tunnel_id"`
	DataB64  string `json:"data_b64"`
	Binary   bool   `json:"binary"`
}

// WSCloseData is the payload for ws_close messages.
type WSCloseData struct {
	TunnelID string `json:"tunnel_id"`
	Code     int    `json:"code"`
	Reason   string `json:"reason,omitempty"`
}

// WSTunnel represents an active WebSocket proxy tunnel.
type WSTunnel struct {
	id   string
	conn *websocket.Conn
	done chan struct{}
}

// RelayClient manages the WebSocket connection and PTY sessions.
type RelayClient struct {
	config        *Config
	shell         string
	workdir       string
	conn          *websocket.Conn
	sessions      map[string]*PTYSession
	wsTunnels     map[string]*WSTunnel
	mu            sync.Mutex
	done          chan struct{}
	authenticated bool
}

// PTYSession represents an active terminal session.
type PTYSession struct {
	id   string
	ptmx *os.File
	cmd  *exec.Cmd
	done chan struct{}
}

// NewRelayClient creates a new relay client.
func NewRelayClient(cfg *Config, shell, workdir string) *RelayClient {
	return &RelayClient{
		config:    cfg,
		shell:     shell,
		workdir:   workdir,
		sessions:  make(map[string]*PTYSession),
		wsTunnels: make(map[string]*WSTunnel),
		done:      make(chan struct{}),
	}
}

// Run connects to the relay and processes messages until closed.
func (c *RelayClient) Run() error {
	// Convert HTTP(S) URL to WebSocket URL
	relayURL := strings.TrimRight(c.config.RelayURL, "/")
	relayURL = strings.Replace(relayURL, "https://", "wss://", 1)
	relayURL = strings.Replace(relayURL, "http://", "ws://", 1)
	connectURL := relayURL + "/connect"
	log.Printf("Connecting to %s", connectURL)

	header := http.Header{}
	conn, _, err := websocket.DefaultDialer.Dial(connectURL, header)
	if err != nil {
		return fmt.Errorf("websocket dial failed: %w", err)
	}
	c.conn = conn
	defer conn.Close()

	// Send hello
	helloData, _ := json.Marshal(map[string]interface{}{
		"device_id": c.config.DeviceID,
		"token":     c.config.Token,
		"meta":      map[string]string{"name": "connector"},
	})
	c.sendMessage("hello", helloData)

	// Read messages
	for {
		select {
		case <-c.done:
			return nil
		default:
		}

		_, raw, err := conn.ReadMessage()
		if err != nil {
			select {
			case <-c.done:
				return nil
			default:
				return fmt.Errorf("read error: %w", err)
			}
		}

		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("Invalid message: %v", err)
			continue
		}

		c.handleMessage(msg)
	}
}

// Close shuts down the client and all sessions.
func (c *RelayClient) Close() {
	select {
	case <-c.done:
		return
	default:
		close(c.done)
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	for id, sess := range c.sessions {
		c.cleanupSession(id, sess)
	}

	for id, tunnel := range c.wsTunnels {
		c.cleanupWSTunnel(id, tunnel)
	}

	if c.conn != nil {
		c.conn.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		)
		c.conn.Close()
	}
}

func (c *RelayClient) handleMessage(msg Message) {
	switch msg.Type {
	case "hello_ok":
		log.Println("✓ Authenticated with relay")
		c.authenticated = true
		// Check if relay sent a workdir override from device config
		var helloOkData struct {
			Workdir string `json:"workdir"`
		}
		if msg.Data != nil {
			if err := json.Unmarshal(msg.Data, &helloOkData); err == nil && helloOkData.Workdir != "" {
				log.Printf("  Remote workdir configured: %s", helloOkData.Workdir)
				if c.workdir == "" {
					// Only override if no local --workdir flag was set
					c.workdir = helloOkData.Workdir
				}
			}
		}

	case "session_start":
		var data SessionStartData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			log.Printf("Invalid session_start: %v", err)
			return
		}
		c.startSession(data)

	case "stdin":
		var data StdinData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			log.Printf("Invalid stdin: %v", err)
			return
		}
		c.handleStdin(data)

	case "resize":
		var data ResizeData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			log.Printf("Invalid resize: %v", err)
			return
		}
		c.handleResize(data)

	case "session_end":
		var data SessionEndData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			log.Printf("Invalid session_end: %v", err)
			return
		}
		c.endSession(data.SessionID, data.Reason)

	case "http_request":
		var data HTTPRequestData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			log.Printf("Invalid http_request: %v", err)
			return
		}
		go c.handleHTTPRequest(data)

	case "ws_open":
		var data WSOpenData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			log.Printf("Invalid ws_open: %v", err)
			return
		}
		go c.handleWSOpen(data)

	case "ws_frame":
		var data WSFrameData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			log.Printf("Invalid ws_frame: %v", err)
			return
		}
		c.handleWSFrame(data)

	case "ws_close":
		var data WSCloseData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			log.Printf("Invalid ws_close: %v", err)
			return
		}
		c.handleWSClose(data)

	case "error":
		log.Printf("Relay error: %s", string(msg.Data))

	default:
		log.Printf("Unknown message type: %s", msg.Type)
	}
}

// ─── WebSocket Proxy Handlers ────────────────────────────────────────

func (c *RelayClient) handleWSOpen(data WSOpenData) {
	log.Printf("[ws-proxy] opening tunnel %s → %s", data.TunnelID[:8], data.URL)

	// Validate URL
	parsed, err := url.Parse(data.URL)
	if err != nil || (parsed.Scheme != "ws" && parsed.Scheme != "wss") {
		c.sendWSError(data.TunnelID, fmt.Sprintf("Invalid WebSocket URL: %s", data.URL))
		return
	}

	// Connect to local WebSocket
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}
	header := http.Header{}

	var conn *websocket.Conn
	if len(data.Protocols) > 0 {
		header.Set("Sec-WebSocket-Protocol", strings.Join(data.Protocols, ", "))
		conn, _, err = dialer.Dial(data.URL, header)
	} else {
		conn, _, err = dialer.Dial(data.URL, header)
	}
	if err != nil {
		c.sendWSError(data.TunnelID, fmt.Sprintf("Failed to connect to %s: %v", data.URL, err))
		return
	}

	tunnel := &WSTunnel{
		id:   data.TunnelID,
		conn: conn,
		done: make(chan struct{}),
	}

	c.mu.Lock()
	c.wsTunnels[data.TunnelID] = tunnel
	c.mu.Unlock()

	// Confirm tunnel opened
	ackData, _ := json.Marshal(map[string]string{"tunnel_id": data.TunnelID})
	c.sendMessage("ws_opened", ackData)

	log.Printf("[ws-proxy] tunnel %s connected to %s", data.TunnelID[:8], data.URL)

	// Read from local WS and forward to relay
	go c.readWSTunnel(tunnel)
}

func (c *RelayClient) readWSTunnel(tunnel *WSTunnel) {
	defer func() {
		c.mu.Lock()
		delete(c.wsTunnels, tunnel.id)
		c.mu.Unlock()
		tunnel.conn.Close()
	}()

	for {
		select {
		case <-tunnel.done:
			return
		default:
		}

		msgType, data, err := tunnel.conn.ReadMessage()
		if err != nil {
			select {
			case <-tunnel.done:
				return
			default:
			}
			// Notify relay that the local WS closed
			closeData, _ := json.Marshal(map[string]interface{}{
				"tunnel_id": tunnel.id,
				"code":      1000,
				"reason":    "local websocket closed",
			})
			c.sendMessage("ws_close", closeData)
			return
		}

		isBinary := msgType == websocket.BinaryMessage
		encoded := base64.StdEncoding.EncodeToString(data)

		frameData, _ := json.Marshal(WSFrameData{
			TunnelID: tunnel.id,
			DataB64:  encoded,
			Binary:   isBinary,
		})
		c.sendMessage("ws_frame", frameData)
	}
}

func (c *RelayClient) handleWSFrame(data WSFrameData) {
	c.mu.Lock()
	tunnel, ok := c.wsTunnels[data.TunnelID]
	c.mu.Unlock()
	if !ok {
		return
	}

	decoded, err := base64.StdEncoding.DecodeString(data.DataB64)
	if err != nil {
		log.Printf("[ws-proxy] invalid base64 frame: %v", err)
		return
	}

	msgType := websocket.TextMessage
	if data.Binary {
		msgType = websocket.BinaryMessage
	}

	if err := tunnel.conn.WriteMessage(msgType, decoded); err != nil {
		log.Printf("[ws-proxy] write error on tunnel %s: %v", data.TunnelID[:8], err)
	}
}

func (c *RelayClient) handleWSClose(data WSCloseData) {
	log.Printf("[ws-proxy] closing tunnel %s", data.TunnelID[:8])
	c.mu.Lock()
	tunnel, ok := c.wsTunnels[data.TunnelID]
	if ok {
		c.cleanupWSTunnel(data.TunnelID, tunnel)
	}
	c.mu.Unlock()
}

func (c *RelayClient) cleanupWSTunnel(id string, tunnel *WSTunnel) {
	select {
	case <-tunnel.done:
	default:
		close(tunnel.done)
	}
	tunnel.conn.WriteMessage(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
	)
	tunnel.conn.Close()
	delete(c.wsTunnels, id)
}

func (c *RelayClient) sendWSError(tunnelID, message string) {
	errData, _ := json.Marshal(map[string]string{
		"tunnel_id": tunnelID,
		"message":   message,
	})
	c.sendMessage("ws_error", errData)
}

// ─── HTTP Proxy Handler ─────────────────────────────────────────────

func (c *RelayClient) handleHTTPRequest(data HTTPRequestData) {
	log.Printf("[proxy] %s %s (req %s)", data.Method, data.Path, data.RequestID[:8])

	targetURL := "http:/" + data.Path

	var bodyReader io.Reader
	if data.BodyB64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(data.BodyB64)
		if err != nil {
			c.sendHTTPError(data.RequestID, 400, "Invalid request body encoding")
			return
		}
		bodyReader = strings.NewReader(string(decoded))
	}

	req, err := http.NewRequest(data.Method, targetURL, bodyReader)
	if err != nil {
		c.sendHTTPError(data.RequestID, 500, fmt.Sprintf("Failed to create request: %v", err))
		return
	}

	for k, v := range data.Headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.sendHTTPError(data.RequestID, 502, fmt.Sprintf("Local request failed: %v", err))
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
	if err != nil {
		c.sendHTTPError(data.RequestID, 502, fmt.Sprintf("Failed to read response: %v", err))
		return
	}

	respHeaders := make(map[string]string)
	for k := range resp.Header {
		respHeaders[k] = resp.Header.Get(k)
	}

	responseData := HTTPResponseData{
		RequestID:  data.RequestID,
		StatusCode: resp.StatusCode,
		Headers:    respHeaders,
		BodyB64:    base64.StdEncoding.EncodeToString(body),
	}

	raw, _ := json.Marshal(responseData)
	c.sendMessage("http_response", raw)
	log.Printf("[proxy] %s %s → %d (%d bytes)", data.Method, data.Path, resp.StatusCode, len(body))
}

func (c *RelayClient) sendHTTPError(requestID string, statusCode int, message string) {
	responseData := HTTPResponseData{
		RequestID:  requestID,
		StatusCode: statusCode,
		Headers:    map[string]string{"Content-Type": "application/json"},
		BodyB64:    base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf(`{"error":"%s"}`, message))),
	}
	raw, _ := json.Marshal(responseData)
	c.sendMessage("http_response", raw)
}

// ─── PTY Session Handlers ───────────────────────────────────────────

func (c *RelayClient) startSession(data SessionStartData) {
	log.Printf("Starting session %s (%dx%d)", data.SessionID, data.Cols, data.Rows)

	// Spawn as a login interactive shell (-lic) so that /etc/profile, ~/.zprofile,
	// ~/.bash_profile are sourced and interactive PATH (npm globals, nvm, brew, etc.)
	// is fully loaded — matching a real terminal session.
	cmd := exec.Command(c.shell, "-lic", "exec "+c.shell)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	// Set working directory: prefer --workdir flag, fallback to home directory
	if c.workdir != "" {
		cmd.Dir = c.workdir
	} else if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home
	}

	winSize := &pty.Winsize{
		Cols: uint16(data.Cols),
		Rows: uint16(data.Rows),
	}

	ptmx, err := pty.StartWithSize(cmd, winSize)
	if err != nil {
		log.Printf("Failed to start PTY: %v", err)
		endData, _ := json.Marshal(map[string]string{
			"session_id": data.SessionID,
			"reason":     "pty_error",
		})
		c.sendMessage("session_end", endData)
		return
	}

	sess := &PTYSession{
		id:   data.SessionID,
		ptmx: ptmx,
		cmd:  cmd,
		done: make(chan struct{}),
	}

	c.mu.Lock()
	c.sessions[data.SessionID] = sess
	c.mu.Unlock()

	ackData, _ := json.Marshal(map[string]string{"session_id": data.SessionID})
	c.sendMessage("session_started", ackData)

	go c.readPTY(sess)

	go func() {
		_ = cmd.Wait()
		log.Printf("Session %s: shell exited", data.SessionID)
		endData, _ := json.Marshal(map[string]string{
			"session_id": data.SessionID,
			"reason":     "exit",
		})
		c.sendMessage("session_end", endData)
		c.mu.Lock()
		delete(c.sessions, data.SessionID)
		c.mu.Unlock()
		close(sess.done)
	}()
}

func (c *RelayClient) readPTY(sess *PTYSession) {
	buf := make([]byte, 4096)
	for {
		select {
		case <-sess.done:
			return
		default:
		}

		n, err := sess.ptmx.Read(buf)
		if err != nil {
			return
		}
		if n > 0 {
			encoded := base64.StdEncoding.EncodeToString(buf[:n])
			data, _ := json.Marshal(map[string]string{
				"session_id": sess.id,
				"data_b64":   encoded,
			})
			c.sendMessage("stdout", data)
		}
	}
}

func (c *RelayClient) handleStdin(data StdinData) {
	c.mu.Lock()
	sess, ok := c.sessions[data.SessionID]
	c.mu.Unlock()
	if !ok {
		log.Printf("stdin for missing session %s", data.SessionID)
		c.sendSessionError(data.SessionID, "session_not_found")
		return
	}

	decoded, err := base64.StdEncoding.DecodeString(data.DataB64)
	if err != nil {
		log.Printf("Invalid base64 stdin: %v", err)
		return
	}
	sess.ptmx.Write(decoded)
}

func (c *RelayClient) handleResize(data ResizeData) {
	c.mu.Lock()
	sess, ok := c.sessions[data.SessionID]
	c.mu.Unlock()
	if !ok {
		log.Printf("resize for missing session %s", data.SessionID)
		c.sendSessionError(data.SessionID, "session_not_found")
		return
	}

	if err := pty.Setsize(sess.ptmx, &pty.Winsize{
		Cols: uint16(data.Cols),
		Rows: uint16(data.Rows),
	}); err != nil {
		log.Printf("Failed to resize session %s: %v", data.SessionID, err)
		c.sendSessionError(data.SessionID, "resize_failed")
		return
	}

	// Probe resize is used by resume flows to verify the PTY still exists.
	// A successful probe returns session_started as a readiness ack.
	if data.Probe {
		ackData, _ := json.Marshal(map[string]string{"session_id": data.SessionID})
		c.sendMessage("session_started", ackData)
	}
}

func (c *RelayClient) endSession(sessionID, reason string) {
	log.Printf("Ending session %s: %s", sessionID, reason)
	c.mu.Lock()
	sess, ok := c.sessions[sessionID]
	if ok {
		c.cleanupSession(sessionID, sess)
	}
	c.mu.Unlock()
}

func (c *RelayClient) cleanupSession(id string, sess *PTYSession) {
	sess.ptmx.Close()
	if sess.cmd.Process != nil {
		sess.cmd.Process.Signal(syscall.SIGTERM)
		go func() {
			time.Sleep(2 * time.Second)
			sess.cmd.Process.Kill()
		}()
	}
	delete(c.sessions, id)
}

func (c *RelayClient) sendMessage(msgType string, data json.RawMessage) {
	msg := Message{Type: msgType, Data: data}
	raw, _ := json.Marshal(msg)

	if c.conn != nil {
		if err := c.conn.WriteMessage(websocket.TextMessage, raw); err != nil {
			log.Printf("Write error: %v", err)
		}
	}
}

func (c *RelayClient) sendSessionError(sessionID, message string) {
	errData, _ := json.Marshal(map[string]string{
		"session_id": sessionID,
		"message":    message,
	})
	c.sendMessage("error", errData)
}
