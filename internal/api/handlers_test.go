package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"network-monitor/internal/config"
	"network-monitor/internal/speedtest"
	"network-monitor/internal/store"
)

func testHandlers(t *testing.T) (*Handlers, *store.Store) {
	t.Helper()
	dir := t.TempDir()
	cfgMgr, err := config.NewManager(filepath.Join(dir, "config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(dir, "data", "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return NewHandlers(cfgMgr, st, NewSSEHub(), speedtest.NewRunner(), time.Now()), st
}

func TestHealthAndSummary(t *testing.T) {
	h, st := testHandlers(t)

	lat := 25.0
	sampleTS := time.Now().UTC().Format(time.RFC3339Nano)
	if err := st.Insert(store.Sample{
		TS:        sampleTS,
		Host:      "1.1.1.1",
		Success:   true,
		LatencyMs: &lat,
	}); err != nil {
		t.Fatal(err)
	}

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

	t.Run("samples buckets", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/samples?minutes=30", nil)
		rec := httptest.NewRecorder()
		h.Samples(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d", rec.Code)
		}
		var payload map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		buckets, ok := payload["buckets"].([]any)
		if !ok || len(buckets) < 1 {
			t.Fatalf("buckets=%v", payload["buckets"])
		}
		first, ok := buckets[0].(map[string]any)
		if !ok {
			t.Fatalf("bucket type=%T", buckets[0])
		}
		if first["avg_ms"] == nil || first["min_ms"] == nil || first["max_ms"] == nil {
			t.Fatalf("bucket fields=%v", first)
		}
		if first["sample_count"].(float64) < 1 {
			t.Fatalf("sample_count=%v", first["sample_count"])
		}
		if _, ok := payload["bucket_seconds"]; !ok {
			t.Fatalf("missing bucket_seconds in %v", payload)
		}
		if payload["bucket_seconds"].(float64) != 6 {
			t.Fatalf("bucket_seconds=%v want 6 for 30 min window", payload["bucket_seconds"])
		}
	})

	t.Run("live last_ts", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/live", nil)
		rec := httptest.NewRecorder()
		h.Live(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d", rec.Code)
		}
		var payload map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if payload["last_ts"] == nil || payload["last_ts"] == "" {
			t.Fatalf("last_ts missing in %v", payload)
		}
		if payload["last_success"] != true {
			t.Fatalf("last_success=%v want true", payload["last_success"])
		}
	})

	t.Run("config live window", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
		rec := httptest.NewRecorder()
		h.GetConfig(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d", rec.Code)
		}
		var payload map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if payload["live_window_seconds"].(float64) != 60 {
			t.Fatalf("live_window_seconds=%v", payload["live_window_seconds"])
		}
	})
}

func TestQueryMinutes(t *testing.T) {
	cases := []struct {
		name       string
		query      string
		retention  int
		want       int
	}{
		{name: "default", query: "", retention: 180, want: 30},
		{name: "explicit", query: "15", retention: 180, want: 15},
		{name: "clamp low", query: "0", retention: 180, want: 1},
		{name: "clamp high", query: "999", retention: 60, want: 60},
		{name: "retention below default", query: "", retention: 10, want: 10},
		{name: "invalid", query: "abc", retention: 180, want: 30},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			url := "/api/summary"
			if tc.query != "" {
				url += "?minutes=" + tc.query
			}
			req := httptest.NewRequest(http.MethodGet, url, nil)
			got := queryMinutes(req, tc.retention)
			if got != tc.want {
				t.Fatalf("queryMinutes=%d want %d", got, tc.want)
			}
		})
	}
}

func TestWindowOptions(t *testing.T) {
	got := windowOptions(180)
	want := []int{5, 15, 30, 60, 120, 180}
	if len(got) != len(want) {
		t.Fatalf("len=%d want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("options[%d]=%d want %d", i, got[i], want[i])
		}
	}

	short := windowOptions(3)
	if len(short) != 1 || short[0] != 3 {
		t.Fatalf("short retention options=%v want [3]", short)
	}
}

func TestPutConfigLocalhostAllowed(t *testing.T) {
	h, _ := testHandlers(t)
	req := httptest.NewRequest(http.MethodPut, "/api/config", strings.NewReader(`{"target":"8.8.8.8"}`))
	req.Host = "127.0.0.1:8080"
	rec := httptest.NewRecorder()
	h.PutConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestPutConfigForbidden(t *testing.T) {
	h, _ := testHandlers(t)
	req := httptest.NewRequest(http.MethodPut, "/api/config", strings.NewReader(`{"target":"8.8.8.8"}`))
	req.Host = "192.168.1.10:8080"
	rec := httptest.NewRecorder()
	h.PutConfig(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d want 403", rec.Code)
	}
}

func TestSpeedTest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			if strings.Contains(r.URL.Path, "garbage") {
				_, _ = w.Write(make([]byte, 128*1024))
				return
			}
			http.NotFound(w, r)
		case http.MethodPost:
			if strings.Contains(r.URL.Path, "empty") {
				_, _ = io.ReadAll(r.Body)
				w.WriteHeader(http.StatusOK)
				return
			}
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	cfgYAML := "target: 1.1.1.1\nping_interval_seconds: 1\nretention_minutes: 180\nspeedtest:\n  servers:\n    - " + srv.URL + "/\n  duration_seconds: 5\n  parallel_streams: 2\n"
	if err := os.WriteFile(cfgPath, []byte(cfgYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(dir, "data", "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	h := NewHandlers(cfgMgr, st, NewSSEHub(), speedtest.NewRunnerWithClient(srv.Client()), time.Now())

	req := httptest.NewRequest(http.MethodPost, "/api/speedtest", nil)
	rec := httptest.NewRecorder()
	h.SpeedTest(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["download_mbps"] == nil {
		t.Fatalf("missing download_mbps in %v", payload)
	}
	if payload["upload_mbps"] == nil {
		t.Fatalf("missing upload_mbps in %v", payload)
	}

	results, err := st.QuerySpeedTestResults(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Fatalf("stored results=%d", len(results))
	}

	req = httptest.NewRequest(http.MethodGet, "/api/speedtest/results?limit=10", nil)
	rec = httptest.NewRecorder()
	h.SpeedTestResults(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("results status=%d body=%s", rec.Code, rec.Body.String())
	}
	var list struct {
		Results []map[string]any `json:"results"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Results) != 1 {
		t.Fatalf("api results=%d", len(list.Results))
	}
}

func TestSpeedTestStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		switch r.Method {
		case http.MethodGet:
			if strings.Contains(r.URL.Path, "garbage") {
				_, _ = w.Write(make([]byte, 128*1024))
				return
			}
			http.NotFound(w, r)
		case http.MethodPost:
			if strings.Contains(r.URL.Path, "empty") {
				_, _ = io.ReadAll(r.Body)
				w.WriteHeader(http.StatusOK)
				return
			}
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	cfgYAML := "target: 1.1.1.1\nping_interval_seconds: 1\nretention_minutes: 180\nspeedtest:\n  servers:\n    - " + srv.URL + "/\n  duration_seconds: 5\n  parallel_streams: 1\n"
	if err := os.WriteFile(cfgPath, []byte(cfgYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(dir, "data", "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	runner := speedtest.NewRunnerWithClient(srv.Client())
	h := NewHandlers(cfgMgr, st, NewSSEHub(), runner, time.Now())

	req := httptest.NewRequest(http.MethodGet, "/api/speedtest", nil)
	rec := httptest.NewRecorder()
	h.SpeedTest(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var idle map[string]bool
	if err := json.Unmarshal(rec.Body.Bytes(), &idle); err != nil {
		t.Fatal(err)
	}
	if idle["running"] {
		t.Fatal("expected idle status")
	}

	done := make(chan struct{})
	go func() {
		req := httptest.NewRequest(http.MethodPost, "/api/speedtest", nil)
		rec := httptest.NewRecorder()
		h.SpeedTest(rec, req)
		close(done)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		req = httptest.NewRequest(http.MethodGet, "/api/speedtest", nil)
		rec = httptest.NewRecorder()
		h.SpeedTest(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
		var status map[string]bool
		if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
			t.Fatal(err)
		}
		if status["running"] {
			<-done
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for running status")
}
