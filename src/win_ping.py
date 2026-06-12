"""ICMP ping via the Windows IcmpSendEcho API (no subprocess per ping)."""

from __future__ import annotations

import socket
import struct
import threading
from ctypes import Structure, WinDLL, c_uint8, c_void_p, create_string_buffer, sizeof, wintypes

IP_SUCCESS = 0
INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value


class IP_OPTION_INFORMATION(Structure):
    _fields_ = [
        ("Ttl", c_uint8),
        ("Tos", c_uint8),
        ("Flags", c_uint8),
        ("OptionsSize", c_uint8),
        ("OptionsData", c_void_p),
    ]


class ICMP_ECHO_REPLY(Structure):
    _fields_ = [
        ("Address", wintypes.DWORD),
        ("Status", wintypes.DWORD),
        ("RoundTripTime", wintypes.DWORD),
        ("DataSize", wintypes.WORD),
        ("Reserved", wintypes.WORD),
        ("Data", c_void_p),
        ("Options", IP_OPTION_INFORMATION),
    ]


_REPLY_OVERHEAD = sizeof(ICMP_ECHO_REPLY) + 8


class WinPing:
    """Reusable IcmpSendEcho handle."""

    def __init__(self) -> None:
        self._icmp = WinDLL("iphlpapi", use_last_error=True)
        self._icmp.IcmpCreateFile.restype = wintypes.HANDLE
        self._icmp.IcmpCloseHandle.argtypes = [wintypes.HANDLE]
        self._icmp.IcmpCloseHandle.restype = wintypes.BOOL
        self._icmp.IcmpSendEcho.argtypes = [
            wintypes.HANDLE,
            wintypes.DWORD,
            c_void_p,
            wintypes.WORD,
            c_void_p,
            c_void_p,
            wintypes.DWORD,
            wintypes.DWORD,
        ]
        self._icmp.IcmpSendEcho.restype = wintypes.DWORD

        self._handle = self._icmp.IcmpCreateFile()
        if self._handle == INVALID_HANDLE_VALUE:
            raise OSError("IcmpCreateFile failed")
        self._lock = threading.Lock()
        self._payload = b"NetworkMonitor"
        # Buffers are reused across pings; _lock already serializes access.
        self._send_buffer = create_string_buffer(self._payload, len(self._payload))
        self._reply_size = _REPLY_OVERHEAD + len(self._payload)
        self._reply_buffer = create_string_buffer(self._reply_size)

    def close(self) -> None:
        with self._lock:
            if self._handle is not None and self._handle != INVALID_HANDLE_VALUE:
                self._icmp.IcmpCloseHandle(self._handle)
            self._handle = None

    def ping(self, ip_addr: int, timeout_ms: int = 1000) -> tuple[bool, float | None]:
        with self._lock:
            if self._handle is None or self._handle == INVALID_HANDLE_VALUE:
                return False, None
            sent = self._icmp.IcmpSendEcho(
                self._handle,
                wintypes.DWORD(ip_addr),
                self._send_buffer,
                wintypes.WORD(len(self._payload)),
                None,
                self._reply_buffer,
                wintypes.DWORD(self._reply_size),
                wintypes.DWORD(timeout_ms),
            )
            if sent == 0:
                return False, None

            # Status (offset 4) and RoundTripTime (offset 8) of ICMP_ECHO_REPLY;
            # read inside the lock because the reply buffer is shared.
            status, rtt = struct.unpack_from("II", self._reply_buffer, 4)

        if status != IP_SUCCESS:
            return False, None
        return True, 0.5 if rtt == 0 else float(rtt)


_instance: WinPing | None = None
_instance_lock = threading.Lock()


def resolve_target(target: str) -> int | None:
    try:
        addr = socket.gethostbyname(target)
    except OSError:
        return None
    return struct.unpack("!I", socket.inet_aton(addr))[0]


def run_win_ping(ip_addr: int, timeout_ms: int = 1000) -> tuple[bool, float | None]:
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = WinPing()
        return _instance.ping(ip_addr, timeout_ms)
