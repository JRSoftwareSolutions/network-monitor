package store

import (
	"path/filepath"
	"testing"
	"time"
)

func TestParseTS(t *testing.T) {
	cases := []struct {
		raw  string
		want time.Time
	}{
		{
			raw:  "2026-06-16T10:00:00Z",
			want: time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC),
		},
		{
			raw:  "2026-06-16T10:00:00+00:00",
			want: time.Date(2026, 6, 16, 10, 0, 0, 0, time.UTC),
		},
		{
			raw:  "2026-06-16T10:00:00.123456789Z",
			want: time.Date(2026, 6, 16, 10, 0, 0, 123456789, time.UTC),
		},
	}

	for _, tc := range cases {
		got, err := ParseTS(tc.raw)
		if err != nil {
			t.Fatalf("ParseTS(%q): %v", tc.raw, err)
		}
		if !got.Equal(tc.want) {
			t.Fatalf("ParseTS(%q)=%v want %v", tc.raw, got, tc.want)
		}
	}
}

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
