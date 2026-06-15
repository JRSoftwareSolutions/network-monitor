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
        # App + shims (lazy imports)
        "src.server",
        "src.app.server",
        "src.app.desktop",
        # API
        "src.api.payloads",
        "src.api.cache",
        # Monitoring
        "src.monitoring.ping_monitor",
        "src.monitoring.logger",
        "src.monitoring.sample_store",
        "src.monitoring.jitter",
        "src.monitoring.win_ping",
        # Metrics
        "src.metrics",
        "src.metrics.analytics",
        "src.metrics.time",
        "src.metrics.windows",
        "src.metrics.constants",
        "src.metrics.samples",
        "src.metrics.narrative",
        "src.metrics.indicators",
        # Verdict
        "src.verdict",
        "src.verdict.gaming",
        "src.verdict.health",
        "src.verdict.stabilizer",
        # Platform + config
        "src.platform.network_info",
        "src.platform.win_proc",
        "src.config",
        # uvicorn + webview (keep existing entries unchanged)
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
