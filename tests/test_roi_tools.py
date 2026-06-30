"""ROI tools 单元测试"""

import numpy as np
import cv2

from src.tools.roi_tools import crop_roi, run_hsv_roi_tool, run_contour_roi_tool, compute_hsv_area_in_roi, sample_hsv_in_roi


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


def test_hsv_roi_tool_passes_when_match_area_in_range():
    img = np.zeros((120, 160, 3), dtype=np.uint8)
    # BGR green
    img[40:80, 60:100] = (0, 255, 0)
    tool = {
        "id": "01",
        "name": "色彩识别",
        "type": "hsv_roi",
        "enabled": True,
        "roi": {"shape": "rect", "x": 60, "y": 40, "w": 40, "h": 40},
        "params": {
            "h_lower": [35, 50, 50],
            "h_upper": [85, 255, 255],
            "match_area_min": 100,
            "match_area_max": 2000,
        },
    }
    r = run_hsv_roi_tool(img, tool)
    assert r["passed"] is True
    assert r["tool"] == "01"
    assert r["value"] == 40 * 40
    assert r["details"]["match_area_min"] == 100
    assert r["details"]["match_area_max"] == 2000


def test_hsv_roi_tool_fails_when_match_area_below_min():
    img = np.zeros((120, 160, 3), dtype=np.uint8)
    img[55:65, 75:85] = (0, 255, 0)
    tool = {
        "id": "01",
        "type": "hsv_roi",
        "roi": {"shape": "rect", "x": 60, "y": 40, "w": 40, "h": 40},
        "params": {
            "h_lower": [35, 50, 50],
            "h_upper": [85, 255, 255],
            "match_area_min": 500,
            "match_area_max": 2000,
        },
    }
    r = run_hsv_roi_tool(img, tool)
    assert r["passed"] is False
    assert r["value"] < 500


def test_hsv_roi_tool_fails_when_match_area_above_max():
    img = np.zeros((120, 160, 3), dtype=np.uint8)
    img[40:80, 60:100] = (0, 255, 0)
    tool = {
        "id": "01",
        "type": "hsv_roi",
        "roi": {"shape": "rect", "x": 60, "y": 40, "w": 40, "h": 40},
        "params": {
            "h_lower": [35, 50, 50],
            "h_upper": [85, 255, 255],
            "match_area_min": 0,
            "match_area_max": 100,
        },
    }
    r = run_hsv_roi_tool(img, tool)
    assert r["passed"] is False
    assert r["value"] > 100


def test_compute_hsv_area_orange():
    img = np.zeros((120, 160, 3), dtype=np.uint8)
    # BGR orange
    img[40:80, 60:100] = (0, 140, 255)
    roi = {"shape": "rect", "x": 60, "y": 40, "w": 40, "h": 40}
    h, s, v = sample_hsv_in_roi(img, roi)
    assert 8 <= h <= 25
    assert s >= 100
    area = compute_hsv_area_in_roi(
        img,
        roi,
        [max(0, h - 10), max(0, s - 40), max(0, v - 40)],
        [min(180, h + 10), min(255, s + 40), min(255, v + 40)],
    )
    assert area["match"] > 100
    assert area["total"] == 40 * 40


def test_compute_hsv_area_mismatch_is_zero():
    img = np.zeros((120, 160, 3), dtype=np.uint8)
    img[40:80, 60:100] = (0, 140, 255)
    roi = {"shape": "rect", "x": 60, "y": 40, "w": 40, "h": 40}
    area = compute_hsv_area_in_roi(img, roi, [72, 0, 5], [92, 63, 85])
    assert area["match"] == 0


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


def test_run_roi_tools_uses_per_tool_cam_slot():
    from src.tools.roi_tools import run_roi_tools

    img0 = np.zeros((80, 80, 3), dtype=np.uint8)
    img0[20:40, 20:40] = (0, 255, 0)
    img1 = np.zeros((80, 80, 3), dtype=np.uint8)
    img1[10:30, 10:30] = (0, 0, 255)

    config = {
        "tools": [
            {
                "id": "01",
                "cam": 0,
                "type": "hsv_roi",
                "enabled": True,
                "roi": {"shape": "rect", "x": 10, "y": 10, "w": 50, "h": 50},
                "params": {"h_lower": [35, 50, 50], "h_upper": [85, 255, 255]},
            },
            {
                "id": "02",
                "cam": 1,
                "type": "hsv_roi",
                "enabled": True,
                "roi": {"shape": "rect", "x": 5, "y": 5, "w": 40, "h": 40},
                "params": {"h_lower": [0, 50, 50], "h_upper": [10, 255, 255]},
            },
        ]
    }
    results = run_roi_tools({0: img0, 1: img1}, config)
    assert len(results) == 2
    assert results[0]["tool"] == "01"
    assert results[1]["tool"] == "02"
    assert results[0]["value"] > 0
    assert results[1]["value"] > 0

