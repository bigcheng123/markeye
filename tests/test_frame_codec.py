"""frame_codec 综合判定字段测试"""

import numpy as np

from src.frame_codec import build_idle_frame, build_result_frame
from src.pipeline import PipelineResult


def test_build_idle_frame_includes_preview_cam_and_logic():
    config = {"io": {"comprehensive_logic": 2}, "tools": [], "trigger": {"source": "external"}}
    payload = build_idle_frame(config, {}, preview_cam=1)
    assert payload["preview_cam"] == 1
    assert payload["overall"]["logic"] == 2


def test_build_result_frame_includes_overall_logic():
    config = {"io": {"comprehensive_logic": 1}, "tools": [], "trigger": {"source": "external"}, "output": {}}
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    result = PipelineResult(
        passed=True,
        marks=[],
        inspections=[],
        process_ms=1,
        tool_results=[{"tool": "01", "passed": True}],
    )
    payload = build_result_frame(config, {}, result, img)
    assert payload["overall"]["passed"] is True
    assert payload["overall"]["logic"] == 1
