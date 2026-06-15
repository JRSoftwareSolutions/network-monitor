import pytest

from src.config import (
    MAX_DEFAULT_WINDOW_MINUTES,
    MAX_LOG_AGE_MINUTES,
    MAX_PING_INTERVAL_SECONDS,
    MIN_DEFAULT_WINDOW_MINUTES,
    MIN_LOG_AGE_MINUTES,
    MIN_PING_INTERVAL_SECONDS,
    clamp_default_window_minutes,
    clamp_log_age_minutes,
    clamp_ping_interval_seconds,
    clamp_refresh_seconds,
    clamp_server_port,
    load_config,
    normalize_target,
)


def test_clamp_ping_interval_seconds():
    assert clamp_ping_interval_seconds(0.05) == MIN_PING_INTERVAL_SECONDS
    assert clamp_ping_interval_seconds(5000) == MAX_PING_INTERVAL_SECONDS
    assert clamp_ping_interval_seconds(1.5) == 1.5


def test_clamp_refresh_seconds():
    assert clamp_refresh_seconds(0.5) == 1.0
    assert clamp_refresh_seconds(9999) == 3600.0


def test_clamp_log_age_minutes():
    assert clamp_log_age_minutes(1) == MIN_LOG_AGE_MINUTES
    assert clamp_log_age_minutes(99999) == MAX_LOG_AGE_MINUTES


def test_clamp_server_port():
    assert clamp_server_port(0) == 1
    assert clamp_server_port(70000) == 65535
    assert clamp_server_port(8080) == 8080


def test_clamp_default_window_minutes():
    assert clamp_default_window_minutes(0) == MIN_DEFAULT_WINDOW_MINUTES
    assert clamp_default_window_minutes(9999) == MAX_DEFAULT_WINDOW_MINUTES


def test_normalize_target():
    assert normalize_target("  1.1.1.1  ") == "1.1.1.1"
    with pytest.raises(ValueError, match="empty"):
        normalize_target("   ")
    with pytest.raises(ValueError, match="hostname or IP"):
        normalize_target("-invalid")


def test_load_config_missing_file(tmp_path):
    config = load_config(tmp_path / "missing.yaml")
    assert config.target == "1.1.1.1"
    assert config.server_port == 8080
    assert config.default_window_minutes == 30


def test_load_config_empty_yaml(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("", encoding="utf-8")
    config = load_config(path)
    assert config.target == "1.1.1.1"


def test_load_config_none_yaml(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("~", encoding="utf-8")
    config = load_config(path)
    assert config.ping_interval_seconds == MIN_PING_INTERVAL_SECONDS


def test_load_config_invalid_integer_fields_log_warning(tmp_path, caplog):
    path = tmp_path / "config.yaml"
    path.write_text(
        "target: 1.1.1.1\n"
        "server_port: not-a-number\n"
        "default_window_minutes: bad\n",
        encoding="utf-8",
    )
    with caplog.at_level("WARNING"):
        config = load_config(path)
    assert config.server_port == 8080
    assert config.default_window_minutes == 30
    assert any("server_port must be an integer" in record.message for record in caplog.records)
    assert any("default_window_minutes must be an integer" in record.message for record in caplog.records)


def test_load_config_out_of_range_port_and_window(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "target: 8.8.8.8\n"
        "ping_interval_seconds: 1\n"
        "log_file: logs/metrics.jsonl\n"
        "server_host: 127.0.0.1\n"
        "server_port: 99999\n"
        "default_window_minutes: 5000\n"
        "max_log_age_minutes: 60\n",
        encoding="utf-8",
    )
    config = load_config(path)
    assert config.target == "8.8.8.8"
    assert config.server_port == 65535
    assert config.default_window_minutes == MAX_DEFAULT_WINDOW_MINUTES
