"""Detector 单元测试"""

import numpy as np
import cv2
import pytest

from src.detector import Detector


@pytest.fixture
def binary_with_mark():
    """生成一张包含矩形标记的二值图（200x200）"""
    img = np.zeros((200, 200), dtype=np.uint8)
    # 在中心画一个白色矩形作为标记
    img[80:120, 80:120] = 255
    return img


@pytest.fixture
def detector():
    cfg = {"detector": {"min_area": 10, "max_area": 50000, "min_side": 3, "max_side": 300}}
    return Detector(cfg)


class TestDetector:
    def test_detect_single_mark(self, detector, binary_with_mark):
        original = cv2.cvtColor(binary_with_mark, cv2.COLOR_GRAY2BGR)
        marks = detector.detect(binary_with_mark, original)
        assert len(marks) >= 1

    def test_mark_center(self, detector, binary_with_mark):
        original = cv2.cvtColor(binary_with_mark, cv2.COLOR_GRAY2BGR)
        marks = detector.detect(binary_with_mark, original)
        # 矩形中心应在 (100, 100) 附近
        cx, cy = marks[0].center
        assert 95 <= cx <= 105
        assert 95 <= cy <= 105

    def test_mark_area(self, detector, binary_with_mark):
        original = cv2.cvtColor(binary_with_mark, cv2.COLOR_GRAY2BGR)
        marks = detector.detect(binary_with_mark, original)
        # 40x40 = 1600px²
        assert 1500 <= marks[0].area <= 1700

    def test_empty_image(self, detector):
        """全黑图像应检测到 0 个标记"""
        blank = np.zeros((100, 100), dtype=np.uint8)
        original = cv2.cvtColor(blank, cv2.COLOR_GRAY2BGR)
        marks = detector.detect(blank, original)
        assert len(marks) == 0
