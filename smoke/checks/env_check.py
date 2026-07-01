"""S0 — 本机 Python 依赖检查（不连接服务）。"""

from __future__ import annotations

import sys

from . import CheckResult, SmokeContext


def run(ctx: SmokeContext) -> CheckResult:
    del ctx
    parts: list[str] = []

    if sys.version_info < (3, 10):
        return False, f"Python {sys.version.split()[0]} < 3.10"

    parts.append(f"Python {sys.version.split()[0]}")

    modules = {
        "cv2": "opencv",
        "numpy": "numpy",
        "yaml": "pyyaml",
        "httpx": "httpx",
        "fastapi": "fastapi",
        "websockets": "websockets (uvicorn 依赖)",
    }
    for mod, label in modules.items():
        try:
            imported = __import__(mod)
        except ImportError as exc:
            return False, f"无法 import {label}: {exc}"
        if mod == "cv2":
            parts.append(f"OpenCV {imported.__version__}")

    return True, "; ".join(parts)
