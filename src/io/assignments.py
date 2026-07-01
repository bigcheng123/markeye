"""IO 输出/输入分配表解析与归一化。"""

from __future__ import annotations

IO_CHANNEL_COUNT = 8

DEFAULT_OUTPUT_ASSIGNMENTS = [
    "link_ok",
    "result_ng",
    "tool:02",
    "tool:01",
    "off",
    "off",
    "off",
    "off",
]

DEFAULT_INPUT_ASSIGNMENTS = [
    "trigger",
    "switch_program",
    "off",
    "off",
    "off",
    "off",
    "off",
    "off",
]


def _pad_assignments(items: list[str] | None, *, fill: str = "off") -> list[str]:
    out = [str(x) for x in (items or [])][:IO_CHANNEL_COUNT]
    while len(out) < IO_CHANNEL_COUNT:
        out.append(fill)
    return out


def resolve_trigger_bits(input_assignments: list[str]) -> list[int]:
    return [i for i, role in enumerate(input_assignments) if role == "trigger"]


def resolve_output_index(output_assignments: list[str], role: str) -> int | None:
    for i, assigned in enumerate(output_assignments):
        if assigned == role:
            return i
    return None


def _tool_passed_map(tool_results: list[dict] | None) -> dict[str, bool]:
    out: dict[str, bool] = {}
    for item in tool_results or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("tool", ""))
        if key:
            out[key] = bool(item.get("passed"))
    return out


def build_output_states(
    passed: bool,
    output_assignments: list[str],
    tool_results: list[dict] | None = None,
) -> dict[int, bool]:
    """计算检测结果对应的线圈状态（不含 link_ok）。"""
    states: dict[int, bool] = {}
    tool_map = _tool_passed_map(tool_results)

    for i, role in enumerate(_pad_assignments(output_assignments)):
        if role in ("off", "link_ok"):
            continue
        if role == "result_ng":
            states[i] = not passed
        elif role == "result_ok":
            states[i] = passed
        elif role.startswith("tool:"):
            tool_id = role.split(":", 1)[1]
            if tool_id in tool_map:
                states[i] = not tool_map[tool_id]
    return states


def _migrate_output_assignments(io: dict) -> list[str]:
    out_assign = ["off"] * IO_CHANNEL_COUNT
    outputs = io.get("outputs") or {}
    has_legacy = False

    link_idx = outputs.get("link_ok")
    if link_idx is not None:
        idx = int(link_idx)
        if 0 <= idx < IO_CHANNEL_COUNT:
            out_assign[idx] = "link_ok"
            has_legacy = True

    ng_idx = outputs.get("result_ng")
    if ng_idx is not None:
        idx = int(ng_idx)
        if 0 <= idx < IO_CHANNEL_COUNT:
            out_assign[idx] = "result_ng"
            has_legacy = True

    if has_legacy:
        return out_assign
    return list(DEFAULT_OUTPUT_ASSIGNMENTS)


def _migrate_input_assignments(io: dict) -> list[str]:
    in_assign = ["off"] * IO_CHANNEL_COUNT
    trigger_bits = (io.get("inputs") or {}).get("trigger_bits")
    if trigger_bits:
        for bit in trigger_bits:
            idx = int(bit)
            if 0 <= idx < IO_CHANNEL_COUNT:
                in_assign[idx] = "trigger"
        return in_assign
    return list(DEFAULT_INPUT_ASSIGNMENTS)


def normalize_io_assignments(io: dict | None) -> dict:
    """补齐 8 路分配表，并同步 outputs/inputs 兼容字段。"""
    io = dict(io or {})

    raw_out = io.get("output_assignments")
    raw_in = io.get("input_assignments")

    if raw_out:
        output_assignments = _pad_assignments(raw_out)
    else:
        output_assignments = _migrate_output_assignments(io)

    if raw_in:
        input_assignments = _pad_assignments(raw_in)
    else:
        input_assignments = _migrate_input_assignments(io)

    input_assignments = [
        "off" if role == "restart" else role for role in input_assignments
    ]

    io["output_assignments"] = output_assignments
    io["input_assignments"] = input_assignments

    outputs = io.setdefault("outputs", {})
    inputs = io.setdefault("inputs", {})
    outputs["link_ok"] = resolve_output_index(output_assignments, "link_ok")
    outputs["result_ng"] = resolve_output_index(output_assignments, "result_ng")
    inputs["trigger_bits"] = resolve_trigger_bits(input_assignments)

    return io
