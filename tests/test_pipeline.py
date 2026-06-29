"""DetectionPipeline 单元测试"""

import numpy as np
import pytest

from src.pipeline import DetectionPipeline


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
