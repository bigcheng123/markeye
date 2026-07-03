"""相机采集测试。"""

from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock, patch

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


def test_enumerate_devices_includes_connected_slot():
    svc = CameraService({})
    cap = MagicMock()
    cap.get.side_effect = lambda prop: {
        3: 1280.0,  # CAP_PROP_FRAME_WIDTH
        4: 720.0,   # CAP_PROP_FRAME_HEIGHT
    }.get(prop, 0.0)
    cap.getBackendName.return_value = "V4L2"

    slot = svc._slots[0]
    slot.device_id = 2
    slot.connected = True
    slot.cap = cap

    with patch("src.camera_service.probe_camera_diagnostic") as probe:
        probe.return_value = (
            {"device_id": 0, "opened": False, "read_ok": False, "reason": "not_found"},
            None,
        )
        devices = svc.enumerate_devices(max_probe=4)

    probed_ids = [call.args[0] for call in probe.call_args_list]
    assert 2 not in probed_ids
    assert len(devices) == 1
    assert devices[0]["device_id"] == 2
    assert devices[0]["width"] == 1280
    assert devices[0]["height"] == 720
    assert devices[0]["backend"] == "V4L2"
    assert devices[0]["accessible"] is True


def test_enumerate_devices_probes_unconnected_indices():
    svc = CameraService({})
    probe_cap = MagicMock()
    probe_cap.get.side_effect = lambda prop: {
        3: 640.0,
        4: 480.0,
    }.get(prop, 0.0)
    probe_cap.getBackendName.return_value = "DSHOW"

    with patch("src.camera_service.probe_camera_diagnostic") as probe:
        probe.side_effect = lambda device_id, **_: (
            {
                "device_id": device_id,
                "opened": device_id == 1,
                "read_ok": device_id == 1,
                "backend": "DSHOW" if device_id == 1 else None,
                "reason": "ok" if device_id == 1 else "not_found",
            },
            probe_cap if device_id == 1 else None,
        )
        devices = svc.enumerate_devices(max_probe=3)

    assert [d["device_id"] for d in devices] == [1]
    assert devices[0]["width"] == 640
    probe_cap.release.assert_called_once()


def test_enumerate_devices_detail_includes_diagnostics():
    svc = CameraService({})
    with patch("src.camera_service.probe_camera_diagnostic") as probe:
        probe.return_value = (
            {"device_id": 0, "opened": False, "read_ok": False, "reason": "open_failed"},
            None,
        )
        result = svc.enumerate_devices_detail(max_probe=1)

    assert result["count"] == 0
    assert result["devices"] == []
    assert len(result["diagnostics"]) == 1
    assert result["diagnostics"][0]["reason"] == "open_failed"
    assert "hints" in result


def test_connect_succeeds_when_any_slot_connects():
    svc = CameraService({"input": {"cameras": [0, 1]}})
    with patch.object(svc, "connect_all", return_value={0: True, 1: False}):
        assert svc.connect() is True


def test_probe_timeout_from_config():
    svc = CameraService({"input": {"probe_timeout_s": 5.5}})
    assert svc._probe_timeout_s() == 5.5
