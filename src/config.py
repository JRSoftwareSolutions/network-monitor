from dataclasses import dataclass
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config.yaml"
MIN_PING_INTERVAL_SECONDS = 0.1
MAX_PING_INTERVAL_SECONDS = 3600.0


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

    ping_interval_seconds = float(raw["ping_interval_seconds"])
    ping_interval_seconds = max(
        MIN_PING_INTERVAL_SECONDS,
        min(MAX_PING_INTERVAL_SECONDS, ping_interval_seconds),
    )

    return Config(
        target=str(raw["target"]),
        ping_interval_seconds=ping_interval_seconds,
        log_file=log_file,
        server_host=str(raw["server_host"]),
        server_port=int(raw["server_port"]),
        default_window_minutes=int(raw["default_window_minutes"]),
        max_log_age_minutes=int(raw["max_log_age_minutes"]),
        archive_enabled=bool(raw.get("archive_enabled", True)),
        max_log_size_bytes=max_log_size_bytes,
        archive_dir=archive_dir,
    )
