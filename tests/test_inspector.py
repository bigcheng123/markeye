"""Inspector 单元测试"""

import numpy as np
import cv2
import pytest

from src.detector import Detector, MarkResult
from src.inspector import Inspector


@pytest.fixture
def inspector():
    cfg = {
        "inspect": {
            "color_check": True,
            "size_check": True,
            "position_check": True,
            "color_tolerance": 0.10,
            "size_tolerance": 0.15,
            "position_tolerance": 10,
            "colors": {
                "red": {
                    "lower": [0, 50, 50],
                    "upper": [10, 255, 255],
                },
                "blue": {
                    "lower": [100, 50, 50],
                    "upper": [130, 255, 255],
                },
            },
        }
    }
    return Inspector(cfg)


class TestInspector:
    def test_inspect_single_mark(self, inspector):
        """创建一个模拟标记及其图像，检查流程不报错"""
        img = np.random.randint(0, 255, (200, 200, 3), dtype=np.uint8)
        marks = [
            MarkResult(
                label="mark_1",
                contour=np.array([[[50, 50]], [[50, 100]], [[100, 100]], [[100, 50]]]),
                bbox=(50, 50, 50, 50),
                center=(75, 75),
                area=2500,
                aspect_ratio=1.0,
                confidence=0.9,
            )
        ]
        results = inspector.inspect(img, marks)
        assert len(results) == 1
        # 只要不抛异常就 OK

    def test_multiple_marks(self, inspector):
        img = np.random.randint(0, 255, (200, 200, 3), dtype=np.uint8)
        marks = [
            MarkResult(
                label="m1", contour=np.array([[[0, 0]], [[0, 10]], [[10, 10]], [[10, 0]]]),
                bbox=(0, 0, 10, 10), center=(5, 5), area=100, aspect_ratio=1.0, confidence=1.0,
            ),
            MarkResult(
                label="m2", contour=np.array([[[100, 100]], [[100, 120]], [[120, 120]], [[120, 100]]]),
                bbox=(100, 100, 20, 20), center=(110, 110), area=400, aspect_ratio=1.0, confidence=1.0,
            ),
        ]
        results = inspector.inspect(img, marks)
        assert len(results) == 2
