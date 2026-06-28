"""标记检测模块：定位图像中的标记区域，输出轮廓与位置信息。"""

from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np


@dataclass
class MarkResult:
    """单个标记的检测结果"""
    label: str               # 标记标签（如 "mark_1"）
    contour: np.ndarray      # 轮廓点集
    bbox: tuple              # 外接矩形 (x, y, w, h)
    center: tuple            # 中心点坐标 (cx, cy)
    area: float              # 面积 (px²)
    aspect_ratio: float      # 宽高比
    confidence: float        # 置信度 (0~1)


class Detector:
    """标记检测器，从预处理后的二值图中定位标记区域。"""

    def __init__(self, config: dict):
        self.cfg = config.get("detector", {})

    def _find_contours(self, binary: np.ndarray) -> list[np.ndarray]:
        """查找轮廓"""
        mode_map = {
            "external": cv2.RETR_EXTERNAL,
            "tree": cv2.RETR_TREE,
        }
        method_map = {
            "simple": cv2.CHAIN_APPROX_SIMPLE,
            "none": cv2.CHAIN_APPROX_NONE,
        }
        mode = mode_map.get(self.cfg.get("contour_mode", "external"), cv2.RETR_EXTERNAL)
        method = method_map.get(self.cfg.get("contour_approx", "simple"), cv2.CHAIN_APPROX_SIMPLE)
        contours, _ = cv2.findContours(binary, mode, method)
        return contours

    def _filter_contours(self, contours: list[np.ndarray]) -> list[np.ndarray]:
        """按面积和尺寸过滤轮廓"""
        min_area = self.cfg.get("min_area", 50)
        max_area = self.cfg.get("max_area", 50000)
        min_side = self.cfg.get("min_side", 5)
        max_side = self.cfg.get("max_side", 300)

        filtered = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if not (min_area <= area <= max_area):
                continue
            x, y, w, h = cv2.boundingRect(cnt)
            if not (min_side <= w <= max_side and min_side <= h <= max_side):
                continue
            filtered.append(cnt)
        return filtered

    def detect(self, binary: np.ndarray, original: np.ndarray) -> list[MarkResult]:
        """执行标记检测"""
        contours = self._find_contours(binary)
        contours = self._filter_contours(contours)

        results = []
        for i, cnt in enumerate(contours):
            area = cv2.contourArea(cnt)
            x, y, w, h = cv2.boundingRect(cnt)
            cx, cy = x + w // 2, y + h // 2
            aspect = w / h if h > 0 else 0

            # 用轮廓面积占外接矩比例作置信度（近似）
            rect_area = w * h
            confidence = min(area / rect_area, 1.0) if rect_area > 0 else 0.0

            results.append(MarkResult(
                label=f"mark_{i + 1}",
                contour=cnt,
                bbox=(x, y, w, h),
                center=(cx, cy),
                area=area,
                aspect_ratio=round(aspect, 3),
                confidence=round(confidence, 3),
            ))

        return results
