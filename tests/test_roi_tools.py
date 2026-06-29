"""ROI tools 单元测试"""

import numpy as np
import cv2

from src.tools.roi_tools import crop_roi, run_hsv_roi_tool, run_contour_roi_tool


def test_crop_roi_rect_bounds():
    img = np.zeros((100, 200, 3), dtype=np.uint8)
    crop = crop_roi(img, {"shape": "rect", "x": 50, "y": 20, "w": 40, "h": 10})
    assert crop.img.shape[:2] == (10, 40)
    assert crop.mask is None
    assert crop.offset_xy == (50, 20)


def test_crop_roi_circle_has_mask():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    crop = crop_roi(img, {"shape": "circle", "cx": 50, "cy": 50, "r": 10})
    assert crop.img.shape[0] >= 1
    assert crop.mask is not None
    assert crop.mask.dtype == np.uint8


def test_hsv_roi_tool_passes_for_green():
    img = np.zeros((120, 160, 3), dtype=np.uint8)
    # BGR green
    img[40:80, 60:100] = (0, 255, 0)
    tool = {
        "id": "01",
        "name": "色彩识别",
        "type": "hsv_roi",
        "enabled": True,
        "roi": {"shape": "rect", "x": 60, "y": 40, "w": 40, "h": 40},
        "params": {"h_lower": [35, 50, 50], "h_upper": [85, 255, 255]},
    }
    r = run_hsv_roi_tool(img, tool)
    assert r["passed"] is True
    assert r["tool"] == "01"


def test_contour_roi_tool_rect_with_expected_pass():
    img = np.zeros((200, 300, 3), dtype=np.uint8)
    # draw white rectangle edge inside ROI
    cv2.rectangle(img, (120, 70), (200, 130), (255, 255, 255), 2)
    tool = {
        "id": "02",
        "name": "轮廓识别",
        "type": "contour_roi",
        "enabled": True,
        "roi": {"shape": "rect", "x": 80, "y": 40, "w": 180, "h": 140},
        "params": {
            "target_shape": "rect",
            "size_tolerance": 0.3,
            "position_tolerance": 20,
            "min_area": 50,
            "canny1": 30,
            "canny2": 120,
            "blur": 3,
            "expected": {"center": [160, 100], "size": [80, 60]},
        },
    }
    r = run_contour_roi_tool(img, tool)
    assert r["tool"] == "02"
    assert r["passed"] is True

