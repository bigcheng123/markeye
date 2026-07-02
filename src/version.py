"""应用版本信息（用于 Web UI 显示）。"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional

# 手动维护；每次发布递进 0.1（如 1.0 → 1.1 → 1.2）
APP_VERSION = "1.2"


def _run_git(args: list[str], *, cwd: Path) -> Optional[str]:
    try:
        out = subprocess.check_output(["git", *args], cwd=str(cwd), stderr=subprocess.DEVNULL)
        return out.decode("utf-8", errors="replace").strip()
    except Exception:
        return None


def get_app_version(repo_root: Path | None = None, **_kwargs) -> str:
    """返回当前应用版本号（界面右下角显示）。"""
    del repo_root, _kwargs
    return APP_VERSION


def get_app_meta(repo_root: Path, **_kwargs) -> dict:
    """给前端使用的元信息集合。"""

    version = get_app_version(repo_root)
    commit = _run_git(["rev-parse", "--short", "HEAD"], cwd=repo_root) or ""
    branch = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_root) or ""
    dirty = _run_git(["status", "--porcelain"], cwd=repo_root)
    return {
        "version": version,
        "git": {
            "branch": branch,
            "commit": commit,
            "dirty": bool(dirty),
        },
    }

