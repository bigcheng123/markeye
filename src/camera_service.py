"""相机采集与软触发采图。"""

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from .utils import imread

ROOT = Path(__file__).resolve().parent.parent


class CameraService:
    """管理相机连接与单帧采集。

    后台采集线程持续更新最新帧；预览与触发均从该缓冲读取，避免多路 read 争抢导致滞后或回退静态图。
    """

    def __init__(self, config: dict):
        self.config = config
        self._cap: Optional[cv2.VideoCapture] = None
        self._connected = False
        self._using_fallback = False
        self._last_frame: Optional[np.ndarray] = None
        self._latest_frame: Optional[np.ndarray] = None
        self._frame_seq = 0
        self._lock = threading.Lock()
        self._grab_stop = threading.Event()
        self._grab_thread: Optional[threading.Thread] = None

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def using_fallback(self) -> bool:
        return self._using_fallback

    @property
    def frame_seq(self) -> int:
        with self._lock:
            return self._frame_seq

    def _open_capture(self, cam_id: int) -> Optional[cv2.VideoCapture]:
        """按平台尝试打开相机；Windows 优先 DirectShow。"""
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
        self.disconnect()
        inp = self.config.get("input", {})
        cam_id = camera_id if camera_id is not None else inp.get("camera_id", 0)
        self._cap = self._open_capture(int(cam_id))
        self._connected = self._cap is not None
        self._using_fallback = not self._connected
        if self._connected:
            self._start_grabber()
        return self._connected

    def disconnect(self) -> None:
        self._stop_grabber()
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        self._connected = False
        self._using_fallback = False
        with self._lock:
            self._latest_frame = None

    def switch(self) -> bool:
        inp = self.config.get("input", {})
        current = inp.get("camera_id", 0)
        next_id = 1 if current == 0 else 0
        inp["camera_id"] = next_id
        return self.connect(next_id)

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
        self._stop_grabber()
        self._grab_stop.clear()
        thread = threading.Thread(
            target=self._grabber_loop,
            name="markeye-camera-grabber",
            daemon=True,
        )
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
            if not self._connected or self._cap is None:
                time.sleep(0.03)
                continue

            ret, frame = self._cap.read()
            if ret and frame is not None:
                with self._lock:
                    self._latest_frame = frame
                    self._last_frame = frame
                    self._frame_seq += 1
                    self._using_fallback = False
                continue

            self._using_fallback = True
            time.sleep(0.02)

    def _capture_fallback_unlocked(self) -> Optional[np.ndarray]:
        """无实时帧时的兜底：最近成功帧或样本图（不使用主控静态图）。"""
        if self._last_frame is not None:
            return self._last_frame.copy()

        fallback_path = self._resolve_fallback_path()
        if fallback_path is not None:
            img = imread(str(fallback_path))
            if img is not None:
                self._last_frame = img
                self._using_fallback = True
                return img.copy()

        return None

    def get_live_frame(self) -> Optional[np.ndarray]:
        """预览：返回采集线程当前最新帧副本。"""
        with self._lock:
            if self._latest_frame is not None:
                return self._latest_frame.copy()
            return self._capture_fallback_unlocked()

    def capture_for_trigger(self, *, max_wait_s: float = 0.2) -> Optional[np.ndarray]:
        """软触发：等待采集线程产出新帧后返回，确保为点击时刻的最新画面。"""
        with self._lock:
            start_seq = self._frame_seq

        deadline = time.monotonic() + max_wait_s
        while time.monotonic() < deadline:
            time.sleep(0.005)
            with self._lock:
                if self._frame_seq > start_seq and self._latest_frame is not None:
                    return self._latest_frame.copy()

        with self._lock:
            if self._latest_frame is not None:
                return self._latest_frame.copy()
            return self._capture_fallback_unlocked()

    def capture_frame(self) -> Optional[np.ndarray]:
        return self.get_live_frame()

    def capture_latest_frame(self) -> Optional[np.ndarray]:
        return self.capture_for_trigger()

    def get_last_frame(self) -> Optional[np.ndarray]:
        with self._lock:
            if self._last_frame is None:
                return None
            return self._last_frame.copy()
