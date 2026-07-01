"""tool_builder 单元测试"""

import numpy as np

from src.detector import MarkResult
from src.inspector import InspectionResult
from src.pipeline import PipelineResult
from src.tool_builder import build_inspections, marks_to_json


def _mark():
    cnt = np.array([[[50, 50]], [[50, 100]], [[100, 100]], [[100, 50]]])
    return MarkResult(
        label="mark_1",
        contour=cnt,
        bbox=(50, 50, 50, 50),
        center=(75, 75),
        area=2500,
        aspect_ratio=1.0,
        confidence=0.85,
    )


def test_build_inspections_includes_enabled_tools():
    mark = _mark()
    insp = InspectionResult(
        mark=mark,
        color_pass=True,
        size_pass=True,
        position_pass=True,
    )
    pr = PipelineResult(
        passed=True,
        marks=[mark],
        inspections=[insp],
        tool_results=[
            {"tool": "01", "name": "色彩识别", "passed": True, "value": 100, "threshold": 100, "fail_reasons": []},
            {"tool": "02", "name": "轮廓识别", "passed": False, "value": 0, "threshold": 100, "fail_reasons": ["未检测到目标形状"]},
        ],
        process_ms=10,
    )
    cfg = {
        "tools": [
            {"id": "01", "name": "色彩识别", "type": "hsv_roi", "enabled": True, "roi": {"shape": "rect", "x": 0, "y": 0, "w": 10, "h": 10}},
            {"id": "02", "name": "轮廓识别", "type": "contour_roi", "enabled": True, "roi": {"shape": "rect", "x": 0, "y": 0, "w": 10, "h": 10}},
        ]
    }
    items = build_inspections(pr, cfg)
    tools = [i["tool"] for i in items]
    assert tools == ["01", "02"]
    assert items[0]["passed"] is True
    assert items[1]["passed"] is False


def test_build_inspections_skips_disabled_tools():
    pr = PipelineResult(
        passed=True,
        marks=[],
        inspections=[],
        tool_results=[
            {"tool": "01", "name": "色彩识别", "passed": True, "value": 100, "threshold": 100, "fail_reasons": []},
            {"tool": "02", "name": "轮廓识别", "passed": True, "value": 200, "threshold": 100, "fail_reasons": []},
        ],
        process_ms=5,
    )
    cfg = {
        "tools": [
            {"id": "01", "name": "色彩识别", "type": "hsv_roi", "enabled": False, "roi": {"shape": "rect", "x": 0, "y": 0, "w": 10, "h": 10}},
            {"id": "02", "name": "轮廓识别", "type": "contour_roi", "enabled": True, "roi": {"shape": "rect", "x": 0, "y": 0, "w": 10, "h": 10}},
        ]
    }
    items = build_inspections(pr, cfg)
    assert [i["tool"] for i in items] == ["02"]
    assert items[0]["value"] == 200


def test_marks_to_json():
    mark = _mark()
    out = marks_to_json([mark], overall_passed=True)
    assert len(out) == 1
    assert out[0]["label"] == "mark_1"
    assert out[0]["passed"] is True


def test_marks_to_json_preview_null():
    mark = _mark()
    out = marks_to_json([mark])
    assert out[0]["passed"] is None


def test_marks_to_json_per_inspection():
    mark = _mark()
    insp_ok = InspectionResult(mark=mark, color_pass=True, size_pass=True, position_pass=True)
    insp_ng = InspectionResult(mark=mark, color_pass=False, size_pass=True, position_pass=True)
    out_ok = marks_to_json([mark], [insp_ok])
    out_ng = marks_to_json([mark], [insp_ng])
    assert out_ok[0]["passed"] is True
    assert out_ng[0]["passed"] is False
