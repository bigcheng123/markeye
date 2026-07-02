"""IO 切换程序（switch_program）端到端测试。"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from src import web_server


def _two_profile_setup(tmp_path, *, auto_switch: dict | None = None) -> None:
    config_dir = tmp_path / "config"
    config_dir.mkdir(exist_ok=True)
    (config_dir / "config.yaml").write_text(
        "trigger:\n  source: external\nio:\n  auto_switch:\n    enabled: false\n",
        encoding="utf-8",
    )
    (config_dir / "other.yaml").write_text(
        "trigger:\n  source: internal\nio:\n  auto_switch:\n    enabled: false\n",
        encoding="utf-8",
    )
    web_server.state.config_store.config_dir = config_dir
    web_server.state.config_store._active = "config.yaml"
    web_server.state.config_store._cache = None
    if auto_switch is not None:
        cfg = web_server.state.config_store.load()
        cfg.setdefault("io", {})["auto_switch"] = auto_switch
        web_server.state.config_store.save(cfg)


class _BitsResult:
    def __init__(self, bits: list[bool]):
        self.bits = bits

    def isError(self) -> bool:
        return False


@pytest.fixture
def io_client(tmp_path, monkeypatch):
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True)
    master_dir = tmp_path / "data" / "masters" / "config"
    master_dir.mkdir(parents=True)
    monkeypatch.setattr(web_server, "ROOT", tmp_path)
    _two_profile_setup(tmp_path)
    web_server.state = web_server.AppState()
    web_server.state.config_store.config_dir = config_dir
    web_server.state.calibration.master_dir = master_dir
    return web_server.state


def test_io_switch_program_end_to_end(io_client, monkeypatch):
    """IN3 上升沿 → 检测边沿 → 轮换下一配方。"""
    client = MagicMock()
    client.connect.return_value = True
    ok_result = MagicMock()
    ok_result.isError.return_value = False
    client.write_coil.return_value = ok_result
    client.read_discrete_inputs.return_value = _BitsResult([False] * 8)
    monkeypatch.setattr(
        "src.io.modbus_client.ModbusIOService._create_client",
        lambda _self: client,
    )
    monkeypatch.setitem(__import__("sys").modules, "pymodbus", MagicMock())

    cfg = io_client.config_store.get_cached()
    cfg["io"] = {
        "enabled": True,
        "transport": "rtu",
        "serial_port": "COM4",
        "unit_id": 1,
        "input_assignments": [
            "trigger",
            "trigger",
            "switch_program",
            "off",
            "off",
            "off",
            "off",
            "off",
        ],
        "output_assignments": ["link_ok", "result_ng", "off", "off", "off", "off", "off", "off"],
        "auto_switch": {"enabled": False},
    }
    io_client.config_store.save(cfg)
    io_client.reload_services()
    client.read_discrete_inputs.return_value = _BitsResult([False] * 8)
    assert io_client.io.connect() is True
    io_client.io.poll_input_edges()

    client.read_discrete_inputs.return_value = _BitsResult(
        [False, False, True, False, False, False, False, False]
    )
    edges = io_client.io.poll_input_edges()
    assert edges == [(2, "switch_program")]

    asyncio.run(web_server._handle_io_switch_program())

    assert io_client.config_store._active == "other.yaml"
    assert io_client.config_store.get_cached()["trigger"]["source"] == "internal"


def test_io_switch_program_cycles_back_to_first(io_client):
    _two_profile_setup(io_client.config_store.config_dir.parent)
    io_client.config_store.switch("other.yaml")

    asyncio.run(web_server._handle_io_switch_program())

    assert io_client.config_store._active == "config.yaml"


def test_io_switch_program_uses_auto_switch_target(io_client):
    _two_profile_setup(
        io_client.config_store.config_dir.parent,
        auto_switch={"enabled": True, "ok_program": "other.yaml", "ng_program": None},
    )

    asyncio.run(web_server._handle_io_switch_program())

    assert io_client.config_store._active == "other.yaml"


def test_io_switch_program_skips_when_only_one_profile(io_client, tmp_path):
    config_dir = tmp_path / "config"
    (config_dir / "other.yaml").unlink()

    asyncio.run(web_server._handle_io_switch_program())

    assert io_client.config_store._active == "config.yaml"


def test_io_switch_program_notifies_websocket(io_client):
    received: list[dict] = []

    class _MockWs:
        async def send_json(self, data):
            received.append(data)

    io_client.ws_clients.add(_MockWs())
    asyncio.run(web_server._notify_profile_switch("other.yaml"))

    assert len(received) == 1
    assert received[0]["type"] == "profile_switch"
    assert received[0]["active"] == "other.yaml"
    assert any(p["name"] == "other.yaml" for p in received[0]["profiles"])


def test_io_switch_program_broadcasts_idle_frame(io_client):
    frames: list[dict] = []
    original_broadcast = io_client.broadcast

    async def capture_broadcast(payload):
        frames.append(payload)
        await original_broadcast(payload)

    io_client.broadcast = capture_broadcast

    asyncio.run(web_server._handle_io_switch_program())

    assert io_client.config_store._active == "other.yaml"
    assert frames
    assert frames[-1].get("type") == "frame"
