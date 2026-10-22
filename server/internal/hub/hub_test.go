package hub

import (
	"encoding/json"
	"sync"
	"testing"
)

func TestPublishDelivers(t *testing.T) {
	h := New(4, nil)
	a, b := h.Subscribe(), h.Subscribe()

	h.Publish("deleted", map[string]int{"id": 7})

	for _, c := range []*Client{a, b} {
		var m struct {
			Type string         `json:"type"`
			Data map[string]int `json:"data"`
		}
		if err := json.Unmarshal(<-c.C, &m); err != nil {
			t.Fatal(err)
		}
		if m.Type != "deleted" || m.Data["id"] != 7 {
			t.Fatalf("got %+v", m)
		}
	}
}

func TestSlowClientDropped(t *testing.T) {
	h := New(2, nil)
	slow := h.Subscribe()
	fast := h.Subscribe()

	for i := 0; i < 3; i++ {
		h.Publish("position", i)
		<-fast.C // fast client keeps up
	}

	if h.Len() != 1 {
		t.Fatalf("Len = %d, want 1", h.Len())
	}
	n := 0
	for range slow.C { // must terminate: channel closed after drop
		n++
	}
	if n != 2 {
		t.Fatalf("slow client got %d buffered frames, want 2", n)
	}
	h.Unsubscribe(slow) // idempotent after drop
}

func TestUnsubscribeAndClose(t *testing.T) {
	h := New(1, nil)
	c := h.Subscribe()
	h.Unsubscribe(c)
	h.Unsubscribe(c)
	if _, ok := <-c.C; ok {
		t.Fatal("channel should be closed")
	}

	d := h.Subscribe()
	h.Close()
	if _, ok := <-d.C; ok {
		t.Fatal("channel should be closed after Close")
	}
	if _, ok := <-h.Subscribe().C; ok {
		t.Fatal("subscribe after Close should return closed client")
	}
	h.Publish("device", nil) // no panic
}

func TestConcurrentPublish(t *testing.T) {
	h := New(1000, nil)
	clients := make([]*Client, 10)
	for i := range clients {
		clients[i] = h.Subscribe()
	}
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				h.Publish("position", i)
			}
		}()
	}
	wg.Add(1)
	go func() { // churn subscribers concurrently
		defer wg.Done()
		for i := 0; i < 100; i++ {
			h.Unsubscribe(h.Subscribe())
		}
	}()
	wg.Wait()
	for _, c := range clients {
		if got := len(c.C); got != 800 {
			t.Fatalf("client got %d frames, want 800", got)
		}
	}
}
