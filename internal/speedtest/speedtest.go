package speedtest

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

const defaultDurationSeconds = 10
const defaultParallelStreams = 8
const downloadChunkBytes = 10_000_000 // 10 MB per stream
const uploadChunkBytes = 4 << 20       // 4 MB per upload POST

type Config struct {
	Servers         []string
	DownloadPath    string
	UploadPath      string
	DownloadURL     string // legacy: explicit download endpoint
	UploadURL       string // legacy: explicit upload endpoint
	DurationSeconds int
	ParallelStreams int
}

func DefaultConfig() Config {
	return Config{
		Servers:         append([]string(nil), defaultServers...),
		DurationSeconds: defaultDurationSeconds,
		ParallelStreams: defaultParallelStreams,
	}
}

type Progress struct {
	Phase string  `json:"phase"`
	Mbps  float64 `json:"mbps"`
}

type ProgressFunc func(Progress)

type Result struct {
	TS              string   `json:"ts"`
	DownloadMbps    *float64 `json:"download_mbps,omitempty"`
	UploadMbps      *float64 `json:"upload_mbps,omitempty"`
	DurationSeconds int      `json:"duration_seconds"`
	Error           *string  `json:"error,omitempty"`
}

type Runner struct {
	mu      sync.Mutex
	running atomic.Bool
	client  *http.Client
}

func NewRunner() *Runner {
	return NewRunnerWithClient(newSpeedTestHTTPClient())
}

func newSpeedTestHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   10 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          100,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 15 * time.Second,
		},
	}
}

func NewRunnerWithClient(client *http.Client) *Runner {
	if client == nil {
		client = &http.Client{}
	}
	return &Runner{
		client: client,
	}
}

var ErrBusy = fmt.Errorf("speed test already running")

func (r *Runner) Running() bool {
	return r.running.Load()
}

func (r *Runner) Run(ctx context.Context, cfg Config, onProgress ProgressFunc) (res Result, err error) {
	if !r.mu.TryLock() {
		return Result{}, ErrBusy
	}
	r.running.Store(true)
	defer func() {
		r.running.Store(false)
		r.mu.Unlock()
		if rec := recover(); rec != nil {
			err = fmt.Errorf("speed test panicked: %v", rec)
		}
	}()

	if cfg.DurationSeconds < 1 {
		cfg.DurationSeconds = defaultDurationSeconds
	}
	if cfg.ParallelStreams < 1 {
		cfg.ParallelStreams = defaultParallelStreams
	}

	duration := time.Duration(cfg.DurationSeconds) * time.Second
	ts := time.Now().UTC().Format(time.RFC3339Nano)

	targets := resolveServers(cfg)
	if len(targets) == 0 {
		msg := "no speed test servers configured"
		return Result{
			TS:              ts,
			DurationSeconds: cfg.DurationSeconds,
			Error:           &msg,
		}, nil
	}

	var lastErr error
	for i, target := range targets {
		if ctx.Err() != nil {
			break
		}
		parallel := effectiveParallelStreams(cfg.ParallelStreams, target.provider)
		downloadMbps, err := measureDownload(ctx, r.client, target.downloadURL, duration, parallel, target.provider, onProgress)
		if err != nil {
			lastErr = err
			log.Printf("speedtest: mirror %d download failed: %v", i+1, err)
			continue
		}

		uploadMbps, err := measureUpload(ctx, r.client, target.uploadURL, duration, parallel, target.provider, onProgress)
		if err != nil {
			lastErr = err
			log.Printf("speedtest: mirror %d upload failed: %v", i+1, err)
			continue
		}

		return Result{
			TS:              ts,
			DownloadMbps:    ptr(round2(downloadMbps)),
			UploadMbps:      ptr(round2(uploadMbps)),
			DurationSeconds: cfg.DurationSeconds,
		}, nil
	}

	msg := "all speed test mirrors failed"
	if lastErr != nil {
		msg = lastErr.Error()
	}
	return Result{
		TS:              ts,
		DurationSeconds: cfg.DurationSeconds,
		Error:           &msg,
	}, nil
}

func isPhaseEnd(ctx context.Context, err error) bool {
	if ctx.Err() != nil {
		return true
	}
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func measureDownload(ctx context.Context, client *http.Client, downloadURL string, duration time.Duration, parallel int, provider Provider, onProgress ProgressFunc) (float64, error) {
	if parallel < 1 {
		parallel = 1
	}

	deadline := time.Now().Add(duration)
	tracker := newThroughputTracker(downloadGraceTime, rollingWindow)
	var saw429 atomic.Bool
	pipeline := provider != ProviderCloudflare
	stagger := streamStaggerDelay
	if provider == ProviderCloudflare {
		stagger = 500 * time.Millisecond
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	phaseCtx, phaseCancel := context.WithDeadline(ctx, deadline)
	defer phaseCancel()
	phaseStart := time.Now()

	var errOnce sync.Once
	var firstErr error
	fail := func(err error) {
		if err == nil {
			return
		}
		errOnce.Do(func() {
			firstErr = err
			cancel()
		})
	}

	report := func() {
		if onProgress == nil {
			return
		}
		onProgress(Progress{Phase: "download", Mbps: tracker.liveMbps()})
	}
	report()

	stopReports := make(chan struct{})
	defer close(stopReports)
	go runProgressReporter(stopReports, report)

	stopRateLimitWatch := make(chan struct{})
	defer close(stopRateLimitWatch)
	go runRateLimitWatcher(stopRateLimitWatch, phaseStart, &saw429, tracker, cancel)

	var wg sync.WaitGroup
	for i := range parallel {
		wg.Add(1)
		go func(workerIndex int) {
			defer wg.Done()
			if delay := time.Duration(workerIndex) * stagger; delay > 0 {
				select {
				case <-ctx.Done():
					return
				case <-time.After(delay):
				}
			}
			runDownloadWorker(phaseCtx, client, downloadURL, tracker, &saw429, pipeline, fail)
		}(i)
	}
	if waitErr := waitWithContext(ctx, &wg); waitErr != nil {
		return 0, waitErr
	}

	if firstErr != nil && !saw429.Load() {
		return 0, firstErr
	}

	mbps := tracker.finalMbps()
	if mbps <= 0 {
		if saw429.Load() {
			return 0, fmt.Errorf("download rate limited (HTTP 429)")
		}
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		return 0, fmt.Errorf("download produced no data")
	}
	return mbps, nil
}

func runDownloadWorker(
	ctx context.Context,
	client *http.Client,
	downloadURL string,
	tracker *throughputTracker,
	saw429 *atomic.Bool,
	pipeline bool,
	fail func(error),
) {
	backoff := 500 * time.Millisecond
	pipelineThreshold := int64(downloadChunkBytes / 2)

	var (
		prefetching bool
		prefetchCh  chan prefetchResult
	)
	defer func() {
		if !prefetching {
			return
		}
		pr := <-prefetchCh
		if pr.resp != nil {
			_, _ = io.Copy(io.Discard, pr.resp.Body)
			pr.resp.Body.Close()
		}
	}()

	doRequest := func() (*http.Response, error) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "network-monitor speedtest")
		return client.Do(req)
	}

	handleNonOK := func(resp *http.Response) {
		if resp.StatusCode == http.StatusTooManyRequests {
			saw429.Store(true)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()

		wait := backoff
		if resp.StatusCode != http.StatusTooManyRequests {
			wait = 500 * time.Millisecond
		} else if retryAfter := parseRetryAfter(resp.Header.Get("Retry-After")); retryAfter > 0 {
			wait = retryAfter
		}
		select {
		case <-ctx.Done():
		case <-time.After(wait):
		}
		if resp.StatusCode == http.StatusTooManyRequests && backoff < 5*time.Second {
			backoff *= 2
		}
	}

	startPrefetch := func() {
		if prefetching {
			return
		}
		prefetching = true
		prefetchCh = make(chan prefetchResult, 1)
		go func() {
			resp, err := doRequest()
			result := prefetchResult{resp: resp, err: err}
			select {
			case prefetchCh <- result:
			case <-ctx.Done():
				if resp != nil {
					_, _ = io.Copy(io.Discard, resp.Body)
					resp.Body.Close()
				}
			}
		}()
	}

	acquireResponse := func() (*http.Response, error) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if prefetching {
			select {
			case pr := <-prefetchCh:
				prefetching = false
				if pr.err != nil {
					return nil, pr.err
				}
				return pr.resp, nil
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return doRequest()
	}

	for ctx.Err() == nil {

		resp, err := acquireResponse()
		if err != nil {
			if isPhaseEnd(ctx, err) {
				return
			}
			fail(err)
			return
		}

		if resp.StatusCode != http.StatusOK {
			handleNonOK(resp)
			continue
		}
		backoff = 500 * time.Millisecond

		var bytesOnResponse int64
		buf := make([]byte, 32<<10)
		for {
			n, readErr := readWithContext(ctx, resp.Body, buf)
			if n > 0 {
				bytesOnResponse += int64(n)
				tracker.addBytes(int64(n))
				if pipeline && !prefetching && bytesOnResponse >= pipelineThreshold {
					startPrefetch()
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				resp.Body.Close()
				if isPhaseEnd(ctx, readErr) {
					return
				}
				fail(readErr)
				return
			}
		}
		resp.Body.Close()
	}
}

type prefetchResult struct {
	resp *http.Response
	err  error
}

func measureUpload(ctx context.Context, client *http.Client, url string, duration time.Duration, parallel int, provider Provider, onProgress ProgressFunc) (float64, error) {
	if parallel < 1 {
		parallel = 1
	}

	deadline := time.Now().Add(duration)
	tracker := newThroughputTracker(uploadGraceTime, rollingWindow)
	stagger := streamStaggerDelay
	if provider == ProviderCloudflare {
		stagger = 500 * time.Millisecond
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	phaseCtx, phaseCancel := context.WithDeadline(ctx, deadline)
	defer phaseCancel()

	var errOnce sync.Once
	var firstErr error
	fail := func(err error) {
		if err == nil {
			return
		}
		errOnce.Do(func() {
			firstErr = err
			cancel()
		})
	}

	report := func() {
		if onProgress == nil {
			return
		}
		onProgress(Progress{Phase: "upload", Mbps: tracker.liveMbps()})
	}
	report()

	stopReports := make(chan struct{})
	defer close(stopReports)
	go runProgressReporter(stopReports, report)

	chunk := make([]byte, uploadChunkBytes)

	var wg sync.WaitGroup
	for i := range parallel {
		wg.Add(1)
		go func(workerIndex int) {
			defer wg.Done()
			if delay := time.Duration(workerIndex) * stagger; delay > 0 {
				select {
				case <-ctx.Done():
					return
				case <-time.After(delay):
				}
			}
			runUploadWorker(phaseCtx, client, url, chunk, tracker, fail)
		}(i)
	}
	if waitErr := waitWithContext(ctx, &wg); waitErr != nil {
		return 0, waitErr
	}

	if firstErr != nil {
		return 0, firstErr
	}

	mbps := tracker.finalMbps()
	if mbps <= 0 {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		return 0, fmt.Errorf("upload produced no data")
	}
	return mbps, nil
}

func runUploadWorker(
	ctx context.Context,
	client *http.Client,
	url string,
	chunk []byte,
	tracker *throughputTracker,
	fail func(error),
) {
	for ctx.Err() == nil {

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(chunk))
		if err != nil {
			if isPhaseEnd(ctx, err) {
				return
			}
			fail(err)
			return
		}
		req.ContentLength = int64(len(chunk))
		req.Header.Set("User-Agent", "network-monitor speedtest")

		resp, err := client.Do(req)
		if err != nil {
			if isPhaseEnd(ctx, err) {
				return
			}
			fail(err)
			return
		}
		defer resp.Body.Close()
		if err := discardWithContext(ctx, resp.Body); err != nil && !isPhaseEnd(ctx, err) {
			fail(err)
			return
		}
		tracker.addBytes(int64(len(chunk)))
	}
}

func waitWithContext(ctx context.Context, wg *sync.WaitGroup) error {
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func readWithContext(ctx context.Context, body io.ReadCloser, buf []byte) (int, error) {
	if ctx.Err() != nil {
		return 0, ctx.Err()
	}
	type readResult struct {
		n   int
		err error
	}
	ch := make(chan readResult, 1)
	go func() {
		n, err := body.Read(buf)
		ch <- readResult{n, err}
	}()
	select {
	case <-ctx.Done():
		body.Close()
		return 0, ctx.Err()
	case res := <-ch:
		return res.n, res.err
	}
}

func discardWithContext(ctx context.Context, body io.ReadCloser) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	done := make(chan error, 1)
	go func() {
		_, err := io.Copy(io.Discard, body)
		done <- err
	}()
	select {
	case <-ctx.Done():
		body.Close()
		return ctx.Err()
	case err := <-done:
		return err
	}
}

func runProgressReporter(stop <-chan struct{}, report func()) {
	ticker := time.NewTicker(progressInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			report()
		}
	}
}

func runRateLimitWatcher(stop <-chan struct{}, phaseStart time.Time, saw429 *atomic.Bool, tracker *throughputTracker, cancel context.CancelFunc) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if saw429.Load() && tracker.countedBytesValue() == 0 && time.Since(phaseStart) >= 2*time.Second {
				cancel()
				return
			}
		}
	}
}

func parseRetryAfter(value string) time.Duration {
	if value == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if t, err := http.ParseTime(value); err == nil {
		if wait := time.Until(t); wait > 0 {
			return wait
		}
	}
	return 0
}

func bytesToMbps(bytes int64, seconds float64) float64 {
	return (float64(bytes) * 8) / seconds / 1_000_000
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

func ptr(v float64) *float64 {
	return &v
}
