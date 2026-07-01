"""display_images 工具预览槽位选择"""

import numpy as np

from src.display_images import first_enabled_tool_cam, pick_primary_preview
from src.frame_codec import NO_TOOLS_VIEWPORT_MESSAGE, build_idle_frame, build_no_tools_frame, build_result_frame
from src.pipeline import PipelineResult


def test_first_enabled_tool_cam_skips_disabled():
    cfg = {
        "tools": [
            {"id": "01", "cam": 0, "enabled": False},
            {"id": "02", "cam": 1, "enabled": True},
        ]
    }
    assert first_enabled_tool_cam(cfg) == 1


def test_pick_primary_preview_uses_enabled_tool_cam():
    img0 = np.zeros((10, 10, 3), dtype=np.uint8)
    img1 = np.ones((12, 12, 3), dtype=np.uint8) * 255
    cfg = {
        "tools": [
            {"id": "01", "cam": 0, "enabled": False},
            {"id": "02", "cam": 1, "enabled": True},
        ]
    }
    primary, slot = pick_primary_preview({0: img0, 1: img1}, cfg)
    assert slot == 1
    assert primary is img1


def test_pick_primary_preview_tool_combinations():
    img0 = np.zeros((8, 8, 3), dtype=np.uint8)
    img1 = np.ones((8, 8, 3), dtype=np.uint8)
    frames = {0: img0, 1: img1}

    only_t1 = {
        "tools": [
            {"id": "01", "cam": 0, "enabled": True},
            {"id": "02", "cam": 1, "enabled": False},
        ]
    }
    p, s = pick_primary_preview(frames, only_t1)
    assert (p, s) == (img0, 0)

    only_t2 = {
        "tools": [
            {"id": "01", "cam": 0, "enabled": False},
            {"id": "02", "cam": 1, "enabled": True},
        ]
    }
    p, s = pick_primary_preview(frames, only_t2)
    assert (p, s) == (img1, 1)

    both_on = {
        "tools": [
            {"id": "01", "cam": 0, "enabled": True},
            {"id": "02", "cam": 1, "enabled": True},
        ]
    }
    p, s = pick_primary_preview(frames, both_on)
    assert (p, s) == (img0, 0)


def test_build_idle_frame_preview_cam_follows_enabled_tool():
    cfg = {
        "tools": [
            {"id": "01", "cam": 0, "enabled": False},
            {"id": "02", "cam": 1, "enabled": True, "roi": {"shape": "rect", "x": 0, "y": 0, "w": 1, "h": 1}},
        ],
        "trigger": {"source": "external"},
        "output": {"jpeg_quality": 70},
        "calibration": {"sample_count": 0},
    }
    img = np.zeros((20, 20, 3), dtype=np.uint8)
    frame = build_idle_frame(cfg, {}, img, [], [], preview_cam=1)
    assert frame["preview_cam"] == 1
    assert [i["tool"] for i in frame["inspections"]] == ["02"]


def test_build_result_frame_preview_cam_propagates():
    cfg = {
        "tools": [
            {"id": "01", "cam": 0, "enabled": False},
            {"id": "02", "cam": 1, "enabled": True, "type": "hsv_roi", "roi": {"shape": "rect", "x": 0, "y": 0, "w": 1, "h": 1}},
        ],
        "trigger": {"source": "external"},
        "output": {"jpeg_quality": 70},
        "calibration": {"sample_count": 0},
    }
    img = np.zeros((20, 20, 3), dtype=np.uint8)
    pr = PipelineResult(
        passed=True,
        marks=[],
        inspections=[],
        tool_results=[
            {"tool": "02", "name": "T2", "passed": True, "value": 10, "threshold": 5, "fail_reasons": []},
        ],
        process_ms=3,
    )
    frame = build_result_frame(cfg, {}, pr, img, preview_cam=1)
    assert frame["preview_cam"] == 1
    assert [i["tool"] for i in frame["inspections"]] == ["02"]


def test_build_no_tools_frame_has_black_viewport_message():
    cfg = {
        "tools": [
            {"id": "01", "enabled": False},
            {"id": "02", "enabled": False},
        ],
        "trigger": {"source": "external"},
        "calibration": {"sample_count": 0},
    }
    frame = build_no_tools_frame(cfg, {"trigger_total": 0})
    assert frame["no_tools"] is True
    assert frame["viewport_message"] == NO_TOOLS_VIEWPORT_MESSAGE
    assert frame["inspections"] == []
    assert frame["overall"]["passed"] is None
    assert frame["frame"]["image_base64"] is None
