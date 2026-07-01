"""S3 — WebSocket /ws/frame 收首帧检查。"""

from __future__ import annotations

import asyncio
import json

from . import CheckResult, SmokeContext


async def _recv_first_frame(ws_url: str, timeout: float) -> dict:
    import websockets

    async with websockets.connect(ws_url, open_timeout=timeout) as ws:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        return json.loads(raw)


def run(ctx: SmokeContext) -> CheckResult:
    try:
        payload = asyncio.run(_recv_first_frame(ctx.ws_url, ctx.ws_timeout))
    except ImportError as exc:
        return False, f"缺少 websockets: {exc}"
    except asyncio.TimeoutError:
        return False, f"{ctx.ws_timeout}s 内未收到帧（检查 WS 代理或服务预览循环）"
    except ConnectionRefusedError:
        return False, f"WebSocket 连接拒绝: {ctx.ws_url}"
    except Exception as exc:
        return False, str(exc)

    if "type" not in payload:
        return False, f"帧缺少 type 字段: keys={list(payload.keys())}"
    if "image" not in payload and "stats" not in payload:
        return False, "帧缺少 image/stats"
    return True, f"type={payload.get('type')!r}"
