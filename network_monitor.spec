# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec: one-folder windowed build of the desktop app.

Build with:  python -m PyInstaller network_monitor.spec --noconfirm
Output:      dist/NetworkMonitor/NetworkMonitor.exe
"""

from pathlib import Path

ROOT = Path(SPECPATH)  # noqa: F821 - SPECPATH is injected by PyInstaller

a = Analysis(
    [str(ROOT / "src" / "desktop.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        # Read-only assets, served from sys._MEIPASS at runtime.
        (str(ROOT / "static"), "static"),
        # Template copied next to the exe on first run (ensure_user_config).
        (str(ROOT / "config.yaml"), "."),
    ],
    hiddenimports=[
        "src.sample_store",
        "src.metrics_logger",
        "src.metrics_analytics",
        "src.metrics_verdict",
        "src.metrics_narrative",
        "src.metrics_time",
        "src.jitter",
        "src.win_proc",
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        # pywebview's Windows backend (WebView2 via winforms) is loaded lazily.
        "webview.platforms.winforms",
        "webview.platforms.edgechromium",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="NetworkMonitor",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="NetworkMonitor",
)
