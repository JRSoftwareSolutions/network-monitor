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
