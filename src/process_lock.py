"""单实例进程锁 — 防止双开抢占 COM/相机。"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
from pathlib import Path

logger = logging.getLogger("markeye.process_lock")

LOCK_PATH = Path(tempfile.gettempdir()) / "markeye.lock"


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def acquire_process_lock() -> None:
    """获取进程锁；已有存活实例则退出。"""
    if LOCK_PATH.exists():
        try:
            old_pid = int(LOCK_PATH.read_text(encoding="utf-8").strip())
            if _pid_alive(old_pid):
                logger.error(
                    "已有 MarkEye 实例运行 (PID %s)，请先 stop_app 停止后再启动",
                    old_pid,
                )
                sys.exit(1)
        except (ValueError, OSError):
            pass
        try:
            LOCK_PATH.unlink()
        except OSError:
            pass
    LOCK_PATH.write_text(str(os.getpid()), encoding="utf-8")
    logger.debug("进程锁已创建: %s (PID %s)", LOCK_PATH, os.getpid())


def release_process_lock() -> None:
    """释放当前进程持有的锁文件。"""
    try:
        if not LOCK_PATH.exists():
            return
        owner = LOCK_PATH.read_text(encoding="utf-8").strip()
        if owner == str(os.getpid()):
            LOCK_PATH.unlink()
            logger.debug("进程锁已释放: %s", LOCK_PATH)
    except OSError as exc:
        logger.debug("释放进程锁失败: %s", exc)
