"""Preprocessor 单元测试"""

import numpy as np
import cv2
import pytest

from src.preprocessor import Preprocessor


@pytest.fixture
def sample_img():
    """生成一张 200x100 的测试图（灰色背景 + 随机噪点）"""
    return np.random.randint(100, 150, (100, 200, 3), dtype=np.uint8)


@pytest.fixture
def preprocessor():
    cfg = {"preprocess": {"resize_width": 100, "blur_kernel": 3}}
    return Preprocessor(cfg)


class TestPreprocessor:
    def test_resize(self, preprocessor, sample_img):
        resized = preprocessor.resize(sample_img)
        assert resized.shape[1] == 100

    def test_grayscale(self, preprocessor, sample_img):
        gray = preprocessor.grayscale(sample_img)
        assert len(gray.shape) == 2

    def test_denoise(self, preprocessor, sample_img):
        gray = preprocessor.grayscale(sample_img)
        denoised = preprocessor.denoise(gray)
        assert denoised.shape == gray.shape

    def test_threshold(self, preprocessor, sample_img):
        gray = preprocessor.grayscale(sample_img)
        binary = preprocessor.threshold(gray)
        assert binary.dtype == np.uint8
        assert len(binary.shape) == 2

    def test_full_pipeline(self, preprocessor, sample_img):
        result = preprocessor.process(sample_img)
        assert len(result.shape) == 2
        assert result.dtype == np.uint8
