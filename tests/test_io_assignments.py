"""IO 分配表单元测试。"""

from __future__ import annotations

from src.io.assignments import (
    DEFAULT_INPUT_ASSIGNMENTS,
    DEFAULT_OUTPUT_ASSIGNMENTS,
    build_output_states,
    normalize_io_assignments,
    resolve_trigger_bits,
)


def test_normalize_defaults():
    io = normalize_io_assignments({})
    assert io["output_assignments"] == DEFAULT_OUTPUT_ASSIGNMENTS
    assert io["input_assignments"] == DEFAULT_INPUT_ASSIGNMENTS
    assert io["outputs"]["link_ok"] == 0
    assert io["outputs"]["result_ng"] == 1
    assert io["inputs"]["trigger_bits"] == [0]


def test_normalize_from_legacy_fields():
    io = normalize_io_assignments(
        {
            "outputs": {"link_ok": 2, "result_ng": 5},
            "inputs": {"trigger_bits": [1, 3]},
        }
    )
    assert io["output_assignments"][2] == "link_ok"
    assert io["output_assignments"][5] == "result_ng"
    assert io["input_assignments"][1] == "trigger"
    assert io["input_assignments"][3] == "trigger"
    assert resolve_trigger_bits(io["input_assignments"]) == [1, 3]


def test_normalize_migrates_restart_input_role():
    io = normalize_io_assignments(
        {"input_assignments": ["trigger", "restart", "off", "off", "off", "off", "off", "off"]}
    )
    assert io["input_assignments"][1] == "off"


def test_normalize_comprehensive_logic_migration():
    assert normalize_io_assignments({"comprehensive_logic": 1})["comprehensive_logic"] == 1
    assert normalize_io_assignments({"comprehensive_logic": 2})["comprehensive_logic"] == 1
    assert normalize_io_assignments({"comprehensive_logic": 3})["comprehensive_logic"] == 2
    assert normalize_io_assignments({"comprehensive_logic": 4})["comprehensive_logic"] == 1
    assert normalize_io_assignments({"comprehensive_logic": 99})["comprehensive_logic"] == 1
    assert normalize_io_assignments({})["comprehensive_logic"] == 1
    migrated = normalize_io_assignments({"comprehensive_logic": 2})
    assert migrated["comprehensive_logic_v2"] is True


def test_normalize_comprehensive_logic_v2_passthrough():
    assert normalize_io_assignments({"comprehensive_logic": 2, "comprehensive_logic_v2": True})[
        "comprehensive_logic"
    ] == 2
    assert normalize_io_assignments({"comprehensive_logic": 3, "comprehensive_logic_v2": True})[
        "comprehensive_logic"
    ] == 3


def test_build_output_states_comprehensive_and_tools():
    assignments = [
        "link_ok",
        "result_ng",
        "tool:02",
        "tool:01",
        "off",
        "off",
        "off",
        "off",
    ]
    tool_results = [
        {"tool": "01", "passed": True},
        {"tool": "02", "passed": False},
    ]
    states = build_output_states(True, assignments, tool_results)
    assert states[1] is False
    assert states[2] is True
    assert states[3] is False
    assert 0 not in states


def test_build_output_states_ignores_running():
    assignments = ["link_ok", "running", "result_ng"] + ["off"] * 5
    states = build_output_states(False, assignments, [])
    assert 1 not in states
    assert states[2] is True


def test_normalize_sanitizes_removed_tool_assignments():
    io = normalize_io_assignments(
        {
            "output_assignments": [
                "link_ok",
                "tool:99",
                "tool:01",
                "off",
                "off",
                "off",
                "off",
                "off",
            ]
        },
        tools=[{"id": "01", "name": "色彩识别", "type": "hsv_roi", "enabled": True}],
    )
    assert io["output_assignments"][1] == "off"
    assert io["output_assignments"][2] == "tool:01"
