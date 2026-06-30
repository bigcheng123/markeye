"""Pipeline 结果 → Web UI inspections[] 聚合（按 config.tools）。"""

from __future__ import annotations

from .pipeline import PipelineResult


def build_inspections(pipeline_result: PipelineResult, config: dict) -> list[dict]:
    tools = (config or {}).get("tools") or []
    results = {r.get("tool"): r for r in (pipeline_result.tool_results or []) if isinstance(r, dict)}
    items: list[dict] = []

    for t in tools:
        if not isinstance(t, dict):
            continue
        if t.get("enabled", True) is False:
            continue
        key = t.get("id") or t.get("name") or "tool"
        r = results.get(key)
        if not r:
            items.append(
                {
                    "tool": key,
                    "name": t.get("name", key),
                    "passed": None,
                    "value": 0,
                    "threshold": 100,
                    "fail_reasons": [],
                }
            )
            continue
        items.append(
            {
                "tool": key,
                "name": r.get("name", t.get("name", key)),
                "passed": None if r.get("passed") is None else bool(r.get("passed")),
                "value": int(r.get("value", 0)),
                "threshold": int(r.get("threshold", 100)),
                "fail_reasons": r.get("fail_reasons", []) or [],
                "details": r.get("details", {}) or {},
            }
        )
    return items


def marks_to_json(marks, inspections=None, overall_passed=None) -> list[dict]:
    """将标记转为 Web JSON；预览时 inspections=None → passed=null。"""
    out = []
    for i, m in enumerate(marks):
        contour = [[int(p[0][0]), int(p[0][1])] for p in m.contour.reshape(-1, 1, 2)]
        if inspections is not None and i < len(inspections):
            mark_passed = bool(inspections[i].passed)
        elif overall_passed is not None:
            mark_passed = bool(overall_passed)
        else:
            mark_passed = None
        out.append({
            "label": m.label,
            "bbox": [int(v) for v in m.bbox],
            "center": [float(v) for v in m.center],
            "area": float(m.area),
            "passed": mark_passed,
            "contour": contour,
        })
    return out
