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

func TestClassifyStatusGreat(t *testing.T) {
	avg := 20.0
	jit := 3.0
	s := Summary{SampleCount: 10, SuccessCount: 10, AvgLatencyMs: &avg, AvgJitterMs: &jit, LossPercent: 0}
	tier := ClassifyStatus(s, config.Default().Thresholds)
	if tier != TierGreat {
		t.Fatalf("tier=%s", tier)
	}
}

func TestClassifyStatusOffline(t *testing.T) {
	s := Summary{SampleCount: 5, SuccessCount: 0}
	tier := ClassifyStatus(s, config.Default().Thresholds)
	if tier != TierOffline {
		t.Fatalf("tier=%s", tier)
	}
}
