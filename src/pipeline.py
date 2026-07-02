"""检测管线：预处理 → 检测 → 检查，供 CLI 与 Web 服务共用。"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional, Union

import numpy as np

from .detector import Detector, MarkResult
from .display_images import has_active_tools
from .inspector import InspectionResult, Inspector
from .preprocessor import Preprocessor
from .utils import draw_detection, overlay_result
from .tools.roi_tools import run_roi_tools


def aggregate_tool_results(
    tool_results: list[dict],
    io_config: dict | None = None,
) -> tuple[bool, list[str]]:
    """按 io.comprehensive_logic 汇总各工具判定结果。"""
    if not tool_results:
        return False, []

    logic = 1
    if io_config:
        try:
            logic = int(io_config.get("comprehensive_logic", 1))
        except (TypeError, ValueError):
            logic = 1

    fail_reasons: list[str] = []
    passed_flags = [bool(t.get("passed")) for t in tool_results]

    if logic == 1:
        # 全部OK：所有工具 OK 时综合 OK
        all_pass = all(passed_flags)
    elif logic == 2:
        # 任一OK：至少一个工具 OK 时综合 OK
        all_pass = any(passed_flags)
    elif logic == 3:
        # 全部NG：所有工具 NG 时综合 OK
        all_pass = bool(passed_flags) and not any(passed_flags)
    else:
        all_pass = all(passed_flags)

    if not all_pass:
        if logic == 3:
            for t in tool_results:
                if t.get("passed"):
                    fail_reasons.extend(t.get("fail_reasons", []) or [])
        else:
            for t in tool_results:
                if not t.get("passed"):
                    fail_reasons.extend(t.get("fail_reasons", []) or [])

    return all_pass, fail_reasons


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

    def run(self, images: Union[np.ndarray, dict[int, np.ndarray]]) -> PipelineResult:
        """对 BGR 图像（或按槽位多帧）执行完整检测。"""
        if isinstance(images, dict):
            primary = images.get(0)
            if primary is None:
                primary = next((f for f in images.values() if f is not None), None)
            img = primary
        else:
            img = images

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
        use_tools = has_active_tools(self.config)
        tool_results = run_roi_tools(images if isinstance(images, dict) else img, self.config)

        if use_tools:
            marks: list[MarkResult] = []
            inspections: list[InspectionResult] = []
            fail_reasons: list[str] = []
            io_cfg = (self.config or {}).get("io") or {}
            all_pass, tool_fail_reasons = aggregate_tool_results(tool_results, io_cfg)
            fail_reasons.extend(tool_fail_reasons)
            result_img = img.copy()
        else:
            binary = self._preprocessor.process(img)
            marks = self._detector.detect(binary, img)
            inspections = self._inspector.inspect(img, marks, self.config)
            fail_reasons = []
            for r in inspections:
                if not r.passed:
                    fail_reasons.extend(r.fail_reasons)
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
