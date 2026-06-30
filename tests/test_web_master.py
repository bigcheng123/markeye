"""主控图像 API 测试。"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from src import web_server


@pytest.fixture
def client(tmp_path, monkeypatch):
  config_dir = tmp_path / "config"
  config_dir.mkdir()
  (config_dir / "config.yaml").write_text(
    "input:\n  camera_id: 0\ntrigger:\n  source: external\noutput:\n  jpeg_quality: 70\n",
    encoding="utf-8",
  )
  master_dir = tmp_path / "masters"
  master_dir.mkdir()
  monkeypatch.setattr(web_server, "ROOT", tmp_path)
  web_server.state = web_server.AppState()
  web_server.state.config_store.config_dir = config_dir
  web_server.state.calibration.master_dir = master_dir
  with TestClient(web_server.app) as c:
    yield c


def test_master_image_not_found(client):
  res = client.get("/api/calibration/master/image")
  assert res.status_code == 404


def test_master_image_after_register(client, monkeypatch):
  img = np.zeros((100, 120, 3), dtype=np.uint8)
  img[:, :] = (40, 80, 120)

  monkeypatch.setattr(
    web_server.state.camera,
    "capture_for_trigger",
    lambda **_: img.copy(),
  )

  reg = client.post("/api/calibration/master")
  assert reg.status_code == 200

  res = client.get("/api/calibration/master/image")
  assert res.status_code == 200
  data = res.json()
  assert data["width"] == 120
  assert data["height"] == 100
  assert data["image_base64"]
