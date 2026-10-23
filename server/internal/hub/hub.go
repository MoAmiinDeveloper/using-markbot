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

// DeviceScoped is implemented by payloads that belong to one device
// (positions, devices, events, commands). Such messages are only delivered
// to clients whose filter allows that device; other messages go to everyone.
type DeviceScoped interface {
	ScopeDeviceID() int64
}

// Client is one subscriber. Read frames from C; when C is closed the client
// was dropped (too slow) or the hub shut down.
type Client struct {
	C     <-chan []byte
	ch    chan []byte
	allow func(deviceID int64) bool // nil = everything
	// allowMsg, when set, replaces allow and decides for every message.
	allowMsg func(msgType string, data any) bool
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

// Subscribe registers a new client that receives every message. After Close
// it returns a client whose channel is already closed.
func (h *Hub) Subscribe() *Client { return h.SubscribeFiltered(nil) }

// SubscribeFiltered registers a client that only receives device-scoped
// messages for devices allow accepts. allow runs on the publishing goroutine
// with the hub lock held, so it must be fast and must not call into the hub.
func (h *Hub) SubscribeFiltered(allow func(deviceID int64) bool) *Client {
	return h.subscribe(allow, nil)
}

func (h *Hub) subscribe(allow func(deviceID int64) bool, allowMsg func(string, any) bool) *Client {
	ch := make(chan []byte, h.buffer)
	c := &Client{C: ch, ch: ch, allow: allow, allowMsg: allowMsg}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		close(ch)
		return c
	}
	h.clients[c] = struct{}{}
	return c
}

// SubscribeFunc registers a client whose allow function decides for every
// message (type and payload), for visibility rules that depend on more than
// one device (e.g. dispatch jobs). Same constraints as SubscribeFiltered.
func (h *Hub) SubscribeFunc(allow func(msgType string, data any) bool) *Client {
	return h.subscribe(nil, allow)
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
	scoped, isScoped := data.(DeviceScoped)
	var deviceID int64
	if isScoped {
		deviceID = scoped.ScopeDeviceID()
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		if c.allowMsg != nil {
			if !c.allowMsg(msgType, data) {
				continue
			}
		} else if isScoped && c.allow != nil && !c.allow(deviceID) {
			continue
		}
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
