package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStoreInsertQueryPrune(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(filepath.Join(dir, "monitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	lat := 12.5
	jit := 1.2
	if err := st.Insert(Sample{
		TS:        time.Now().UTC().Format(time.RFC3339Nano),
		Host:      "1.1.1.1",
		Success:   true,
		LatencyMs: &lat,
		JitterMs:  &jit,
	}); err != nil {
		t.Fatal(err)
	}

	since := time.Now().Add(-time.Minute)
	samples, err := st.QuerySince(since)
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 1 {
		t.Fatalf("samples=%d", len(samples))
	}

	oldTS := time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339Nano)
	if err := st.Insert(Sample{TS: oldTS, Host: "1.1.1.1", Success: true, LatencyMs: &lat}); err != nil {
		t.Fatal(err)
	}
	if err := st.Prune(time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	samples, err = st.QuerySince(time.Now().Add(-3 * time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 1 {
		t.Fatalf("after prune samples=%d", len(samples))
	}
}

func TestDownsample(t *testing.T) {
	samples := make([]Sample, 10)
	for i := range samples {
		samples[i] = Sample{TS: time.Now().UTC().Format(time.RFC3339Nano)}
	}
	out := Downsample(samples, 5)
	if len(out) != 5 {
		t.Fatalf("downsample len=%d", len(out))
	}
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}
