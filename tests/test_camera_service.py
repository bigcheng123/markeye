"""相机采集测试。"""

from __future__ import annotations

import threading
import time

import numpy as np

from src.camera_service import CameraService


def test_get_live_frame_returns_latest_copy():
    svc = CameraService({})
    svc._connected = True
    svc._latest_frame = np.zeros((10, 10, 3), dtype=np.uint8)
    svc._frame_seq = 1

    frame = svc.get_live_frame()

    assert frame is not None
    assert int(frame[0, 0, 0]) == 0
    frame[0, 0, 0] = 99
    assert int(svc._latest_frame[0, 0, 0]) == 0


def test_capture_for_trigger_waits_for_new_frame():
    svc = CameraService({})
    svc._connected = True
    svc._latest_frame = np.zeros((10, 10, 3), dtype=np.uint8)
    svc._frame_seq = 1

    def bump():
        time.sleep(0.03)
        with svc._lock:
            svc._latest_frame = np.ones((10, 10, 3), dtype=np.uint8) * 90
            svc._frame_seq = 2

    threading.Thread(target=bump, daemon=True).start()
    frame = svc.capture_for_trigger(max_wait_s=0.5)

    assert frame is not None
    assert int(frame[0, 0, 0]) == 90


def test_fallback_does_not_use_master_image(tmp_path):
    import cv2

    master = tmp_path / "master.jpg"
    sample = tmp_path / "sample.jpg"
    cv2.imwrite(str(master), np.zeros((8, 8, 3), dtype=np.uint8))
    cv2.imwrite(str(sample), np.ones((8, 8, 3), dtype=np.uint8) * 120)

    cfg = {
        "input": {"fallback_image": str(sample)},
        "calibration": {"master_image": str(master)},
    }
    svc = CameraService(cfg)
    svc._connected = False

    frame = svc.get_live_frame()

    assert frame is not None
    assert int(frame[0, 0, 0]) == 120
