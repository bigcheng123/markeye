"""S4 — POST /api/trigger 触发检测（可选，会 +1 履历）。"""

from __future__ import annotations

import httpx

from . import CheckResult, SmokeContext


def run(ctx: SmokeContext) -> CheckResult:
    base = ctx.base_url.rstrip("/")

    try:
        with httpx.Client(base_url=base, timeout=ctx.timeout) as client:
            res = client.post("/api/trigger")
            if res.status_code != 200:
                return False, f"/api/trigger → {res.status_code}: {res.text[:200]}"
            data = res.json()
    except httpx.ConnectError:
        return False, f"连接拒绝: {base}"
    except httpx.TimeoutException:
        return False, f"请求超时 ({ctx.timeout}s)"
    except Exception as exc:
        return False, str(exc)

    if data.get("type") != "frame":
        return False, f"type={data.get('type')!r}"
    overall = data.get("overall") or {}
    if not isinstance(overall.get("passed"), bool):
        return False, "overall.passed 非 bool"
    stats = data.get("stats") or {}
    for key in ("trigger_total", "ok_count", "ng_count"):
        if key not in stats:
            return False, f"stats 缺少 {key!r}"
    passed = overall["passed"]
    return True, f"passed={passed}, trigger_total={stats.get('trigger_total')}"
