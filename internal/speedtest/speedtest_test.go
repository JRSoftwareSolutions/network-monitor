package speedtest

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func libreSpeedHandler(downloadChunk int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			if strings.Contains(r.URL.Path, "garbage") {
				_, _ = w.Write(make([]byte, downloadChunk))
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
	}
}

func testLibreSpeedDownloadURL(base string) string {
	dl, _ := LibreSpeedURLs(base, "", "", 1)
	return dl
}

func testLibreSpeedUploadURL(base string) string {
	_, ul := LibreSpeedURLs(base, "", "", 1)
	return ul
}

func TestMeasureDownload(t *testing.T) {
	srv := httptest.NewServer(libreSpeedHandler(512 * 1024))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	dl := testLibreSpeedDownloadURL(srv.URL + "/")
	mbps, err := measureDownload(ctx, srv.Client(), dl, 4*time.Second, 1, ProviderLibreSpeed, nil)
	if err != nil {
		t.Fatal(err)
	}
	if mbps <= 0 {
		t.Fatalf("mbps=%v want > 0", mbps)
	}
}

func TestMeasureDownloadParallel(t *testing.T) {
	var peakConcurrent atomic.Int32
	var active atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "garbage") {
			http.NotFound(w, r)
			return
		}
		cur := active.Add(1)
		defer active.Add(-1)
		for {
			peak := peakConcurrent.Load()
			if cur > peak && peakConcurrent.CompareAndSwap(peak, cur) {
				break
			}
			if cur <= peak {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
		_, _ = w.Write(make([]byte, 64*1024))
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	dl := testLibreSpeedDownloadURL(srv.URL + "/")
	mbps, err := measureDownload(ctx, srv.Client(), dl, 3*time.Second, 4, ProviderLibreSpeed, nil)
	if err != nil {
		t.Fatal(err)
	}
	if mbps <= 0 {
		t.Fatalf("mbps=%v want > 0", mbps)
	}
	if peak := peakConcurrent.Load(); peak < 2 {
		t.Fatalf("peak concurrent=%d want >= 2", peak)
	}
}

func TestMeasureDownloadStreamStagger(t *testing.T) {
	var mu sync.Mutex
	var requestTimes []time.Time

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "garbage") {
			http.NotFound(w, r)
			return
		}
		mu.Lock()
		requestTimes = append(requestTimes, time.Now())
		mu.Unlock()
		_, _ = w.Write(make([]byte, 256*1024))
	}))
	defer srv.Close()

	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	dl := testLibreSpeedDownloadURL(srv.URL + "/")
	_, err := measureDownload(ctx, srv.Client(), dl, 3*time.Second, 4, ProviderLibreSpeed, nil)
	if err != nil {
		t.Fatal(err)
	}

	mu.Lock()
	times := append([]time.Time(nil), requestTimes...)
	mu.Unlock()

	if len(times) < 2 {
		t.Fatalf("requests=%d want >= 2", len(times))
	}

	earliest := start.Add(250 * time.Millisecond)
	var sawStaggered bool
	for _, ts := range times {
		if !ts.Before(earliest) {
			sawStaggered = true
			break
		}
	}
	if !sawStaggered {
		t.Fatalf("expected a request after stagger window; first=%v start=%v", times[0], start)
	}
}

func TestMeasureDownloadRejectsNonOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte("x"))
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	dl := testLibreSpeedDownloadURL(srv.URL + "/")
	_, err := measureDownload(ctx, srv.Client(), dl, 2*time.Second, 1, ProviderLibreSpeed, nil)
	if err == nil {
		t.Fatal("expected error for HTTP 429")
	}
	if err.Error() != "download rate limited (HTTP 429)" {
		t.Fatalf("err=%q want rate limited message", err.Error())
	}
}

func TestMeasureUpload(t *testing.T) {
	srv := httptest.NewServer(libreSpeedHandler(0))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	ul := testLibreSpeedUploadURL(srv.URL + "/")
	mbps, err := measureUpload(ctx, srv.Client(), ul, 5*time.Second, 1, ProviderLibreSpeed, nil)
	if err != nil {
		t.Fatal(err)
	}
	if mbps <= 0 {
		t.Fatalf("mbps=%v want > 0", mbps)
	}
}

func TestRunnerBusy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		libreSpeedHandler(1024)(w, r)
	}))
	defer srv.Close()

	runner := NewRunnerWithClient(srv.Client())
	cfg := Config{
		Servers:         []string{srv.URL + "/"},
		DurationSeconds: 5,
		ParallelStreams: 2,
	}

	done := make(chan struct{})
	go func() {
		_, _ = runner.Run(context.Background(), cfg, nil)
		close(done)
	}()

	time.Sleep(20 * time.Millisecond)
	_, err := runner.Run(context.Background(), cfg, nil)
	if err != ErrBusy {
		t.Fatalf("err=%v want ErrBusy", err)
	}
	<-done
}

func TestRunnerSuccess(t *testing.T) {
	srv := httptest.NewServer(libreSpeedHandler(256 * 1024))
	defer srv.Close()

	runner := NewRunnerWithClient(srv.Client())
	res, err := runner.Run(context.Background(), Config{
		Servers:         []string{srv.URL + "/"},
		DurationSeconds: 5,
		ParallelStreams: 2,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Error != nil {
		t.Fatalf("error=%s", *res.Error)
	}
	if res.DownloadMbps == nil || *res.DownloadMbps <= 0 {
		t.Fatalf("download=%v", res.DownloadMbps)
	}
	if res.UploadMbps == nil || *res.UploadMbps <= 0 {
		t.Fatalf("upload=%v", res.UploadMbps)
	}
}

func TestRunnerProgress(t *testing.T) {
	srv := httptest.NewServer(libreSpeedHandler(256 * 1024))
	defer srv.Close()

	var progress []Progress
	runner := NewRunnerWithClient(srv.Client())
	_, err := runner.Run(context.Background(), Config{
		Servers:         []string{srv.URL + "/"},
		DurationSeconds: 5,
		ParallelStreams: 2,
	}, func(p Progress) {
		progress = append(progress, p)
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(progress) < 2 {
		t.Fatalf("progress events=%d want >= 2", len(progress))
	}

	var sawDownload, sawUpload bool
	for _, p := range progress {
		if p.Phase == "download" && p.Mbps > 0 {
			sawDownload = true
		}
		if p.Phase == "upload" && p.Mbps > 0 {
			sawUpload = true
		}
	}
	if !sawDownload {
		t.Fatal("missing download progress with mbps > 0")
	}
	if !sawUpload {
		t.Fatal("missing upload progress with mbps > 0")
	}
}

func TestRunnerServerFailover(t *testing.T) {
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte("x"))
	}))
	defer bad.Close()

	good := httptest.NewServer(libreSpeedHandler(256 * 1024))
	defer good.Close()

	runner := NewRunnerWithClient(&http.Client{})
	res, err := runner.Run(context.Background(), Config{
		Servers:         []string{bad.URL + "/", good.URL + "/"},
		DurationSeconds: 5,
		ParallelStreams: 2,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Error != nil {
		t.Fatalf("error=%s", *res.Error)
	}
	if res.DownloadMbps == nil || *res.DownloadMbps <= 0 {
		t.Fatalf("download=%v", res.DownloadMbps)
	}
	if res.UploadMbps == nil || *res.UploadMbps <= 0 {
		t.Fatalf("upload=%v", res.UploadMbps)
	}
}

func TestRunnerReleasesLockOnContextCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "garbage") {
			flusher, ok := w.(http.Flusher)
			if !ok {
				http.Error(w, "no flush", http.StatusInternalServerError)
				return
			}
			for {
				if _, err := w.Write(make([]byte, 32<<10)); err != nil {
					return
				}
				flusher.Flush()
				time.Sleep(50 * time.Millisecond)
			}
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	runner := NewRunnerWithClient(srv.Client())
	cfg := Config{
		Servers:         []string{srv.URL + "/"},
		DurationSeconds: 30,
		ParallelStreams: 1,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	_, _ = runner.Run(ctx, cfg, nil)
	if runner.Running() {
		t.Fatal("runner still marked running after context cancel")
	}

	_, err := runner.Run(context.Background(), Config{
		Servers:         []string{srv.URL + "/"},
		DurationSeconds: 1,
		ParallelStreams: 1,
	}, nil)
	if err == ErrBusy {
		t.Fatal("mutex still held after context cancel")
	}
}
