import re
import logging
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

if getattr(sys, "frozen", False):
    # PyInstaller bundle: writable data (config, logs) lives next to the exe,
    # read-only bundled assets (static/, config template) live in _MEIPASS.
    APP_ROOT = Path(sys.executable).resolve().parent
    BUNDLE_ROOT = Path(getattr(sys, "_MEIPASS", str(APP_ROOT)))
else:
    APP_ROOT = Path(__file__).resolve().parent.parent
    BUNDLE_ROOT = APP_ROOT

DEFAULT_CONFIG_PATH = APP_ROOT / "config.yaml"

MIN_PING_INTERVAL_SECONDS = 0.1
MAX_PING_INTERVAL_SECONDS = 3600.0
MIN_REFRESH_SECONDS = 1.0
MAX_REFRESH_SECONDS = 3600.0
MIN_LOG_AGE_MINUTES = 5
MAX_LOG_AGE_MINUTES = 10080  # one week
MIN_SERVER_PORT = 1
MAX_SERVER_PORT = 65535
MIN_DEFAULT_WINDOW_MINUTES = 1
MAX_DEFAULT_WINDOW_MINUTES = 1440

DEFAULT_FULL_REFRESH_SECONDS = 60.0
DEFAULT_CONNECTION_REFRESH_SECONDS = 120.0
DEFAULT_TARGET = "1.1.1.1"
DEFAULT_LOG_FILE = "logs/metrics.jsonl"
DEFAULT_SERVER_HOST = "127.0.0.1"
DEFAULT_SERVER_PORT = 8080
DEFAULT_WINDOW_MINUTES = 30
DEFAULT_MAX_LOG_AGE_MINUTES = 180
DEFAULT_ARCHIVE_DIR = "logs/archive"
DEFAULT_MAX_LOG_SIZE_MB = 1.0

# Hostname or IPv4/IPv6 address; must not start with "-" so the value can
# never be mistaken for a ping flag by the subprocess fallback.
TARGET_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:\-]{0,252}$")

_logger = logging.getLogger(__name__)


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def clamp_ping_interval_seconds(value: float) -> float:
    return _clamp(float(value), MIN_PING_INTERVAL_SECONDS, MAX_PING_INTERVAL_SECONDS)


def clamp_refresh_seconds(value: float) -> float:
    return _clamp(float(value), MIN_REFRESH_SECONDS, MAX_REFRESH_SECONDS)


def clamp_log_age_minutes(value: int | float) -> int:
    return int(_clamp(int(value), MIN_LOG_AGE_MINUTES, MAX_LOG_AGE_MINUTES))


def clamp_server_port(value: int | float) -> int:
    return int(_clamp(int(value), MIN_SERVER_PORT, MAX_SERVER_PORT))


def clamp_default_window_minutes(value: int | float) -> int:
    return int(_clamp(int(value), MIN_DEFAULT_WINDOW_MINUTES, MAX_DEFAULT_WINDOW_MINUTES))


def normalize_target(value: str) -> str:
    target = str(value).strip()
    if not target:
        raise ValueError("target must not be empty")
    if not TARGET_RE.match(target):
        raise ValueError("target must be a hostname or IP address")
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


def _resolve_path(raw_path: str | Path, default: str) -> Path:
    path = Path(raw_path or default)
    if not path.is_absolute():
        path = APP_ROOT / path
    return path


def _coerce_int(raw, default: int, *, key: str, errors: list[str]) -> int:
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        errors.append(f"{key} must be an integer; using default {default}")
        return default


def _read_yaml_raw(config_path: Path) -> tuple[dict, list[str]]:
    errors: list[str] = []
    raw: dict = {}

    if not config_path.exists():
        errors.append(f"Config file not found: {config_path}")
        return raw, errors

    try:
        content = config_path.read_text(encoding="utf-8")
    except OSError as exc:
        errors.append(f"Cannot read config file: {exc}")
        return raw, errors

    if not content.strip():
        errors.append("Config file is empty")
        return raw, errors

    try:
        loaded = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        errors.append(f"Invalid YAML in config: {exc}")
        return raw, errors

    if loaded is None:
        errors.append("Config file contains no data")
    elif not isinstance(loaded, dict):
        errors.append("Config root must be a mapping")
    else:
        raw = loaded

    return raw, errors


def _parse_config_fields(raw: dict, errors: list[str]) -> Config:
    target_raw = raw.get("target", DEFAULT_TARGET)
    try:
        target = normalize_target(str(target_raw))
    except ValueError:
        _logger.warning("Config: target must not be empty; using default %s", DEFAULT_TARGET)
        target = DEFAULT_TARGET

    ping_interval = clamp_ping_interval_seconds(
        raw.get("ping_interval_seconds", MIN_PING_INTERVAL_SECONDS)
    )

    log_file = _resolve_path(raw.get("log_file", DEFAULT_LOG_FILE), DEFAULT_LOG_FILE)
    archive_dir = _resolve_path(raw.get("archive_dir", DEFAULT_ARCHIVE_DIR), DEFAULT_ARCHIVE_DIR)

    max_log_size_mb = raw.get("max_log_size_mb", DEFAULT_MAX_LOG_SIZE_MB)
    try:
        max_log_size_mb = float(max_log_size_mb)
    except (TypeError, ValueError):
        _logger.warning(
            "Config: max_log_size_mb must be numeric; using default %s",
            DEFAULT_MAX_LOG_SIZE_MB,
        )
        max_log_size_mb = DEFAULT_MAX_LOG_SIZE_MB
    max_log_size_bytes = max(1, int(max_log_size_mb * 1024 * 1024))

    server_host = str(raw.get("server_host", DEFAULT_SERVER_HOST))

    server_port = clamp_server_port(
        _coerce_int(
            raw.get("server_port"),
            DEFAULT_SERVER_PORT,
            key="server_port",
            errors=errors,
        )
    )
    if raw.get("server_port") is not None:
        try:
            requested = int(raw["server_port"])
        except (TypeError, ValueError):
            requested = None
        if requested is not None and requested != server_port:
            _logger.warning(
                "Config: server_port %s out of range %s-%s; using %s",
                requested,
                MIN_SERVER_PORT,
                MAX_SERVER_PORT,
                server_port,
            )

    default_window_minutes = _coerce_int(
        raw.get("default_window_minutes"),
        DEFAULT_WINDOW_MINUTES,
        key="default_window_minutes",
        errors=errors,
    )
    default_window_minutes = clamp_default_window_minutes(default_window_minutes)
    if raw.get("default_window_minutes") is not None:
        try:
            requested = int(raw["default_window_minutes"])
        except (TypeError, ValueError):
            requested = None
        if requested is not None and requested != default_window_minutes:
            _logger.warning(
                "Config: default_window_minutes %s out of range %s-%s; using %s",
                requested,
                MIN_DEFAULT_WINDOW_MINUTES,
                MAX_DEFAULT_WINDOW_MINUTES,
                default_window_minutes,
            )

    max_log_age_minutes = clamp_log_age_minutes(
        raw.get("max_log_age_minutes", DEFAULT_MAX_LOG_AGE_MINUTES)
    )

    return Config(
        target=target,
        ping_interval_seconds=ping_interval,
        log_file=log_file,
        server_host=server_host,
        server_port=server_port,
        default_window_minutes=default_window_minutes,
        max_log_age_minutes=max_log_age_minutes,
        archive_enabled=bool(raw.get("archive_enabled", True)),
        max_log_size_bytes=max_log_size_bytes,
        archive_dir=archive_dir,
        full_refresh_seconds=clamp_refresh_seconds(
            raw.get("full_refresh_seconds", DEFAULT_FULL_REFRESH_SECONDS)
        ),
        connection_refresh_seconds=clamp_refresh_seconds(
            raw.get("connection_refresh_seconds", DEFAULT_CONNECTION_REFRESH_SECONDS)
        ),
    )


def load_config(path: Path | None = None) -> Config:
    config_path = path or DEFAULT_CONFIG_PATH
    raw, errors = _read_yaml_raw(config_path)
    config = _parse_config_fields(raw, errors)
    for message in errors:
        _logger.warning("Config: %s", message)
    return config


def _yaml_number(value: float) -> int | float:
    """Write whole numbers as ints so the YAML stays clean (3 instead of 3.0)."""
    numeric = float(value)
    return int(numeric) if numeric.is_integer() else numeric


def _yaml_path(path: Path) -> str:
    """Keep paths inside the project relative, as they were authored."""
    try:
        return path.relative_to(APP_ROOT).as_posix()
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
    }
    with config_path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(data, handle, sort_keys=False, allow_unicode=True)


def ensure_user_config() -> None:
    """Seed a user-editable config next to the app on first run and create log dirs."""
    if not DEFAULT_CONFIG_PATH.exists():
        bundled_template = BUNDLE_ROOT / "config.yaml"
        if bundled_template.exists() and bundled_template != DEFAULT_CONFIG_PATH:
            shutil.copyfile(bundled_template, DEFAULT_CONFIG_PATH)

    config = load_config()
    config.log_file.parent.mkdir(parents=True, exist_ok=True)
    config.archive_dir.mkdir(parents=True, exist_ok=True)
