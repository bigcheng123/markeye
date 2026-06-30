"""WebSocket 帧编码与结果图保存。"""

from __future__ import annotations

import base64
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from .display_images import build_tool_binary_image, has_active_tools, tools_rois_to_json
from .tool_builder import build_inspections, marks_to_json


def encode_image_b64(img: np.ndarray, quality: int = 70) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        return ""
    return base64.b64encode(buf.tobytes()).decode("ascii")


def trigger_source_label(source: str) -> str:
    return {
        "internal": "内部触发",
        "external": "外部触发",
        "continuous": "连续采集",
    }.get(source, source)


def _frame_images(
    original: Optional[np.ndarray],
    config: dict,
    tool_results: Optional[list] = None,
    quality: int = 70,
) -> dict:
    """组装原图 + 二值化图字段。"""
    frame_info: dict = {
        "width": 0,
        "height": 0,
        "process_ms": None,
        "image_base64": None,
        "original_base64": None,
        "binary_base64": None,
    }
    if original is None or original.size == 0:
        return frame_info

    h, w = original.shape[:2]
    orig_b64 = encode_image_b64(original, quality)
    binary = build_tool_binary_image(original, config, tool_results)
    if len(binary.shape) == 2:
        binary = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
    binary_b64 = encode_image_b64(binary, quality)
    frame_info = {
        "width": w,
        "height": h,
        "process_ms": None,
        "image_base64": orig_b64,
        "original_base64": orig_b64,
        "binary_base64": binary_b64,
    }
    return frame_info


def _comprehensive_logic(config: dict) -> int:
    io_cfg = (config or {}).get("io") or {}
    try:
        return int(io_cfg.get("comprehensive_logic", 1))
    except (TypeError, ValueError):
        return 1


def build_idle_frame(
    config: dict,
    stats: dict,
    preview_image: Optional[np.ndarray] = None,
    marks: Optional[list] = None,
    tool_results: Optional[list] = None,
    preview_cam: int = 0,
) -> dict:
    cal = config.get("calibration", {})
    trigger = config.get("trigger", {})
    source = trigger.get("source", "internal")
    quality = int(config.get("output", {}).get("jpeg_quality", 70))
    frame_info = _frame_images(preview_image, config, tool_results, quality)
    marks_json = (
        []
        if has_active_tools(config)
        else marks_to_json(marks or [])
    )
    slot = max(0, min(1, int(preview_cam)))
    return {
        "type": "frame",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "idle": True,
        "overall": {"passed": None, "logic": _comprehensive_logic(config)},
        "preview_cam": slot,
        "frame": frame_info,
        "marks": marks_json,
        "tool_rois": tools_rois_to_json(config),
        "inspections": _idle_inspections(config),
        "stats": stats,
        "calibration": {"sample_count": cal.get("sample_count", 0)},
        "trigger": {"source": source, "label": trigger_source_label(source)},
    }


def _idle_inspections(config: dict) -> list[dict]:
    tools = (config or {}).get("tools") or []
    items: list[dict] = []
    for t in tools:
        if not isinstance(t, dict):
            continue
        if t.get("enabled", True) is False:
            continue
        key = t.get("id") or t.get("name") or "tool"
        items.append(
            {
                "tool": key,
                "name": t.get("name", key),
                "passed": None,
                "value": 0,
                "threshold": 100,
                "fail_reasons": [],
            }
        )
    return items


def build_result_frame(
    config: dict,
    stats: dict,
    pipeline_result,
    original_image: np.ndarray,
) -> dict:
    cal = config.get("calibration", {})
    trigger = config.get("trigger", {})
    source = trigger.get("source", "internal")
    quality = int(config.get("output", {}).get("jpeg_quality", 70))
    inspections = build_inspections(pipeline_result, config)
    passed = bool(pipeline_result.passed and not pipeline_result.error)
    frame_info = _frame_images(
        original_image,
        config,
        pipeline_result.tool_results,
        quality,
    )
    frame_info["process_ms"] = pipeline_result.process_ms

    marks_json = (
        []
        if has_active_tools(config)
        else marks_to_json(
            pipeline_result.marks,
            pipeline_result.inspections,
            passed,
        )
    )

    return {
        "type": "frame",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "overall": {"passed": passed, "logic": _comprehensive_logic(config)},
        "preview_cam": 0,
        "frame": frame_info,
        "marks": marks_json,
        "tool_rois": tools_rois_to_json(config),
        "inspections": inspections,
        "stats": stats,
        "calibration": {"sample_count": cal.get("sample_count", 0)},
        "trigger": {"source": source, "label": trigger_source_label(source)},
    }


def maybe_save_result(config: dict, passed: bool, image: np.ndarray) -> Optional[str]:
    output = config.get("output", {})
    policy = output.get("save_policy", "none")
    if policy == "none" and not output.get("save_result", False):
        return None
    if policy == "ok" and not passed:
        return None
    if policy == "ng" and passed:
        return None

    save_dir = Path(output.get("save_dir", "output"))
    save_dir.mkdir(parents=True, exist_ok=True)
    tag = "ok" if passed else "ng"
    name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{tag}.jpg"
    path = save_dir / name
    cv2.imwrite(str(path), image)
    return str(path)
