"""图像预处理模块：灰度化、去噪、二值化、透视校正等。"""

from typing import Optional

import cv2
import numpy as np


class Preprocessor:
    """图像预处理器，对输入图像进行标准化处理。"""

    def __init__(self, config: dict):
        self.cfg = config.get("preprocess", {})

    def resize(self, img: np.ndarray) -> np.ndarray:
        """统一缩放至目标宽度"""
        target_w = self.cfg.get("resize_width")
        if not target_w:
            return img
        h, w = img.shape[:2]
        if w == target_w:
            return img
        ratio = target_w / w
        target_h = int(h * ratio)
        return cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_AREA)

    def grayscale(self, img: np.ndarray) -> np.ndarray:
        """转灰度"""
        method = self.cfg.get("gray_method", "cvt")
        if method == "cvt":
            return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        elif method == "weighted":
            b, g, r = cv2.split(img)
            return cv2.addWeighted(b, 0.114, cv2.addWeighted(g, 0.587, r, 0.299, 0), 0, 0)
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    def denoise(self, img: np.ndarray) -> np.ndarray:
        """高斯去噪"""
        k = self.cfg.get("blur_kernel", 5)
        if k % 2 == 0:
            k += 1
        return cv2.GaussianBlur(img, (k, k), 0)

    def threshold(self, img: np.ndarray) -> np.ndarray:
        """二值化"""
        method = self.cfg.get("threshold_method", "otsu")
        max_val = self.cfg.get("threshold_max", 255)

        if method == "otsu":
            _, binary = cv2.threshold(img, 0, max_val, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        elif method == "adaptive":
            binary = cv2.adaptiveThreshold(
                img, max_val, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY, 11, 2,
            )
        else:
            thresh = self.cfg.get("threshold_value", 127)
            _, binary = cv2.threshold(img, thresh, max_val, cv2.THRESH_BINARY)
        return binary

    def morph(self, img: np.ndarray) -> np.ndarray:
        """形态学操作：先开运算去噪，后闭运算填充空洞"""
        k = self.cfg.get("morph_kernel", 3)
        iters = self.cfg.get("morph_iters", 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
        opened = cv2.morphologyEx(img, cv2.MORPH_OPEN, kernel, iterations=iters)
        closed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, kernel, iterations=iters)
        return closed

    def correct_perspective(self, img: np.ndarray) -> np.ndarray:
        """透视校正（需配置四点坐标）"""
        points = self.cfg.get("perspective_points", [])
        if len(points) != 4:
            return img
        pts = np.array(points, dtype=np.float32)
        rect = self._order_points(pts)
        (tl, tr, br, bl) = rect
        width_a = np.linalg.norm(br - bl)
        width_b = np.linalg.norm(tr - tl)
        max_width = max(int(width_a), int(width_b))
        height_a = np.linalg.norm(tr - br)
        height_b = np.linalg.norm(tl - bl)
        max_height = max(int(height_a), int(height_b))
        dst = np.array([
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1],
        ], dtype=np.float32)
        M = cv2.getPerspectiveTransform(rect, dst)
        return cv2.warpPerspective(img, M, (max_width, max_height))

    @staticmethod
    def _order_points(pts: np.ndarray) -> np.ndarray:
        """对四点按 TL, TR, BR, BL 排序"""
        rect = np.zeros((4, 2), dtype=np.float32)
        s = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]
        rect[2] = pts[np.argmax(s)]
        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]
        rect[3] = pts[np.argmax(diff)]
        return rect

    def process(self, img: np.ndarray) -> np.ndarray:
        """完整预处理流水线"""
        img = self.resize(img)
        if self.cfg.get("perspective_correct", False):
            img = self.correct_perspective(img)
        gray = self.grayscale(img)
        blurred = self.denoise(gray)
        binary = self.threshold(blurred)
        cleaned = self.morph(binary)
        return cleaned
