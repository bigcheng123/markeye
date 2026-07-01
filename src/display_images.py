"""Web UI 三种显示模式：原图 / 处理叠加 / 二值化命中目标。"""

from __future__ import annotations

import cv2
import numpy as np

from .tools.roi_tools import hsv_hit_mask, run_roi_tools


def tools_rois_to_json(config: dict) -> list[dict]:
    """config.tools → 前端 ROI 叠加层数据。"""
    items: list[dict] = []
    for t in (config or {}).get("tools") or []:
        if not isinstance(t, dict):
            continue
        if t.get("enabled", True) is False:
            continue
        roi = t.get("roi")
        if not isinstance(roi, dict):
            continue
        try:
            cam = max(0, min(1, int(t.get("cam", 0))))
        except (TypeError, ValueError):
            cam = 0
        items.append(
            {
                "id": t.get("id") or t.get("name") or "tool",
                "name": t.get("name", ""),
                "cam": cam,
                "roi": roi,
            }
        )
    return items


def has_active_tools(config: dict) -> bool:
    """是否配置了启用的检测工具（有则不再使用旧版全局轮廓 marks）。"""
    for t in (config or {}).get("tools") or []:
        if isinstance(t, dict) and t.get("enabled", True) is not False:
            return True
    return False


def required_tool_cam_slots(config: dict) -> set[int]:
    """启用工具实际用到的相机槽位。"""
    slots: set[int] = set()
    for t in (config or {}).get("tools") or []:
        if not isinstance(t, dict):
            continue
        if t.get("enabled", True) is False:
            continue
        try:
            slots.add(max(0, min(1, int(t.get("cam", 0)))))
        except (TypeError, ValueError):
            slots.add(0)
    return slots or {0}


def first_enabled_tool_cam(config: dict, default: int = 0) -> int:
    """首个启用工具对应的相机槽位（0/1）。"""
    for t in (config or {}).get("tools") or []:
        if not isinstance(t, dict):
            continue
        if t.get("enabled", True) is False:
            continue
        try:
            return max(0, min(1, int(t.get("cam", default))))
        except (TypeError, ValueError):
            return default
    return max(0, min(1, int(default)))


def pick_primary_preview(
    images: np.ndarray | dict[int, np.ndarray] | None,
    config: dict,
) -> tuple[np.ndarray | None, int]:
    """按启用工具顺序选取主预览图及其相机槽位。"""
    if images is None:
        return None, first_enabled_tool_cam(config)

    if isinstance(images, dict):
        if has_active_tools(config):
            for t in (config or {}).get("tools") or []:
                if not isinstance(t, dict) or t.get("enabled", True) is False:
                    continue
                try:
                    slot = max(0, min(1, int(t.get("cam", 0))))
                except (TypeError, ValueError):
                    slot = 0
                frame = images.get(slot)
                if frame is not None:
                    return frame, slot
        primary = images.get(0)
        if primary is None:
            primary = next((f for f in images.values() if f is not None), None)
        slot = 0 if images.get(0) is primary else first_enabled_tool_cam(config)
        return primary, slot

    slot = first_enabled_tool_cam(config) if has_active_tools(config) else 0
    return images, slot


def _contour_hit_mask(img: np.ndarray, tool: dict, tool_result: dict | None) -> np.ndarray:
    h, w = img.shape[:2]
    canvas = np.zeros((h, w), dtype=np.uint8)
    det = None
    if tool_result and isinstance(tool_result.get("details"), dict):
        det = tool_result["details"].get("detected")
    if not det:
        results = run_roi_tools(img, {"tools": [tool]})
        if results:
            det = (results[0].get("details") or {}).get("detected")
    if not det or not det.get("bbox"):
        return canvas
    x, y, bw, bh = [int(v) for v in det["bbox"][:4]]
    x = max(0, min(w - 1, x))
    y = max(0, min(h - 1, y))
    bw = max(1, min(w - x, bw))
    bh = max(1, min(h - y, bh))
    canvas[y : y + bh, x : x + bw] = 255
    return canvas


def build_tool_binary_image(
    img: np.ndarray,
    config: dict,
    tool_results: list[dict] | None = None,
) -> np.ndarray:
    """黑底白前景：各工具 ROI 内命中的识别目标。"""
    if img is None or img.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)

    h, w = img.shape[:2]
    canvas = np.zeros((h, w), dtype=np.uint8)
    results_by_tool = {
        r.get("tool"): r for r in (tool_results or []) if isinstance(r, dict)
    }

    for t in (config or {}).get("tools") or []:
        if not isinstance(t, dict):
            continue
        if t.get("enabled", True) is False:
            continue
        key = t.get("id") or t.get("name") or "tool"
        tr = results_by_tool.get(key)
        cached = tr.get("_hit_mask") if tr else None
        if cached is not None and cached.shape[:2] == (h, w):
            canvas = cv2.bitwise_or(canvas, cached)
            continue
        t_type = t.get("type")
        if t_type == "hsv_roi":
            mask = hsv_hit_mask(img, t)
        elif t_type == "contour_roi":
            mask = _contour_hit_mask(img, t, tr)
        else:
            continue
        canvas = cv2.bitwise_or(canvas, mask)

    return canvas

