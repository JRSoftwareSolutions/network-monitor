# Network Monitor

Cross-platform network quality monitor: pings a configurable host every second, stores samples in SQLite, and serves a real-time dashboard over HTTP with Server-Sent Events (SSE).

## Requirements

- [Go 1.22+](https://go.dev/dl/)
- [Node.js 20+](https://nodejs.org/) (for building the dashboard)

## Quick start (Windows)

Double-click **`start.bat`**. It builds the web UI, compiles the Go binary, starts the server, and opens [http://127.0.0.1:8080](http://127.0.0.1:8080).

## Manual setup

```bash
cd web && npm install && npm run build
# sync built assets for go:embed (Windows PowerShell):
powershell -NoProfile -Command "Remove-Item -Recurse -Force internal/api/dist -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force internal/api/dist | Out-Null; Copy-Item -Recurse web/dist/* internal/api/dist/"
go build -o bin/monitor ./cmd/monitor
./bin/monitor
```

Or on Unix: `make build && ./bin/monitor`

## Configuration

Edit [`config.yaml`](config.yaml):

| Setting | Description | Default |
|---------|-------------|---------|
| `target` | Host or IP to ping | `1.1.1.1` |
| `ping_interval_seconds` | Seconds between pings | `1` |
| `retention_minutes` | How long to keep samples in SQLite | `180` |
| `listen_host` | Bind address (`0.0.0.0` for LAN) | `127.0.0.1` |
| `listen_port` | HTTP port | `8080` |
| `data_dir` | Directory for `monitor.db` | `./data` |
| `thresholds.ping_max`, `thresholds.jitter_max` | Exposed in config; not used in tier classification today | see `config.yaml` |
| `speedtest.servers` | LibreSpeed mirror base URLs, tried in order until one succeeds | see `config.yaml` |
| `speedtest.download_path`, `speedtest.upload_path` | Paths relative to each mirror base (`garbage.php`, `empty.php`) | `garbage.php`, `empty.php` |
| `speedtest.download_url`, `speedtest.upload_url` | Optional explicit endpoints (skips mirror list); use for Cloudflare legacy `__down` / `__up` | unset |
| `speedtest.duration_seconds` | Seconds per download and upload phase | `10` |
| `speedtest.parallel_streams` | Concurrent download/upload connections (1–16); use 8+ on gigabit links | `8` |

Speed tests run from the **monitor host** using the LibreSpeed protocol against public mirrors with automatic failover. Set `download_url` and `upload_url` together to override with a custom or Cloudflare endpoint.

Measurement uses a TCP warm-up grace period (1.5 s download, 3 s upload), staggered stream starts, and pipelined download requests. Live progress shows a rolling 1.5 s average; the stored result is steady-state throughput after the grace window.

Each ping attempt times out after **1.5 s** if the target does not respond (not configurable).

### LAN access

Set `listen_host: 0.0.0.0` and open `http://<your-machine-ip>:8080` from another device on the network.

When not bound to localhost, `PUT /api/config` requires a token:

```bash
set CONFIG_TOKEN=your-secret
```

Send `Authorization: Bearer your-secret` or `X-Config-Token: your-secret` with settings changes.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Uptime and health |
| `GET` | `/api/config` | Current settings and thresholds |
| `PUT` | `/api/config` | Update target, interval, retention |
| `GET` | `/api/summary?minutes=` | Window aggregates and status tier |
| `GET` | `/api/samples?minutes=` | Time-bucketed chart series (`buckets`, tier-derived `bucket_seconds`, min/max/avg per bucket) |
| `GET` | `/api/live` | Rolling 60s window (`last_ts`, `last_success`, avg/min/max latency and jitter, loss %, sample and success counts) |
| `POST` | `/api/speedtest` | On-demand download + upload throughput snapshot (Mbps) from the monitor host; emits `speedtest_progress` SSE events during the run; persists result to SQLite |
| `GET` | `/api/speedtest` | Whether a speed test is currently running (`running`) |
| `GET` | `/api/speedtest/results?limit=` | Recent persisted speed test results (newest first, default limit 50, max 500) |
| `GET` | `/api/events` | SSE stream (`sample`, `config`, `speedtest_progress` events) |

## Development

Double-click **`dev.bat`** (or run `npm run dev` from the repo root). It starts the Go API and Vite dev server, then opens [http://127.0.0.1:5173](http://127.0.0.1:5173). UI changes hot-reload; restart the API window after Go changes.

Manual two-terminal workflow:

```bash
go run ./cmd/monitor          # Terminal 1 — API on :8080
cd web && npm run dev         # Terminal 2 — Vite on :5173, proxies /api
```

## Tests

From the repo root:

```bash
npm test
```

This runs Go unit tests, Vitest, builds the binary, and runs Playwright e2e tests.

## Architecture

```
cmd/monitor/          Go entrypoint
internal/collector/   Cross-platform ping loop + jitter
internal/store/       SQLite persistence + retention
internal/api/         REST, SSE, embedded SPA
web/                  Vite + Svelte + uPlot dashboard
```

Samples are pushed to browsers via SSE; history and aggregates are fetched over REST. One binary embeds the built frontend — no Python runtime or CDN dependencies.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev guidelines, PR checklist, and Windows terminal notes. Maintainer details (data flow, API contract, extension points) are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
