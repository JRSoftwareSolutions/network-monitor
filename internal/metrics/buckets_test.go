package metrics

import (
	"testing"
	"time"

	"network-monitor/internal/store"
)

func sampleAt(ts time.Time, latency float64) store.Sample {
	v := latency
	return store.Sample{
		TS:        ts.UTC().Format(time.RFC3339Nano),
		Host:      "1.1.1.1",
		Success:   true,
		LatencyMs: &v,
	}
}

func failedAt(ts time.Time) store.Sample {
	return store.Sample{
		TS:      ts.UTC().Format(time.RFC3339Nano),
		Host:    "1.1.1.1",
		Success: false,
	}
}

func TestDisplayBucketSeconds(t *testing.T) {
	cases := []struct {
		minutes int
		want    float64
	}{
		{5, 1},
		{15, 3},
		{30, 6},
		{60, 12},
		{120, 24},
		{180, 36},
	}
	for _, tc := range cases {
		got := DisplayBucketSeconds(tc.minutes)
		if got != tc.want {
			t.Fatalf("DisplayBucketSeconds(%d)=%v want %v", tc.minutes, got, tc.want)
		}
	}
}

func TestAggregateBucketsOneSecondBins(t *testing.T) {
	start := time.Date(2026, 6, 16, 12, 0, 0, 0, time.UTC)
	samples := []store.Sample{
		sampleAt(start, 10),
		sampleAt(start.Add(1*time.Second), 20),
	}
	out := AggregateBuckets(samples, start, 1)
	if len(out) != 2 {
		t.Fatalf("len=%d want 2", len(out))
	}
	if out[0].AvgMs == nil || *out[0].AvgMs != 10 {
		t.Fatalf("first avg=%v", out[0].AvgMs)
	}
	if out[1].MinMs == nil || *out[1].MinMs != 20 {
		t.Fatalf("second min=%v", out[1].MinMs)
	}
}

func TestAggregateBucketsMinMaxAvg(t *testing.T) {
	start := time.Date(2026, 6, 16, 12, 0, 0, 0, time.UTC)
	samples := make([]store.Sample, 0, 250)
	for i := 0; i < 250; i++ {
		lat := float64(10 + i%20)
		if i == 125 {
			lat = 200
		}
		samples = append(samples, sampleAt(start.Add(time.Duration(i)*time.Second), lat))
	}
	out := AggregateBuckets(samples, start, 10)
	if len(out) != 25 {
		t.Fatalf("len=%d want 25 for 250 samples in 10s buckets", len(out))
	}
	var sawSpike bool
	for _, b := range out {
		if b.MaxMs != nil && *b.MaxMs >= 200 {
			sawSpike = true
			break
		}
	}
	if !sawSpike {
		t.Fatal("spike not preserved in bucket max")
	}
}

func TestAggregateBucketsAllFailed(t *testing.T) {
	start := time.Date(2026, 6, 16, 12, 0, 0, 0, time.UTC)
	samples := []store.Sample{
		failedAt(start),
		failedAt(start.Add(1 * time.Second)),
	}
	out := AggregateBuckets(samples, start, 1)
	if len(out) != 2 {
		t.Fatalf("len=%d want 2", len(out))
	}
	if out[0].AvgMs != nil || out[0].MinMs != nil || out[0].MaxMs != nil {
		t.Fatalf("expected null latencies, got %+v", out[0])
	}
	if out[0].SampleCount != 1 {
		t.Fatalf("sample_count=%d", out[0].SampleCount)
	}
}

func TestBucketStartAlignment(t *testing.T) {
	bucketSeconds := 10.0
	ts := time.Date(2026, 6, 16, 12, 0, 37, 0, time.UTC)
	got := BucketStart(ts, bucketSeconds)
	want := time.Date(2026, 6, 16, 12, 0, 30, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("BucketStart=%v want %v", got, want)
	}
	center := BucketCenter(got, bucketSeconds)
	wantCenter := time.Date(2026, 6, 16, 12, 0, 35, 0, time.UTC)
	if !center.Equal(wantCenter) {
		t.Fatalf("BucketCenter=%v want %v", center, wantCenter)
	}
}

func TestAggregateBucketsEpochStable(t *testing.T) {
	start := time.Date(2026, 6, 16, 12, 0, 0, 0, time.UTC)
	samples := make([]store.Sample, 0, 300)
	for i := 0; i < 300; i++ {
		samples = append(samples, sampleAt(start.Add(time.Duration(i)*time.Second), float64(10+i%5)))
	}
	bucketSeconds := 10.0

	outA := AggregateBuckets(samples, start.Add(-time.Hour), bucketSeconds)
	outB := AggregateBuckets(samples, start.Add(-30*time.Minute), bucketSeconds)

	if len(outA) != len(outB) {
		t.Fatalf("len mismatch: %d vs %d", len(outA), len(outB))
	}
	for i := range outA {
		if outA[i].TS != outB[i].TS {
			t.Fatalf("bucket %d ts shifted: %s vs %s", i, outA[i].TS, outB[i].TS)
		}
		if outA[i].SampleCount != outB[i].SampleCount {
			t.Fatalf("bucket %d count changed: %d vs %d", i, outA[i].SampleCount, outB[i].SampleCount)
		}
		if (outA[i].AvgMs == nil) != (outB[i].AvgMs == nil) {
			t.Fatalf("bucket %d avg presence changed", i)
		}
		if outA[i].AvgMs != nil && *outA[i].AvgMs != *outB[i].AvgMs {
			t.Fatalf("bucket %d avg changed: %v vs %v", i, *outA[i].AvgMs, *outB[i].AvgMs)
		}
	}
}
