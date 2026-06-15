import json
from datetime import datetime, timezone
from pathlib import Path

from src.monitoring.logger import MetricsLogger

from helpers import sample


def test_metrics_logger_archives_old_lines(tmp_path: Path):
    log_file = tmp_path / "metrics.jsonl"
    archive_dir = tmp_path / "archive"
    now = datetime.now(timezone.utc)
    old_line = json.dumps(sample(now, -7200, latency_ms=10), separators=(",", ":"))
    fresh_line = json.dumps(sample(now, -30, latency_ms=20), separators=(",", ":"))
    log_file.write_text(f"{old_line}\n{fresh_line}\n", encoding="utf-8")

    logger = MetricsLogger(
        log_file,
        max_log_age_minutes=60,
        archive_enabled=True,
        max_log_size_bytes=1024,
        archive_dir=archive_dir,
    )
    try:
        logger._maintain_log()
    finally:
        logger.close()

    kept = log_file.read_text(encoding="utf-8").strip().splitlines()
    assert len(kept) == 1
    assert json.loads(kept[0])["latency_ms"] == 20
    archives = list(archive_dir.glob("metrics-*.jsonl"))
    assert len(archives) == 1
    archived = archives[0].read_text(encoding="utf-8")
    assert old_line in archived


def test_metrics_logger_buffers_and_flushes(tmp_path: Path):
    log_file = tmp_path / "metrics.jsonl"
    logger = MetricsLogger(log_file, max_log_age_minutes=60, max_log_size_bytes=1024)
    now = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)
    try:
        logger.append(sample(now, 0, latency_ms=10))
        assert log_file.exists() is False or log_file.read_text(encoding="utf-8") == ""
        logger.flush()
        assert log_file.read_text(encoding="utf-8").strip()
    finally:
        logger.close()
