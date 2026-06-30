"""camera_config 单元测试"""

from src.camera_config import (
    available_camera_ids,
    camera_id_to_cam_slot,
    normalize_input_cameras,
    slot_device_ids,
)


def test_normalize_preserves_user_cameras_list():
    inp = {"cameras": [0, 2, 2, 1], "camera_id": 2}
    out = normalize_input_cameras(inp)
    assert out == [0, 1, 2]
    assert inp["camera_id"] == 2
    assert inp["cameras"] == [0, 1, 2]


def test_normalize_migrates_legacy_camera_id():
    inp = {"camera_id": 3}
    out = normalize_input_cameras(inp)
    assert out[0] == 3
    assert len(out) >= 2
    assert inp["camera_id"] == 3


def test_camera_id_clamped_to_available_list():
    inp = {"cameras": [1, 2], "camera_id": 99}
    normalize_input_cameras(inp)
    assert inp["camera_id"] == 1


def test_available_camera_ids_from_config():
    cfg = {"input": {"cameras": [2, 0, 2], "camera_id": 0}}
    assert available_camera_ids(cfg) == [0, 2]


def test_slot_device_ids_uses_first_two():
    cfg = {"input": {"cameras": [0, 1, 2], "camera_id": 0}}
    assert slot_device_ids(cfg) == [0, 1]


def test_camera_id_to_cam_slot():
    cfg = {"input": {"cameras": [0, 1], "camera_id": 1}}
    assert camera_id_to_cam_slot(cfg) == 1
    cfg["input"]["camera_id"] = 0
    assert camera_id_to_cam_slot(cfg) == 0
