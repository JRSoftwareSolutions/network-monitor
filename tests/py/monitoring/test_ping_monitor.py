import pytest
from unittest.mock import patch

from src.monitoring.ping_monitor import PingBackend, is_ipv6_target, parse_ping_output


@pytest.mark.parametrize(
    ("output", "returncode", "expected"),
    [
        ("Reply from 1.1.1.1: bytes=32 time=14ms TTL=57", 0, (True, 14.0)),
        ("Reply from 1.1.1.1: bytes=32 time<1ms TTL=57", 0, (True, 0.5)),
        ("Antwoord van 1.1.1.1: bytes=32 tijd=14 ms TTL=57", 0, (True, 14.0)),
        ("Réponse de 1.1.1.1 : octets=32 temps=14,5 ms TTL=57", 0, (True, 14.5)),
        ("Request timed out.", 1, (False, None)),
        ("Reply from 1.1.1.1: bytes=32 time=14ms TTL=57", 2, (False, None)),
    ],
)
def test_parse_ping_output(output, returncode, expected):
    assert parse_ping_output(output, returncode) == expected


def test_is_ipv6_target():
    assert is_ipv6_target("2001:4860:4860::8888")
    assert not is_ipv6_target("1.1.1.1")


def test_ping_backend_ipv6_uses_subprocess():
    backend = PingBackend("2001:4860:4860::8888")
    with patch("src.monitoring.ping_monitor.run_ping_subprocess", return_value=(True, 14.0)) as mock_ping:
        assert backend.ping() == (True, 14.0)
        mock_ping.assert_called_once_with("2001:4860:4860::8888", backend.timeout_ms)
