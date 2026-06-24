package collector

import "testing"

func TestParsePingOutputWindows(t *testing.T) {
	ok, lat := ParsePingOutput("Reply from 1.1.1.1: bytes=32 time=14ms TTL=57", 0)
	if !ok || lat != 14 {
		t.Fatalf("got ok=%v lat=%v", ok, lat)
	}
}

func TestParsePingOutputSubMillis(t *testing.T) {
	ok, lat := ParsePingOutput("time<1ms", 0)
	if !ok || lat != 0.5 {
		t.Fatalf("got ok=%v lat=%v", ok, lat)
	}
}

func TestParsePingOutputLocale(t *testing.T) {
	ok, lat := ParsePingOutput("tijd=14,5ms", 0)
	if !ok || lat != 14.5 {
		t.Fatalf("got ok=%v lat=%v", ok, lat)
	}
}

func TestParsePingOutputFailure(t *testing.T) {
	ok, _ := ParsePingOutput("Request timed out.", 1)
	if ok {
		t.Fatal("expected failure")
	}
}

func TestJitterTracker(t *testing.T) {
	var j JitterTracker
	if got := j.Update(10); got != 0 {
		t.Fatalf("first jitter=%v", got)
	}
	if got := j.Update(15); got != 5 {
		t.Fatalf("second jitter=%v", got)
	}
	j.Reset()
	if got := j.Update(20); got != 0 {
		t.Fatalf("after reset jitter=%v", got)
	}
}
