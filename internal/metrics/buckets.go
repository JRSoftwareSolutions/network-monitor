package metrics

import (
	"sort"
	"time"

	"network-monitor/internal/store"
)

const ChartBaselinePoints = 300

type ChartBucket struct {
	TS          string   `json:"ts"`
	AvgMs       *float64 `json:"avg_ms,omitempty"`
	MinMs       *float64 `json:"min_ms,omitempty"`
	MaxMs       *float64 `json:"max_ms,omitempty"`
	AvgJitterMs *float64 `json:"avg_jitter_ms,omitempty"`
	MinJitterMs *float64 `json:"min_jitter_ms,omitempty"`
	MaxJitterMs *float64 `json:"max_jitter_ms,omitempty"`
	SampleCount int      `json:"sample_count"`
}

// DisplayBucketSeconds returns the chart bin width for a rolling window (~ChartBaselinePoints buckets).
func DisplayBucketSeconds(windowMinutes int) float64 {
	return float64(windowMinutes*60) / float64(ChartBaselinePoints)
}

func BucketStart(t time.Time, bucketSeconds float64) time.Time {
	if bucketSeconds <= 0 {
		return t.UTC()
	}
	nsPerBucket := int64(bucketSeconds * float64(time.Second))
	if nsPerBucket <= 0 {
		return t.UTC()
	}
	bin := t.UTC().UnixNano() / nsPerBucket
	return time.Unix(0, bin*nsPerBucket).UTC()
}

func BucketCenter(binStart time.Time, bucketSeconds float64) time.Time {
	if bucketSeconds <= 0 {
		return binStart.UTC()
	}
	half := time.Duration(bucketSeconds * float64(time.Second) / 2)
	return binStart.UTC().Add(half)
}

func AggregateBuckets(samples []store.Sample, windowStart time.Time, bucketSeconds float64) []ChartBucket {
	if len(samples) == 0 {
		return nil
	}
	if bucketSeconds <= 0 {
		return samplesToBuckets(samples)
	}

	type acc struct {
		total       int
		success     int
		sum         float64
		min         float64
		max         float64
		has         bool
		jitterSum   float64
		jitterMin   float64
		jitterMax   float64
		jitterCount int
		jitterHas   bool
	}
	accs := make(map[int64]acc)

	for _, s := range samples {
		t, err := store.ParseTS(s.TS)
		if err != nil {
			continue
		}
		if t.Before(windowStart.UTC()) {
			continue
		}
		binStart := BucketStart(t, bucketSeconds)
		key := binStart.UnixNano()
		a := accs[key]
		a.total++
		if s.Success && s.LatencyMs != nil {
			v := *s.LatencyMs
			if !a.has {
				a.min = v
				a.max = v
				a.has = true
			} else {
				if v < a.min {
					a.min = v
				}
				if v > a.max {
					a.max = v
				}
			}
			a.sum += v
			a.success++
		}
		if s.Success && s.JitterMs != nil {
			jv := *s.JitterMs
			if !a.jitterHas {
				a.jitterMin = jv
				a.jitterMax = jv
				a.jitterHas = true
			} else {
				if jv < a.jitterMin {
					a.jitterMin = jv
				}
				if jv > a.jitterMax {
					a.jitterMax = jv
				}
			}
			a.jitterSum += jv
			a.jitterCount++
		}
		accs[key] = a
	}

	keys := make([]int64, 0, len(accs))
	for k := range accs {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })

	out := make([]ChartBucket, 0, len(keys))
	for _, key := range keys {
		a := accs[key]
		binStart := time.Unix(0, key).UTC()
		center := BucketCenter(binStart, bucketSeconds)
		b := ChartBucket{
			TS:          center.Format(time.RFC3339Nano),
			SampleCount: a.total,
		}
		if a.has {
			avg := round2(a.sum / float64(a.success))
			minV := round2(a.min)
			maxV := round2(a.max)
			b.AvgMs = ptr(avg)
			b.MinMs = ptr(minV)
			b.MaxMs = ptr(maxV)
		}
		if a.jitterHas {
			jAvg := round2(a.jitterSum / float64(a.jitterCount))
			jMin := round2(a.jitterMin)
			jMax := round2(a.jitterMax)
			b.AvgJitterMs = ptr(jAvg)
			b.MinJitterMs = ptr(jMin)
			b.MaxJitterMs = ptr(jMax)
		}
		out = append(out, b)
	}
	return out
}

func samplesToBuckets(samples []store.Sample) []ChartBucket {
	out := make([]ChartBucket, len(samples))
	for i, s := range samples {
		b := ChartBucket{TS: s.TS, SampleCount: 1}
		if s.Success && s.LatencyMs != nil {
			v := round2(*s.LatencyMs)
			b.AvgMs = ptr(v)
			b.MinMs = ptr(v)
			b.MaxMs = ptr(v)
		}
		if s.Success && s.JitterMs != nil {
			jv := round2(*s.JitterMs)
			b.AvgJitterMs = ptr(jv)
			b.MinJitterMs = ptr(jv)
			b.MaxJitterMs = ptr(jv)
		}
		out[i] = b
	}
	return out
}
