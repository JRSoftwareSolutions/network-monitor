package metrics

import (
	"math"
	"sort"

	"network-monitor/internal/config"
	"network-monitor/internal/store"
)

type StatusTier string

const (
	TierGreat   StatusTier = "great"
	TierOK      StatusTier = "ok"
	TierPoor    StatusTier = "poor"
	TierOffline StatusTier = "offline"
)

type Summary struct {
	WindowMinutes int        `json:"window_minutes"`
	SampleCount   int        `json:"sample_count"`
	SuccessCount  int        `json:"success_count"`
	LossPercent   float64    `json:"loss_percent"`
	AvgLatencyMs  *float64   `json:"avg_latency_ms,omitempty"`
	MinLatencyMs  *float64   `json:"min_latency_ms,omitempty"`
	MaxLatencyMs  *float64   `json:"max_latency_ms,omitempty"`
	P95LatencyMs  *float64   `json:"p95_latency_ms,omitempty"`
	AvgJitterMs   *float64   `json:"avg_jitter_ms,omitempty"`
	Status        StatusTier `json:"status"`
}

type LiveMetrics struct {
	LastTS        string   `json:"last_ts,omitempty"`
	LastSuccess   bool     `json:"last_success"`
	LatencyMs     *float64 `json:"latency_ms,omitempty"`
	MinLatencyMs  *float64 `json:"min_latency_ms,omitempty"`
	MaxLatencyMs  *float64 `json:"max_latency_ms,omitempty"`
	JitterMs      *float64 `json:"jitter_ms,omitempty"`
	MinJitterMs   *float64 `json:"min_jitter_ms,omitempty"`
	MaxJitterMs   *float64 `json:"max_jitter_ms,omitempty"`
	LossPercent   float64  `json:"loss_percent"`
	SampleCount   int      `json:"sample_count"`
	SuccessCount  int      `json:"success_count"`
}

func ComputeSummary(samples []store.Sample, windowMinutes int, thresholds config.Thresholds) Summary {
	summary := Summary{WindowMinutes: windowMinutes}
	if len(samples) == 0 {
		summary.Status = TierOffline
		return summary
	}

	var latencies []float64
	var jitters []float64
	for _, s := range samples {
		summary.SampleCount++
		if s.Success {
			summary.SuccessCount++
			if s.LatencyMs != nil {
				latencies = append(latencies, *s.LatencyMs)
			}
			if s.JitterMs != nil {
				jitters = append(jitters, *s.JitterMs)
			}
		}
	}

	if summary.SampleCount > 0 {
		summary.LossPercent = lossPercent(summary.SampleCount, summary.SuccessCount)
	}

	if len(latencies) > 0 {
		avg := mean(latencies)
		minV := latencies[0]
		maxV := latencies[0]
		for _, v := range latencies[1:] {
			if v < minV {
				minV = v
			}
			if v > maxV {
				maxV = v
			}
		}
		p95 := percentile(latencies, 95)
		summary.AvgLatencyMs = ptr(round2(avg))
		summary.MinLatencyMs = ptr(round2(minV))
		summary.MaxLatencyMs = ptr(round2(maxV))
		summary.P95LatencyMs = ptr(round2(p95))
	}
	if len(jitters) > 0 {
		summary.AvgJitterMs = ptr(round2(mean(jitters)))
	}

	summary.Status = ClassifyStatus(summary, thresholds)
	return summary
}

func ComputeLive(samples []store.Sample) LiveMetrics {
	live := LiveMetrics{}
	if len(samples) == 0 {
		return live
	}

	latest := samples[len(samples)-1]
	live.LastTS = latest.TS
	live.LastSuccess = latest.Success

	var latencies []float64
	var jitters []float64
	for _, s := range samples {
		live.SampleCount++
		if s.Success {
			live.SuccessCount++
			if s.LatencyMs != nil {
				latencies = append(latencies, *s.LatencyMs)
			}
			if s.JitterMs != nil {
				jitters = append(jitters, *s.JitterMs)
			}
		}
	}

	if live.SampleCount > 0 {
		live.LossPercent = lossPercent(live.SampleCount, live.SuccessCount)
	}
	if len(latencies) > 0 {
		live.LatencyMs = ptr(round2(mean(latencies)))
		minV, maxV := minMax(latencies)
		live.MinLatencyMs = ptr(round2(minV))
		live.MaxLatencyMs = ptr(round2(maxV))
	}
	if len(jitters) > 0 {
		live.JitterMs = ptr(round2(mean(jitters)))
		minV, maxV := minMax(jitters)
		live.MinJitterMs = ptr(round2(minV))
		live.MaxJitterMs = ptr(round2(maxV))
	}
	return live
}

func minMax(values []float64) (float64, float64) {
	minV := values[0]
	maxV := values[0]
	for _, v := range values[1:] {
		if v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}
	return minV, maxV
}

func ClassifyStatus(s Summary, t config.Thresholds) StatusTier {
	if s.SampleCount == 0 || s.SuccessCount == 0 {
		return TierOffline
	}
	if s.LossPercent >= t.LossMax {
		return TierOffline
	}

	avgPing := 0.0
	if s.AvgLatencyMs != nil {
		avgPing = *s.AvgLatencyMs
	}
	avgJitter := 0.0
	if s.AvgJitterMs != nil {
		avgJitter = *s.AvgJitterMs
	}

	if avgPing <= t.PingGreat && avgJitter <= t.JitterGreat && s.LossPercent <= 0 {
		return TierGreat
	}
	if avgPing <= t.PingGood && avgJitter <= t.JitterGood && s.LossPercent <= t.LossGood {
		return TierOK
	}
	return TierPoor
}

func lossPercent(total, success int) float64 {
	return round2(float64(total-success) / float64(total) * 100)
}

func mean(values []float64) float64 {
	sum := 0.0
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

func percentile(values []float64, pct float64) float64 {
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	if len(sorted) == 0 {
		return 0
	}
	rank := (pct / 100) * float64(len(sorted)-1)
	low := int(math.Floor(rank))
	high := int(math.Ceil(rank))
	if low == high {
		return sorted[low]
	}
	weight := rank - float64(low)
	return sorted[low]*(1-weight) + sorted[high]*weight
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func ptr(v float64) *float64 {
	return &v
}
