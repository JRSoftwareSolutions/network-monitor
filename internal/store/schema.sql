PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS samples (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  host       TEXT NOT NULL,
  success    INTEGER NOT NULL,
  latency_ms REAL,
  jitter_ms  REAL
);

CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts);

CREATE TABLE IF NOT EXISTS speedtest_results (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ts               TEXT NOT NULL,
  download_mbps    REAL,
  upload_mbps      REAL,
  duration_seconds INTEGER NOT NULL,
  error            TEXT
);

CREATE INDEX IF NOT EXISTS idx_speedtest_results_ts ON speedtest_results(ts);
