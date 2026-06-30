"""双相机配置：槽位 ↔ OpenCV 设备号、旧配置迁移。"""

from __future__ import annotations

NUM_CAMERA_SLOTS = 2


def _unique_sorted_ids(cameras: list) -> list[int]:
    out: list[int] = []
    seen: set[int] = set()
    for c in cameras:
        try:
            n = int(c)
        except (TypeError, ValueError):
            continue
        if n < 0 or n in seen:
            continue
        seen.add(n)
        out.append(n)
    return sorted(out)


def normalize_input_cameras(inp: dict) -> list[int]:
    """确保 input.cameras 为可切换设备号列表（至少 1 个）；camera_id 落在列表内。"""
    cameras = inp.get("cameras")
    if isinstance(cameras, list) and len(cameras) >= 1:
        out = _unique_sorted_ids(cameras)
        if not out:
            out = [0]
    else:
        primary = int(inp.get("camera_id", 0))
        secondary = 1 if primary != 1 else 0
        out = [primary, secondary]

    inp["cameras"] = out
    cam_id = int(inp.get("camera_id", out[0]))
    if cam_id not in out:
        cam_id = out[0]
    inp["camera_id"] = cam_id
    return out


def available_camera_ids(cfg: dict) -> list[int]:
    """STEP1 / 工具栏：可切换的 OpenCV 设备号列表。"""
    inp = (cfg or {}).get("input", {})
    cameras = inp.get("cameras")
    if isinstance(cameras, list) and len(cameras) >= 1:
        out = _unique_sorted_ids(cameras)
        if out:
            return out
    return normalize_input_cameras(inp.copy() if inp else {"camera_id": 0})


def normalize_calibration_masters(cal: dict) -> dict:
    """确保 calibration.masters 含槽位 0/1 路径映射。"""
    masters = cal.get("masters")
    if not isinstance(masters, dict):
        masters = {}
    legacy = cal.get("master_image")
    if legacy and "0" not in masters:
        masters["0"] = legacy
    cal["masters"] = masters
    if masters.get("0"):
        cal["master_image"] = masters["0"]
    return masters


def normalize_config(cfg: dict) -> dict:
    """迁移单相机配置为双槽位结构（原地修改并返回）。"""
    inp = cfg.setdefault("input", {})
    normalize_input_cameras(inp)
    cal = cfg.setdefault("calibration", {})
    normalize_calibration_masters(cal)
    for tool in cfg.get("tools") or []:
        if isinstance(tool, dict) and "cam" not in tool:
            tool["cam"] = 0
    return cfg


def slot_device_ids(cfg: dict) -> list[int]:
    """双路硬件槽位对应的 OpenCV 设备号（取可切换列表前 NUM_CAMERA_SLOTS 个）。"""
    full = available_camera_ids(cfg)
    slots: list[int] = []
    for i in range(NUM_CAMERA_SLOTS):
        if i < len(full):
            slots.append(full[i])
        elif full:
            slots.append(full[0])
        else:
            slots.append(i)
    return slots


def camera_id_to_cam_slot(cfg: dict) -> int:
    """将 input.camera_id（设备号）映射为 tool.cam 槽位索引（0/1）。"""
    inp = (cfg or {}).get("input", {})
    camera_id = int(inp.get("camera_id", 0))
    devices = slot_device_ids(cfg)
    for i, dev in enumerate(devices[:NUM_CAMERA_SLOTS]):
        if int(dev) == camera_id:
            return i
    cameras = available_camera_ids(cfg)
    try:
        return max(0, min(NUM_CAMERA_SLOTS - 1, cameras.index(camera_id)))
    except ValueError:
        return 0
