"""相机采集与软触发采图。"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from .utils import imread

ROOT = Path(__file__).resolve().parent.parent


class CameraService:
    """管理相机连接与单帧采集。"""

    def __init__(self, config: dict):
        self.config = config
        self._cap: Optional[cv2.VideoCapture] = None
        self._connected = False
        self._using_fallback = False
        self._last_frame: Optional[np.ndarray] = None

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def using_fallback(self) -> bool:
        return self._using_fallback

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
        return self._connected

    def disconnect(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        self._connected = False
        self._using_fallback = False

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

    def capture_frame(self) -> Optional[np.ndarray]:
        if self._connected and self._cap is not None:
            ret, frame = self._cap.read()
            if ret and frame is not None:
                self._last_frame = frame
                self._using_fallback = False
                return frame
            self._using_fallback = True

        cal = self.config.get("calibration", {})
        master = cal.get("master_image")
        if master:
            img = imread(master)
            if img is not None:
                self._last_frame = img
                self._using_fallback = True
                return img

        fallback_path = self._resolve_fallback_path()
        if fallback_path is not None:
            img = imread(str(fallback_path))
            if img is not None:
                self._last_frame = img
                self._using_fallback = True
                return img

        return self._last_frame

    def get_last_frame(self) -> Optional[np.ndarray]:
        return self._last_frame
