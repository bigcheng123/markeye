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
    """管理 calibration 配置段与主控注册（支持分槽位 CAM#0 / CAM#1，按程序分目录存档）。"""

    def __init__(
        self,
        config_store,
        project_root: str,
        masters_base: str = "data/masters",
    ):
        self.config_store = config_store
        self.project_root = Path(project_root)
        self.masters_base = Path(masters_base)
        self.master_dir = self.project_root / self.masters_base / "default"
        self.sync_master_dir()

    def profile_stem(self) -> str:
        return Path(self.config_store._active).stem

    def sync_master_dir(self) -> Path:
        """按当前活动程序切换主控图像目录：data/masters/<程序名>/"""
        self.master_dir = self.project_root / self.masters_base / self.profile_stem()
        self.master_dir.mkdir(parents=True, exist_ok=True)
        return self.master_dir

    def _resolve_path(self, path_str: str) -> Optional[Path]:
        p = Path(path_str)
        if not p.is_absolute():
            p = self.project_root / p
        return p if p.exists() else None

    def _rel_path(self, path: Path) -> str:
        try:
            return str(path.relative_to(self.project_root)).replace("\\", "/")
        except ValueError:
            return str(path).replace("\\", "/")

    def add_sample(self) -> int:
        cfg = self.config_store.get_cached()
        cal = cfg.setdefault("calibration", {})
        cal["sample_count"] = int(cal.get("sample_count", 0)) + 1
        self.config_store.save(cfg)
        return cal["sample_count"]

    def register_master(
        self,
        image: np.ndarray,
        slot: int = 0,
        name: Optional[str] = None,
        *,
        ui_only: bool = False,
    ) -> dict:
        slot = max(0, min(NUM_CAMERA_SLOTS - 1, int(slot)))
        self.sync_master_dir()
        cfg = self.config_store.get_cached()
        cal = cfg.setdefault("calibration", {})
        masters = cal.setdefault("masters", {})

        file_name = name or f"master_cam{slot}"
        master_path = self.master_dir / f"{file_name}.jpg"
        imwrite(str(master_path), image)

        if not ui_only:
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
            cal["sample_count"] = int(cal.get("sample_count", 0)) + 1

        path_str = self._rel_path(master_path)
        masters[str(slot)] = path_str
        if slot == 0:
            cal["master_image"] = path_str
        self.config_store.save(cfg)
        return cal

    def register_master_from_path(self, path: str, slot: int = 0, *, ui_only: bool = False) -> dict:
        img = imread(path)
        if img is None:
            raise ValueError(f"无法读取图像: {path}")
        return self.register_master(img, slot=slot, name=Path(path).stem, ui_only=ui_only)

    def master_path(self, slot: int = 0) -> Optional[str]:
        cfg = self.config_store.get_cached()
        cal = cfg.get("calibration", {})
        masters = cal.get("masters") or {}
        path = masters.get(str(slot)) or (cal.get("master_image") if slot == 0 else None)
        if not path:
            return None
        resolved = self._resolve_path(str(path))
        return str(resolved) if resolved else None

    def load_master_image(self, slot: int = 0) -> Optional[np.ndarray]:
        path = self.master_path(slot)
        if not path:
            return None
        return imread(path)

    def list_master_slots(self) -> dict[int, bool]:
        return {slot: self.master_path(slot) is not None for slot in range(NUM_CAMERA_SLOTS)}

    def get_info(self) -> dict:
        return self.config_store.get_cached().get("calibration", {})
