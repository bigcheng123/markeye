"""ConfigStore 双相机与向导步骤保存测试"""

import pytest

from src.config_store import ConfigStore


@pytest.fixture
def store(tmp_path):
    return ConfigStore(config_dir=str(tmp_path), default_name="config.yaml")


def test_save_wizard_step1_dual_cameras(store):
    store.save({"input": {"camera_id": 0}, "trigger": {"source": "external"}})
    cfg = store.save_wizard_step(
        1,
        {
            "input": {"cameras": [0, 1], "camera_id": 0, "exposure": 50},
            "trigger": {"source": "external", "delay_ms": 0},
        },
    )
    assert cfg["input"]["cameras"] == [0, 1]
    assert cfg["input"]["camera_id"] == 0


def test_save_wizard_step3_dual_tools_preserve_cam_and_roi(store, tmp_path):
    master0 = tmp_path / "m0.jpg"
    master1 = tmp_path / "m1.jpg"
    master0.write_bytes(b"x")
    master1.write_bytes(b"y")
    store.save(
        {
            "calibration": {"masters": {"0": str(master0), "1": str(master1)}},
            "tools": [],
        }
    )
    tools = [
        {
            "id": "01",
            "cam": 0,
            "name": "色彩识别",
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 400, "y": 330, "w": 122, "h": 70},
            "params": {
                "h_lower": [0, 50, 50],
                "h_upper": [180, 255, 255],
                "match_area_min": 1000,
                "match_area_max": 2200,
            },
        },
        {
            "id": "02",
            "cam": 1,
            "name": "色彩识别",
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 180, "y": 400, "w": 122, "h": 70},
            "params": {
                "h_lower": [80, 100, 100],
                "h_upper": [110, 150, 180],
                "match_area_min": 1000,
                "match_area_max": 2500,
            },
        },
    ]
    cfg = store.save_wizard_step(3, {"tools": tools})
    assert len(cfg["tools"]) == 2
    assert cfg["tools"][0]["cam"] == 0
    assert cfg["tools"][1]["cam"] == 1
    assert cfg["tools"][0]["roi"]["x"] == 400
    assert cfg["tools"][1]["roi"]["x"] == 180

    reloaded = ConfigStore(config_dir=str(store.config_dir), default_name="config.yaml")
    loaded = reloaded.load()
    assert loaded["tools"][1]["cam"] == 1


def test_save_wizard_step3_rejects_missing_master_for_cam(store, tmp_path):
    master0 = tmp_path / "m0.jpg"
    master0.write_bytes(b"x")
    store.save(
        {
            "calibration": {"masters": {"0": str(master0)}},
            "tools": [],
        }
    )
    tools = [
        {
            "id": "02",
            "cam": 1,
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 10, "y": 10, "w": 20, "h": 20},
            "params": {"h_lower": [0, 50, 50], "h_upper": [180, 255, 255]},
        },
    ]
    with pytest.raises(ValueError, match="CAM#1"):
        store.save_wizard_step(3, {"tools": tools})


def test_save_wizard_step4_comprehensive_logic(store):
    store.save({"io": {"comprehensive_logic": 1}})
    cfg = store.save_wizard_step(4, {"io": {"comprehensive_logic": 2, "trerr_enabled": False}})
    assert cfg["io"]["comprehensive_logic"] == 2
    assert cfg["io"]["trerr_enabled"] is False
