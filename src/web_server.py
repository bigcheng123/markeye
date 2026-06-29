"""MarkEye Web 服务 — 静态 UI + WebSocket 推帧 + REST API。"""

from __future__ import annotations

import asyncio
import logging
import socket
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .calibration import CalibrationService
from .camera_service import CameraService
from .config_store import ConfigStore
from .frame_codec import build_idle_frame, build_result_frame, maybe_save_result
from .io.modbus_client import ModbusIOService
from .pipeline import DetectionPipeline
from .stats_store import StatsStore
from .utils import setup_logger

logger = setup_logger()
ROOT = Path(__file__).resolve().parent.parent


class AppState:
    """共享运行时状态。"""

    def __init__(self):
        self.config_store = ConfigStore(str(ROOT / "config"))
        cfg = self.config_store.load()
        stats_path = cfg.get("output", {}).get("stats_file", "output/stats.json")
        self.stats = StatsStore(str(ROOT / stats_path))
        self.calibration = CalibrationService(self.config_store, str(ROOT / "output/masters"))
        self.camera = CameraService(cfg)
        self.io = ModbusIOService(cfg)
        self.pipeline = DetectionPipeline(cfg)
        self.ws_clients: set[WebSocket] = set()
        self._preview_task: Optional[asyncio.Task] = None
        self._last_frame_payload: dict = self.build_idle_payload()

    def build_idle_payload(self, frame: Optional[np.ndarray] = None) -> dict:
        cfg = self.config_store.get_cached()
        preview = frame if frame is not None else self.camera.capture_frame()
        marks = self.pipeline.locate(preview) if preview is not None else []
        return build_idle_frame(cfg, self.stats.snapshot(), preview, marks)

    def reload_services(self) -> None:
        cfg = self.config_store.get_cached()
        self.camera.config = cfg
        self.pipeline = DetectionPipeline(cfg)
        self.io = ModbusIOService(cfg)

    async def broadcast(self, payload: dict) -> None:
        self._last_frame_payload = payload
        dead = []
        for ws in self.ws_clients:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.ws_clients.discard(ws)

    def run_detection(self, image: np.ndarray) -> dict:
        cfg = self.config_store.get_cached()
        if image is None:
            self.stats.record_trerr()
            self.io.write_result(False, trerr=True)
            payload = build_idle_frame(cfg, self.stats.snapshot())
            payload["error"] = "capture_failed"
            return payload

        result = self.pipeline.run(image)
        display = result.result_image if result.result_image is not None else image
        self.stats.record_success(result.passed, result.process_ms)
        self.io.write_result(result.passed)
        maybe_save_result(cfg, result.passed, display)
        return build_result_frame(cfg, self.stats.snapshot(), result, display)


state = AppState()


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = state.config_store.get_cached()
    state.camera.connect()
    state._last_frame_payload = state.build_idle_payload()
    if state.io.enabled:
        state.io.connect()
    state._preview_task = asyncio.create_task(_preview_loop())
    logger.info("MarkEye Web 服务已启动")
    yield
    if state._preview_task:
        state._preview_task.cancel()
    state.camera.disconnect()
    state.io.disconnect()


app = FastAPI(title="MarkEye", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

template_dir = ROOT / "template"
icon_dir = ROOT / "icon"
if icon_dir.exists():
    app.mount("/icon", StaticFiles(directory=str(icon_dir)), name="icon")
if template_dir.exists():
    app.mount(
        "/template",
        StaticFiles(directory=str(template_dir), html=True),
        name="template",
    )


@app.get("/")
async def root():
    index = template_dir / "index.html"
    if index.exists():
        return RedirectResponse(url="/template/index.html", status_code=302)
    return {"service": "MarkEye", "health": "/api/health"}


async def _preview_loop():
    """运行模式：推送带定位框的实时预览（idle 帧，约 10fps）。"""
    while True:
        await asyncio.sleep(0.1)
        if not state.ws_clients:
            continue
        frame = state.camera.capture_frame()
        if frame is None:
            continue
        payload = state.build_idle_payload(frame)
        await state.broadcast(payload)


@app.get("/api/health")
async def health():
    inp = state.config_store.get_cached().get("input", {})
    return {
        "status": "ok",
        "camera": state.camera.connected,
        "camera_id": inp.get("camera_id", 0),
        "using_fallback": state.camera.using_fallback,
    }


@app.get("/api/device")
async def device():
    hostname = socket.gethostname()
    return {
        "model": "MarkEye",
        "name": hostname,
        "ip": "127.0.0.1",
        "mac": "00:00:00:00:00:00",
    }


@app.get("/api/config")
async def get_config():
    return state.config_store.get_cached()


class ConfigBody(BaseModel):
    config: dict


@app.put("/api/config")
async def put_config(body: ConfigBody):
    state.config_store.save(body.config)
    state.reload_services()
    return {"ok": True}


@app.get("/api/config/list")
async def list_config():
    return {"profiles": state.config_store.list_profiles()}


@app.get("/api/wizard/step/{step}")
async def get_wizard_step(step: int):
    try:
        return state.config_store.get_wizard_step(step)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.put("/api/wizard/step/{step}")
async def put_wizard_step(step: int, body: dict):
    try:
        cfg = state.config_store.save_wizard_step(step, body)
        state.reload_services()
        return {"ok": True, "config": cfg}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/trigger")
async def trigger():
    frame = state.camera.capture_frame()
    payload = state.run_detection(frame)
    await state.broadcast(payload)
    return payload


@app.post("/api/stats/reset")
async def reset_stats():
    state.stats.reset()
    cfg = state.config_store.get_cached()
    payload = build_idle_frame(cfg, state.stats.snapshot())
    await state.broadcast(payload)
    return {"ok": True, "stats": state.stats.snapshot()}


@app.post("/api/calibration/add")
async def calibration_add():
    count = state.calibration.add_sample()
    cfg = state.config_store.get_cached()
    payload = build_idle_frame(cfg, state.stats.snapshot())
    await state.broadcast(payload)
    return {"ok": True, "sample_count": count}


@app.post("/api/calibration/master")
async def calibration_master():
    frame = state.camera.capture_frame()
    if frame is None:
        raise HTTPException(400, "无法获取图像以注册主控")
    cal = state.calibration.register_master(frame)
    state.reload_services()
    return {"ok": True, "calibration": cal}


@app.post("/api/camera/switch")
async def camera_switch():
    ok = state.camera.switch()
    state.config_store.save(state.config_store.get_cached())
    return {"ok": ok, "camera_id": state.config_store.get_cached().get("input", {}).get("camera_id")}


@app.websocket("/ws/frame")
async def ws_frame(ws: WebSocket):
    await ws.accept()
    state.ws_clients.add(ws)
    try:
        state._last_frame_payload = state.build_idle_payload()
        await ws.send_json(state._last_frame_payload)
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        state.ws_clients.discard(ws)


def main():
    import uvicorn

    uvicorn.run(
        "src.web_server:app",
        host="0.0.0.0",
        port=8080,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
