"""主控图像按程序分目录存档测试。"""

from __future__ import annotations

import numpy as np
import pytest

from src.calibration import CalibrationService
from src.config_store import ConfigStore


@pytest.fixture
def cal_env(tmp_path):
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "config.yaml").write_text("calibration: {}\n", encoding="utf-8")
    (config_dir / "prog_a.yaml").write_text("calibration: {}\n", encoding="utf-8")
    store = ConfigStore(str(config_dir))
    store.load()
    cal = CalibrationService(store, str(tmp_path))
    return tmp_path, store, cal


def test_master_saved_per_profile(cal_env):
    tmp_path, store, cal = cal_env
    img = np.zeros((80, 100, 3), dtype=np.uint8)
    img[:, :] = (10, 20, 30)

    cal.register_master(img, slot=0, ui_only=True)
    path_a = cal.master_path(0)
    assert path_a
    assert (tmp_path / "data" / "masters" / "config" / "master_cam0.jpg").exists()

    store.switch("prog_a.yaml")
    cal.sync_master_dir()
    assert cal.master_path(0) is None

    img2 = np.zeros((60, 90, 3), dtype=np.uint8)
    img2[:, :] = (40, 50, 60)
    cal.register_master(img2, slot=1, ui_only=True)
    assert (tmp_path / "data" / "masters" / "prog_a" / "master_cam1.jpg").exists()

    store.switch("config.yaml")
    cal.sync_master_dir()
    assert cal.master_path(0) is not None
    assert cal.master_path(1) is None
