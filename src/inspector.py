"""检查器模块：对检测到的标记进行颜色、大小、位置判定。"""

from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

from .detector import MarkResult


@dataclass
class InspectionResult:
    """单个标记的检查结果"""
    mark: MarkResult
    color_pass: bool = True
    size_pass: bool = True
    position_pass: bool = True
    color_actual: Optional[tuple] = None
    color_expected: str = ""
    size_deviation: float = 0.0
    position_offset: float = 0.0
    fail_reasons: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all([self.color_pass, self.size_pass, self.position_pass])


class Inspector:
    """检查器，对标记区域进行质量判定。"""

    def __init__(self, config: dict):
        self.cfg = config.get("inspect", {})

    def _get_dominant_color(self, img: np.ndarray, bbox: tuple) -> tuple:
        """获取标记区域的主色（HSV 均值）"""
        x, y, w, h = bbox
        roi = img[y : y + h, x : x + w]
        if roi.size == 0:
            return (0, 0, 0)
        color_space = self.cfg.get("color_space", "hsv")
        if color_space == "hsv":
            roi_hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        elif color_space == "lab":
            roi_hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB)
        else:
            roi_hsv = roi
        # 去掉边缘像素避免背景干扰
        h_r, w_r = roi_hsv.shape[:2]
        inner = roi_hsv[int(h_r * 0.1) : int(h_r * 0.9), int(w_r * 0.1) : int(w_r * 0.9)]
        mean = cv2.mean(inner)[:3]
        return tuple(int(v) for v in mean)

    def _match_color(
        self, hsv_mean: tuple, color_defs: dict
    ) -> tuple[bool, str, float]:
        """匹配最接近的标准颜色"""
        if not color_defs:
            return True, "none", 0.0

        best_name = "unknown"
        best_dist = float("inf")
        tolerance = self.cfg.get("color_tolerance", 0.10)
        h, s, v = hsv_mean

        for name, bounds in color_defs.items():
            lower = np.array(bounds["lower"], dtype=np.uint8)
            upper = np.array(bounds["upper"], dtype=np.uint8)

            # 处理红色在HSV色环两端的情况
            if name == "red":
                lower1 = np.array([0, lower[1], lower[2]], dtype=np.uint8)
                upper1 = np.array([lower[0], upper[1], upper[2]], dtype=np.uint8)
                lower2 = np.array([upper[0], lower[1], lower[2]], dtype=np.uint8)
                upper2 = np.array([180, upper[1], upper[2]], dtype=np.uint8)
                in_range1 = cv2.inRange(
                    np.array([[[h, s, v]]], dtype=np.uint8), lower1, upper1
                )[0, 0]
                in_range2 = cv2.inRange(
                    np.array([[[h, s, v]]], dtype=np.uint8), lower2, upper2
                )[0, 0]
                if in_range1 or in_range2:
                    return True, name, 0.0
            else:
                mask = cv2.inRange(
                    np.array([[[h, s, v]]], dtype=np.uint8), lower, upper
                )
                if mask[0, 0]:
                    return True, name, 0.0

            # 计算距离（简单欧氏）
            c_lower = np.array(bounds["lower"], dtype=np.float32)
            c_upper = np.array(bounds["upper"], dtype=np.float32)
            c_center = (c_lower + c_upper) / 2
            dist = np.linalg.norm(np.array([h, s, v], dtype=np.float32) - c_center)
            if dist < best_dist:
                best_dist = dist
                best_name = name

        range_diag = np.linalg.norm(np.array([180, 255, 255], dtype=np.float32))
        relative_dist = best_dist / range_diag if range_diag > 0 else 1.0
        color_pass = relative_dist <= tolerance

        return color_pass, best_name, round(relative_dist, 3)

    def _check_size(self, mark: MarkResult, ref_area: Optional[float] = None) -> tuple[bool, float]:
        """检查标记大小是否在容差范围内"""
        tolerance = self.cfg.get("size_tolerance", 0.15)
        # 以第一个标记的面积作为参考，或使用配置的参考值
        if ref_area is None:
            return True, 0.0
        deviation = abs(mark.area - ref_area) / ref_area
        size_pass = deviation <= tolerance
        return size_pass, round(deviation, 3)

    def _check_position(self, mark: MarkResult, ref_center: Optional[tuple] = None) -> tuple[bool, float]:
        """检查标记位置偏移"""
        tolerance = self.cfg.get("position_tolerance", 10)
        if ref_center is None:
            return True, 0.0
        dx = mark.center[0] - ref_center[0]
        dy = mark.center[1] - ref_center[1]
        offset = np.sqrt(dx**2 + dy**2)
        position_pass = offset <= tolerance
        return position_pass, round(offset, 1)

    def inspect(
        self,
        img: np.ndarray,
        marks: list[MarkResult],
    ) -> list[InspectionResult]:
        """对检测到的标记逐一执行检查"""
        results = []
        color_check = self.cfg.get("color_check", True)
        size_check = self.cfg.get("size_check", True)
        position_check = self.cfg.get("position_check", True)
        color_defs = self.cfg.get("colors", {})

        # 参考值：以第一个标记为准
        ref_area = marks[0].area if marks else None
        ref_center = marks[0].center if marks else None

        for mark in marks:
            ir = InspectionResult(mark=mark)
            reasons = []

            # 颜色检查
            if color_check:
                hsv_mean = self._get_dominant_color(img, mark.bbox)
                ir.color_actual = hsv_mean
                color_pass, best_name, dist = self._match_color(hsv_mean, color_defs)
                ir.color_pass = color_pass
                ir.color_expected = best_name
                if not color_pass:
                    reasons.append(f"颜色不符 (实际≈{best_name}, 偏差{dist})")

            # 大小检查
            if size_check:
                size_pass, dev = self._check_size(mark, ref_area)
                ir.size_pass = size_pass
                ir.size_deviation = dev
                if not size_pass:
                    reasons.append(f"大小偏差 {dev:.1%} (超限)")

            # 位置检查
            if position_check:
                pos_pass, offset = self._check_position(mark, ref_center)
                ir.position_pass = pos_pass
                ir.position_offset = offset
                if not pos_pass:
                    reasons.append(f"位置偏移 {offset}px (超限)")

            ir.fail_reasons = reasons
            results.append(ir)

        return results
