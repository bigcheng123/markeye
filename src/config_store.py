"""YAML 配置读写与多程序管理。"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import yaml


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
            self._cache = yaml.safe_load(f) or {}
        return self._cache

    def save(self, data: dict) -> None:
        path = self.active_path
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
        self._cache = data

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
        self.save(cfg)
        return cfg
