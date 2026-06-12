# Network Monitor

Measures **latency**, **jitter**, and **packet loss** by pinging a configurable host. Results are appended to a JSON Lines log file and displayed in a live browser dashboard with a configurable rolling time window.

## Requirements

- Python 3.10+
- Windows (uses native `ping` command)

## Setup

```bash
pip install -r requirements.txt
```

## Run

From the project root:

```bash
python -m src.server
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080) in your browser.

The monitor starts automatically when the server starts. One JSON sample is written per ping interval.

## Configuration

Edit [`config.yaml`](config.yaml):

| Setting | Description | Default |
|---------|-------------|---------|
| `target` | Host or IP to ping | `1.1.1.1` |
| `ping_interval_seconds` | Seconds between pings | `1` |
| `log_file` | Path to JSONL log (relative to project root) | `logs/metrics.jsonl` |
| `server_host` | Web server bind address | `127.0.0.1` |
| `server_port` | Web server port | `8080` |
| `default_window_minutes` | Default dashboard rolling window | `30` |
| `max_log_age_minutes` | Move log entries older than this out of the live file | `60` |
| `archive_enabled` | Write removed entries to timestamped archive files | `true` |
| `max_log_size_mb` | Max live log file size before oldest entries are archived | `1` |
| `archive_dir` | Directory for archived JSONL files | `logs/archive` |

## Archiving

After each ping, the live log file is maintained to stay manageable:

1. **Age-based** — entries older than `max_log_age_minutes` are removed from the live file.
2. **Size-based** — if the live file still exceeds `max_log_size_mb`, the oldest remaining entries are removed until it is under the limit.

When `archive_enabled` is `true` (default), removed entries are written to timestamped files under `archive_dir`, e.g. `logs/archive/metrics-2026-06-12T16-30-00.123Z.jsonl`. When disabled, removed entries are discarded (same as the previous trim-only behavior).

The dashboard reads only the live log file; archives are kept for historical retention.

## Log format

Each line in the log file is a JSON object:

```json
{"ts":"2026-06-12T14:30:01.123Z","host":"1.1.1.1","success":true,"latency_ms":14.2,"jitter_ms":1.8}
```

Fields:

- `ts` — UTC timestamp (ISO-8601)
- `host` — ping target
- `success` — whether the ping succeeded
- `latency_ms` — round-trip time in milliseconds, or `null` on failure
- `jitter_ms` — RFC 3550-style smoothed jitter, or `null`

## Dashboard

- Poll interval matches `ping_interval_seconds` from config
- Checks `/api/metrics/status` each interval and only loads full metrics when a new sample is available
- Connection info refreshes every 30 seconds
- Rolling window options: 5, 15, 30 (default), 60, 120 minutes
- Window selection is saved in browser `localStorage`
- Summary cards, latency/jitter chart, packet loss chart, and recent sample table

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/config` | Monitor configuration for the UI |
| `GET /api/metrics/status` | Latest sample timestamp (lightweight poll check) |
| `GET /api/metrics?windowMinutes=30` | Filtered samples and aggregated stats |

Packet loss in stats is computed over the selected window: `(failed pings / total pings) × 100`.
