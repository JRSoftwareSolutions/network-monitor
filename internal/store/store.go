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
	_, err := s.db.Exec(`DELETE FROM samples WHERE ts < ?`, cutoff)
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
