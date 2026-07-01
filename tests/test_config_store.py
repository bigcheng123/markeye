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


def test_save_wizard_step4_assignments_normalized(store):
    store.save({"io": {}})
    fragment = {
        "io": {
            "enabled": True,
            "transport": "rtu",
            "serial_port": "COM4",
            "output_assignments": ["link_ok", "result_ng"] + ["off"] * 6,
            "input_assignments": ["trigger"] + ["off"] * 7,
        }
    }
    cfg = store.save_wizard_step(4, fragment)
    assert cfg["io"]["outputs"]["link_ok"] == 0
    assert cfg["io"]["outputs"]["result_ng"] == 1
    assert cfg["io"]["inputs"]["trigger_bits"] == [0]
    assert len(cfg["io"]["output_assignments"]) == 8


@pytest.fixture
def profile_store(tmp_path):
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    store = ConfigStore(config_dir=str(config_dir), default_name="config.yaml")
    master_dir = tmp_path / "data" / "masters" / "config"
    master_dir.mkdir(parents=True)
    master_file = master_dir / "master_cam0.jpg"
    master_file.write_bytes(b"jpeg")
    rel = "data/masters/config/master_cam0.jpg"
    store.save(
        {
            "trigger": {"source": "external"},
            "input": {"camera_id": 0},
            "calibration": {
                "masters": {"0": rel},
                "master_image": rel,
                "sample_count": 1,
            },
            "tools": [{"id": "01", "enabled": True, "type": "hsv_roi", "cam": 0}],
        }
    )
    return store, tmp_path


def test_create_from_default(profile_store):
    store, root = profile_store
    cfg = store.create_from_default("prog_001.yaml", root)
    assert (store.config_dir / "prog_001.yaml").exists()
    assert cfg["trigger"]["source"] == "external"
    masters = cfg["calibration"]["masters"]["0"]
    assert masters.startswith("data/masters/prog_001/")
    assert (root / "data" / "masters" / "prog_001" / "master_cam0.jpg").is_file()


def test_copy_profile(profile_store):
    store, root = profile_store
    cfg = store.copy_profile("config.yaml", "prog_copy.yaml", root)
    assert (store.config_dir / "prog_copy.yaml").exists()
    assert cfg["calibration"]["masters"]["0"].startswith("data/masters/prog_copy/")
    assert (root / "data" / "masters" / "prog_copy" / "master_cam0.jpg").is_file()


def test_rename_profile_updates_active(profile_store):
    store, root = profile_store
    store.create_from_default("prog_active.yaml", root)
    store.switch("prog_active.yaml")
    store.rename_profile("prog_active.yaml", "renamed.yaml", root)
    assert not (store.config_dir / "prog_active.yaml").exists()
    assert (store.config_dir / "renamed.yaml").exists()
    assert store._active == "renamed.yaml"
    assert (root / "data" / "masters" / "renamed" / "master_cam0.jpg").is_file()


def test_rename_profile_rejects_default_name(profile_store):
    store, root = profile_store
    store.copy_profile("config.yaml", "other.yaml", root)
    with pytest.raises(ValueError, match="不能重命名默认配方"):
        store.rename_profile("config.yaml", "new.yaml", root)


def test_delete_profile(profile_store):
    store, root = profile_store
    store.create_from_default("prog_del.yaml", root)
    store.delete_profile("prog_del.yaml", root)
    assert not (store.config_dir / "prog_del.yaml").exists()
    assert not (root / "data" / "masters" / "prog_del").exists()


def test_delete_profile_rejects_active(profile_store):
    store, root = profile_store
    store.create_from_default("prog_x.yaml", root)
    store.switch("prog_x.yaml")
    with pytest.raises(ValueError, match="不能删除当前活动配方"):
        store.delete_profile("prog_x.yaml", root)


def test_delete_profile_rejects_default(profile_store):
    store, root = profile_store
    store.create_from_default("prog_y.yaml", root)
    store.switch("prog_y.yaml")
    with pytest.raises(ValueError, match="不能删除默认配方"):
        store.delete_profile("config.yaml", root)
