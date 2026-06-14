import pytest

from src.ping_monitor import parse_ping_output


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
