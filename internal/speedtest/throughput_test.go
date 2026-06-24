package speedtest

import (
	"testing"
	"time"
)

func TestThroughputTracker_grace(t *testing.T) {
	tracker := newThroughputTracker(50*time.Millisecond, 100*time.Millisecond)

	tracker.addBytes(1_000_000)
	if got := tracker.liveMbps(); got != 0 {
		t.Fatalf("liveMbps during grace=%v want 0", got)
	}

	time.Sleep(60 * time.Millisecond)
	tracker.addBytes(1_000_000)

	if got := tracker.liveMbps(); got <= 0 {
		t.Fatalf("liveMbps after grace=%v want > 0", got)
	}

	time.Sleep(550 * time.Millisecond)
	if got := tracker.finalMbps(); got <= 0 {
		t.Fatalf("finalMbps=%v want > 0", got)
	}
	if got := tracker.countedBytesValue(); got != 1_000_000 {
		t.Fatalf("countedBytes=%d want only post-grace bytes", got)
	}
}

func TestThroughputTracker_rolling(t *testing.T) {
	tracker := newThroughputTracker(0, 500*time.Millisecond)

	// 1 MB/s for 1 second => 8 Mbps
	const chunk = 125_000 // bytes per 125ms => 1 MB/s
	for range 8 {
		tracker.addBytes(chunk)
		time.Sleep(125 * time.Millisecond)
	}

	live := tracker.liveMbps()
	if live < 6 || live > 10 {
		t.Fatalf("rolling Mbps=%v want ~8", live)
	}
}

func TestThroughputTracker_final(t *testing.T) {
	tracker := newThroughputTracker(0, 500*time.Millisecond)

	// 10 MB in 1 second => 80 Mbps
	tracker.addBytes(10_000_000)
	time.Sleep(1 * time.Second)

	final := tracker.finalMbps()
	if final < 70 || final > 90 {
		t.Fatalf("final Mbps=%v want ~80", final)
	}
}

func TestThroughputTracker_finalRespectsMinWindow(t *testing.T) {
	tracker := newThroughputTracker(0, 100*time.Millisecond)
	tracker.addBytes(1_000_000)

	if got := tracker.finalMbps(); got != 0 {
		t.Fatalf("finalMbps=%v want 0 before min window", got)
	}
}
