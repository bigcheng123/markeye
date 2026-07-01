"""S2 — 只读 REST API 通路检查。"""

from __future__ import annotations

import httpx

from . import CheckResult, SmokeContext


def run(ctx: SmokeContext) -> CheckResult:
    base = ctx.base_url.rstrip("/")
    checked = 0

    try:
        with httpx.Client(base_url=base, timeout=ctx.timeout) as client:
            device = client.get("/api/device")
            if device.status_code != 200:
                return False, f"/api/device → {device.status_code}"
            if device.json().get("model") != "MarkEye":
                return False, "device.model != MarkEye"
            checked += 1

            config = client.get("/api/config")
            if config.status_code != 200:
                return False, f"/api/config → {config.status_code}"
            cfg = config.json()
            for key in ("input", "tools"):
                if key not in cfg:
                    return False, f"/api/config 缺少 {key!r}"
            checked += 1

            profiles = client.get("/api/config/list")
            if profiles.status_code != 200:
                return False, f"/api/config/list → {profiles.status_code}"
            items = profiles.json().get("profiles") or []
            if not isinstance(items, list) or len(items) == 0:
                return False, "/api/config/list profiles 为空"
            checked += 1

            cam_opts = client.get("/api/camera/options")
            if cam_opts.status_code != 200:
                return False, f"/api/camera/options → {cam_opts.status_code}"
            cam_body = cam_opts.json()
            if "camera_id" not in cam_body or "cameras" not in cam_body:
                return False, "/api/camera/options 缺少 camera_id/cameras"
            checked += 1

            master = client.get("/api/calibration/master/status")
            if master.status_code != 200:
                return False, f"/api/calibration/master/status → {master.status_code}"
            slots = master.json().get("slots") or {}
            if not isinstance(slots, dict):
                return False, "master/status slots 非 dict"
            for slot, registered in slots.items():
                if not isinstance(registered, bool):
                    return False, f"slot {slot!r} 值非 bool: {registered!r}"
            checked += 1

            for step in range(1, 5):
                wiz = client.get(f"/api/wizard/step/{step}")
                if wiz.status_code != 200:
                    return False, f"/api/wizard/step/{step} → {wiz.status_code}"
                checked += 1

    except httpx.ConnectError:
        return False, f"连接拒绝: {base}"
    except httpx.TimeoutException:
        return False, f"请求超时 ({ctx.timeout}s)"
    except Exception as exc:
        return False, str(exc)

    return True, f"{checked} 个只读端点通过"
