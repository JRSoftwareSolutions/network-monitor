# Contributing

Thanks for helping improve Network Monitor. This doc covers conventions and what to check before opening a PR.

## Dev setup

See [README.md](README.md) for requirements, quick start (`start.bat`), dev mode (`dev.bat` or `npm run dev`), manual build, and the two-terminal dev workflow (Go API on `:8080`, Vite on `:5173`).

## Architecture

Network Monitor is a single Go binary: collector → SQLite → REST/SSE API → embedded Svelte dashboard. Package boundaries and data flow are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Guidelines

Use this checklist when planning or reviewing changes.

- [ ] **Layered architecture** — Each package has one job. Data flows collector → store → metrics/api → frontend. No HTTP in collector, no SQL in handlers, no fetch in components.
- [ ] **API as contract** — JSON shapes live in Go structs and `web/src/lib/api.ts`. Update both in the same PR. Prefer additive changes; document new endpoints in README.
- [ ] **Test what breaks** — Go unit tests for parsing/math/store; `httptest` for handlers; Vitest for pure TS; Playwright for dashboard flows. Skip mock-only or trivial tests.
- [ ] **Small, focused PRs** — One intent per PR (feature, fix, or refactor). Keep diffs reviewable; separate refactors from behavior changes.
- [ ] **Dependency discipline** — Justify every new dependency in the PR. Prefer stdlib, Svelte runes, and pure functions. Pin versions in `go.mod` and `web/package.json`.
- [ ] **Config and secrets** — Settings in `config.yaml`; secrets via env (`CONFIG_TOKEN`). Validate on load; never commit tokens or embed secrets in the frontend.
- [ ] **Schema changes** — Edit `internal/store/schema.sql`, add forward-only migration in `store.go`, add a store test with an old-schema fixture.
- [ ] **Error handling** — Go: return errors, log at boundaries, JSON `{ "error": "..." }` for HTTP failures. TS: `fetchJson` throws on non-2xx; SSE reconnect stays in `sse.ts`.
- [ ] **Frontend state** — State in `App.svelte` via runes; components get props and emit events. Window bindings via `DASHBOARD_METRICS`; status tiers via `status.ts` / Go `metrics`.
- [ ] **Data visualization** — Charts bucket by fixed time intervals (~300 points per window); avg line + per-bucket range band (see [docs/DATA_VISUALIZATION.md](docs/DATA_VISUALIZATION.md)). Epoch-aligned bins, completed-bin SSE ingest, event-driven chart refresh. Aggregation in `metrics` / `charts.ts`, not components.
- [ ] **Security baseline** — Token required for config writes from non-localhost. Validate and bound user input. No secrets in logs or commits.
- [ ] **Technical debt** — Label shortcuts `tech-debt`. Do not add features while tests fail, Go/TS logic is duplicated, schema lacks migration, or API changes are undocumented.
- [ ] **Automation (recommended)** — CI running `npm test`, `gofmt`, and `tsc --noEmit` are not set up yet but are the next guardrails to adopt.

## PR checklist

Before requesting review:

- [ ] `npm test` passes (Go unit tests, Vitest, Playwright)
- [ ] API changes mirrored in `web/src/lib/api.ts` (and Go handlers/types)
- [ ] [README.md](README.md) API table updated if endpoints or shapes changed
- [ ] Schema changes include migration + store test (if applicable)
- [ ] New dependencies justified in the PR description

## Windows terminal note

This project targets Windows PowerShell. When probing localhost or running HTTP commands from a terminal or agent:

- Use `curl.exe`, not bare `curl` (PowerShell aliases it to `Invoke-WebRequest`)
- Always pass `--max-time` (`2` for localhost)
- Prefer `start.bat` to start the app and `npm test` for tests

Full rules: [.cursor/rules/terminal-commands.mdc](.cursor/rules/terminal-commands.mdc).
