package config

import (
	"path/filepath"
	"testing"
)

func TestDefaultAndUpdate(t *testing.T) {
	dir := t.TempDir()
	m, err := NewManager(filepath.Join(dir, "config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	target := "8.8.4.4"
	updated, err := m.Update(ConfigUpdate{Target: &target})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Target != "8.8.4.4" {
		t.Fatalf("target=%s", updated.Target)
	}
}

func TestInvalidTargetRejected(t *testing.T) {
	dir := t.TempDir()
	m, err := NewManager(filepath.Join(dir, "config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	bad := "not valid host!"
	_, err = m.Update(ConfigUpdate{Target: &bad})
	if err == nil {
		t.Fatal("expected validation error")
	}
}
