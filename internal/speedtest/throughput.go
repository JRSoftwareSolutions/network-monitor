package speedtest

import (
	"sync"
	"time"
)

const (
	downloadGraceTime  = 1500 * time.Millisecond
	uploadGraceTime    = 3 * time.Second
	rollingWindow      = 1500 * time.Millisecond
	streamStaggerDelay = 300 * time.Millisecond
	progressInterval   = 200 * time.Millisecond
	minFinalWindow     = 500 * time.Millisecond
)

type byteSample struct {
	at    time.Time
	bytes int64
}

type throughputTracker struct {
	mu           sync.Mutex
	grace        time.Duration
	rolling      time.Duration
	start        time.Time
	graceEnd     time.Time
	countedBytes int64
	samples      []byteSample
}

func newThroughputTracker(grace, rolling time.Duration) *throughputTracker {
	start := time.Now()
	return &throughputTracker{
		grace:    grace,
		rolling:  rolling,
		start:    start,
		graceEnd: start.Add(grace),
		samples:  []byteSample{{at: start, bytes: 0}},
	}
}

func (t *throughputTracker) addBytes(n int64) {
	if n <= 0 {
		return
	}
	now := time.Now()
	if now.Before(t.graceEnd) {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	t.countedBytes += n
	t.samples = append(t.samples, byteSample{at: now, bytes: t.countedBytes})
}

func (t *throughputTracker) liveMbps() float64 {
	now := time.Now()
	if now.Before(t.graceEnd) {
		return 0
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	windowStart := now.Add(-t.rolling)
	if windowStart.Before(t.graceEnd) {
		windowStart = t.graceEnd
	}

	bytesNow := t.countedBytes
	bytesThen := t.bytesAtLocked(windowStart)
	elapsed := now.Sub(windowStart).Seconds()
	if elapsed <= 0 || bytesNow <= bytesThen {
		return 0
	}
	return round2(bytesToMbps(bytesNow-bytesThen, elapsed))
}

func (t *throughputTracker) finalMbps() float64 {
	now := time.Now()
	if now.Before(t.graceEnd) {
		return 0
	}

	t.mu.Lock()
	bytes := t.countedBytes
	t.mu.Unlock()

	elapsed := now.Sub(t.graceEnd).Seconds()
	if elapsed < minFinalWindow.Seconds() || bytes == 0 {
		return 0
	}
	return bytesToMbps(bytes, elapsed)
}

func (t *throughputTracker) countedBytesValue() int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.countedBytes
}

func (t *throughputTracker) bytesAtLocked(target time.Time) int64 {
	var bytes int64
	for _, s := range t.samples {
		if !s.at.After(target) {
			bytes = s.bytes
		} else {
			break
		}
	}
	return bytes
}
