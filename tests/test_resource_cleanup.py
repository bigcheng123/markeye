"""硬件资源清理与进程锁单元测试。"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from src.io.modbus_client import ModbusIOService
from src.process_lock import LOCK_PATH, acquire_process_lock, release_process_lock
from src.resource_cleanup import cleanup_hardware, reset_cleanup_state


def _rtu_config(**overrides) -> dict:
    base = {
        "io": {
            "enabled": True,
            "transport": "rtu",
            "serial_port": "COM4",
            "unit_id": 1,
            "connect_retries": 2,
            "connect_retry_delay_s": 0.01,
            "output_assignments": ["link_ok"] + ["off"] * 7,
            "input_assignments": ["off"] * 8,
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


@pytest.fixture(autouse=True)
def _reset_cleanup():
    reset_cleanup_state()
    yield
    reset_cleanup_state()
    release_process_lock()


@pytest.fixture
def mock_modbus(monkeypatch):
    client = MagicMock()
    client.connect.return_value = True
    client.read_discrete_inputs.return_value = _BitsResult([False] * 8)
    client.write_coil.return_value = _OkResult()

    monkeypatch.setattr(
        "src.io.modbus_client.ModbusIOService._create_client",
        lambda self: client,
    )
    monkeypatch.setitem(__import__("sys").modules, "pymodbus", MagicMock())
    return client


def test_cleanup_hardware_idempotent():
    camera = MagicMock()
    io = MagicMock()
    cleanup_hardware(camera, io, reason="test")
    cleanup_hardware(camera, io, reason="test")
    camera.disconnect.assert_called_once()
    io.disconnect.assert_called_once()


def test_process_lock_acquire_and_release(tmp_path, monkeypatch):
    lock = tmp_path / "markeye.lock"
    monkeypatch.setattr("src.process_lock.LOCK_PATH", lock)
    acquire_process_lock()
    assert lock.read_text(encoding="utf-8") == str(os.getpid())
    release_process_lock()
    assert not lock.exists()


def test_process_lock_rejects_live_pid(tmp_path, monkeypatch):
    lock = tmp_path / "markeye.lock"
    monkeypatch.setattr("src.process_lock.LOCK_PATH", lock)
    lock.write_text(str(os.getpid()), encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        acquire_process_lock()
    assert exc.value.code == 1


def test_process_lock_clears_stale_pid(tmp_path, monkeypatch):
    lock = tmp_path / "markeye.lock"
    monkeypatch.setattr("src.process_lock.LOCK_PATH", lock)
    lock.write_text("999999999", encoding="utf-8")
    acquire_process_lock()
    assert lock.read_text(encoding="utf-8") == str(os.getpid())


def test_mark_disconnected_closes_client(mock_modbus):
    svc = ModbusIOService(_rtu_config())
    assert svc.connect() is True
    svc._mark_disconnected()
    assert not svc.is_connected()
    assert svc._client is None
    mock_modbus.close.assert_called()


def test_connect_retries_on_failure(mock_modbus, monkeypatch):
    calls = {"n": 0}

    def flaky_connect():
        calls["n"] += 1
        return calls["n"] >= 2

    mock_modbus.connect.side_effect = flaky_connect
    monkeypatch.setattr("src.io.modbus_client.time.sleep", lambda _: None)

    svc = ModbusIOService(_rtu_config(connect_retries=3, connect_retry_delay_s=0.01))
    assert svc.connect() is True
    assert calls["n"] == 2


def test_register_hardware_cleanup_registers_once():
    from src.resource_cleanup import register_hardware_cleanup

    camera = MagicMock()
    io = MagicMock()
    with patch("src.resource_cleanup.atexit.register") as reg:
        register_hardware_cleanup(camera, io, label="test")
        register_hardware_cleanup(camera, io, label="test")
        reg.assert_called_once()


def test_system_shutdown_endpoint(monkeypatch):
    from fastapi.testclient import TestClient

    from src import web_server

    monkeypatch.setattr(web_server, "acquire_process_lock", lambda: None)
    monkeypatch.setattr(web_server, "release_process_lock", lambda: None)

    async def fake_shutdown():
        pass

    monkeypatch.setattr(web_server, "_schedule_shutdown", fake_shutdown)

    config_dir = web_server.ROOT / "config"
    web_server.state = web_server.AppState()
    client = TestClient(web_server.app)
    res = client.post("/api/system/shutdown")
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_cameras_disconnect_endpoint(monkeypatch):
    from fastapi.testclient import TestClient

    from src import web_server

    monkeypatch.setattr(web_server, "acquire_process_lock", lambda: None)
    monkeypatch.setattr(web_server, "release_process_lock", lambda: None)
    web_server.state = web_server.AppState()
    web_server.state.camera.disconnect = MagicMock()

    client = TestClient(web_server.app)
    res = client.post("/api/cameras/disconnect")
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    web_server.state.camera.disconnect.assert_called_once()
