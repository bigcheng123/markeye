"""WebSocket 帧编码与结果图保存。"""

from __future__ import annotations

import base64
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

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


def build_idle_frame(
    config: dict,
    stats: dict,
    preview_image: Optional[np.ndarray] = None,
    marks: Optional[list] = None,
) -> dict:
    cal = config.get("calibration", {})
    trigger = config.get("trigger", {})
    source = trigger.get("source", "internal")
    quality = int(config.get("output", {}).get("jpeg_quality", 70))
    frame_info: dict = {"width": 0, "height": 0, "process_ms": None, "image_base64": None}
    if preview_image is not None and preview_image.size > 0:
        h, w = preview_image.shape[:2]
        frame_info = {
            "width": w,
            "height": h,
            "process_ms": None,
            "image_base64": encode_image_b64(preview_image, quality),
        }
    return {
        "type": "frame",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "idle": True,
        "overall": {"passed": None},
        "frame": frame_info,
        "marks": marks_to_json(marks or []),
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
    display_image: np.ndarray,
) -> dict:
    cal = config.get("calibration", {})
    trigger = config.get("trigger", {})
    source = trigger.get("source", "internal")
    quality = int(config.get("output", {}).get("jpeg_quality", 70))
    h, w = display_image.shape[:2]
    inspections = build_inspections(pipeline_result, config)
    passed = bool(pipeline_result.passed and not pipeline_result.error)

    return {
        "type": "frame",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "overall": {"passed": passed},
        "frame": {
            "image_base64": encode_image_b64(display_image, quality),
            "width": w,
            "height": h,
            "process_ms": pipeline_result.process_ms,
        },
        "marks": marks_to_json(
            pipeline_result.marks,
            pipeline_result.inspections,
            passed,
        ),
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
