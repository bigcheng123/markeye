#!/usr/bin/env python3
"""MarkEye 产线冒烟测试主编排器。

用法:
    python smoke/run_smoke.py
    python smoke/run_smoke.py --base-url http://127.0.0.1:8080
    python smoke/run_smoke.py --with-trigger
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# 允许从仓库根或 smoke/ 目录直接运行
_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from checks import SmokeContext
from checks import api_readonly
from checks import api_trigger
from checks import env_check
from checks import service_alive
from checks import websocket_frame


def _parse_args() -> argparse.Namespace:
    default_url = os.environ.get("MARKEYE_BASE_URL", "http://127.0.0.1:8080")
    parser = argparse.ArgumentParser(description="MarkEye 产线冒烟测试")
    parser.add_argument(
        "--base-url",
        default=default_url,
        help=f"服务地址（默认: {default_url}，或环境变量 MARKEYE_BASE_URL）",
    )
    parser.add_argument("--timeout", type=float, default=10.0, help="HTTP 超时秒数")
    parser.add_argument("--ws-timeout", type=float, default=20.0, help="WebSocket 等待首帧秒数")
    parser.add_argument(
        "--with-trigger",
        action="store_true",
        help="执行 S4 触发检测（履历 +1，维护窗口使用）",
    )
    parser.add_argument("-q", "--quiet", action="store_true", help="仅输出失败项")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    ctx = SmokeContext(
        base_url=args.base_url.rstrip("/"),
        timeout=args.timeout,
        ws_timeout=args.ws_timeout,
        quiet=args.quiet,
    )

    checks: list[tuple[str, object]] = [
        ("S0 环境", env_check),
        ("S1 存活", service_alive),
        ("S2 只读API", api_readonly),
        ("S3 WebSocket", websocket_frame),
    ]
    if args.with_trigger:
        checks.append(("S4 触发", api_trigger))

    if not args.quiet:
        print(f"MarkEye 冒烟测试 → {ctx.base_url}")
        print("-" * 48)

    results: list[tuple[str, bool, str]] = []
    failed = 0

    for name, module in checks:
        ok, detail = module.run(ctx)
        results.append((name, ok, detail))
        if ok:
            if not args.quiet:
                print(f"[PASS] {name}: {detail}")
        else:
            failed += 1
            print(f"[FAIL] {name}: {detail}")

    if not args.quiet:
        print("-" * 48)
        passed = len(results) - failed
        print(f"结果: {passed}/{len(results)} 通过")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
