"""Desktop launcher: serves the dashboard locally and embeds it in a native window."""

import os
import sys
import threading
import time
import urllib.error
import urllib.request

import webview

from src.config import ensure_user_config

SERVER_STARTUP_TIMEOUT_SECONDS = 15.0


def _show_error(message: str) -> None:
    if sys.stderr is not None:
        print(message, file=sys.stderr)
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "Network Monitor", 0x10)


def _wait_until_ready(url: str, server_thread: threading.Thread) -> bool:
    deadline = time.monotonic() + SERVER_STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if not server_thread.is_alive():
            return False
        try:
            with urllib.request.urlopen(url, timeout=1):
                return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.2)
    return False


def main() -> None:
    # A windowed (console-less) exe has no stdout/stderr; give the logging
    # machinery a sink so uvicorn's log writes cannot fail.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

    ensure_user_config()

    # Imported after ensure_user_config() so the server reads the seeded config.
    from src import server

    host = server.config.server_host
    port = server.config.server_port
    url_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    url = f"http://{url_host}:{port}/"

    uv_server = server.create_server(host, port)
    server_thread = threading.Thread(target=uv_server.run, name="UvicornServer")
    server_thread.start()

    if not _wait_until_ready(url, server_thread):
        uv_server.should_exit = True
        server_thread.join(timeout=5)
        _show_error(
            f"Network Monitor could not start its local server on {url}\n\n"
            f"Port {port} may already be in use - is another instance running?"
        )
        raise SystemExit(1)

    webview.create_window(
        "Network Monitor",
        url,
        width=1280,
        height=860,
        min_size=(1024, 700),
    )
    webview.start()

    # Window closed: stop the server, whose lifespan shutdown stops the monitor.
    uv_server.should_exit = True
    server_thread.join(timeout=5)


if __name__ == "__main__":
    main()
