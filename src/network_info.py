import json
import subprocess
import threading
import time
from typing import TypedDict


class ActiveConnection(TypedDict):
    type: str | None
    name: str | None


_DETECT_SCRIPT = r"""
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric |
    Select-Object -First 1
if (-not $route) {
    @{ type = $null; name = $null } | ConvertTo-Json -Compress
    exit
}

$ifIndex = $route.ifIndex
$adapter = Get-NetAdapter -InterfaceIndex $ifIndex -ErrorAction SilentlyContinue
if (-not $adapter) {
    @{ type = $null; name = $null } | ConvertTo-Json -Compress
    exit
}

$isWifi = ($adapter.MediaType -eq 'Native 802.11') -or
    ($adapter.PhysicalMediaType -eq 'Native 802.11') -or
    ($adapter.InterfaceDescription -match 'Wi-Fi|Wireless')
$type = if ($isWifi) { 'WiFi' } else { 'Ethernet' }

$name = $null
if ($isWifi) {
    $wlan = netsh wlan show interfaces 2>$null |
        Select-String '^\s*SSID\s*:\s*(.+)$' |
        ForEach-Object { $_.Matches.Groups[1].Value.Trim() } |
        Where-Object { $_ } |
        Select-Object -First 1
    if ($wlan) { $name = $wlan }
}

if (-not $name) {
    $profile = Get-NetConnectionProfile -InterfaceIndex $ifIndex -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($profile) { $name = $profile.Name }
}

if (-not $name) { $name = $adapter.Name }

@{ type = $type; name = $name } | ConvertTo-Json -Compress
"""

_CACHE_TTL_SECONDS = 30.0
_cache_lock = threading.Lock()
_cached_result: ActiveConnection | None = None
_cached_at: float = 0.0


def _fetch_active_connection() -> ActiveConnection:
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", _DETECT_SCRIPT],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
        if result.returncode != 0:
            return {"type": None, "name": None}

        payload = json.loads(result.stdout.strip() or "{}")
        connection_type = payload.get("type")
        name = payload.get("name")
        if connection_type not in ("WiFi", "Ethernet"):
            connection_type = None
        if not isinstance(name, str) or not name.strip():
            name = None
        else:
            name = name.strip()

        return {"type": connection_type, "name": name}
    except (json.JSONDecodeError, subprocess.TimeoutExpired, OSError):
        return {"type": None, "name": None}


def get_active_connection() -> ActiveConnection:
    global _cached_result, _cached_at

    now = time.monotonic()
    with _cache_lock:
        if _cached_result is not None and (now - _cached_at) < _CACHE_TTL_SECONDS:
            return _cached_result

    result = _fetch_active_connection()
    with _cache_lock:
        _cached_result = result
        _cached_at = now
    return result
