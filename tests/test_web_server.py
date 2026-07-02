"""Web API 集成测试"""

from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src import web_server


@pytest.fixture
def client(tmp_path, monkeypatch):
    # 避免测试污染真实 config/config.yaml：使用临时 ROOT 与独立 AppState
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "config.yaml").write_text(
        "input:\n  camera_id: 0\ntrigger:\n  source: external\noutput:\n  jpeg_quality: 70\n",
        encoding="utf-8",
    )
    master_dir = tmp_path / "data" / "masters" / "config"
    master_dir.mkdir(parents=True)

    monkeypatch.setattr(web_server, "ROOT", tmp_path)
    web_server.state = web_server.AppState()
    web_server.state.config_store.config_dir = config_dir
    web_server.state.calibration.master_dir = master_dir
    return TestClient(web_server.app)


@pytest.fixture
def sample_image(tmp_path):
    cv2 = pytest.importorskip("cv2")
    img_path = tmp_path / "sample.jpg"
    img = np.zeros((120, 120, 3), dtype=np.uint8)
    cv2.rectangle(img, (30, 30), (90, 90), (0, 0, 255), -1)
    cv2.imwrite(str(img_path), img)
    cfg = web_server.state.config_store.get_cached()
    cfg.setdefault("input", {})["fallback_image"] = str(img_path)
    web_server.state.config_store.save(cfg)
    web_server.state.reload_services()
    yield img_path
    web_server.state.stats.reset()


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "io" in data
    assert data["io"]["enabled"] is False


def test_io_status_endpoint(client):
    res = client.get("/api/io/status")
    assert res.status_code == 200
    data = res.json()
    assert "enabled" in data
    assert "connected" in data
    assert "transport" in data
    assert "input_bits" in data
    assert "output_bits" in data
    assert "run_mode_enabled" in data
    assert len(data["input_bits"]) == 8
    assert len(data["output_bits"]) == 8


def test_io_run_mode_endpoint(client):
    res = client.post("/api/io/run-mode", json={"enabled": False})
    assert res.status_code == 200
    data = res.json()
    assert data["run_mode_enabled"] is False
    res2 = client.get("/api/io/status")
    assert res2.json()["run_mode_enabled"] is False
    res3 = client.post("/api/io/run-mode", json={"enabled": True})
    assert res3.json()["run_mode_enabled"] is True


def test_io_reconnect_when_disabled(client):
    res = client.post("/api/io/reconnect")
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is False


def test_io_test_output_when_disabled(client):
    res = client.post("/api/io/test/output", json={"channel": 0, "value": True})
    assert res.status_code == 400


def test_reload_services_disconnects_old_io(client):
    old_io = web_server.state.io
    called = []
    old_io.disconnect = lambda: called.append(True)
    web_server.state.reload_services()
    assert called == [True]
    assert web_server.state.io is not old_io


def test_trigger(client, sample_image):
    res = client.post("/api/trigger")
    assert res.status_code == 200
    data = res.json()
    assert data["type"] == "frame"
    assert "stats" in data
    assert "overall" in data
    assert "passed" in data["overall"]


def test_trigger_dual_tools_overall_passed(client, sample_image, tmp_path):
    cv2 = pytest.importorskip("cv2")
    img0 = tmp_path / "cam0.jpg"
    img1 = tmp_path / "cam1.jpg"
    frame0 = np.zeros((120, 120, 3), dtype=np.uint8)
    frame0[30:90, 30:90] = (0, 255, 0)
    frame1 = np.zeros((120, 120, 3), dtype=np.uint8)
    frame1[30:90, 30:90] = (0, 0, 255)
    cv2.imwrite(str(img0), frame0)
    cv2.imwrite(str(img1), frame1)

    cfg = web_server.state.config_store.get_cached()
    cfg.setdefault("calibration", {})["masters"] = {"0": str(img0), "1": str(img1)}
    cfg["tools"] = [
        {
            "id": "01",
            "cam": 0,
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 20, "y": 20, "w": 80, "h": 80},
            "params": {
                "h_lower": [35, 50, 50],
                "h_upper": [85, 255, 255],
                "match_area_min": 100,
                "match_area_max": 10000,
            },
        },
        {
            "id": "02",
            "cam": 1,
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 20, "y": 20, "w": 80, "h": 80},
            "params": {
                "h_lower": [0, 50, 50],
                "h_upper": [10, 255, 255],
                "match_area_min": 100,
                "match_area_max": 10000,
            },
        },
    ]
    cfg.setdefault("io", {})["comprehensive_logic"] = 1
    web_server.state.config_store.save(cfg)
    web_server.state.reload_services()

    # fallback_image drives both camera slots in test environment
    res = client.post("/api/trigger")
    assert res.status_code == 200
    data = res.json()
    assert data["overall"]["logic"] == 1
    assert isinstance(data["overall"]["passed"], bool)
    assert len(data.get("inspections") or []) == 2


def test_trigger_only_tool2_enabled_uses_cam1_preview(client, sample_image, tmp_path):
    cv2 = pytest.importorskip("cv2")
    img0 = tmp_path / "cam0.jpg"
    img1 = tmp_path / "cam1.jpg"
    frame0 = np.zeros((120, 120, 3), dtype=np.uint8)
    frame1 = np.zeros((120, 120, 3), dtype=np.uint8)
    frame1[30:90, 30:90] = (0, 0, 255)
    cv2.imwrite(str(img0), frame0)
    cv2.imwrite(str(img1), frame1)

    cfg = web_server.state.config_store.get_cached()
    cfg.setdefault("calibration", {})["masters"] = {"0": str(img0), "1": str(img1)}
    cfg["tools"] = [
        {
            "id": "01",
            "cam": 0,
            "type": "hsv_roi",
            "enabled": False,
            "roi": {"shape": "rect", "x": 20, "y": 20, "w": 80, "h": 80},
            "params": {
                "h_lower": [35, 50, 50],
                "h_upper": [85, 255, 255],
                "match_area_min": 100,
                "match_area_max": 10000,
            },
        },
        {
            "id": "02",
            "cam": 1,
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 20, "y": 20, "w": 80, "h": 80},
            "params": {
                "h_lower": [0, 50, 50],
                "h_upper": [10, 255, 255],
                "match_area_min": 100,
                "match_area_max": 10000,
            },
        },
    ]
    web_server.state.config_store.save(cfg)
    web_server.state.reload_services()

    res = client.post("/api/trigger")
    assert res.status_code == 200
    data = res.json()
    inspections = data.get("inspections") or []
    assert [i["tool"] for i in inspections] == ["02"]
    assert data.get("preview_cam") == 1
    rois = data.get("tool_rois") or []
    assert len(rois) == 1
    assert rois[0]["id"] == "02"
    assert rois[0]["cam"] == 1


def test_tool_image_skips_disabled_tool(client, sample_image):
    cfg = web_server.state.config_store.get_cached()
    cfg["tools"] = [
        {
            "id": "01",
            "cam": 0,
            "type": "hsv_roi",
            "enabled": False,
            "roi": {"shape": "rect", "x": 10, "y": 10, "w": 50, "h": 40},
            "params": {"h_lower": [0, 0, 0], "h_upper": [180, 255, 255]},
        },
        {
            "id": "02",
            "cam": 1,
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 5, "y": 5, "w": 30, "h": 25},
            "params": {"h_lower": [0, 0, 0], "h_upper": [180, 255, 255]},
        },
    ]
    web_server.state.config_store.save(cfg)
    web_server.state.reload_services()

    res_disabled = client.get("/api/tools/image?tool=01")
    assert res_disabled.status_code == 404

    res_enabled = client.get("/api/tools/image?tool=02")
    assert res_enabled.status_code == 200
    data = res_enabled.json()
    assert data["tool"] == "02"
    assert data["cam"] == 1


def test_stats_reset(client):
    res = client.post("/api/stats/reset")
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_cameras_reconnect_updates_config(client):
    res = client.post("/api/cameras/reconnect", json={"cameras": [0, 1]})
    assert res.status_code == 200
    data = res.json()
    assert "cameras" in data
    assert len(data["cameras"]) == 2
    assert data["available_cameras"] == [0, 1]

    cfg = web_server.state.config_store.get_cached()
    assert cfg["input"]["cameras"] == [0, 1]


def test_camera_options(client):
    cfg = web_server.state.config_store.get_cached()
    cfg.setdefault("input", {})["cameras"] = [0, 1, 2]
    cfg["input"]["camera_id"] = 1
    web_server.state.config_store.save(cfg)

    res = client.get("/api/camera/options")
    assert res.status_code == 200
    data = res.json()
    assert data["cameras"] == [0, 1, 2]
    assert data["camera_id"] == 1
    assert "connected" in data


def test_camera_select_updates_config(client):
    cfg = web_server.state.config_store.get_cached()
    before = int(cfg.get("input", {}).get("camera_id", 0))

    res = client.post("/api/camera/select", json={"camera_id": 2})
    assert res.status_code == 200
    data = res.json()
    # CI/无相机环境下可能无法真正连接，但配置仍需更新
    assert "ok" in data
    assert data["camera_id"] == 2

    cfg = web_server.state.config_store.get_cached()
    assert int(cfg.get("input", {}).get("camera_id", 0)) == 2
    assert 2 in cfg.get("input", {}).get("cameras", [])

    client.post("/api/camera/select", json={"camera_id": before})


def test_cameras_reconnect_variable_length(client):
    res = client.post("/api/cameras/reconnect", json={"cameras": [0, 2]})
    assert res.status_code == 200
    data = res.json()
    # 无设备时 ok 可能为 False，但返回结构与配置更新必须正确
    assert "ok" in data
    assert data["available_cameras"] == [0, 2]

    cfg = web_server.state.config_store.get_cached()
    assert cfg["input"]["cameras"] == [0, 2]


def test_tool_image_returns_roi_crop(client, sample_image):
    cfg = web_server.state.config_store.get_cached()
    cfg["tools"] = [
        {
            "id": "01",
            "cam": 0,
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 10, "y": 10, "w": 50, "h": 40},
            "params": {"h_lower": [0, 0, 0], "h_upper": [180, 255, 255]},
        }
    ]
    web_server.state.config_store.save(cfg)
    web_server.state.reload_services()

    res = client.get("/api/tools/image?tool=01")
    assert res.status_code == 200
    data = res.json()
    assert data["tool"] == "01"
    assert data["cam"] == 0
    assert data["width"] == 50
    assert data["height"] == 40
    assert data["image_base64"]


def test_config_switch(client, tmp_path):
    config_dir = tmp_path / "config"
    config_dir.mkdir(exist_ok=True)
    (config_dir / "config.yaml").write_text("trigger:\n  source: external\n", encoding="utf-8")
    (config_dir / "other.yaml").write_text("trigger:\n  source: internal\n", encoding="utf-8")
    web_server.state.config_store.config_dir = config_dir
    web_server.state.config_store._active = "config.yaml"
    web_server.state.config_store._cache = None

    res = client.post("/api/config/switch", json={"name": "other.yaml"})
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["active"] == "other.yaml"
    assert web_server.state.config_store.get_cached()["trigger"]["source"] == "internal"


def test_wizard_step4_get_output_history(client):
    cfg = web_server.state.config_store.get_cached()
    cfg.setdefault("output", {})["history"] = {
        "enabled": True,
        "format": "csv",
        "dir": "output/history/",
        "flush_on_profile_switch": True,
        "flush_on_idle_minutes": 50,
    }
    cfg["output"]["save_policy"] = "ok"
    web_server.state.config_store.save(cfg)

    res = client.get("/api/wizard/step/4")
    assert res.status_code == 200
    data = res.json()
    assert data["output"]["save_policy"] == "ok"
    assert data["output"]["history"]["enabled"] is True


def test_history_buffered_and_flushed_on_profile_switch(client, tmp_path):
    import csv

    cv2 = pytest.importorskip("cv2")
    frame = np.zeros((120, 120, 3), dtype=np.uint8)
    frame[30:90, 30:90] = (0, 255, 0)

    config_dir = tmp_path / "config"
    config_dir.mkdir(exist_ok=True)
    (config_dir / "config.yaml").write_text("trigger:\n  source: external\n", encoding="utf-8")
    (config_dir / "other.yaml").write_text("trigger:\n  source: internal\n", encoding="utf-8")
    web_server.state.config_store.config_dir = config_dir
    web_server.state.config_store._active = "config.yaml"
    web_server.state.config_store._cache = None

    img = tmp_path / "master.jpg"
    cv2.imwrite(str(img), frame)
    cfg = web_server.state.config_store.get_cached()
    cfg.setdefault("calibration", {})["masters"] = {"0": str(img)}
    cfg["tools"] = [
        {
            "id": "01",
            "cam": 0,
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 20, "y": 20, "w": 80, "h": 80},
            "params": {
                "h_lower": [35, 50, 50],
                "h_upper": [85, 255, 255],
                "match_area_min": 100,
                "match_area_max": 10000,
            },
        },
    ]
    cfg.setdefault("output", {})["history"] = {
        "enabled": True,
        "dir": "output/history/",
        "flush_on_profile_switch": True,
        "flush_on_idle_minutes": 0,
    }
    web_server.state.config_store.save(cfg)
    web_server.state.reload_services()

    payload = web_server.state.run_detection({0: frame})
    assert payload.get("overall", {}).get("passed") is not None
    assert web_server.state.history.pending_count() == 1

    switch = client.post("/api/config/switch", json={"name": "other.yaml"})
    assert switch.status_code == 200
    assert web_server.state.history.pending_count() == 0

    hist_dir = tmp_path / "output" / "history"
    files = list(hist_dir.glob("*/inspection.csv"))
    assert len(files) == 1
    with files[0].open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 1
    assert rows[0]["profile"] == "config.yaml"


def test_continuous_trigger_skips_archive(client, tmp_path, monkeypatch):
    cv2 = pytest.importorskip("cv2")
    frame = np.zeros((120, 120, 3), dtype=np.uint8)
    frame[30:90, 30:90] = (0, 255, 0)
    img = tmp_path / "master.jpg"
    cv2.imwrite(str(img), frame)

    cfg = web_server.state.config_store.get_cached()
    cfg.setdefault("calibration", {})["masters"] = {"0": str(img)}
    cfg["tools"] = [
        {
            "id": "01",
            "cam": 0,
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 20, "y": 20, "w": 80, "h": 80},
            "params": {
                "h_lower": [35, 50, 50],
                "h_upper": [85, 255, 255],
                "match_area_min": 100,
                "match_area_max": 10000,
            },
        },
    ]
    cfg.setdefault("output", {})["save_policy"] = "all"
    cfg["output"]["history"] = {
        "enabled": True,
        "dir": "output/history/",
        "flush_on_profile_switch": False,
        "flush_on_idle_minutes": 0,
    }
    web_server.state.config_store.save(cfg)
    web_server.state.reload_services()

    saved_images: list = []
    monkeypatch.setattr(
        web_server,
        "maybe_save_result",
        lambda cfg, passed, image: saved_images.append(passed) or "saved",
    )

    web_server.state.run_detection({0: frame}, skip_archive=True)
    assert web_server.state.history.pending_count() == 0
    assert saved_images == []

    web_server.state.run_detection({0: frame}, skip_archive=False)
    assert web_server.state.history.pending_count() == 1
    assert saved_images == [True]


def test_trigger_continuous_body_skips_history(client, tmp_path, monkeypatch):
    cv2 = pytest.importorskip("cv2")
    frame = np.zeros((120, 120, 3), dtype=np.uint8)
    frame[30:90, 30:90] = (0, 255, 0)
    img = tmp_path / "master.jpg"
    cv2.imwrite(str(img), frame)

    cfg = web_server.state.config_store.get_cached()
    cfg.setdefault("calibration", {})["masters"] = {"0": str(img)}
    cfg["tools"] = [
        {
            "id": "01",
            "cam": 0,
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 20, "y": 20, "w": 80, "h": 80},
            "params": {
                "h_lower": [35, 50, 50],
                "h_upper": [85, 255, 255],
                "match_area_min": 100,
                "match_area_max": 10000,
            },
        },
    ]
    cfg.setdefault("output", {})["history"] = {"enabled": True, "dir": "output/history/"}
    web_server.state.config_store.save(cfg)
    web_server.state.reload_services()

    monkeypatch.setattr(web_server.state.camera, "capture_all_for_trigger", lambda slots: {0: frame})

    res = client.post("/api/trigger", json={"continuous": True})
    assert res.status_code == 200
    assert web_server.state.history.pending_count() == 0

    res2 = client.post("/api/trigger")
    assert res2.status_code == 200
    assert web_server.state.history.pending_count() == 1


def test_config_create(client):
    res = client.post("/api/config/create", json={"name": "prog_001.yaml"})
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["name"] == "prog_001.yaml"
    assert (web_server.state.config_store.config_dir / "prog_001.yaml").exists()


def test_config_copy(client):
    res = client.post("/api/config/copy", json={"from": "config.yaml", "name": "prog_copy.yaml"})
    assert res.status_code == 200
    assert res.json()["name"] == "prog_copy.yaml"
    assert (web_server.state.config_store.config_dir / "prog_copy.yaml").exists()


def test_config_rename(client):
    client.post("/api/config/create", json={"name": "prog_rename.yaml"})
    res = client.post(
        "/api/config/rename",
        json={"from": "prog_rename.yaml", "to": "prog_renamed.yaml"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["to"] == "prog_renamed.yaml"
    assert not (web_server.state.config_store.config_dir / "prog_rename.yaml").exists()


def test_config_delete(client):
    client.post("/api/config/create", json={"name": "prog_delete.yaml"})
    res = client.post("/api/config/delete", json={"name": "prog_delete.yaml"})
    assert res.status_code == 200
    assert not (web_server.state.config_store.config_dir / "prog_delete.yaml").exists()


def test_config_delete_active_rejected(client):
    res = client.post("/api/config/delete", json={"name": "config.yaml"})
    assert res.status_code == 409


def test_cameras_enumerate(client, monkeypatch):
    sample = [
        {
            "device_id": 0,
            "model": "Test Cam",
            "backend": "MOCK",
            "width": 640,
            "height": 480,
            "accessible": True,
        }
    ]
    monkeypatch.setattr(web_server, "enumerate_camera_devices", lambda **_: sample)

    res = client.get("/api/cameras/enumerate")
    assert res.status_code == 200
    data = res.json()
    assert data["count"] == 1
    assert data["devices"][0]["device_id"] == 0
    assert data["devices"][0]["model"] == "Test Cam"


def test_camera_snapshot_without_active_tools(client, sample_image):
    """STEP1 硬件测试：无启用工具时仍可按设备号抓拍。"""
    cfg = web_server.state.config_store.get_cached()
    cfg["tools"] = [
        {"id": "01", "enabled": False, "type": "hsv_roi", "cam": 0},
        {"id": "02", "enabled": False, "type": "hsv_roi", "cam": 1},
    ]
    web_server.state.config_store.save(cfg)
    web_server.state.reload_services()

    res = client.get("/api/cameras/snapshot?device_id=0")
    assert res.status_code == 200
    data = res.json()
    assert data["device_id"] == 0
    assert data["image_base64"]
    assert data["width"] > 0
    assert data["height"] > 0

    current = client.get("/api/frame/current").json()
    assert current.get("no_tools") is True


def test_save_current_frame(client, sample_image, tmp_path, monkeypatch):
    cv2 = pytest.importorskip("cv2")
    capture_dir = tmp_path / "output" / "captures"
    cfg = web_server.state.config_store.get_cached()
    cfg.setdefault("output", {})["capture_dir"] = str(capture_dir)
    web_server.state.config_store.save(cfg)

    trigger = client.post("/api/trigger")
    assert trigger.status_code == 200
    frame_b64 = trigger.json()["frame"]["image_base64"]
    assert frame_b64

    opened = []
    monkeypatch.setattr(
        "src.frame_codec.open_dir_in_file_manager",
        lambda p: opened.append(str(p)),
    )

    res = client.post("/api/frame/save", json={"image_base64": frame_b64})
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["filename"].startswith("capture_")
    saved = Path(data["path"])
    assert saved.is_file()
    assert len(saved.parent.name) == 8 and saved.parent.name.isdigit()
    assert str(saved.parent).replace("\\", "/") == data["dir"]
    img = cv2.imread(str(saved))
    assert img is not None
    assert opened


def test_save_current_frame_requires_image(client):
    res = client.post("/api/frame/save", json={})
    assert res.status_code == 400


def test_camera_snapshot_with_empty_tools_list(client, sample_image):
    """STEP1 硬件测试：STEP3 未配置任何工具（tools=[]）时仍可抓拍。"""
    cfg = web_server.state.config_store.get_cached()
    cfg["tools"] = []
    web_server.state.config_store.save(cfg)
    web_server.state.reload_services()

    res = client.get("/api/cameras/snapshot?device_id=0")
    assert res.status_code == 200
    data = res.json()
    assert data["device_id"] == 0
    assert data["image_base64"]
