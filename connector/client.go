package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
    "syscall"
	"sync"
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
}

// SessionEndData is the payload for session_end messages.
type SessionEndData struct {
	SessionID string `json:"session_id"`
	Reason    string `json:"reason"`
}

// RelayClient manages the WebSocket connection and PTY sessions.
type RelayClient struct {
	config   *Config
	shell    string
	conn     *websocket.Conn
	sessions map[string]*PTYSession
	mu       sync.Mutex
	done     chan struct{}
}

// PTYSession represents an active terminal session.
type PTYSession struct {
	id   string
	ptmx *os.File
	cmd  *exec.Cmd
	done chan struct{}
}

// NewRelayClient creates a new relay client.
func NewRelayClient(cfg *Config, shell string) *RelayClient {
	return &RelayClient{
		config:   cfg,
		shell:    shell,
		sessions: make(map[string]*PTYSession),
		done:     make(chan struct{}),
	}
}

// Run connects to the relay and processes messages until closed.
func (c *RelayClient) Run() error {
	connectURL := c.config.RelayURL + "/connect"
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

	case "error":
		log.Printf("Relay error: %s", string(msg.Data))

	default:
		log.Printf("Unknown message type: %s", msg.Type)
	}
}

func (c *RelayClient) startSession(data SessionStartData) {
	log.Printf("Starting session %s (%dx%d)", data.SessionID, data.Cols, data.Rows)

	cmd := exec.Command(c.shell)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

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

	// Acknowledge session start
	ackData, _ := json.Marshal(map[string]string{"session_id": data.SessionID})
	c.sendMessage("session_started", ackData)

	// Read PTY output and forward to relay
	go c.readPTY(sess)

	// Wait for process to exit
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
		return
	}

	pty.Setsize(sess.ptmx, &pty.Winsize{
		Cols: uint16(data.Cols),
		Rows: uint16(data.Rows),
	})
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
