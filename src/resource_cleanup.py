"""硬件资源统一清理 — atexit / signal 兜底。"""

from __future__ import annotations

import atexit
import logging
import signal
import sys
import threading
from typing import Any

logger = logging.getLogger("markeye.cleanup")

_lock = threading.Lock()
_cleanup_done = False
_registered = False
_refs: dict[str, Any] = {}


def cleanup_hardware(camera=None, io=None, *, reason: str = "unknown") -> None:
    """同步、幂等释放相机与 Modbus 连接。"""
    global _cleanup_done
    with _lock:
        if _cleanup_done:
            return
        _cleanup_done = True

    cam = camera if camera is not None else _refs.get("camera")
    io_svc = io if io is not None else _refs.get("io")
    try:
        logger.info("硬件资源清理 (%s)", reason)
    except (ValueError, OSError):
        pass

    if cam is not None:
        try:
            cam.disconnect()
        except Exception as exc:
            logger.warning("相机断开异常: %s", exc)

    if io_svc is not None:
        try:
            io_svc.disconnect()
        except Exception as exc:
            logger.warning("Modbus 断开异常: %s", exc)

    try:
        from .process_lock import release_process_lock

        release_process_lock()
    except Exception as exc:
        logger.debug("释放进程锁异常: %s", exc)


def reset_cleanup_state() -> None:
    """测试用：重置清理状态。"""
    global _cleanup_done, _registered
    with _lock:
        _cleanup_done = False
        _registered = False


def register_hardware_cleanup(camera, io, *, label: str = "web") -> None:
    """注册 atexit 与信号处理器（幂等）。"""
    global _registered
    with _lock:
        _refs["camera"] = camera
        _refs["io"] = io
        if _registered:
            return
        _registered = True

    atexit.register(lambda: cleanup_hardware(reason=f"atexit:{label}"))

    def _handler(signum, _frame):
        cleanup_hardware(reason=f"signal:{signum}")
        raise SystemExit(0)

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _handler)
        except (ValueError, OSError):
            pass
