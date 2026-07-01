"""S1 — HTTP 存活与静态页检查。"""

from __future__ import annotations

import httpx

from . import CheckResult, SmokeContext


def run(ctx: SmokeContext) -> CheckResult:
    base = ctx.base_url.rstrip("/")
    notes: list[str] = []

    try:
        with httpx.Client(base_url=base, timeout=ctx.timeout, follow_redirects=False) as client:
            health = client.get("/api/health")
            if health.status_code != 200:
                return False, f"/api/health → {health.status_code}"
            body = health.json()
            if body.get("status") != "ok":
                return False, f"status={body.get('status')!r}"

            if body.get("using_fallback"):
                notes.append("using_fallback=true")
            camera = body.get("camera")
            if camera is not None:
                notes.append(f"camera={camera}")
            app = body.get("app") or {}
            version = app.get("version")
            if version:
                notes.append(f"version={version}")

            root = client.get("/")
            if root.status_code not in (200, 302, 307, 308):
                return False, f"/ → {root.status_code}"

            page = client.get("/template/index.html")
            if page.status_code != 200:
                return False, f"/template/index.html → {page.status_code}"
            ctype = page.headers.get("content-type", "")
            if "html" not in ctype.lower():
                return False, f"Content-Type 不含 html: {ctype!r}"

    except httpx.ConnectError:
        return False, f"连接拒绝: {base}（服务是否已启动？）"
    except httpx.TimeoutException:
        return False, f"请求超时 ({ctx.timeout}s)"
    except Exception as exc:
        return False, str(exc)

    detail = "health OK, 静态页 OK"
    if notes:
        detail += f" ({', '.join(notes)})"
    return True, detail
