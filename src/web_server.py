"""MarkEye Web 服务 — 静态 UI + WebSocket 推帧 + REST API。"""

from __future__ import annotations

import asyncio
import logging
import socket
import time
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
from .camera_config import available_camera_ids, camera_id_to_cam_slot, slot_device_ids
from .camera_service import CameraService, enumerate_camera_devices
from .config_store import ConfigStore
from .display_images import (
    build_tool_binary_image,
    first_enabled_tool_cam,
    has_active_tools,
    pick_primary_preview,
    required_tool_cam_slots,
)
from .frame_codec import (
    build_idle_frame,
    build_no_tools_frame,
    build_result_frame,
    decode_image_b64,
    encode_image_b64,
    maybe_save_result,
    save_display_frame,
)
from .io.modbus_client import ModbusIOService
from .pipeline import DetectionPipeline
from .tools.roi_tools import compute_hsv_area_in_roi, crop_roi, hsv_hit_mask, run_roi_tools, sample_hsv_in_roi
from .stats_store import StatsStore
from .utils import json_safe, setup_logger
from .version import get_app_meta

logger = setup_logger()
ROOT = Path(__file__).resolve().parent.parent
PREVIEW_PAUSE_AFTER_TRIGGER_SEC = 0.6


class AppState:
    """共享运行时状态。"""

    def __init__(self):
        self.config_store = ConfigStore(str(ROOT / "config"))
        cfg = self.config_store.load()
        stats_path = cfg.get("output", {}).get("stats_file", "output/stats.json")
        self.stats = StatsStore(str(ROOT / stats_path))
        self.calibration = CalibrationService(self.config_store, str(ROOT))
        self.camera = CameraService(cfg)
        self.io = ModbusIOService(cfg)
        self.pipeline = DetectionPipeline(cfg)
        self.ws_clients: set[WebSocket] = set()
        self._preview_task: Optional[asyncio.Task] = None
        self._preview_paused_until: float = 0.0
        self._last_frame_payload: dict = self.build_idle_payload()

    def build_idle_payload(
        self, frame: Optional[np.ndarray] = None, *, fast_preview: bool = False, slot: Optional[int] = None
    ) -> dict:
        cfg = self.config_store.get_cached()
        if not has_active_tools(cfg):
            return build_no_tools_frame(cfg, self.stats.snapshot(), idle=True)
        if slot is None:
            slot = (
                first_enabled_tool_cam(cfg)
                if has_active_tools(cfg)
                else camera_id_to_cam_slot(cfg)
            )
        preview = frame if frame is not None else self.camera.get_live_frame(slot)
        images = preview
        if has_active_tools(cfg) and preview is not None:
            images = {slot: preview}
        if fast_preview:
            marks = []
            tool_results = []
        elif has_active_tools(cfg):
            marks = []
            tool_results = run_roi_tools(images, cfg) if preview is not None else []
        else:
            marks = self.pipeline.locate(preview) if preview is not None else []
            tool_results = run_roi_tools(images, cfg) if preview is not None else []
        return build_idle_frame(
            cfg, self.stats.snapshot(), preview, marks, tool_results, preview_cam=slot
        )

    def reload_services(self) -> None:
        cfg = self.config_store.get_cached()
        self.calibration.sync_master_dir()
        old_devices = slot_device_ids(self.camera.config)
        new_devices = slot_device_ids(cfg)
        self.camera.config = cfg
        self.pipeline = DetectionPipeline(cfg)
        self.io = ModbusIOService(cfg)
        if old_devices != new_devices:
            self.camera.connect_all(new_devices)

    def reconnect_cameras(self, cameras: Optional[list[int]] = None) -> dict[int, bool]:
        cfg = self.config_store.get_cached()
        if cameras is not None:
            inp = cfg.setdefault("input", {})
            full = sorted({int(c) for c in cameras})
            if not full:
                full = [0]
            inp["cameras"] = full
            cam_id = int(inp.get("camera_id", full[0]))
            if cam_id not in full:
                cam_id = full[0]
            inp["camera_id"] = cam_id
            self.config_store.save(cfg)
        self.camera.config = cfg
        self.pipeline = DetectionPipeline(cfg)
        self.io = ModbusIOService(cfg)
        return self.camera.connect_all(slot_device_ids(cfg))

    def select_camera(self, camera_id: int) -> bool:
        """切换预览用设备号：更新 camera_id 并将 slot0 接到该设备。"""
        cfg = self.config_store.get_cached()
        inp = cfg.setdefault("input", {})
        cam_id = int(camera_id)
        full = available_camera_ids(cfg)
        if cam_id not in full:
            full = sorted(set(full + [cam_id]))
        inp["cameras"] = full
        inp["camera_id"] = cam_id
        self.config_store.save(cfg)
        devices = slot_device_ids(cfg)
        devices[0] = cam_id
        self.camera.config = cfg
        results = self.camera.connect_all(devices)
        return results.get(0, False)

    async def broadcast(self, payload: dict) -> None:
        safe = json_safe(payload)
        self._last_frame_payload = safe
        dead = []
        for ws in self.ws_clients:
            try:
                await ws.send_json(safe)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.ws_clients.discard(ws)

    def run_detection(self, images: np.ndarray | dict[int, np.ndarray]) -> dict:
        cfg = self.config_store.get_cached()
        if not has_active_tools(cfg):
            return build_no_tools_frame(cfg, self.stats.snapshot(), idle=True)
        primary, preview_cam = pick_primary_preview(images, cfg)
        if primary is None:
            self.stats.record_trerr()
            self.io.write_result(False, trerr=True)
            payload = build_idle_frame(cfg, self.stats.snapshot())
            payload["error"] = "capture_failed"
            return payload

        frames = images if isinstance(images, dict) else {0: images}
        result = self.pipeline.run(frames)
        self.stats.record_success(result.passed, result.process_ms)
        self.io.write_result(result.passed)
        save_img = result.result_image if result.result_image is not None else primary
        maybe_save_result(cfg, result.passed, save_img)
        return build_result_frame(
            cfg, self.stats.snapshot(), result, primary, preview_cam=preview_cam
        )


state = AppState()


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = state.config_store.get_cached()
    state.camera.connect()
    state._last_frame_payload = json_safe(
        await asyncio.to_thread(state.build_idle_payload)
    )
    if state.io.enabled:
        state.io.connect()
    state._preview_task = asyncio.create_task(_preview_loop())
    logger.info("MarkEye Web 服务已启动")
    yield
    if state._preview_task:
        state._preview_task.cancel()
    state.stats.flush()
    state.camera.disconnect()
    state.io.disconnect()


app = FastAPI(title="MarkEye", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def disable_static_cache(request, call_next):
    """开发阶段禁止浏览器缓存 UI 静态资源，避免 Chrome 与 Cursor 看到不同版本。"""
    response = await call_next(request)
    path = request.url.path
    if (
        path.startswith("/template/js/")
        or path.startswith("/template/css/")
        or path.endswith(".html")
        or path.endswith("/template/")
    ):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


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
        if time.monotonic() < state._preview_paused_until:
            continue
        cfg = state.config_store.get_cached()
        if not has_active_tools(cfg):
            payload = await asyncio.to_thread(state.build_idle_payload)
            await state.broadcast(payload)
            continue
        slot = camera_id_to_cam_slot(cfg)
        frame = await asyncio.to_thread(state.camera.get_live_frame, slot)
        if frame is None:
            continue
        payload = await asyncio.to_thread(state.build_idle_payload, frame, True, slot)
        await state.broadcast(payload)


@app.get("/api/health")
async def health():
    inp = state.config_store.get_cached().get("input", {})
    cameras = available_camera_ids(state.config_store.get_cached())
    cfg = state.config_store.get_cached()
    return {
        "status": "ok",
        "camera": state.camera.connected,
        "camera_id": inp.get("camera_id", cameras[0] if cameras else 0),
        "cameras": state.camera.slot_status(),
        "available_cameras": cameras,
        "using_fallback": state.camera.using_fallback,
        "app": get_app_meta(ROOT, base=float(cfg.get("app", {}).get("version_base", 0.0))),
    }


@app.get("/api/camera/options")
async def camera_options():
    """工具栏「相机号码」：可切换设备号与当前选中项。"""
    cfg = state.config_store.get_cached()
    inp = cfg.get("input", {})
    cameras = available_camera_ids(cfg)
    camera_id = int(inp.get("camera_id", cameras[0] if cameras else 0))
    if camera_id not in cameras and cameras:
        camera_id = cameras[0]
    return {
        "cameras": cameras,
        "camera_id": camera_id,
        "connected": state.camera.connected,
    }


@app.get("/api/cameras/enumerate")
async def cameras_enumerate(max_probe: int = 10):
    """枚举本机可打开的相机设备（OpenCV 设备索引）。"""
    limit = max(1, min(32, int(max_probe)))
    devices = await asyncio.to_thread(enumerate_camera_devices, max_probe=limit)
    return {"count": len(devices), "devices": devices}


@app.get("/api/device")
async def device():
    hostname = socket.gethostname()
    cfg = state.config_store.get_cached()
    return {
        "model": "MarkEye",
        "name": hostname,
        "ip": "127.0.0.1",
        "mac": "00:00:00:00:00:00",
        "app": get_app_meta(ROOT, base=float(cfg.get("app", {}).get("version_base", 0.0))),
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


class ProfileSwitchBody(BaseModel):
    name: str


@app.post("/api/config/switch")
async def switch_config(body: ProfileSwitchBody):
    try:
        cfg = state.config_store.switch(body.name)
        state.reload_services()
        return {"ok": True, "active": body.name, "config": cfg}
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


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
        if step == 1:
            await asyncio.to_thread(state.reconnect_cameras)
            payload = await asyncio.to_thread(state.build_idle_payload)
            await state.broadcast(payload)
        return {"ok": True, "config": cfg}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _master_slot(body: Optional[dict] = None, cam: Optional[int] = None) -> int:
    if cam is not None:
        return max(0, min(1, int(cam)))
    if body and body.get("cam") is not None:
        return max(0, min(1, int(body["cam"])))
    return 0


def _as_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in {"1", "true", "yes", "y", "on"}
    return False


def _get_tool_source_image(slot: int, *, prefer_live: bool = False) -> Optional[np.ndarray]:
    """取工具计算用图像。\n+\n+    - prefer_live=True: Live → Master（STEP3 期望使用实时画面）\n+    - prefer_live=False: Master → Live（兼容旧行为）\n+    """
    if prefer_live:
        img = state.camera.get_live_frame(slot)
        if img is None:
            img = state.calibration.load_master_image(slot)
        return img
    img = state.calibration.load_master_image(slot)
    if img is None:
        img = state.camera.get_live_frame(slot)
    return img


@app.post("/api/tools/hsv-area")
async def tools_hsv_area(body: dict):
    slot = _master_slot(body)
    prefer_live = _as_bool(body.get("prefer_live"))
    img = await asyncio.to_thread(_get_tool_source_image, slot, prefer_live=prefer_live)
    if img is None:
        raise HTTPException(400, f"CAM#{slot} 无可用画面（未注册主控且无 Live）")
    roi = body.get("roi") or {}
    params = body.get("params") or {}
    h_lower = params.get("h_lower") or body.get("h_lower") or [0, 0, 0]
    h_upper = params.get("h_upper") or body.get("h_upper") or [180, 255, 255]
    return compute_hsv_area_in_roi(img, roi, h_lower, h_upper)


@app.post("/api/tools/hsv-sample-roi")
async def tools_hsv_sample_roi(body: dict):
    slot = _master_slot(body)
    prefer_live = _as_bool(body.get("prefer_live"))
    img = await asyncio.to_thread(_get_tool_source_image, slot, prefer_live=prefer_live)
    if img is None:
        raise HTTPException(400, f"CAM#{slot} 无可用画面（未注册主控且无 Live）")
    roi = body.get("roi") or {}
    min_sat = int(body.get("min_saturation", 30))
    try:
        h, s, v = sample_hsv_in_roi(img, roi, min_saturation=min_sat)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"hsv": [h, s, v]}


@app.post("/api/tools/hsv-match-preview")
async def tools_hsv_match_preview(body: dict):
    """返回 ROI 内 HSV 命中像素预览图（仅匹配像素可见，其余为黑）。"""
    slot = _master_slot(body)
    prefer_live = _as_bool(body.get("prefer_live"))
    img = await asyncio.to_thread(_get_tool_source_image, slot, prefer_live=prefer_live)
    if img is None:
        raise HTTPException(400, f"CAM#{slot} 无可用画面（未注册主控且无 Live）")
    roi = body.get("roi") or {}
    params = body.get("params") or {}
    h_lower = params.get("h_lower") or body.get("h_lower") or [0, 0, 0]
    h_upper = params.get("h_upper") or body.get("h_upper") or [180, 255, 255]
    tool = {"roi": roi, "params": {"h_lower": h_lower, "h_upper": h_upper}}
    mask = hsv_hit_mask(img, tool)
    preview = np.zeros_like(img)
    preview[mask > 0] = img[mask > 0]
    quality = int(state.config_store.get_cached().get("output", {}).get("jpeg_quality", 70))
    h, w = preview.shape[:2]
    return {
        "image_base64": encode_image_b64(preview, quality),
        "width": w,
        "height": h,
    }


def _trigger_capture_and_detect() -> dict:
    cfg = state.config_store.get_cached()
    slots = required_tool_cam_slots(cfg) if has_active_tools(cfg) else None
    frames = state.camera.capture_all_for_trigger(slots)
    return state.run_detection(frames)


@app.post("/api/trigger")
async def trigger():
    state._preview_paused_until = time.monotonic() + PREVIEW_PAUSE_AFTER_TRIGGER_SEC
    payload = await asyncio.to_thread(_trigger_capture_and_detect)
    await state.broadcast(payload)
    return payload


@app.post("/api/stats/reset")
async def reset_stats():
    state.stats.reset()
    payload = await asyncio.to_thread(state.build_idle_payload)
    await state.broadcast(payload)
    return {"ok": True, "stats": state.stats.snapshot()}


@app.post("/api/calibration/add")
async def calibration_add():
    count = state.calibration.add_sample()
    payload = await asyncio.to_thread(state.build_idle_payload)
    await state.broadcast(payload)
    return {"ok": True, "sample_count": count}


@app.post("/api/calibration/master")
async def calibration_master(body: Optional[dict] = None):
    body = body or {}
    slot = _master_slot(body)
    ui_only = _as_bool(body.get("ui_only", True))
    b64 = body.get("image_base64")
    if b64:
        try:
            frame = await asyncio.to_thread(decode_image_b64, str(b64))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    else:
        frame = state.camera.capture_for_trigger(slot=slot)
        if frame is None:
            raise HTTPException(400, f"无法从 CAM#{slot} 获取图像以注册主控")
    cal = await asyncio.to_thread(
        state.calibration.register_master, frame, slot, None, ui_only=ui_only
    )
    state.reload_services()
    return {"ok": True, "calibration": cal, "cam": slot, "ui_only": ui_only}


@app.get("/api/calibration/master/status")
async def get_master_status():
    slots = state.calibration.list_master_slots()
    return {
        "profile": state.config_store._active,
        "masters_dir": str(state.calibration.master_dir).replace("\\", "/"),
        "slots": {str(k): v for k, v in slots.items()},
    }


@app.get("/api/calibration/master/image")
async def get_master_image(cam: int = 0):
    from .frame_codec import encode_image_b64

    slot = max(0, min(1, int(cam)))
    img = state.calibration.load_master_image(slot)
    if img is None:
        raise HTTPException(404, f"未注册 CAM#{slot} 主控图像")
    h, w = img.shape[:2]
    quality = int(state.config_store.get_cached().get("output", {}).get("jpeg_quality", 70))
    return {
        "image_base64": encode_image_b64(img, quality),
        "width": w,
        "height": h,
    }


@app.get("/api/frame/current")
async def get_current_frame():
    """返回最近一次缓存帧（供 WebSocket 连接时 REST 补帧）。"""
    return state._last_frame_payload


def _capture_save_dir(config: dict) -> Path:
    output = (config or {}).get("output", {})
    rel = output.get("capture_dir", "output/captures")
    path = Path(str(rel))
    if not path.is_absolute():
        path = ROOT / path
    return path


@app.post("/api/frame/save")
async def save_current_frame(body: Optional[dict] = None):
    """保存主画面当前显示图像到项目目录，并打开该目录。"""
    body = body or {}
    b64 = body.get("image_base64")
    if not b64:
        raise HTTPException(400, "缺少 image_base64")
    try:
        frame = await asyncio.to_thread(decode_image_b64, str(b64))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    cfg = state.config_store.get_cached()
    save_dir = _capture_save_dir(cfg)
    open_folder = body.get("open_folder", True) is not False

    def _save() -> Path:
        return save_display_frame(frame, save_dir, open_folder=open_folder)

    try:
        path = await asyncio.to_thread(_save)
    except OSError as exc:
        raise HTTPException(500, str(exc)) from exc

    return {
        "ok": True,
        "path": str(path).replace("\\", "/"),
        "filename": path.name,
        "dir": str(save_dir).replace("\\", "/"),
    }


@app.post("/api/camera/switch")
async def camera_switch():
    ok = state.camera.switch()
    state.config_store.save(state.config_store.get_cached())
    payload = await asyncio.to_thread(state.build_idle_payload)
    await state.broadcast(payload)
    return {"ok": ok, "camera_id": state.config_store.get_cached().get("input", {}).get("camera_id")}


@app.get("/api/cameras/live")
async def get_camera_live(cam: int = 0):
    slot = max(0, min(1, int(cam)))
    frame = await asyncio.to_thread(state.camera.get_live_frame, slot)
    if frame is None:
        raise HTTPException(404, f"CAM#{slot} 无 Live 画面")
    h, w = frame.shape[:2]
    cfg = state.config_store.get_cached()
    quality = int(cfg.get("output", {}).get("jpeg_quality", 70))
    binary = build_tool_binary_image(frame, cfg, None)
    if binary is not None and getattr(binary, "size", 0) != 0 and len(binary.shape) == 2:
        binary = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
    return {
        "image_base64": encode_image_b64(frame, quality),
        "binary_base64": encode_image_b64(binary, quality) if binary is not None else "",
        "width": w,
        "height": h,
        "cam": slot,
    }


@app.get("/api/cameras/snapshot")
async def get_camera_snapshot(device_id: int = 0):
    """向导 STEP1 硬件测试：按 OpenCV 设备号单帧抓拍，不依赖测量工具。"""
    dev = int(device_id)
    frame, slot = await asyncio.to_thread(state.camera.capture_device_snapshot, dev)
    if frame is None:
        raise HTTPException(404, f"相机 {dev} 抓拍失败")
    h, w = frame.shape[:2]
    cfg = state.config_store.get_cached()
    quality = int(cfg.get("output", {}).get("jpeg_quality", 70))
    preview_cam = slot if slot is not None else 0
    if slot is None:
        cameras = available_camera_ids(cfg)
        try:
            preview_cam = max(0, min(1, cameras.index(dev)))
        except ValueError:
            preview_cam = 0
    return {
        "image_base64": encode_image_b64(frame, quality),
        "width": w,
        "height": h,
        "device_id": dev,
        "cam": preview_cam,
    }


def _find_tool_config(config: dict, tool_key: str) -> Optional[dict]:
    """按 inspections.tool（id 或 name）查找 tools 配置项。"""
    if not tool_key:
        return None
    for t in (config or {}).get("tools") or []:
        if not isinstance(t, dict):
            continue
        if t.get("enabled", True) is False:
            continue
        key = t.get("id") or t.get("name") or ""
        if str(key) == str(tool_key):
            return t
    return None


@app.get("/api/tools/image")
async def get_tool_image(tool: str):
    """运行模式：按 tool 返回对应 ROI 图像（裁剪后）。"""
    cfg = state.config_store.get_cached()
    t = _find_tool_config(cfg, tool)
    if not t:
        raise HTTPException(404, f"未找到工具: {tool}")
    try:
        slot = max(0, min(1, int(t.get("cam", 0))))
    except (TypeError, ValueError):
        slot = 0

    img = await asyncio.to_thread(state.camera.get_live_frame, slot)
    if img is None:
        img = state.calibration.load_master_image(slot)
    if img is None:
        raise HTTPException(404, f"CAM#{slot} 无可用画面")

    roi = t.get("roi") or {}
    crop = crop_roi(img, roi)
    if crop.img is None or crop.img.size == 0:
        raise HTTPException(400, "ROI 越界/为空")

    quality = int(cfg.get("output", {}).get("jpeg_quality", 70))
    h, w = crop.img.shape[:2]
    return {
        "tool": tool,
        "cam": slot,
        "roi": roi,
        "image_base64": encode_image_b64(crop.img, quality),
        "width": w,
        "height": h,
    }


@app.post("/api/cameras/reconnect")
async def cameras_reconnect(body: Optional[dict] = None):
    """按配置或请求体重连双路相机；cameras 为可切换设备号列表（长度 ≥ 1）。"""
    body = body or {}
    cameras = body.get("cameras")
    if cameras is not None:
        try:
            cameras = sorted({int(c) for c in cameras})
            if not cameras:
                raise ValueError("empty")
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, "cameras 需为至少含 1 个设备号的列表") from exc
    elif body.get("slot") is not None and body.get("device_id") is not None:
        slot = max(0, min(1, int(body["slot"])))
        current = slot_device_ids(state.config_store.get_cached())
        current[slot] = int(body["device_id"])
        cameras = current
    else:
        cameras = None

    results = await asyncio.to_thread(state.reconnect_cameras, cameras)
    payload = await asyncio.to_thread(state.build_idle_payload)
    await state.broadcast(payload)
    return {
        "ok": any(results.values()),
        "results": {str(k): v for k, v in results.items()},
        "cameras": state.camera.slot_status(),
        "available_cameras": available_camera_ids(state.config_store.get_cached()),
    }


@app.post("/api/camera/select")
async def camera_select(body: dict):
    """兼容旧 API：按 CAM#（1 起）或 camera_id 更新 slot0。"""
    cam = body.get("cam")
    camera_id = body.get("camera_id")
    if cam is not None:
        try:
            camera_id = max(0, int(cam) - 1)
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, "无效的 cam") from exc
    elif camera_id is None:
        raise HTTPException(400, "需要 cam 或 camera_id")
    else:
        try:
            camera_id = int(camera_id)
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, "无效的 camera_id") from exc

    ok = await asyncio.to_thread(state.select_camera, int(camera_id))
    payload = await asyncio.to_thread(state.build_idle_payload)
    await state.broadcast(payload)
    cfg = state.config_store.get_cached()
    return {
        "ok": ok,
        "connected": state.camera.is_connected(0),
        "camera_id": int(camera_id),
        "cam": int(camera_id) + 1,
        "cameras": state.camera.slot_status(),
        "available_cameras": available_camera_ids(cfg),
    }


@app.websocket("/ws/frame")
async def ws_frame(ws: WebSocket):
    await ws.accept()
    state.ws_clients.add(ws)
    try:
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
