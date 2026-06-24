package speedtest

import (
	"strings"
	"testing"
)

func TestDetectProvider(t *testing.T) {
	if got := DetectProvider("https://speed.cloudflare.com/__down", "https://speed.cloudflare.com/__up"); got != ProviderCloudflare {
		t.Fatalf("got=%v want cloudflare", got)
	}
	if got := DetectProvider("http://127.0.0.1/garbage.php", "http://127.0.0.1/empty.php"); got != ProviderCustom {
		t.Fatalf("got=%v want custom", got)
	}
}

func TestLibreSpeedURLs(t *testing.T) {
	dl, ul := LibreSpeedURLs("https://example.com/backend/", "", "", 10)
	if !strings.HasPrefix(dl, "https://example.com/backend/garbage.php?ckSize=10&cors=true") {
		t.Fatalf("download=%q", dl)
	}
	if ul != "https://example.com/backend/empty.php?cors=true" {
		t.Fatalf("upload=%q", ul)
	}
}

func TestCloudflareDownloadURL(t *testing.T) {
	got := CloudflareDownloadURL("https://speed.cloudflare.com/__down", 1_000_000)
	if !strings.Contains(got, "bytes=1000000") {
		t.Fatalf("url=%q", got)
	}
}

func TestResolveServersLibreSpeedDefaults(t *testing.T) {
	targets := resolveServers(Config{})
	if len(targets) != len(defaultServers) {
		t.Fatalf("targets=%d want %d", len(targets), len(defaultServers))
	}
	if targets[0].provider != ProviderLibreSpeed {
		t.Fatalf("provider=%v want librespeed", targets[0].provider)
	}
	if !strings.Contains(targets[0].downloadURL, "garbage.php?ckSize=10") {
		t.Fatalf("download=%q", targets[0].downloadURL)
	}
}

func TestResolveServersExplicitURLs(t *testing.T) {
	targets := resolveServers(Config{
		DownloadURL: "https://speed.cloudflare.com/__down",
		UploadURL:   "https://speed.cloudflare.com/__up",
	})
	if len(targets) != 1+len(defaultServers) {
		t.Fatalf("targets=%d want %d", len(targets), 1+len(defaultServers))
	}
	if targets[0].provider != ProviderCloudflare {
		t.Fatalf("provider=%v", targets[0].provider)
	}
	if targets[1].provider != ProviderLibreSpeed {
		t.Fatalf("fallback provider=%v", targets[1].provider)
	}
}

func TestEffectiveParallelStreams(t *testing.T) {
	if got := effectiveParallelStreams(8, ProviderLibreSpeed); got != 8 {
		t.Fatalf("librespeed=%d want 8", got)
	}
	if got := effectiveParallelStreams(8, ProviderCloudflare); got != 3 {
		t.Fatalf("cloudflare=%d want 3", got)
	}
}

func TestResolveServersCustomList(t *testing.T) {
	targets := resolveServers(Config{
		Servers: []string{"https://mirror.example/", "https://other.example/backend/"},
	})
	if len(targets) != 2 {
		t.Fatalf("targets=%d want 2", len(targets))
	}
	if !strings.HasPrefix(targets[1].downloadURL, "https://other.example/backend/garbage.php") {
		t.Fatalf("download=%q", targets[1].downloadURL)
	}
}
