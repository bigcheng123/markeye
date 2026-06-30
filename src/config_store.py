"""YAML 配置读写与多程序管理。"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import yaml

from .camera_config import NUM_CAMERA_SLOTS, normalize_config


def _validate_wizard_step3(cfg: dict) -> None:
    """已启用工具所用的 CAM# 槽位须已注册主控图像。"""
    masters = (cfg.get("calibration") or {}).get("masters") or {}
    missing: list[str] = []
    for t in cfg.get("tools") or []:
        if not isinstance(t, dict) or t.get("enabled", True) is False:
            continue
        try:
            slot = max(0, min(NUM_CAMERA_SLOTS - 1, int(t.get("cam", 0))))
        except (TypeError, ValueError):
            slot = 0
        key = str(slot)
        path = masters.get(key) or masters.get(slot)
        if not path:
            tid = t.get("id") or t.get("name") or "?"
            missing.append(f"工具 {tid} 使用 CAM#{slot} 但未注册主控图像")
    if missing:
        raise ValueError("; ".join(missing))


class ConfigStore:
    """管理 config/*.yaml 配方文件。"""

    def __init__(self, config_dir: str = "config", default_name: str = "config.yaml"):
        self.config_dir = Path(config_dir)
        self.default_name = default_name
        self._active = default_name
        self._cache: Optional[dict] = None

    @property
    def active_path(self) -> Path:
        return self.config_dir / self._active

    def list_profiles(self) -> list[dict]:
        profiles = []
        if not self.config_dir.exists():
            return profiles
        for p in sorted(self.config_dir.glob("*.yaml")):
            profiles.append(
                {
                    "id": p.stem,
                    "name": p.name,
                    "path": str(p),
                    "active": p.name == self._active,
                }
            )
        return profiles

    def switch(self, name: str) -> dict:
        path = self.config_dir / name
        if not path.exists():
            raise FileNotFoundError(f"配置不存在: {name}")
        self._active = name
        self._cache = None
        return self.load()

    def load(self) -> dict:
        path = self.active_path
        if not path.exists():
            raise FileNotFoundError(f"配置不存在: {path}")
        with open(path, "r", encoding="utf-8") as f:
            self._cache = normalize_config(yaml.safe_load(f) or {})
        return self._cache

    def save(self, data: dict) -> None:
        path = self.active_path
        path.parent.mkdir(parents=True, exist_ok=True)
        normalized = normalize_config(data)
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(normalized, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
        self._cache = normalized

    def get_cached(self) -> dict:
        if self._cache is None:
            return self.load()
        return self._cache

    def get_wizard_step(self, step: int) -> dict:
        cfg = self.get_cached()
        if step == 1:
            return {
                "trigger": cfg.get("trigger", {}),
                "input": cfg.get("input", {}),
                "preprocess": {
                    k: cfg.get("preprocess", {}).get(k)
                    for k in ("resize_width", "resize_height")
                },
            }
        if step == 2:
            return {"calibration": cfg.get("calibration", {})}
        if step == 3:
            return {
                "tools": cfg.get("tools", []),
                "inspect": cfg.get("inspect", {}),
                "detector": cfg.get("detector", {}),
            }
        if step == 4:
            return {"io": cfg.get("io", {}), "output": cfg.get("output", {})}
        raise ValueError(f"无效向导步骤: {step}")

    def save_wizard_step(self, step: int, fragment: dict) -> dict:
        cfg = self.get_cached()
        for key, val in fragment.items():
            if isinstance(val, dict) and isinstance(cfg.get(key), dict):
                cfg[key] = {**cfg.get(key, {}), **val}
            else:
                cfg[key] = val
        if step == 3:
            _validate_wizard_step3(cfg)
        self.save(cfg)
        return cfg
