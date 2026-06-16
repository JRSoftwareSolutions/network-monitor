package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"network-monitor/internal/config"
	"network-monitor/internal/metrics"
	"network-monitor/internal/store"
)

type Handlers struct {
	cfgMgr    *config.Manager
	store     *store.Store
	sse       *SSEHub
	startedAt time.Time
}

func NewHandlers(cfgMgr *config.Manager, st *store.Store, sse *SSEHub, startedAt time.Time) *Handlers {
	return &Handlers{cfgMgr: cfgMgr, store: st, sse: sse, startedAt: startedAt}
}

func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"ok":       true,
		"uptime_s": int(time.Since(h.startedAt).Seconds()),
	})
}

func (h *Handlers) GetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := h.cfgMgr.Get()
	writeJSON(w, map[string]any{
		"target":                cfg.Target,
		"ping_interval_seconds":   cfg.PingIntervalSeconds,
		"retention_minutes":       cfg.RetentionMinutes,
		"listen_host":             cfg.ListenHost,
		"listen_port":             cfg.ListenPort,
		"thresholds":              cfg.Thresholds,
		"window_options_minutes":  windowOptions(cfg.RetentionMinutes),
	})
}

func (h *Handlers) PutConfig(w http.ResponseWriter, r *http.Request) {
	if !h.allowConfigWrite(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var patch config.ConfigUpdate
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	updated, err := h.cfgMgr.Update(patch)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.sse.Broadcast("config", map[string]any{
		"target":                updated.Target,
		"ping_interval_seconds": updated.PingIntervalSeconds,
		"retention_minutes":     updated.RetentionMinutes,
	})

	writeJSON(w, map[string]any{
		"target":                updated.Target,
		"ping_interval_seconds": updated.PingIntervalSeconds,
		"retention_minutes":     updated.RetentionMinutes,
	})
}

func (h *Handlers) Summary(w http.ResponseWriter, r *http.Request) {
	minutes := queryMinutes(r, h.cfgMgr.Get().RetentionMinutes)
	since := time.Now().Add(-time.Duration(minutes) * time.Minute)
	samples, err := h.store.QuerySince(since)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cfg := h.cfgMgr.Get()
	summary := metrics.ComputeSummary(samples, minutes, cfg.Thresholds)
	writeJSON(w, summary)
}

func (h *Handlers) Samples(w http.ResponseWriter, r *http.Request) {
	minutes := queryMinutes(r, h.cfgMgr.Get().RetentionMinutes)
	since := time.Now().Add(-time.Duration(minutes) * time.Minute)
	samples, err := h.store.QuerySince(since)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	samples = store.Downsample(samples, 1500)
	writeJSON(w, map[string]any{"samples": samples, "window_minutes": minutes})
}

func (h *Handlers) Live(w http.ResponseWriter, r *http.Request) {
	since := time.Now().Add(-60 * time.Second)
	samples, err := h.store.QuerySince(since)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cfg := h.cfgMgr.Get()
	writeJSON(w, metrics.ComputeLive(samples, cfg.Thresholds))
}

func (h *Handlers) allowConfigWrite(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		host = r.Host
	}
	if isLoopback(host) {
		return true
	}
	token := os.Getenv("CONFIG_TOKEN")
	if token == "" {
		return false
	}
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") && strings.TrimPrefix(auth, "Bearer ") == token {
		return true
	}
	return r.Header.Get("X-Config-Token") == token
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func queryMinutes(r *http.Request, maxMinutes int) int {
	defaultMinutes := 30
	if maxMinutes < defaultMinutes {
		defaultMinutes = maxMinutes
	}
	raw := r.URL.Query().Get("minutes")
	if raw == "" {
		return defaultMinutes
	}
	var minutes int
	if _, err := fmt.Sscanf(raw, "%d", &minutes); err != nil {
		return defaultMinutes
	}
	if minutes < 1 {
		minutes = 1
	}
	if minutes > maxMinutes {
		minutes = maxMinutes
	}
	return minutes
}

func windowOptions(retention int) []int {
	options := []int{5, 15, 30, 60, 120, 180}
	out := make([]int, 0, len(options))
	for _, v := range options {
		if v <= retention {
			out = append(out, v)
		}
	}
	if len(out) == 0 {
		out = append(out, retention)
	}
	return out
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(true)
	_ = enc.Encode(v)
}
