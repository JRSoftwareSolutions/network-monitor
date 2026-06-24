package metrics

import (
	"testing"

	"network-monitor/internal/config"
	"network-monitor/internal/store"
)

func TestComputeSummaryLoss(t *testing.T) {
	samples := []store.Sample{
		{TS: "2026-06-16T10:00:00Z", Success: true, LatencyMs: ptr(10)},
		{TS: "2026-06-16T10:00:01Z", Success: false},
	}
	summary := ComputeSummary(samples, 5, config.Default().Thresholds)
	if summary.LossPercent != 50 {
		t.Fatalf("loss=%v", summary.LossPercent)
	}
}

func TestClassifyStatus(t *testing.T) {
	th := config.Default().Thresholds

	cases := []struct {
		name string
		s    Summary
		want StatusTier
	}{
		{
			name: "offline no samples",
			s:    Summary{SampleCount: 0},
			want: TierOffline,
		},
		{
			name: "offline all failed",
			s:    Summary{SampleCount: 5, SuccessCount: 0},
			want: TierOffline,
		},
		{
			name: "offline high loss",
			s:    Summary{SampleCount: 10, SuccessCount: 8, LossPercent: th.LossMax},
			want: TierOffline,
		},
		{
			name: "great",
			s: Summary{
				SampleCount: 10, SuccessCount: 10,
				AvgLatencyMs: ptr(20), AvgJitterMs: ptr(3), LossPercent: 0,
			},
			want: TierGreat,
		},
		{
			name: "ok",
			s: Summary{
				SampleCount: 10, SuccessCount: 10,
				AvgLatencyMs: ptr(60), AvgJitterMs: ptr(10), LossPercent: 0.5,
			},
			want: TierOK,
		},
		{
			name: "poor",
			s: Summary{
				SampleCount: 10, SuccessCount: 10,
				AvgLatencyMs: ptr(100), AvgJitterMs: ptr(25), LossPercent: 2,
			},
			want: TierPoor,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyStatus(tc.s, th)
			if got != tc.want {
				t.Fatalf("tier=%s want %s", got, tc.want)
			}
		})
	}
}

func TestComputeLive(t *testing.T) {
	cases := []struct {
		name         string
		samples      []store.Sample
		wantLastTS   string
		wantSuccess  bool
		wantLatency  *float64
		wantMinLat   *float64
		wantMaxLat   *float64
		wantJitter   *float64
		wantMinJit   *float64
		wantMaxJit   *float64
		wantLoss     float64
		wantCount    int
		wantSuccessN int
	}{
		{
			name:         "empty window",
			samples:      nil,
			wantSuccess:  false,
			wantLoss:     0,
			wantCount:    0,
			wantSuccessN: 0,
		},
		{
			name: "avg latency and jitter",
			samples: []store.Sample{
				{TS: "2026-06-16T10:00:00Z", Success: true, LatencyMs: ptr(10), JitterMs: ptr(2)},
				{TS: "2026-06-16T10:00:05Z", Success: true, LatencyMs: ptr(20), JitterMs: ptr(4)},
			},
			wantLastTS:   "2026-06-16T10:00:05Z",
			wantSuccess:  true,
			wantLatency:  ptr(15),
			wantMinLat:   ptr(10),
			wantMaxLat:   ptr(20),
			wantJitter:   ptr(3),
			wantMinJit:   ptr(2),
			wantMaxJit:   ptr(4),
			wantLoss:     0,
			wantCount:    2,
			wantSuccessN: 2,
		},
		{
			name: "failed pings excluded from averages",
			samples: []store.Sample{
				{TS: "2026-06-16T10:00:00Z", Success: true, LatencyMs: ptr(10), JitterMs: ptr(2)},
				{TS: "2026-06-16T10:00:05Z", Success: false},
			},
			wantLastTS:   "2026-06-16T10:00:05Z",
			wantSuccess:  false,
			wantLatency:  ptr(10),
			wantMinLat:   ptr(10),
			wantMaxLat:   ptr(10),
			wantJitter:   ptr(2),
			wantMinJit:   ptr(2),
			wantMaxJit:   ptr(2),
			wantLoss:     50,
			wantCount:    2,
			wantSuccessN: 1,
		},
		{
			name: "single sample slow ping interval",
			samples: []store.Sample{
				{TS: "2026-06-16T10:00:00Z", Success: true, LatencyMs: ptr(42), JitterMs: ptr(5)},
			},
			wantLastTS:   "2026-06-16T10:00:00Z",
			wantSuccess:  true,
			wantLatency:  ptr(42),
			wantMinLat:   ptr(42),
			wantMaxLat:   ptr(42),
			wantJitter:   ptr(5),
			wantMinJit:   ptr(5),
			wantMaxJit:   ptr(5),
			wantLoss:     0,
			wantCount:    1,
			wantSuccessN: 1,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			live := ComputeLive(tc.samples)
			if live.LastTS != tc.wantLastTS {
				t.Fatalf("last_ts=%q want %q", live.LastTS, tc.wantLastTS)
			}
			if live.LastSuccess != tc.wantSuccess {
				t.Fatalf("last_success=%v want %v", live.LastSuccess, tc.wantSuccess)
			}
			if live.SampleCount != tc.wantCount {
				t.Fatalf("sample_count=%d want %d", live.SampleCount, tc.wantCount)
			}
			if live.SuccessCount != tc.wantSuccessN {
				t.Fatalf("success_count=%d want %d", live.SuccessCount, tc.wantSuccessN)
			}
			if live.LossPercent != tc.wantLoss {
				t.Fatalf("loss=%v want %v", live.LossPercent, tc.wantLoss)
			}
			assertFloatPtr(t, "latency_ms", live.LatencyMs, tc.wantLatency)
			assertFloatPtr(t, "min_latency_ms", live.MinLatencyMs, tc.wantMinLat)
			assertFloatPtr(t, "max_latency_ms", live.MaxLatencyMs, tc.wantMaxLat)
			assertFloatPtr(t, "jitter_ms", live.JitterMs, tc.wantJitter)
			assertFloatPtr(t, "min_jitter_ms", live.MinJitterMs, tc.wantMinJit)
			assertFloatPtr(t, "max_jitter_ms", live.MaxJitterMs, tc.wantMaxJit)
		})
	}
}

func assertFloatPtr(t *testing.T, name string, got, want *float64) {
	t.Helper()
	if want == nil {
		if got != nil {
			t.Fatalf("%s=%v want nil", name, *got)
		}
		return
	}
	if got == nil {
		t.Fatalf("%s=nil want %v", name, *want)
	}
	if *got != *want {
		t.Fatalf("%s=%v want %v", name, *got, *want)
	}
}
