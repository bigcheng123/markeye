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
        if role in ("off", "link_ok", "running"):
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


def _valid_tool_ids(tools: list | None) -> set[str]:
    out: set[str] = set()
    for item in tools or []:
        if not isinstance(item, dict):
            continue
        tool_id = item.get("id")
        if tool_id is not None and str(tool_id).strip():
            out.add(str(tool_id))
    return out


def _sanitize_tool_output_assignments(
    output_assignments: list[str], tools: list | None
) -> list[str]:
    """移除已删除工具的 OUT 分配（tool:XX → off）。"""
    valid = _valid_tool_ids(tools)
    if not valid:
        return output_assignments
    sanitized: list[str] = []
    for role in output_assignments:
        if role.startswith("tool:"):
            tool_id = role.split(":", 1)[1]
            sanitized.append(role if tool_id in valid else "off")
        else:
            sanitized.append(role)
    return sanitized


def normalize_io_assignments(io: dict | None, *, tools: list | None = None) -> dict:
    """补齐 8 路分配表，并同步 outputs/inputs 兼容字段。"""
    io = dict(io or {})

    raw_out = io.get("output_assignments")
    raw_in = io.get("input_assignments")

    if raw_out:
        output_assignments = _pad_assignments(raw_out)
    else:
        output_assignments = _migrate_output_assignments(io)

    output_assignments = _sanitize_tool_output_assignments(output_assignments, tools)

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

    io["comprehensive_logic"] = _normalize_comprehensive_logic(
        io.get("comprehensive_logic"),
        schema_v2=bool(io.get("comprehensive_logic_v2")),
    )
    if not io.get("comprehensive_logic_v2"):
        io["comprehensive_logic_v2"] = True

    return io


_LEGACY_COMPREHENSIVE_LOGIC = {2: 1, 3: 2, 4: 1}


def _normalize_comprehensive_logic(value, *, schema_v2: bool) -> int:
    """规范化综合判定 OK 条件；旧版配置一次性迁移至 1~3。"""
    try:
        logic = int(value)
    except (TypeError, ValueError):
        return 1
    if schema_v2:
        if logic in (1, 2, 3):
            return logic
        return 1
    migrated = _LEGACY_COMPREHENSIVE_LOGIC.get(logic, logic)
    if migrated in (1, 2, 3):
        return migrated
    return 1
