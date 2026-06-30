"""标定：主控图像、参考点、追加学习。"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import numpy as np

from .camera_config import NUM_CAMERA_SLOTS
from .detector import Detector
from .preprocessor import Preprocessor
from .utils import imread, imwrite


class CalibrationService:
    """管理 calibration 配置段与主控注册（支持分槽位 CAM#0 / CAM#1）。"""

    def __init__(self, config_store, master_dir: str = "output/masters"):
        self.config_store = config_store
        self.master_dir = Path(master_dir)

    def add_sample(self) -> int:
        cfg = self.config_store.get_cached()
        cal = cfg.setdefault("calibration", {})
        cal["sample_count"] = int(cal.get("sample_count", 0)) + 1
        self.config_store.save(cfg)
        return cal["sample_count"]

    def register_master(self, image: np.ndarray, slot: int = 0, name: Optional[str] = None) -> dict:
        slot = max(0, min(NUM_CAMERA_SLOTS - 1, int(slot)))
        cfg = self.config_store.get_cached()
        cal = cfg.setdefault("calibration", {})
        masters = cal.setdefault("masters", {})

        self.master_dir.mkdir(parents=True, exist_ok=True)
        file_name = name or f"master_cam{slot}"
        master_path = self.master_dir / f"{file_name}.jpg"
        imwrite(str(master_path), image)

        binary = Preprocessor(cfg).process(image)
        marks = Detector(cfg).detect(binary, image)
        if marks and slot == 0:
            primary = marks[0]
            cal["reference_center"] = list(primary.center)
            cal["reference_area"] = float(primary.area)
        elif slot == 0 and not marks:
            h, w = image.shape[:2]
            cal["reference_center"] = [w // 2, h // 2]
            cal["reference_area"] = None

        path_str = str(master_path).replace("\\", "/")
        masters[str(slot)] = path_str
        if slot == 0:
            cal["master_image"] = path_str
        cal["sample_count"] = int(cal.get("sample_count", 0)) + 1
        self.config_store.save(cfg)
        return cal

    def register_master_from_path(self, path: str, slot: int = 0) -> dict:
        img = imread(path)
        if img is None:
            raise ValueError(f"无法读取图像: {path}")
        return self.register_master(img, slot=slot, name=Path(path).stem)

    def master_path(self, slot: int = 0) -> Optional[str]:
        cfg = self.config_store.get_cached()
        cal = cfg.get("calibration", {})
        masters = cal.get("masters") or {}
        path = masters.get(str(slot)) or (cal.get("master_image") if slot == 0 else None)
        return path or None

    def load_master_image(self, slot: int = 0) -> Optional[np.ndarray]:
        path = self.master_path(slot)
        if not path:
            return None
        return imread(path)

    def get_info(self) -> dict:
        return self.config_store.get_cached().get("calibration", {})
