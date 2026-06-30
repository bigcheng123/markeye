from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import cv2
import numpy as np


@dataclass
class RoiCrop:
    img: np.ndarray
    mask: Optional[np.ndarray]
    offset_xy: tuple[int, int]


def _clamp_int(v: Any, lo: int, hi: int, default: int = 0) -> int:
    try:
        iv = int(v)
    except Exception:
        return default
    return max(lo, min(hi, iv))


def crop_roi(img: np.ndarray, roi: dict) -> RoiCrop:
    """按固定像素坐标裁剪 ROI。circle 会返回 mask。"""
    h, w = img.shape[:2]
    shape = (roi or {}).get("shape", "rect")

    if shape == "circle":
        cx = _clamp_int(roi.get("cx"), 0, w - 1, 0)
        cy = _clamp_int(roi.get("cy"), 0, h - 1, 0)
        r = max(1, _clamp_int(roi.get("r"), 1, max(w, h), 1))

        x0 = max(0, cx - r)
        y0 = max(0, cy - r)
        x1 = min(w, cx + r + 1)
        y1 = min(h, cy + r + 1)
        cropped = img[y0:y1, x0:x1]

        mask = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
        cv2.circle(mask, (cx - x0, cy - y0), r, 255, -1)
        return RoiCrop(img=cropped, mask=mask, offset_xy=(x0, y0))

    # default rect
    x = _clamp_int(roi.get("x"), 0, w, 0)
    y = _clamp_int(roi.get("y"), 0, h, 0)
    rw = max(1, _clamp_int(roi.get("w"), 1, w, 1))
    rh = max(1, _clamp_int(roi.get("h"), 1, h, 1))
    x1 = min(w, x + rw)
    y1 = min(h, y + rh)
    cropped = img[y:y1, x:x1]
    return RoiCrop(img=cropped, mask=None, offset_xy=(x, y))


def _hsv_mean(bgr: np.ndarray, mask: Optional[np.ndarray]) -> tuple[int, int, int]:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    if mask is None:
        mean = cv2.mean(hsv)[:3]
    else:
        mean = cv2.mean(hsv, mask=mask)[:3]
    return (int(mean[0]), int(mean[1]), int(mean[2]))


def _roi_pixel_mask(crop: RoiCrop) -> np.ndarray:
    if crop.mask is not None:
        return crop.mask
    return np.full(crop.img.shape[:2], 255, dtype=np.uint8)


def sample_hsv_in_roi(
    img: np.ndarray,
    roi: dict,
    *,
    min_saturation: int = 30,
) -> tuple[int, int, int]:
    """在 ROI 内取样代表性 HSV（优先高饱和度像素的中位数）。"""
    crop = crop_roi(img, roi)
    if crop.img.size == 0:
        raise ValueError("ROI 越界/为空")

    hsv = cv2.cvtColor(crop.img, cv2.COLOR_BGR2HSV)
    roi_mask = _roi_pixel_mask(crop)
    pixels = hsv[roi_mask > 0]
    if pixels.size == 0:
        return _hsv_mean(crop.img, crop.mask)

    if min_saturation > 0:
        chromatic = pixels[pixels[:, 1] >= min_saturation]
        if chromatic.size > 0:
            pixels = chromatic

    med = np.median(pixels, axis=0)
    return int(med[0]), int(med[1]), int(med[2])


def compute_hsv_area_in_roi(
    img: np.ndarray,
    roi: dict,
    h_lower: list,
    h_upper: list,
) -> dict:
    """统计 ROI 内符合 HSV 范围的像素面积（与 OpenCV inRange 一致）。"""
    crop = crop_roi(img, roi)
    if crop.img.size == 0:
        return {"match": 0, "total": 0, "ratio": 0.0}

    lower = np.array([int(h_lower[0]), int(h_lower[1]), int(h_lower[2])], dtype=np.uint8)
    upper = np.array([int(h_upper[0]), int(h_upper[1]), int(h_upper[2])], dtype=np.uint8)
    hsv = cv2.cvtColor(crop.img, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, lower, upper)
    roi_mask = _roi_pixel_mask(crop)
    mask = cv2.bitwise_and(mask, roi_mask)
    match = int(cv2.countNonZero(mask))
    total = int(cv2.countNonZero(roi_mask))
    return {
        "match": match,
        "total": total,
        "ratio": float(match / total) if total else 0.0,
    }


def _parse_area_limit(value: Any, default: int) -> int:
    if value is None or value == "":
        return default
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return default


def run_hsv_roi_tool(img: np.ndarray, tool: dict) -> dict:
    roi = (tool or {}).get("roi", {}) or {}
    params = (tool or {}).get("params", {}) or {}
    lower = params.get("h_lower") or params.get("lower") or [0, 0, 0]
    upper = params.get("h_upper") or params.get("upper") or [180, 255, 255]
    lower = [int(lower[0]), int(lower[1]), int(lower[2])] if len(lower) == 3 else [0, 0, 0]
    upper = [int(upper[0]), int(upper[1]), int(upper[2])] if len(upper) == 3 else [180, 255, 255]

    crop = crop_roi(img, roi)
    if crop.img.size == 0:
        return {
            "tool": tool.get("id", tool.get("name", "hsv_roi")),
            "name": tool.get("name", "HSV"),
            "passed": False,
            "value": 0,
            "threshold": 0,
            "fail_reasons": ["ROI 越界/为空"],
            "details": {},
        }

    area_info = compute_hsv_area_in_roi(img, roi, lower, upper)
    match = int(area_info["match"])
    roi_total = int(area_info["total"])
    area_min = _parse_area_limit(params.get("match_area_min"), 0)
    area_max = _parse_area_limit(params.get("match_area_max"), roi_total if roi_total > 0 else match)

    in_range = area_min <= match <= area_max
    fail_reasons: list[str] = []
    if not in_range:
        if match < area_min:
            fail_reasons.append(f"匹配面积 {match}px 低于下限 {area_min}px")
        else:
            fail_reasons.append(f"匹配面积 {match}px 超过上限 {area_max}px")

    return {
        "tool": tool.get("id", tool.get("name", "hsv_roi")),
        "name": tool.get("name", "色彩识别"),
        "passed": bool(in_range),
        "value": match,
        "threshold": area_max,
        "fail_reasons": fail_reasons,
        "details": {
            "lower": lower,
            "upper": upper,
            "roi": roi,
            "match_area": match,
            "match_area_min": area_min,
            "match_area_max": area_max,
            "roi_total": roi_total,
            "match_ratio": area_info["ratio"],
        },
    }


def _detect_shape_in_edges(
    edges: np.ndarray,
    target_shape: str,
    min_area: int,
) -> Optional[dict]:
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    best_score = -1.0
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < float(min_area):
            continue
        peri = cv2.arcLength(cnt, True)
        if peri <= 0:
            continue
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        x, y, w, h = cv2.boundingRect(cnt)
        cx = x + w / 2.0
        cy = y + h / 2.0

        if target_shape == "rect":
            if len(approx) == 4 and cv2.isContourConvex(approx):
                score = area
            else:
                continue
        else:  # circle
            circularity = float(4.0 * np.pi * area / (peri * peri))
            if circularity >= 0.7:
                score = circularity * area
            else:
                continue

        if score > best_score:
            best_score = score
            best = {
                "bbox": [int(x), int(y), int(w), int(h)],
                "center": [float(cx), float(cy)],
                "area": float(area),
                "perimeter": float(peri),
                "circularity": float(4.0 * np.pi * area / (peri * peri)),
                "approx_vertices": int(len(approx)),
            }
    return best


def run_contour_roi_tool(img: np.ndarray, tool: dict) -> dict:
    roi = (tool or {}).get("roi", {}) or {}
    params = (tool or {}).get("params", {}) or {}
    target_shape = params.get("target_shape", "rect")
    min_area = int(params.get("min_area", 80))
    canny1 = int(params.get("canny1", 50))
    canny2 = int(params.get("canny2", 150))
    blur = int(params.get("blur", 3))
    size_tol = float(params.get("size_tolerance", 0.15))
    pos_tol = float(params.get("position_tolerance", 10))
    expected = params.get("expected", {}) or {}
    exp_center = expected.get("center")
    exp_size = expected.get("size")  # rect: [w,h], circle: [r]

    crop = crop_roi(img, roi)
    if crop.img.size == 0:
        return {
            "tool": tool.get("id", tool.get("name", "contour_roi")),
            "name": tool.get("name", "轮廓识别"),
            "passed": False,
            "value": 0,
            "threshold": 100,
            "fail_reasons": ["ROI 越界/为空"],
            "details": {},
        }

    gray = cv2.cvtColor(crop.img, cv2.COLOR_BGR2GRAY)
    if blur and blur > 1:
        k = blur if blur % 2 == 1 else blur + 1
        gray = cv2.GaussianBlur(gray, (k, k), 0)
    edges = cv2.Canny(gray, canny1, canny2)
    shape = _detect_shape_in_edges(edges, "circle" if target_shape == "circle" else "rect", min_area=min_area)
    if not shape:
        return {
            "tool": tool.get("id", tool.get("name", "contour_roi")),
            "name": tool.get("name", "轮廓识别"),
            "passed": False,
            "value": 0,
            "threshold": 100,
            "fail_reasons": ["未检测到目标形状"],
            "details": {"roi": roi, "target_shape": target_shape},
        }

    # 计算相对原图坐标
    ox, oy = crop.offset_xy
    det_bbox = shape["bbox"]
    det_center = shape["center"]
    det_bbox_abs = [det_bbox[0] + ox, det_bbox[1] + oy, det_bbox[2], det_bbox[3]]
    det_center_abs = [det_center[0] + ox, det_center[1] + oy]

    # 尺寸/位置容差判定（若未配置 expected，则只做 existence）
    size_ok = True
    pos_ok = True
    fail_reasons: list[str] = []
    size_dev = 0.0
    pos_dev = 0.0

    if isinstance(exp_center, (list, tuple)) and len(exp_center) == 2:
        dx = float(det_center_abs[0]) - float(exp_center[0])
        dy = float(det_center_abs[1]) - float(exp_center[1])
        pos_dev = float((dx * dx + dy * dy) ** 0.5)
        pos_ok = bool(pos_dev <= pos_tol)
        if not pos_ok:
            fail_reasons.append(f"位置偏差 {pos_dev:.1f}px 超限")

    if isinstance(exp_size, (list, tuple)) and len(exp_size) >= 1:
        if target_shape == "circle":
            exp_r = float(exp_size[0])
            det_r = float(min(det_bbox[2], det_bbox[3]) / 2.0)
            size_dev = abs(det_r - exp_r) / exp_r if exp_r > 0 else 1.0
        else:
            exp_w = float(exp_size[0])
            exp_h = float(exp_size[1]) if len(exp_size) > 1 else float(exp_size[0])
            det_w = float(det_bbox[2])
            det_h = float(det_bbox[3])
            dev_w = abs(det_w - exp_w) / exp_w if exp_w > 0 else 1.0
            dev_h = abs(det_h - exp_h) / exp_h if exp_h > 0 else 1.0
            size_dev = max(dev_w, dev_h)
        size_ok = bool(size_dev <= size_tol)
        if not size_ok:
            fail_reasons.append(f"尺寸偏差 {size_dev:.1%} 超限")

    passed = bool(size_ok and pos_ok)
    return {
        "tool": tool.get("id", tool.get("name", "contour_roi")),
        "name": tool.get("name", "轮廓识别"),
        "passed": passed,
        "value": 100 if passed else 0,
        "threshold": 100,
        "fail_reasons": [] if passed else (fail_reasons or ["判定未通过"]),
        "details": {
            "target_shape": target_shape,
            "roi": roi,
            "detected": {"bbox": det_bbox_abs, "center": det_center_abs},
            "expected": expected,
            "size_deviation": size_dev,
            "position_offset": pos_dev,
        },
    }


def run_roi_tools(img: np.ndarray, config: dict) -> list[dict]:
    tools = (config or {}).get("tools") or []
    out: list[dict] = []
    for t in tools:
        if not isinstance(t, dict):
            continue
        if t.get("enabled", True) is False:
            continue
        t_type = t.get("type")
        if t_type == "hsv_roi":
            out.append(run_hsv_roi_tool(img, t))
        elif t_type == "contour_roi":
            out.append(run_contour_roi_tool(img, t))
        else:
            out.append({
                "tool": t.get("id", t.get("name", "tool")),
                "name": t.get("name", t_type or "tool"),
                "passed": False,
                "value": 0,
                "threshold": 100,
                "fail_reasons": [f"未知工具类型: {t_type}"],
                "details": {"type": t_type},
            })
    return out

