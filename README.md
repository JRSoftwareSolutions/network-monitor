# Network Monitor

Measures **latency**, **jitter**, and **packet loss** by pinging a configurable host. Results are kept in memory for fast API responses, persisted to a JSON Lines log file, and displayed in a live browser dashboard with a damped, gaming-aware **connection verdict**, a plain-language **current status** narrative, and a configurable rolling time window.

## Requirements

- Python 3.10+
- Windows (uses native `ping` command)

## Setup

```bash
pip install -r requirements.txt
```

Or double-click **`start.bat`** — it creates a local `.venv`, installs dependencies, starts the server, and opens the dashboard in your browser.

## Run

From the project root:

```bash
python -m src.server
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080) in your browser.

The monitor starts automatically when the server starts. One JSON sample is written per ping interval.

## Standalone exe (Windows)

Build a double-clickable desktop app — the machine that runs it does not need Python:

1. Double-click **`build.bat`** (or run it from a terminal). It installs the build dependencies into `.venv` and runs PyInstaller.
2. Copy the output folder `dist\NetworkMonitor\` anywhere you like.
3. Double-click `NetworkMonitor.exe`. The dashboard opens in its own window; closing the window shuts down the server and ping monitor cleanly.

Notes:

- On first run, an editable `config.yaml` and a `logs\` folder are created next to the exe and persist across restarts.
- Requires the Microsoft WebView2 runtime (preinstalled on Windows 10/11).
- The dashboard loads Chart.js and fonts from CDNs, so it needs internet access to render charts.
- To try the desktop window from source without building: `pip install -r requirements-build.txt`, then `python -m src.desktop`.

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
| `max_log_age_minutes` | Retain samples in memory and live log for this long | `180` |
| `archive_enabled` | Write removed entries to timestamped archive files | `true` |
| `max_log_size_mb` | Max live log file size before oldest entries are archived | `1` |
| `archive_dir` | Directory for archived JSONL files | `logs/archive` |

Rolling window options in the dashboard are limited to values ≤ `max_log_age_minutes` (5, 15, 30, 60, 120 minutes by default).

## Archiving

After each ping, the live log file is maintained to stay manageable:

1. **Age-based** — entries older than `max_log_age_minutes` are removed from the live file.
2. **Size-based** — if the live file still exceeds `max_log_size_mb`, the oldest remaining entries are removed until it is under the limit.

Log maintenance runs at most once per minute (not on every ping). When `archive_enabled` is `true` (default), removed entries are written to daily archive files under `archive_dir`, e.g. `logs/archive/metrics-2026-06-14.jsonl`. When disabled, removed entries are discarded.

The dashboard reads from an in-memory sample store (seeded from the live log on startup); archives are kept for historical retention.

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

Top to bottom:

- **Status banner (hero)** — the *displayed* verdict (`Great for gaming` / `Good to game` / `Playable, expect hiccups` / `Rough — expect lag` / `Offline`) is stabilized with dwell-time hysteresis: downgrades commit after ~8 s of sustained worse readings, upgrades after ~20 s, so single pings can't flip it. Next to it, a smoothed **baseline ping** readout (60-second median — spikes don't move it) with an eased arc, tweened numbers, and an improving/steady/degrading trend pill (last 2 min vs the prior 10 min)
- **Current status** — plain-language narrative explaining what's happening and what it means in-game (e.g. an isolated 150 ms spike is a single micro-hitch, not real lag), plus per-metric reason chips
- **Key indicators** — Ping, Jitter, Packet loss, and Spike rate tiles, each with a rating badge, a one-line gameplay meaning, and a marker on a great→bad scale bar
- **Live feed** — the raw micro view that *is* allowed to jump: last raw ping, instantaneous verdict chip, and a heartbeat strip of the last 60 pings colored by rating
- **History** — selected-window stats with health chip, 1-minute candlesticks, latency/jitter chart with quality threshold bands (40/70/110 ms), packet loss chart, outage history, and recent samples

Plus:

- Live tab title (`28 ms · Good to game`) and a favicon dot that recolors with the verdict, so the tab works as a background monitor
- Poll interval matches `ping_interval_seconds` from config; lightweight `/api/metrics/live` checks use `knownTs` so full metrics load only when a new sample is available
- Connection info refreshes every 2 minutes (cached server-side for 5 minutes)
- Rolling window options derived from `max_log_age_minutes`; selection saved in browser `localStorage`
- "Updated Xs ago" staleness indicator

### Gaming verdict thresholds

Computed server-side over the last 120 seconds; the instant verdict is the worst rating across metrics. A ping counts as a **spike** when it exceeds `max(2.5× baseline, baseline + 80 ms)`, where baseline is the rolling median of the last 60 s — what's rated is the spike *rate*, not the single worst value.

| Metric | Great | Good | Okay | Bad |
|--------|-------|------|------|-----|
| Baseline ping (median) | < 40 ms | < 70 ms | < 110 ms | ≥ 110 ms |
| Avg jitter | < 8 ms | < 15 ms | < 30 ms | ≥ 30 ms |
| Packet loss | 0% | < 1% | ≤ 3% | > 3% |
| Spike rate | 0/min | < 1/min | ≤ 4/min | > 4/min |

`Offline` is reported when 3+ pings fail in a row or no ping has succeeded for 30+ seconds, and commits to the displayed verdict immediately (it is already debounced).

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/config` | Monitor configuration for the UI (includes `window_options`) |
| `GET /api/connection` | Active network connection (WiFi/Ethernet + name) |
| `GET /api/metrics/live?knownTs=…` | Lightweight poll: recent samples + `now` verdict when timestamp changed |
| `GET /api/metrics?windowMinutes=30` | Filtered samples, stats, health, outages, and blocks |

`/api/metrics` response includes:

- `samples` — downsampled chart series (max ~1500 points)
- `recent_samples` — last 60 raw ping samples (heartbeat strip + recent table)
- `sample_count_raw` — full sample count in the window
- `stats` — `packet_loss_pct`, `uptime_pct`, latency min/avg/max/p95, jitter avg, sample count
- `health` — level (`healthy`, `degraded`, `poor`, `offline`, `no_data`), label, reasons
- `now` — gaming readiness over the last 120s, independent of the selected window:
  - `stats` — latest/avg/max ping, jitter, loss, tail failures
  - `baseline_ms` — rolling 60 s median ping; `spike_threshold_ms`, `spike_count`, `spike_rate_per_min`, `worst_spike`
  - `ratings` / `indicators` — per-metric level (`great`/`good`/`okay`/`bad`) with value, short text, and gameplay meaning
  - `instant_verdict` — raw per-poll verdict (level, label, reasons)
  - `display_verdict` — hysteresis-stabilized verdict (level, label, `since_seconds`, `pending` transition info)
  - `trend` — `improving`/`steady`/`degrading` vs the prior 10 minutes, with latency/loss deltas
  - `narrative` — headline, one-line summary, plain-language sentences, and reason chips
- `outages` — consecutive failure runs with start/end, duration, failed count, ongoing flag
- `blocks` — 1-minute bucket summaries for the candlestick chart

Packet loss in stats is computed over the selected window: `(failed pings / total pings) × 100`.

## Ping parsing

On Windows, pings use the native `IcmpSendEcho` API (no `ping.exe` subprocess per sample). Hostnames are resolved once and cached for five minutes; if native ICMP is unavailable, the monitor falls back to locale-neutral parsing of the `ping` command output (e.g. Dutch `tijd=14 ms`).

## Project layout

### Python (`src/`)

| Module | Role |
|--------|------|
| `server.py` | FastAPI app, static files, metrics API |
| `desktop.py` | PyInstaller desktop entry (WebView2 window) |
| `ping_monitor.py` | Async ping loop, orchestrates store + logger |
| `sample_store.py` | In-memory ring buffer of recent samples |
| `metrics_logger.py` | JSONL persistence, age/size maintenance, daily archives |
| `metrics_analytics.py` | Downsampling, bucketing, stats, outage detection |
| `metrics.py` | Public facade re-exporting analytics + store APIs |
| `metrics_verdict.py` | Gaming thresholds, stabilizer hysteresis |
| `metrics_narrative.py` | Plain-language status copy |
| `metrics_time.py` | Timestamp parsing/formatting helpers |
| `config.py` | YAML config load/save with validation |
| `network_info.py` | Windows connection label for the UI |
| `win_ping.py` / `win_proc.py` / `jitter.py` | Native ICMP, process helpers, jitter tracker |

### Frontend (`static/js/` — zero-build IIFE modules on `window.NM`)

Scripts load in dependency order from `index.html`. Each file registers its public API on `NM` (e.g. `NM.constants`, `NM.grid`, `NM.views`).

| Module | Role |
|--------|------|
| `namespace.js` | Creates `window.NM` |
| `constants.js`, `rating-format.js` | Thresholds, formatting |
| `chart-config.js`, `charts-*.js`, `chart-plugins.js` | Chart.js setup |
| `dashboard-grid.js` | GridStack layout (`NM.grid`) |
| `views-model.js`, `views-panels.js`, `views-dialog.js`, `view-builder.js` | Dashboard views/layout (`NM.views`) |
| `app-*.js`, `../app.js` | App shell, polling, UI wiring (`NM.app`) |

## CSS architecture

Styles are bundled from a single SCSS entry point through Sass and PostCSS:

| File | Responsibility |
|------|----------------|
| `static/scss/main.scss` | Source entry — `@use` chain in layer order |
| `static/css/app.css` | Built bundle loaded by the dashboard (`npm run build:css`) |
| `static/scss/abstracts/_tokens.scss` | Design tokens (`:root` vars, `@property` rules) |
| `static/scss/abstracts/_breakpoints.scss` | Sass breakpoint mixins (`bp-md`, etc.) |
| `static/scss/components/_shell.scss` | Page chrome, hero, status panel appearance |
| `static/scss/components/_tiles.scss` | Indicators, live feed tiles, settings popover |
| `static/scss/components/_data.scss` | History panels, charts, tables |
| `static/scss/components/_dashboard-grid.scss` | **GridStack layout** — positioning, edit mode, size presets |
| `static/css/vendor-gridstack.css` | GridStack vendor styles (committed; refresh with `npm run vendor:gridstack`) |
| `static/scss/_overrides.scss` | Theme mappings and final cascade overrides |

**Rules:**

- The app loads one stylesheet: `/static/css/app.css` (rebuild after editing SCSS source files).
- Never add `.grid-stack-*` selectors outside `_dashboard-grid.scss` or `vendor-gridstack.css`.
- Panel wrappers (`[data-panel]`) hold GridStack attributes; inner `<section>` elements hold visual classes.
- Dynamic sizing uses CSS custom properties set from JS (`--hb-height`, `--arc-offset`, etc.).

```bash
npm run build:css        # compile main.scss → app.css (via main.interim.css)
npm run watch:css        # rebuild SCSS → app.css on change (sass + postcss in parallel)
npm run vendor:gridstack # copy GridStack CSS from node_modules (do not curl the CDN)
npm run lint:css         # stylelint guardrails
```

Layer order is declared in `static/scss/base/_layers.scss`: `tokens → reset → vendor → primitives → components → utilities → overrides`.

## Tests

Python unit tests (behavior of ping parsing, config, verdict math, analytics):

```bash
pip install -r requirements-dev.txt
python -m pytest tests/py -q
```

JavaScript unit tests + Playwright e2e:

```bash
npm install
npm run build:css
npm test
```

The test chain runs `build:css` → `lint:css` → `test:unit` → `test:e2e`.

`npm run test:py` runs the Python suite; `npm run test:unit` and `npm run test:e2e` run JS tests separately.
