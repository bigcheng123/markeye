"""应用版本信息（用于 Web UI 显示）。"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional


def _run_git(args: list[str], *, cwd: Path) -> Optional[str]:
    try:
        out = subprocess.check_output(["git", *args], cwd=str(cwd), stderr=subprocess.DEVNULL)
        return out.decode("utf-8", errors="replace").strip()
    except Exception:
        return None


def get_app_version(repo_root: Path, *, base: float = 0.0, step: float = 0.1) -> str:
    """返回形如 '12.3' 的版本号。

    规则：版本号 = base + step * (git 提交数量)。
    - 这样每次 push 新提交时版本都会递进（单位 0.1）。
    - 若不在 git 仓库/不可用，则回退为 base。
    """

    if step <= 0:
        step = 0.1

    count_s = _run_git(["rev-list", "--count", "HEAD"], cwd=repo_root)
    try:
        count = int(count_s) if count_s is not None else 0
    except ValueError:
        count = 0

    v = base + step * float(count)
    # 固定 1 位小数（与 0.1 递进一致）
    return f"{v:.1f}"


def get_app_meta(repo_root: Path, *, base: float = 0.0, step: float = 0.1) -> dict:
    """给前端使用的元信息集合。"""

    version = get_app_version(repo_root, base=base, step=step)
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

