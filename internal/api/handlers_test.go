package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"network-monitor/internal/config"
	"network-monitor/internal/store"
)

func TestHealthAndSummary(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(dir, "data", "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	lat := 25.0
	_ = st.Insert(store.Sample{
		TS:        time.Now().UTC().Format(time.RFC3339Nano),
		Host:      "1.1.1.1",
		Success:   true,
		LatencyMs: &lat,
	})

	h := NewHandlers(cfgMgr, st, NewSSEHub(), time.Now())

	t.Run("health", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		h.Health(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d", rec.Code)
		}
	})

	t.Run("summary", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/summary?minutes=30", nil)
		rec := httptest.NewRecorder()
		h.Summary(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d", rec.Code)
		}
		var payload map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if payload["sample_count"].(float64) < 1 {
			t.Fatalf("summary=%v", payload)
		}
	})
}

func TestPutConfigLocalhostAllowed(t *testing.T) {
	dir := t.TempDir()
	cfgMgr, err := config.NewManager(filepath.Join(dir, "config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(dir, "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	h := NewHandlers(cfgMgr, st, NewSSEHub(), time.Now())
	req := httptest.NewRequest(http.MethodPut, "/api/config", strings.NewReader(`{"target":"8.8.8.8"}`))
	req.Host = "127.0.0.1:8080"
	rec := httptest.NewRecorder()
	h.PutConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}
