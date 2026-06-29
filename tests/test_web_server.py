"""Web API 集成测试"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src.web_server import app, state


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def sample_image(tmp_path):
    cv2 = pytest.importorskip("cv2")
    img_path = tmp_path / "sample.jpg"
    img = np.zeros((120, 120, 3), dtype=np.uint8)
    cv2.rectangle(img, (30, 30), (90, 90), (0, 0, 255), -1)
    cv2.imwrite(str(img_path), img)
    cfg = state.config_store.get_cached()
    cfg.setdefault("input", {})["fallback_image"] = str(img_path)
    state.config_store.save(cfg)
    state.reload_services()
    yield img_path
    state.stats.reset()


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


def test_stats_reset(client):
    res = client.post("/api/stats/reset")
    assert res.status_code == 200
    assert res.json()["ok"] is True
