package store

import (
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

type Sample struct {
	TS        string   `json:"ts"`
	Host      string   `json:"host"`
	Success   bool     `json:"success"`
	LatencyMs *float64 `json:"latency_ms,omitempty"`
	JitterMs  *float64 `json:"jitter_ms,omitempty"`
}

type SpeedTestResult struct {
	ID              int64    `json:"id,omitempty"`
	TS              string   `json:"ts"`
	DownloadMbps    *float64 `json:"download_mbps,omitempty"`
	UploadMbps      *float64 `json:"upload_mbps,omitempty"`
	DurationSeconds int      `json:"duration_seconds"`
	Error           *string  `json:"error,omitempty"`
}

type Store struct {
	db *sql.DB
}

func Open(dbPath string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schemaSQL); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Insert(sample Sample) error {
	success := 0
	if sample.Success {
		success = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO samples (ts, host, success, latency_ms, jitter_ms) VALUES (?, ?, ?, ?, ?)`,
		sample.TS, sample.Host, success, sample.LatencyMs, sample.JitterMs,
	)
	return err
}

func (s *Store) Prune(before time.Time) error {
	cutoff := before.UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`DELETE FROM samples WHERE ts < ?`, cutoff); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM speedtest_results WHERE ts < ?`, cutoff)
	return err
}

func (s *Store) QuerySince(since time.Time) ([]Sample, error) {
	cutoff := since.UTC().Format(time.RFC3339Nano)
	rows, err := s.db.Query(
		`SELECT ts, host, success, latency_ms, jitter_ms FROM samples WHERE ts >= ? ORDER BY ts ASC`,
		cutoff,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Sample
	for rows.Next() {
		var sample Sample
		var success int
		var latency, jitter sql.NullFloat64
		if err := rows.Scan(&sample.TS, &sample.Host, &success, &latency, &jitter); err != nil {
			return nil, err
		}
		sample.Success = success == 1
		if latency.Valid {
			v := latency.Float64
			sample.LatencyMs = &v
		}
		if jitter.Valid {
			v := jitter.Float64
			sample.JitterMs = &v
		}
		out = append(out, sample)
	}
	return out, rows.Err()
}

func (s *Store) InsertSpeedTestResult(result SpeedTestResult) error {
	_, err := s.db.Exec(
		`INSERT INTO speedtest_results (ts, download_mbps, upload_mbps, duration_seconds, error) VALUES (?, ?, ?, ?, ?)`,
		result.TS, result.DownloadMbps, result.UploadMbps, result.DurationSeconds, result.Error,
	)
	return err
}

func (s *Store) QuerySpeedTestResults(limit int) ([]SpeedTestResult, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.db.Query(
		`SELECT id, ts, download_mbps, upload_mbps, duration_seconds, error
		 FROM speedtest_results ORDER BY ts DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SpeedTestResult
	for rows.Next() {
		var result SpeedTestResult
		var download, upload sql.NullFloat64
		var errText sql.NullString
		if err := rows.Scan(&result.ID, &result.TS, &download, &upload, &result.DurationSeconds, &errText); err != nil {
			return nil, err
		}
		if download.Valid {
			v := download.Float64
			result.DownloadMbps = &v
		}
		if upload.Valid {
			v := upload.Float64
			result.UploadMbps = &v
		}
		if errText.Valid {
			v := errText.String
			result.Error = &v
		}
		out = append(out, result)
	}
	return out, rows.Err()
}

func ParseTS(ts string) (time.Time, error) {
	if len(ts) > 0 && ts[len(ts)-1] == 'Z' {
		ts = ts[:len(ts)-1] + "+00:00"
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse ts %q: %w", ts, err)
	}
	return t.UTC(), nil
}
