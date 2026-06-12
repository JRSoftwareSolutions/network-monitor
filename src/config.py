from dataclasses import dataclass
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config.yaml"

MIN_PING_INTERVAL_SECONDS = 0.1
MAX_PING_INTERVAL_SECONDS = 3600.0
MIN_REFRESH_SECONDS = 1.0
MAX_REFRESH_SECONDS = 3600.0
MIN_HIDDEN_POLL_MULTIPLIER = 1
MAX_HIDDEN_POLL_MULTIPLIER = 60
MIN_LOG_AGE_MINUTES = 5
MAX_LOG_AGE_MINUTES = 10080  # one week

DEFAULT_FULL_REFRESH_SECONDS = 60.0
DEFAULT_CONNECTION_REFRESH_SECONDS = 120.0
DEFAULT_HIDDEN_POLL_MULTIPLIER = 10


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def clamp_ping_interval_seconds(value: float) -> float:
    return _clamp(float(value), MIN_PING_INTERVAL_SECONDS, MAX_PING_INTERVAL_SECONDS)


def clamp_refresh_seconds(value: float) -> float:
    return _clamp(float(value), MIN_REFRESH_SECONDS, MAX_REFRESH_SECONDS)


def clamp_hidden_poll_multiplier(value: int | float) -> int:
    return int(_clamp(int(value), MIN_HIDDEN_POLL_MULTIPLIER, MAX_HIDDEN_POLL_MULTIPLIER))


def clamp_log_age_minutes(value: int | float) -> int:
    return int(_clamp(int(value), MIN_LOG_AGE_MINUTES, MAX_LOG_AGE_MINUTES))


def normalize_target(value: str) -> str:
    target = str(value).strip()
    if not target:
        raise ValueError("target must not be empty")
    return target


@dataclass
class Config:
    target: str
    ping_interval_seconds: float
    log_file: Path
    server_host: str
    server_port: int
    default_window_minutes: int
    max_log_age_minutes: int
    archive_enabled: bool
    max_log_size_bytes: int
    archive_dir: Path
    full_refresh_seconds: float = DEFAULT_FULL_REFRESH_SECONDS
    connection_refresh_seconds: float = DEFAULT_CONNECTION_REFRESH_SECONDS
    hidden_poll_multiplier: int = DEFAULT_HIDDEN_POLL_MULTIPLIER


def load_config(path: Path | None = None) -> Config:
    config_path = path or DEFAULT_CONFIG_PATH
    with config_path.open(encoding="utf-8") as handle:
        raw = yaml.safe_load(handle)

    log_file = Path(raw["log_file"])
    if not log_file.is_absolute():
        log_file = PROJECT_ROOT / log_file

    archive_dir = Path(raw.get("archive_dir", "logs/archive"))
    if not archive_dir.is_absolute():
        archive_dir = PROJECT_ROOT / archive_dir

    max_log_size_mb = float(raw.get("max_log_size_mb", 1))
    max_log_size_bytes = max(1, int(max_log_size_mb * 1024 * 1024))

    return Config(
        target=normalize_target(raw["target"]),
        ping_interval_seconds=clamp_ping_interval_seconds(raw["ping_interval_seconds"]),
        log_file=log_file,
        server_host=str(raw["server_host"]),
        server_port=int(raw["server_port"]),
        default_window_minutes=int(raw["default_window_minutes"]),
        max_log_age_minutes=clamp_log_age_minutes(raw["max_log_age_minutes"]),
        archive_enabled=bool(raw.get("archive_enabled", True)),
        max_log_size_bytes=max_log_size_bytes,
        archive_dir=archive_dir,
        full_refresh_seconds=clamp_refresh_seconds(
            raw.get("full_refresh_seconds", DEFAULT_FULL_REFRESH_SECONDS)
        ),
        connection_refresh_seconds=clamp_refresh_seconds(
            raw.get("connection_refresh_seconds", DEFAULT_CONNECTION_REFRESH_SECONDS)
        ),
        hidden_poll_multiplier=clamp_hidden_poll_multiplier(
            raw.get("hidden_poll_multiplier", DEFAULT_HIDDEN_POLL_MULTIPLIER)
        ),
    )


def _yaml_number(value: float) -> int | float:
    """Write whole numbers as ints so the YAML stays clean (3 instead of 3.0)."""
    numeric = float(value)
    return int(numeric) if numeric.is_integer() else numeric


def _yaml_path(path: Path) -> str:
    """Keep paths inside the project relative, as they were authored."""
    try:
        return path.relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return str(path)


def save_config(config: Config, path: Path | None = None) -> None:
    config_path = path or DEFAULT_CONFIG_PATH
    data = {
        "target": config.target,
        "ping_interval_seconds": _yaml_number(config.ping_interval_seconds),
        "log_file": _yaml_path(config.log_file),
        "server_host": config.server_host,
        "server_port": config.server_port,
        "default_window_minutes": config.default_window_minutes,
        "max_log_age_minutes": config.max_log_age_minutes,
        "archive_enabled": config.archive_enabled,
        "max_log_size_mb": _yaml_number(config.max_log_size_bytes / (1024 * 1024)),
        "archive_dir": _yaml_path(config.archive_dir),
        "full_refresh_seconds": _yaml_number(config.full_refresh_seconds),
        "connection_refresh_seconds": _yaml_number(config.connection_refresh_seconds),
        "hidden_poll_multiplier": config.hidden_poll_multiplier,
    }
    with config_path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(data, handle, sort_keys=False, allow_unicode=True)
