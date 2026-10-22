// Package hub fans out live events to WebSocket clients from memory.
//
// Publishing never blocks: every client owns a buffered channel and a client
// whose buffer is full is dropped (its channel is closed) so a slow browser
// can never stall the ingest path.
package hub

import (
	"encoding/json"
	"log/slog"
	"sync"
)

// DefaultBuffer is the per-client queue length used when New gets n <= 0.
const DefaultBuffer = 256

// Message is the envelope sent to clients, one JSON object per frame.
type Message struct {
	Type string `json:"type"`
	Data any    `json:"data,omitempty"` // nil for notification-only messages
}

// Client is one subscriber. Read frames from C; when C is closed the client
// was dropped (too slow) or the hub shut down.
type Client struct {
	C  <-chan []byte
	ch chan []byte
}

// Hub is an in-memory publish/subscribe broker. The zero value is not usable;
// create one with New.
type Hub struct {
	log    *slog.Logger
	buffer int

	mu      sync.Mutex // guards clients and closed; held while sending (sends never block)
	clients map[*Client]struct{}
	closed  bool
}

// New returns a hub whose clients buffer up to buffer frames.
func New(buffer int, log *slog.Logger) *Hub {
	if buffer <= 0 {
		buffer = DefaultBuffer
	}
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Hub{log: log, buffer: buffer, clients: make(map[*Client]struct{})}
}

// Subscribe registers a new client. After Close it returns a client whose
// channel is already closed.
func (h *Hub) Subscribe() *Client {
	ch := make(chan []byte, h.buffer)
	c := &Client{C: ch, ch: ch}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		close(ch)
		return c
	}
	h.clients[c] = struct{}{}
	return c
}

// Unsubscribe removes c and closes its channel. It is safe to call more than once.
func (h *Hub) Unsubscribe(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.drop(c)
}

// Publish encodes msgType/data once and queues it for every client.
func (h *Hub) Publish(msgType string, data any) {
	frame, err := json.Marshal(Message{Type: msgType, Data: data})
	if err != nil {
		h.log.Error("hub: encode message", "type", msgType, "err", err)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c.ch <- frame:
		default:
			h.log.Warn("hub: dropping slow client")
			h.drop(c)
		}
	}
}

// Len reports the number of connected clients.
func (h *Hub) Len() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// Close disconnects all clients and rejects future subscriptions.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for c := range h.clients {
		h.drop(c)
	}
}

// drop must be called with h.mu held.
func (h *Hub) drop(c *Client) {
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.ch)
	}
}
