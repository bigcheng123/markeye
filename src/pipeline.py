"""检测管线：预处理 → 检测 → 检查，供 CLI 与 Web 服务共用。"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .detector import Detector, MarkResult
from .inspector import InspectionResult, Inspector
from .preprocessor import Preprocessor
from .utils import draw_detection, overlay_result
from .tools.roi_tools import run_roi_tools


@dataclass
class PipelineResult:
    """单次检测完整结果"""

    passed: bool
    marks: list[MarkResult]
    inspections: list[InspectionResult]
    process_ms: int
    tool_results: list[dict] = field(default_factory=list)
    fail_reasons: list[str] = field(default_factory=list)
    result_image: Optional[np.ndarray] = None
    error: Optional[str] = None


class DetectionPipeline:
    """封装 OpenCV 检测流程。"""

    def __init__(self, config: dict):
        self.config = config
        self._preprocessor = Preprocessor(config)
        self._detector = Detector(config)
        self._inspector = Inspector(config)

    def locate(self, img: np.ndarray) -> list[MarkResult]:
        """预览定位：仅预处理 + 轮廓检测，不做质量判定。"""
        if img is None or img.size == 0:
            return []
        binary = self._preprocessor.process(img)
        return self._detector.detect(binary, img)

    def run(self, img: np.ndarray) -> PipelineResult:
        """对 BGR 图像执行完整检测。"""
        if img is None:
            return PipelineResult(
                passed=False,
                marks=[],
                inspections=[],
                tool_results=[],
                process_ms=0,
                fail_reasons=["采图失败"],
                error="empty_image",
            )
        if img.size == 0:
            return PipelineResult(
                passed=False,
                marks=[],
                inspections=[],
                tool_results=[],
                process_ms=0,
                fail_reasons=["采图失败"],
                error="empty_image",
            )

        t0 = time.perf_counter()
        binary = self._preprocessor.process(img)
        marks = self._detector.detect(binary, img)
        inspections = self._inspector.inspect(img, marks, self.config)
        tool_results = run_roi_tools(img, self.config)

        fail_reasons: list[str] = []
        for r in inspections:
            if not r.passed:
                fail_reasons.extend(r.fail_reasons)

        # 运行结果以 tools 为准；未定义 tools 时回退到原有 inspections
        if tool_results:
            all_pass = all(bool(t.get("passed")) for t in tool_results)
            for t in tool_results:
                if not t.get("passed"):
                    fail_reasons.extend(t.get("fail_reasons", []) or [])
        else:
            all_pass = bool(inspections) and all(r.passed for r in inspections)
            if not marks:
                all_pass = False
                fail_reasons.append("未检测到标记")

        result_img = img.copy()
        for r in inspections:
            color = (0, 200, 0) if r.passed else (0, 0, 200)
            result_img = draw_detection(
                result_img, r.mark.contour, color, r.mark.label
            )
        result_img = overlay_result(result_img, all_pass, fail_reasons)

        elapsed = int((time.perf_counter() - t0) * 1000)
        return PipelineResult(
            passed=all_pass,
            marks=marks,
            inspections=inspections,
            tool_results=tool_results,
            process_ms=elapsed,
            fail_reasons=fail_reasons,
            result_image=result_img,
        )
