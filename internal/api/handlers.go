package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"network-monitor/internal/config"
	"network-monitor/internal/metrics"
	"network-monitor/internal/speedtest"
	"network-monitor/internal/store"
)

const liveWindowSeconds = 60

type Handlers struct {
	cfgMgr     *config.Manager
	store      *store.Store
	sse        *SSEHub
	speedTest  *speedtest.Runner
	startedAt  time.Time
}

func NewHandlers(cfgMgr *config.Manager, st *store.Store, sse *SSEHub, speedTest *speedtest.Runner, startedAt time.Time) *Handlers {
	return &Handlers{cfgMgr: cfgMgr, store: st, sse: sse, speedTest: speedTest, startedAt: startedAt}
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
		"live_window_seconds":     liveWindowSeconds,
	})
}

func (h *Handlers) PutConfig(w http.ResponseWriter, r *http.Request) {
	if !h.allowConfigWrite(r) {
		logAction("config update denied remote=%s", clientAddr(r))
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
		logAction("config update failed remote=%s err=%v", clientAddr(r), err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	logAction(
		"config updated remote=%s target=%s ping_interval_seconds=%g retention_minutes=%d",
		clientAddr(r),
		updated.Target,
		updated.PingIntervalSeconds,
		updated.RetentionMinutes,
	)

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
	minutes, samples, _, err := h.samplesForWindow(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cfg := h.cfgMgr.Get()
	summary := metrics.ComputeSummary(samples, minutes, cfg.Thresholds)
	writeJSON(w, summary)
}

func (h *Handlers) Samples(w http.ResponseWriter, r *http.Request) {
	minutes, samples, since, err := h.samplesForWindow(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	bucketSeconds := metrics.DisplayBucketSeconds(minutes)
	buckets := metrics.AggregateBuckets(samples, since, bucketSeconds)
	writeJSON(w, map[string]any{
		"buckets":        buckets,
		"window_minutes": minutes,
		"bucket_seconds": bucketSeconds,
	})
}

func (h *Handlers) samplesForWindow(r *http.Request) (minutes int, samples []store.Sample, since time.Time, err error) {
	minutes = queryMinutes(r, h.cfgMgr.Get().RetentionMinutes)
	since = time.Now().Add(-time.Duration(minutes) * time.Minute)
	samples, err = h.store.QuerySince(since)
	return minutes, samples, since, err
}

func (h *Handlers) Live(w http.ResponseWriter, r *http.Request) {
	since := time.Now().Add(-liveWindowSeconds * time.Second)
	samples, err := h.store.QuerySince(since)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, metrics.ComputeLive(samples))
}

func (h *Handlers) SpeedTest(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, map[string]bool{"running": h.speedTest.Running()})
		return
	case http.MethodPost:
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	remote := clientAddr(r)
	cfg := h.cfgMgr.Get()
	logAction(
		"speedtest started remote=%s duration_seconds=%d parallel_streams=%d",
		remote,
		cfg.SpeedTest.DurationSeconds,
		cfg.SpeedTest.ParallelStreams,
	)

	stCfg := speedtest.Config{
		Servers:         cfg.SpeedTest.Servers,
		DownloadPath:    cfg.SpeedTest.DownloadPath,
		UploadPath:      cfg.SpeedTest.UploadPath,
		DownloadURL:     cfg.SpeedTest.DownloadURL,
		UploadURL:       cfg.SpeedTest.UploadURL,
		DurationSeconds: cfg.SpeedTest.DurationSeconds,
		ParallelStreams: cfg.SpeedTest.ParallelStreams,
	}
	timeout := time.Duration(stCfg.DurationSeconds*2+15) * time.Second
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	result, err := h.speedTest.Run(ctx, stCfg, func(p speedtest.Progress) {
		h.sse.Broadcast("speedtest_progress", p)
	})
	if err == speedtest.ErrBusy {
		logAction("speedtest rejected remote=%s reason=busy", remote)
		http.Error(w, "speed test already running", http.StatusConflict)
		return
	}
	if err != nil {
		logAction("speedtest failed remote=%s err=%v", remote, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if result.Error != nil {
		logAction("speedtest finished remote=%s error=%q", remote, *result.Error)
	} else {
		logAction(
			"speedtest finished remote=%s download_mbps=%s upload_mbps=%s",
			remote,
			formatMbps(result.DownloadMbps),
			formatMbps(result.UploadMbps),
		)
	}
	if err := h.store.InsertSpeedTestResult(speedTestResultToStore(result)); err != nil {
		log.Printf("speedtest store insert: %v", err)
	}
	writeJSON(w, result)
}

func formatMbps(v *float64) string {
	if v == nil {
		return "—"
	}
	return fmt.Sprintf("%.2f", *v)
}

func (h *Handlers) SpeedTestResults(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	limit := queryLimit(r, 50)
	results, err := h.store.QuerySpeedTestResults(limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if results == nil {
		results = []store.SpeedTestResult{}
	}
	writeJSON(w, map[string]any{"results": results})
}

func speedTestResultToStore(result speedtest.Result) store.SpeedTestResult {
	return store.SpeedTestResult{
		TS:              result.TS,
		DownloadMbps:    result.DownloadMbps,
		UploadMbps:      result.UploadMbps,
		DurationSeconds: result.DurationSeconds,
		Error:           result.Error,
	}
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

func queryLimit(r *http.Request, defaultLimit int) int {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return defaultLimit
	}
	var limit int
	if _, err := fmt.Sscanf(raw, "%d", &limit); err != nil {
		return defaultLimit
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 500 {
		limit = 500
	}
	return limit
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
