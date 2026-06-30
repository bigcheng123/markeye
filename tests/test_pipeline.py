"""DetectionPipeline 单元测试"""

import numpy as np
import pytest

from src.pipeline import DetectionPipeline, aggregate_tool_results


@pytest.fixture
def pipeline_cfg():
    return {
        "preprocess": {
            "resize_width": 200,
            "blur_kernel": 3,
            "threshold_method": "otsu",
            "morph_kernel": 3,
            "morph_iters": 1,
        },
        "detector": {
            "min_area": 10,
            "max_area": 50000,
            "min_side": 5,
            "max_side": 300,
        },
        "inspect": {
            "color_check": False,
            "size_check": False,
            "position_check": False,
        },
        "calibration": {},
    }


def _dual_hsv_tools():
    return [
        {
            "id": "01",
            "cam": 0,
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 10, "y": 10, "w": 50, "h": 50},
            "params": {
                "h_lower": [35, 50, 50],
                "h_upper": [85, 255, 255],
                "match_area_min": 100,
                "match_area_max": 5000,
            },
        },
        {
            "id": "02",
            "cam": 1,
            "type": "hsv_roi",
            "enabled": True,
            "roi": {"shape": "rect", "x": 5, "y": 5, "w": 40, "h": 40},
            "params": {
                "h_lower": [0, 50, 50],
                "h_upper": [10, 255, 255],
                "match_area_min": 100,
                "match_area_max": 5000,
            },
        },
    ]


def _make_dual_frames():
    cv2 = pytest.importorskip("cv2")
    img0 = np.zeros((80, 80, 3), dtype=np.uint8)
    img0[20:40, 20:40] = (0, 255, 0)
    img1 = np.zeros((80, 80, 3), dtype=np.uint8)
    img1[10:30, 10:30] = (0, 0, 255)
    return {0: img0, 1: img1}


class TestAggregateToolResults:
    def test_logic1_all_pass(self):
        results = [{"passed": True}, {"passed": True}]
        ok, reasons = aggregate_tool_results(results, {"comprehensive_logic": 1})
        assert ok is True
        assert reasons == []

    def test_logic1_one_fail(self):
        results = [
            {"passed": True},
            {"passed": False, "fail_reasons": ["面积不足"]},
        ]
        ok, reasons = aggregate_tool_results(results, {"comprehensive_logic": 1})
        assert ok is False
        assert "面积不足" in reasons

    def test_logic3_any_pass(self):
        results = [
            {"passed": False, "fail_reasons": ["a"]},
            {"passed": True},
        ]
        ok, _ = aggregate_tool_results(results, {"comprehensive_logic": 3})
        assert ok is True


class TestDetectionPipeline:
    def test_empty_image(self, pipeline_cfg):
        pipeline = DetectionPipeline(pipeline_cfg)
        result = pipeline.run(None)
        assert result.passed is False
        assert result.error == "empty_image"

    def test_run_returns_process_ms(self, pipeline_cfg):
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        cv2 = pytest.importorskip("cv2")
        cv2.rectangle(img, (20, 20), (80, 80), (255, 255, 255), -1)
        pipeline = DetectionPipeline(pipeline_cfg)
        result = pipeline.run(img)
        assert result.process_ms >= 0
        assert result.result_image is not None

    def test_locate_returns_marks(self, pipeline_cfg):
        cv2 = pytest.importorskip("cv2")
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        cv2.rectangle(img, (20, 20), (80, 80), (255, 255, 255), -1)
        pipeline = DetectionPipeline(pipeline_cfg)
        marks = pipeline.locate(img)
        assert len(marks) >= 1

    def test_locate_empty_image(self, pipeline_cfg):
        pipeline = DetectionPipeline(pipeline_cfg)
        assert pipeline.locate(None) == []
        assert pipeline.locate(np.array([])) == []

    def test_dual_cam_all_tools_pass(self, pipeline_cfg):
        pipeline_cfg["tools"] = _dual_hsv_tools()
        pipeline_cfg["io"] = {"comprehensive_logic": 1}
        pipeline = DetectionPipeline(pipeline_cfg)
        result = pipeline.run(_make_dual_frames())
        assert len(result.tool_results) == 2
        assert all(t["passed"] for t in result.tool_results)
        assert result.passed is True

    def test_dual_cam_one_tool_fails_overall_ng(self, pipeline_cfg):
        tools = _dual_hsv_tools()
        tools[1]["params"]["match_area_min"] = 99999
        pipeline_cfg["tools"] = tools
        pipeline_cfg["io"] = {"comprehensive_logic": 1}
        pipeline = DetectionPipeline(pipeline_cfg)
        result = pipeline.run(_make_dual_frames())
        assert result.tool_results[0]["passed"] is True
        assert result.tool_results[1]["passed"] is False
        assert result.passed is False

    def test_disabled_tool_excluded_from_aggregate(self, pipeline_cfg):
        tools = _dual_hsv_tools()
        tools[1]["enabled"] = False
        tools[1]["params"]["match_area_min"] = 99999
        pipeline_cfg["tools"] = tools
        pipeline = DetectionPipeline(pipeline_cfg)
        result = pipeline.run(_make_dual_frames())
        assert len(result.tool_results) == 1
        assert result.passed is True
