"""连续触发相关后端优化回归测试。"""

import numpy as np
import pytest

from src.display_images import build_tool_binary_image, required_tool_cam_slots
from src.pipeline import DetectionPipeline
from src.tools.roi_tools import run_hsv_roi_tool


def _hsv_tool(tool_id: str, cam: int, x: int) -> dict:
    return {
        "id": tool_id,
        "cam": cam,
        "type": "hsv_roi",
        "enabled": True,
        "roi": {"shape": "rect", "x": x, "y": 30, "w": 40, "h": 40},
        "params": {
            "h_lower": [0, 100, 100],
            "h_upper": [10, 255, 255],
            "match_area_min": 100,
            "match_area_max": 5000,
        },
        "name": "色彩识别",
    }


def test_required_tool_cam_slots_dual_camera():
    cfg = {
        "tools": [
            _hsv_tool("01", 0, 30),
            _hsv_tool("02", 1, 50),
            _hsv_tool("03", 1, 70),
            _hsv_tool("04", 0, 90),
        ]
    }
    assert required_tool_cam_slots(cfg) == {0, 1}


def test_pipeline_skips_legacy_when_tools_enabled():
    cv2 = pytest.importorskip("cv2")
    img = np.zeros((120, 120, 3), dtype=np.uint8)
    cv2.rectangle(img, (35, 35), (65, 65), (0, 0, 255), -1)
    cfg = {"tools": [_hsv_tool("01", 0, 30)]}
    result = DetectionPipeline(cfg).run(img)
    assert result.tool_results
    assert result.tool_results[0]["passed"] is True
    assert result.marks == []
    assert result.inspections == []


def test_binary_image_reuses_hit_mask():
    cv2 = pytest.importorskip("cv2")
    img = np.zeros((120, 120, 3), dtype=np.uint8)
    cv2.rectangle(img, (35, 35), (65, 65), (0, 0, 255), -1)
    tool = _hsv_tool("01", 0, 30)
    tr = run_hsv_roi_tool(img, tool)
    assert "_hit_mask" in tr
    cfg = {"tools": [tool]}
    binary = build_tool_binary_image(img, cfg, [tr])
    assert int(np.count_nonzero(binary)) > 0
