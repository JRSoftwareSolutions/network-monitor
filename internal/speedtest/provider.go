package speedtest

import (
	"fmt"
	"net/url"
	"strings"
)

type Provider int

const (
	ProviderLibreSpeed Provider = iota
	ProviderCloudflare
	ProviderCustom
)

const (
	defaultDownloadPath = "garbage.php"
	defaultUploadPath   = "empty.php"
	downloadChunkMB     = 10
)

var defaultServers = []string{
	"https://speedtest.selectel.ru/",
	"https://nyc.speedtest.clouvider.net/backend/",
	"https://fra.speedtest.clouvider.net/backend/",
	"https://speedtest.singapore.linode.com/",
}

type serverTarget struct {
	downloadURL string
	uploadURL   string
	provider    Provider
}

func DetectProvider(downloadURL, uploadURL string) Provider {
	if strings.Contains(downloadURL, "speed.cloudflare.com") || strings.Contains(uploadURL, "speed.cloudflare.com") {
		return ProviderCloudflare
	}
	return ProviderCustom
}

func LibreSpeedURLs(base, dlPath, ulPath string, ckSizeMB int) (download, upload string) {
	if dlPath == "" {
		dlPath = defaultDownloadPath
	}
	if ulPath == "" {
		ulPath = defaultUploadPath
	}
	if ckSizeMB < 1 {
		ckSizeMB = downloadChunkMB
	}
	base = strings.TrimRight(base, "/") + "/"
	download = fmt.Sprintf("%s%s?ckSize=%d&cors=true", base, strings.TrimLeft(dlPath, "/"), ckSizeMB)
	upload = fmt.Sprintf("%s%s?cors=true", base, strings.TrimLeft(ulPath, "/"))
	return download, upload
}

func CloudflareDownloadURL(base string, bytes int) string {
	u, err := url.Parse(base)
	if err != nil {
		return fmt.Sprintf("%s?bytes=%d", strings.TrimRight(base, "/"), bytes)
	}
	q := u.Query()
	q.Set("bytes", fmt.Sprintf("%d", bytes))
	u.RawQuery = q.Encode()
	return u.String()
}

func effectiveParallelStreams(requested int, provider Provider) int {
	if requested < 1 {
		requested = defaultParallelStreams
	}
	if provider == ProviderCloudflare && requested > 3 {
		return 3
	}
	return requested
}

func resolveServers(cfg Config) []serverTarget {
	if cfg.DownloadURL != "" && cfg.UploadURL != "" {
		prov := DetectProvider(cfg.DownloadURL, cfg.UploadURL)
		downloadURL := cfg.DownloadURL
		if prov == ProviderCloudflare {
			downloadURL = CloudflareDownloadURL(cfg.DownloadURL, downloadChunkBytes)
		}
		targets := []serverTarget{{
			downloadURL: downloadURL,
			uploadURL:   cfg.UploadURL,
			provider:    prov,
		}}
		if prov == ProviderCloudflare {
			targets = append(targets, libreSpeedTargets(cfg)...)
		}
		return targets
	}

	return libreSpeedTargets(cfg)
}

func libreSpeedTargets(cfg Config) []serverTarget {
	servers := cfg.Servers
	if len(servers) == 0 {
		servers = defaultServers
	}

	targets := make([]serverTarget, 0, len(servers))
	for _, base := range servers {
		base = strings.TrimSpace(base)
		if base == "" {
			continue
		}
		download, upload := LibreSpeedURLs(base, cfg.DownloadPath, cfg.UploadPath, downloadChunkMB)
		targets = append(targets, serverTarget{
			downloadURL: download,
			uploadURL:   upload,
			provider:    ProviderLibreSpeed,
		})
	}
	return targets
}
