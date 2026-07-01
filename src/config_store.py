"""YAML 配置读写与多程序管理。"""

from __future__ import annotations

import copy
import re
import shutil
from pathlib import Path
from typing import Optional

import yaml

from .camera_config import normalize_config
from .io.assignments import normalize_io_assignments


def _validate_wizard_step3(cfg: dict) -> None:
    """STEP3 工具校验：启用工具所用 CAM# 必须存在主控图像路径。"""
    cal = cfg.get("calibration") or {}
    masters = cal.get("masters") or {}
    master_image = cal.get("master_image")

    def _has_master(slot: int) -> bool:
        if str(slot) in masters:
            return True
        # 兼容旧字段：master_image 仅对应 CAM#0
        return slot == 0 and bool(master_image)

    for t in cfg.get("tools") or []:
        if not isinstance(t, dict):
            continue
        if t.get("enabled") is False:
            continue
        try:
            slot = int(t.get("cam", 0))
        except (TypeError, ValueError):
            slot = 0
        if not _has_master(slot):
            raise ValueError(f"缺少 CAM#{slot} 主控图像")


_PROFILE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+\.yaml$")
_MASTERS_BASE = Path("data/masters")


def _validate_profile_name(name: str) -> str:
    if not name or not _PROFILE_NAME_RE.match(name):
        raise ValueError(f"无效配方文件名: {name}（仅允许字母、数字、下划线、连字符，且以 .yaml 结尾）")
    return name


def _resolve_config_path(path_str: str, project_root: Path) -> Optional[Path]:
    p = Path(path_str)
    if not p.is_absolute():
        p = project_root / p
    return p if p.is_file() else None


def _collect_master_sources(cfg: dict, project_root: Path) -> dict[int, Path]:
    """从配置中收集各槽位主控图像源路径。"""
    cal = cfg.get("calibration") or {}
    masters = cal.get("masters") or {}
    found: dict[int, Path] = {}
    for key, path_str in masters.items():
        try:
            slot = int(key)
        except (TypeError, ValueError):
            continue
        resolved = _resolve_config_path(str(path_str), project_root)
        if resolved:
            found[slot] = resolved
    master_image = cal.get("master_image")
    if master_image and 0 not in found:
        resolved = _resolve_config_path(str(master_image), project_root)
        if resolved:
            found[0] = resolved
    return found


def _masters_dir_for_stem(project_root: Path, stem: str) -> Path:
    return project_root / _MASTERS_BASE / stem


def _rewrite_calibration_paths(cfg: dict, project_root: Path, stem: str) -> dict:
    """将 calibration 内主控路径统一为 data/masters/<stem>/master_camN.jpg。"""
    cfg = copy.deepcopy(cfg)
    cal = cfg.setdefault("calibration", {})
    master_dir = _masters_dir_for_stem(project_root, stem)
    masters: dict[str, str] = {}
    for slot in sorted(_collect_master_sources(cfg, project_root).keys()):
        rel = (master_dir / f"master_cam{slot}.jpg").relative_to(project_root)
        masters[str(slot)] = str(rel).replace("\\", "/")
    if masters:
        cal["masters"] = masters
        if "0" in masters:
            cal["master_image"] = masters["0"]
    return cfg


def _copy_masters_for_profile(
    cfg: dict,
    project_root: Path,
    source_stem: str,
    target_stem: str,
) -> None:
    """复制主控图像到目标配方目录，优先使用配置内路径，其次 data/masters/<source_stem>/。"""
    target_dir = _masters_dir_for_stem(project_root, target_stem)
    target_dir.mkdir(parents=True, exist_ok=True)
    sources = _collect_master_sources(cfg, project_root)
    source_dir = _masters_dir_for_stem(project_root, source_stem)
    if source_dir.is_dir():
        for img in source_dir.glob("*.jpg"):
            slot_match = re.search(r"master_cam(\d+)", img.stem)
            if slot_match:
                slot = int(slot_match.group(1))
                if slot not in sources:
                    sources[slot] = img
        for img in source_dir.glob("*.png"):
            slot_match = re.search(r"master_cam(\d+)", img.stem)
            if slot_match:
                slot = int(slot_match.group(1))
                if slot not in sources:
                    sources[slot] = img
    for slot, src in sources.items():
        dest = target_dir / f"master_cam{slot}.jpg"
        if src.suffix.lower() in (".png", ".jpeg", ".jpg"):
            shutil.copy2(src, dest)
        else:
            shutil.copy2(src, dest)


def _load_profile_file(config_dir: Path, name: str) -> dict:
    path = config_dir / name
    if not path.exists():
        raise FileNotFoundError(f"配置不存在: {name}")
    with open(path, "r", encoding="utf-8") as f:
        return normalize_config(yaml.safe_load(f) or {})


def _save_profile_file(config_dir: Path, name: str, data: dict) -> dict:
    path = config_dir / name
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized = normalize_config(data)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(normalized, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    return normalized


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
            io = normalize_io_assignments(cfg.get("io", {}))
            return {"io": io, "output": cfg.get("output", {})}
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
        if step == 4:
            cfg["io"] = normalize_io_assignments(cfg.get("io", {}))
        self.save(cfg)
        return cfg

    def create_from_default(self, name: str, project_root: Path) -> dict:
        """从 default_name 复制为新配方，并复制主控图像。"""
        name = _validate_profile_name(name)
        if name == self.default_name:
            raise ValueError(f"不能使用保留名: {name}")
        dest = self.config_dir / name
        if dest.exists():
            raise FileExistsError(f"配方已存在: {name}")
        default_path = self.config_dir / self.default_name
        if not default_path.exists():
            raise FileNotFoundError(f"默认配置不存在: {self.default_name}")
        cfg = _load_profile_file(self.config_dir, self.default_name)
        source_stem = Path(self.default_name).stem
        target_stem = Path(name).stem
        _copy_masters_for_profile(cfg, project_root, source_stem, target_stem)
        cfg = _rewrite_calibration_paths(cfg, project_root, target_stem)
        return _save_profile_file(self.config_dir, name, cfg)

    def copy_profile(self, from_name: str, to_name: str, project_root: Path) -> dict:
        from_name = _validate_profile_name(from_name)
        to_name = _validate_profile_name(to_name)
        if (self.config_dir / to_name).exists():
            raise FileExistsError(f"配方已存在: {to_name}")
        cfg = _load_profile_file(self.config_dir, from_name)
        source_stem = Path(from_name).stem
        target_stem = Path(to_name).stem
        _copy_masters_for_profile(cfg, project_root, source_stem, target_stem)
        cfg = _rewrite_calibration_paths(cfg, project_root, target_stem)
        return _save_profile_file(self.config_dir, to_name, cfg)

    def rename_profile(self, from_name: str, to_name: str, project_root: Path) -> dict:
        from_name = _validate_profile_name(from_name)
        to_name = _validate_profile_name(to_name)
        if from_name == self.default_name:
            raise ValueError(f"不能重命名默认配方: {from_name}")
        src_path = self.config_dir / from_name
        if not src_path.exists():
            raise FileNotFoundError(f"配置不存在: {from_name}")
        dest_path = self.config_dir / to_name
        if dest_path.exists():
            raise FileExistsError(f"配方已存在: {to_name}")
        source_stem = Path(from_name).stem
        target_stem = Path(to_name).stem
        cfg = _load_profile_file(self.config_dir, from_name)
        old_master_dir = _masters_dir_for_stem(project_root, source_stem)
        new_master_dir = _masters_dir_for_stem(project_root, target_stem)
        if old_master_dir.is_dir():
            new_master_dir.parent.mkdir(parents=True, exist_ok=True)
            if new_master_dir.exists():
                shutil.rmtree(new_master_dir)
            old_master_dir.rename(new_master_dir)
        else:
            new_master_dir.mkdir(parents=True, exist_ok=True)
        cfg = _rewrite_calibration_paths(cfg, project_root, target_stem)
        _save_profile_file(self.config_dir, to_name, cfg)
        src_path.unlink()
        was_active = self._active == from_name
        if was_active:
            self._active = to_name
            self._cache = cfg
        return cfg

    def delete_profile(self, name: str, project_root: Path) -> None:
        name = _validate_profile_name(name)
        if name == self.default_name:
            raise ValueError(f"不能删除默认配方: {name}")
        if name == self._active:
            raise ValueError(f"不能删除当前活动配方: {name}")
        profiles = self.list_profiles()
        if len(profiles) <= 1:
            raise ValueError("不能删除最后一个配方")
        path = self.config_dir / name
        if not path.exists():
            raise FileNotFoundError(f"配置不存在: {name}")
        path.unlink()
        master_dir = _masters_dir_for_stem(project_root, Path(name).stem)
        if master_dir.is_dir():
            shutil.rmtree(master_dir)
        if self._cache is not None and self._active == name:
            self._cache = None
