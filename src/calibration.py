"""标定：主控图像、参考点、追加学习。"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import numpy as np

from .detector import Detector
from .preprocessor import Preprocessor
from .utils import imread, imwrite


class CalibrationService:
    """管理 calibration 配置段与主控注册。"""

    def __init__(self, config_store, master_dir: str = "output/masters"):
        self.config_store = config_store
        self.master_dir = Path(master_dir)

    def add_sample(self) -> int:
        cfg = self.config_store.get_cached()
        cal = cfg.setdefault("calibration", {})
        cal["sample_count"] = int(cal.get("sample_count", 0)) + 1
        self.config_store.save(cfg)
        return cal["sample_count"]

    def register_master(self, image: np.ndarray, name: str = "master") -> dict:
        cfg = self.config_store.get_cached()
        cal = cfg.setdefault("calibration", {})

        self.master_dir.mkdir(parents=True, exist_ok=True)
        master_path = self.master_dir / f"{name}.jpg"
        imwrite(str(master_path), image)

        binary = Preprocessor(cfg).process(image)
        marks = Detector(cfg).detect(binary, image)
        if marks:
            primary = marks[0]
            cal["reference_center"] = list(primary.center)
            cal["reference_area"] = float(primary.area)
        else:
            h, w = image.shape[:2]
            cal["reference_center"] = [w // 2, h // 2]
            cal["reference_area"] = None

        cal["master_image"] = str(master_path).replace("\\", "/")
        cal["sample_count"] = int(cal.get("sample_count", 0)) + 1
        self.config_store.save(cfg)
        return cal

    def register_master_from_path(self, path: str) -> dict:
        img = imread(path)
        if img is None:
            raise ValueError(f"无法读取图像: {path}")
        return self.register_master(img, name=Path(path).stem)

    def load_master_image(self) -> Optional[np.ndarray]:
        cfg = self.config_store.get_cached()
        master = cfg.get("calibration", {}).get("master_image")
        if not master:
            return None
        return imread(master)

    def get_info(self) -> dict:
        return self.config_store.get_cached().get("calibration", {})
