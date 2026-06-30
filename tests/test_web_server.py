"""Web API 集成测试"""

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
    assert res.json()["status"] == "ok"


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
