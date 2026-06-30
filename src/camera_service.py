"""相机采集与软触发采图（双槽位 CAM#0 / CAM#1）。"""

from __future__ import annotations

import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from .camera_config import NUM_CAMERA_SLOTS, slot_device_ids
from .utils import imread

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class _SlotState:
    device_id: int = 0
    cap: Optional[cv2.VideoCapture] = None
    connected: bool = False
    using_fallback: bool = False
    latest_frame: Optional[np.ndarray] = None
    last_frame: Optional[np.ndarray] = None
    frame_seq: int = 0


class CameraService:
    """管理两路逻辑相机槽位，每槽位映射一个 OpenCV 设备号。"""

    def __init__(self, config: dict):
        self.config = config
        self._slots: list[_SlotState] = [_SlotState() for _ in range(NUM_CAMERA_SLOTS)]
        self._lock = threading.Lock()
        self._grab_stop = threading.Event()
        self._grab_thread: Optional[threading.Thread] = None
        # 兼容旧测试/旧代码：曾直接使用 _connected/_latest_frame/_frame_seq（单路相机模型）
        # 现在统一映射到 slot0 状态，通过 property 维持可读写行为。

    @property
    def _connected(self) -> bool:  # noqa: SLF001 - legacy compat
        return self._slots[0].connected

    @_connected.setter
    def _connected(self, v: bool) -> None:  # noqa: SLF001 - legacy compat
        self._slots[0].connected = bool(v)

    @property
    def _latest_frame(self) -> Optional[np.ndarray]:  # noqa: SLF001 - legacy compat
        return self._slots[0].latest_frame

    @_latest_frame.setter
    def _latest_frame(self, frame: Optional[np.ndarray]) -> None:  # noqa: SLF001 - legacy compat
        self._slots[0].latest_frame = frame
        if frame is not None:
            self._slots[0].last_frame = frame

    @property
    def _frame_seq(self) -> int:  # noqa: SLF001 - legacy compat
        return self._slots[0].frame_seq

    @_frame_seq.setter
    def _frame_seq(self, n: int) -> None:  # noqa: SLF001 - legacy compat
        self._slots[0].frame_seq = int(n or 0)

    @property
    def connected(self) -> bool:
        return self.is_connected(0)

    @property
    def using_fallback(self) -> bool:
        return self._slots[0].using_fallback

    @property
    def frame_seq(self) -> int:
        with self._lock:
            return self._slots[0].frame_seq

    def is_connected(self, slot: int = 0) -> bool:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            return False
        return self._slots[slot].connected

    def slot_status(self) -> list[dict]:
        devices = slot_device_ids(self.config)
        out = []
        for i in range(NUM_CAMERA_SLOTS):
            s = self._slots[i]
            out.append({
                "slot": i,
                "device_id": devices[i] if i < len(devices) else i,
                "connected": s.connected,
                "using_fallback": s.using_fallback,
            })
        return out

    def _open_capture(self, cam_id: int) -> Optional[cv2.VideoCapture]:
        backends: list[int | None] = []
        if sys.platform == "win32":
            backends.extend([cv2.CAP_DSHOW, cv2.CAP_MSMF, None])
        else:
            backends.extend([cv2.CAP_V4L2, None])

        for backend in backends:
            cap = (
                cv2.VideoCapture(cam_id)
                if backend is None
                else cv2.VideoCapture(cam_id, backend)
            )
            if not cap.isOpened():
                cap.release()
                continue
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            ret, frame = cap.read()
            if ret and frame is not None:
                return cap
            cap.release()
        return None

    def connect(self, camera_id: Optional[int] = None) -> bool:
        """兼容旧 API：连接全部槽位；camera_id 仅更新 slot0 设备号。"""
        if camera_id is not None:
            inp = self.config.setdefault("input", {})
            cameras = list(slot_device_ids(self.config))
            cameras[0] = int(camera_id)
            inp["cameras"] = cameras
            inp["camera_id"] = int(camera_id)
        return all(self.connect_all().values())

    def connect_all(self, cameras: Optional[list[int]] = None) -> dict[int, bool]:
        devices = cameras if cameras is not None else slot_device_ids(self.config)
        results: dict[int, bool] = {}
        for slot in range(NUM_CAMERA_SLOTS):
            dev = int(devices[slot]) if slot < len(devices) else slot
            results[slot] = self.connect_slot(slot, dev)
        if any(results.values()) and (self._grab_thread is None or not self._grab_thread.is_alive()):
            self._start_grabber()
        if not any(results.values()):
            self._stop_grabber()
        return results

    def connect_slot(self, slot: int, device_id: int) -> bool:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            return False
        self.disconnect_slot(slot)
        state = self._slots[slot]
        state.device_id = int(device_id)
        state.cap = self._open_capture(state.device_id)
        state.connected = state.cap is not None
        state.using_fallback = not state.connected
        return state.connected

    def disconnect_slot(self, slot: int) -> None:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            return
        state = self._slots[slot]
        if state.cap is not None:
            state.cap.release()
            state.cap = None
        state.connected = False
        state.using_fallback = False
        with self._lock:
            state.latest_frame = None

    def disconnect(self) -> None:
        self._stop_grabber()
        for slot in range(NUM_CAMERA_SLOTS):
            self.disconnect_slot(slot)

    def switch(self) -> bool:
        """RUN 模式快捷切换：交换 slot0 / slot1 的设备映射并重连。"""
        inp = self.config.setdefault("input", {})
        cameras = list(slot_device_ids(self.config))
        cameras[0], cameras[1] = cameras[1], cameras[0]
        inp["cameras"] = cameras
        inp["camera_id"] = cameras[0]
        results = self.connect_all(cameras)
        return results.get(0, False)

    def update_cameras_config(self, cameras: list[int]) -> dict[int, bool]:
        inp = self.config.setdefault("input", {})
        normalized = [int(cameras[i]) for i in range(NUM_CAMERA_SLOTS)]
        inp["cameras"] = normalized
        inp["camera_id"] = normalized[0]
        return self.connect_all(normalized)

    def _resolve_fallback_path(self) -> Optional[Path]:
        inp = self.config.get("input", {})
        fallback = inp.get("fallback_image", "data/sample.jpg")
        path = Path(fallback)
        if not path.is_absolute():
            path = ROOT / path
        if path.exists():
            return path
        for candidate in (
            ROOT / "data" / "sample.jpg",
            ROOT / "ui" / "ui_sample" / "target.PNG",
        ):
            if candidate.exists():
                return candidate
        return None

    def _start_grabber(self) -> None:
        if self._grab_thread and self._grab_thread.is_alive():
            return
        self._grab_stop.clear()
        thread = threading.Thread(target=self._grabber_loop, name="markeye-camera-grabber", daemon=True)
        self._grab_thread = thread
        thread.start()

    def _stop_grabber(self) -> None:
        self._grab_stop.set()
        thread = self._grab_thread
        if thread and thread.is_alive():
            thread.join(timeout=2.0)
        self._grab_thread = None

    def _grabber_loop(self) -> None:
        while not self._grab_stop.is_set():
            any_read = False
            for slot in range(NUM_CAMERA_SLOTS):
                state = self._slots[slot]
                if not state.connected or state.cap is None:
                    continue
                ret, frame = state.cap.read()
                if ret and frame is not None:
                    with self._lock:
                        state.latest_frame = frame
                        state.last_frame = frame
                        state.frame_seq += 1
                        state.using_fallback = False
                    any_read = True
                else:
                    state.using_fallback = True
            if not any_read:
                time.sleep(0.02)

    def _capture_fallback_unlocked(self, slot: int) -> Optional[np.ndarray]:
        state = self._slots[slot]
        if state.last_frame is not None:
            return state.last_frame.copy()
        fallback_path = self._resolve_fallback_path()
        if fallback_path is not None:
            img = imread(str(fallback_path))
            if img is not None:
                state.last_frame = img
                state.using_fallback = True
                return img.copy()
        return None

    def get_live_frame(self, slot: int = 0) -> Optional[np.ndarray]:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            slot = 0
        state = self._slots[slot]
        with self._lock:
            if state.latest_frame is not None:
                return state.latest_frame.copy()
            return self._capture_fallback_unlocked(slot)

    def capture_for_trigger(self, slot: int = 0, *, max_wait_s: float = 0.2) -> Optional[np.ndarray]:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            slot = 0
        state = self._slots[slot]
        with self._lock:
            start_seq = state.frame_seq

        deadline = time.monotonic() + max_wait_s
        while time.monotonic() < deadline:
            time.sleep(0.005)
            with self._lock:
                if state.frame_seq > start_seq and state.latest_frame is not None:
                    return state.latest_frame.copy()

        with self._lock:
            if state.latest_frame is not None:
                return state.latest_frame.copy()
            return self._capture_fallback_unlocked(slot)

    def capture_all_for_trigger(self) -> dict[int, Optional[np.ndarray]]:
        return {slot: self.capture_for_trigger(slot) for slot in range(NUM_CAMERA_SLOTS)}

    def capture_frame(self, slot: int = 0) -> Optional[np.ndarray]:
        return self.get_live_frame(slot)

    def capture_latest_frame(self, slot: int = 0) -> Optional[np.ndarray]:
        return self.capture_for_trigger(slot)

    def get_last_frame(self, slot: int = 0) -> Optional[np.ndarray]:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            slot = 0
        state = self._slots[slot]
        with self._lock:
            if state.last_frame is None:
                return None
            return state.last_frame.copy()
