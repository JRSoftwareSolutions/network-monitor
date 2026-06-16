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
| `GET` | `/api/samples?minutes=` | Downsampled chart series |
| `GET` | `/api/live` | Rolling 60s live metrics |
| `GET` | `/api/events` | SSE stream (`sample`, `config` events) |

## Development

Terminal 1 — API and collector:

```bash
go run ./cmd/monitor
```

Terminal 2 — Vite dev server (proxies `/api` to `:8080`):

```bash
cd web && npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Tests

```bash
go test ./...
cd web && npm run test
npm run build   # ensure bin/monitor.exe exists
npx playwright test
```

## Architecture

```
cmd/monitor/          Go entrypoint
internal/collector/   Cross-platform ping loop + jitter
internal/store/       SQLite persistence + retention
internal/api/         REST, SSE, embedded SPA
web/                  Vite + Svelte + uPlot dashboard
```

Samples are pushed to browsers via SSE; history and aggregates are fetched over REST. One binary embeds the built frontend — no Python runtime or CDN dependencies.
