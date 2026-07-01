"""Modbus IO 单元测试（Mock 客户端，无需实机串口）。"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.io.modbus_client import ModbusIOService


def _rtu_config(**overrides) -> dict:
    base = {
        "io": {
            "enabled": True,
            "transport": "rtu",
            "serial_port": "COM4",
            "unit_id": 1,
            "output_assignments": [
                "link_ok",
                "result_ng",
                "off",
                "off",
                "off",
                "off",
                "off",
                "off",
            ],
            "input_assignments": [
                "trigger",
                "trigger",
                "off",
                "off",
                "off",
                "off",
                "off",
                "off",
            ],
        }
    }
    base["io"].update(overrides)
    return base


class _BitsResult:
    def __init__(self, bits: list[bool]):
        self.bits = bits

    def isError(self) -> bool:
        return False


class _OkResult:
    def isError(self) -> bool:
        return False


@pytest.fixture
def mock_client(monkeypatch):
    """注入 Mock Modbus 客户端，避免 import pymodbus 硬件依赖。"""
    client = MagicMock()
    client.connect.return_value = True
    client.read_discrete_inputs.return_value = _BitsResult([False] * 8)
    client.write_coil.return_value = _OkResult()

    def fake_create(_self):
        return client

    monkeypatch.setattr(
        "src.io.modbus_client.ModbusIOService._create_client",
        fake_create,
    )
    monkeypatch.setitem(__import__("sys").modules, "pymodbus", MagicMock())
    return client


def test_connect_sets_link_ok_coil(mock_client):
    svc = ModbusIOService(_rtu_config())
    assert svc.connect() is True
    assert svc.is_connected()
    mock_client.write_coil.assert_any_call(0, True, device_id=1)


def test_rising_edge_on_x1_triggers(mock_client):
    svc = ModbusIOService(_rtu_config())
    svc.connect()
    mock_client.read_discrete_inputs.return_value = _BitsResult(
        [True, False, False, False, False, False, False, False]
    )
    assert svc.poll_trigger_edges() is True
    mock_client.read_discrete_inputs.return_value = _BitsResult(
        [True, False, False, False, False, False, False, False]
    )
    assert svc.poll_trigger_edges() is False


def test_rising_edge_on_x2_triggers(mock_client):
    svc = ModbusIOService(_rtu_config())
    svc.connect()
    mock_client.read_discrete_inputs.return_value = _BitsResult(
        [False, True, False, False, False, False, False, False]
    )
    assert svc.poll_trigger_edges() is True


def test_busy_suppresses_trigger(mock_client):
    svc = ModbusIOService(_rtu_config())
    svc.connect()
    svc.busy = True
    mock_client.read_discrete_inputs.return_value = _BitsResult([True] + [False] * 7)
    assert svc.poll_trigger_edges() is False


def test_write_result_ok_writes_y2_off(mock_client):
    svc = ModbusIOService(_rtu_config())
    svc.connect()
    mock_client.write_coil.reset_mock()
    svc.write_result(True)
    mock_client.write_coil.assert_called_with(1, False, device_id=1)


def test_write_result_ng_writes_y2_on(mock_client):
    svc = ModbusIOService(_rtu_config())
    svc.connect()
    mock_client.write_coil.reset_mock()
    svc.write_result(False)
    mock_client.write_coil.assert_called_with(1, True, device_id=1)


def test_write_result_trerr_skips_y2(mock_client):
    svc = ModbusIOService(_rtu_config())
    svc.connect()
    mock_client.write_coil.reset_mock()
    svc.write_result(False, trerr=True)
    mock_client.write_coil.assert_not_called()


def test_disabled_io_logs_without_connect(mock_client):
    cfg = {"io": {"enabled": False}}
    svc = ModbusIOService(cfg)
    assert svc.connect() is False
    mock_client.connect.assert_not_called()
    svc.write_result(True)
    svc.write_result(False, trerr=True)


def test_connect_seeds_inputs_no_spurious_trigger(mock_client):
    """连接时 X1 已为 ON，不应在首次 poll 误触发。"""
    svc = ModbusIOService(_rtu_config())
    mock_client.read_discrete_inputs.return_value = _BitsResult(
        [True, False, False, False, False, False, False, False]
    )
    svc.connect()
    mock_client.read_discrete_inputs.return_value = _BitsResult(
        [True, False, False, False, False, False, False, False]
    )
    assert svc.poll_trigger_edges() is False


def test_write_result_with_tool_outputs(mock_client):
    cfg = _rtu_config(
        output_assignments=[
            "link_ok",
            "result_ng",
            "tool:02",
            "tool:01",
            "off",
            "off",
            "off",
            "off",
        ]
    )
    svc = ModbusIOService(cfg)
    svc.connect()
    mock_client.write_coil.reset_mock()
    tool_results = [
        {"tool": "01", "passed": True},
        {"tool": "02", "passed": False},
    ]
    svc.write_result(True, tool_results=tool_results)
    mock_client.write_coil.assert_any_call(1, False, device_id=1)
    mock_client.write_coil.assert_any_call(2, True, device_id=1)
    mock_client.write_coil.assert_any_call(3, False, device_id=1)


def test_poll_input_edges_switch_program(mock_client):
    cfg = _rtu_config(
        input_assignments=[
            "off",
            "switch_program",
            "off",
            "off",
            "off",
            "off",
            "off",
            "off",
        ]
    )
    svc = ModbusIOService(cfg)
    svc.connect()
    mock_client.read_discrete_inputs.return_value = _BitsResult(
        [False, True, False, False, False, False, False, False]
    )
    edges = svc.poll_input_edges()
    assert edges == [(1, "switch_program")]


def test_read_failure_marks_disconnected(mock_client):
    svc = ModbusIOService(_rtu_config())
    svc.connect()
    err = MagicMock()
    err.isError.return_value = True
    mock_client.read_discrete_inputs.return_value = err
    assert svc.read_discrete_inputs() is None
    assert not svc.is_connected()


def test_status_reports_assignments():
    svc = ModbusIOService(_rtu_config(enabled=False))
    st = svc.status()
    assert st["enabled"] is False
    assert st["connected"] is False
    assert st["transport"] == "rtu"
    assert st["outputs"]["link_ok"] == 0
    assert st["inputs"]["trigger_bits"] == [0, 1]


def test_read_coils_and_channel_states(mock_client):
    svc = ModbusIOService(_rtu_config())
    svc.connect()
    mock_client.read_coils.return_value = _BitsResult([True, False] + [False] * 6)
    coils = svc.read_coils()
    assert coils == [True, False] + [False] * 6
    states = svc.get_channel_states()
    assert states["output_bits"][0] is True
    assert states["input_bits"] == [False] * 8


def test_test_output_writes_coil(mock_client):
    svc = ModbusIOService(_rtu_config())
    svc.connect()
    mock_client.write_coil.reset_mock()
    assert svc.test_output(2, True) is True
    mock_client.write_coil.assert_called_with(2, True, device_id=1)
