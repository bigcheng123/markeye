"""Modbus IO — RTU 串口 / TCP，输入轮询与线圈输出。"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Optional

from .assignments import (
    IO_CHANNEL_COUNT,
    build_output_states,
    normalize_io_assignments,
    resolve_output_index,
    resolve_trigger_bits,
)

logger = logging.getLogger("markeye.io")

_PARITY_MAP = {"N": "N", "E": "E", "O": "O", "NONE": "N", "EVEN": "E", "ODD": "O"}


class ModbusIOService:
    """Modbus IO：分配表驱动 OUT/IN；Y1=链路 OK，Y2=综合 NG 等。"""

    def __init__(self, config: dict):
        self.cfg = normalize_io_assignments(config.get("io", {}), tools=config.get("tools"))
        self._client: Any = None
        self._connected = False
        self._last_error: str = ""
        self._pulse_timers: dict[int, threading.Timer] = {}
        self._pulse_lock = threading.Lock()
        self._prev_inputs: list[bool] = [False] * IO_CHANNEL_COUNT
        self.busy = False

    @property
    def enabled(self) -> bool:
        return bool(self.cfg.get("enabled", False))

    @property
    def transport(self) -> str:
        return str(self.cfg.get("transport", "tcp")).lower()

    @property
    def unit_id(self) -> int:
        return int(self.cfg.get("unit_id", 1))

    @property
    def output_assignments(self) -> list[str]:
        return list(self.cfg.get("output_assignments", []))

    @property
    def input_assignments(self) -> list[str]:
        return list(self.cfg.get("input_assignments", []))

    def is_connected(self) -> bool:
        return self._connected and self._client is not None

    def _link_ok_index(self) -> Optional[int]:
        return resolve_output_index(self.output_assignments, "link_ok")

    def _create_client(self) -> Any:
        if self.transport == "rtu":
            from pymodbus.client import ModbusSerialClient  # type: ignore

            parity = _PARITY_MAP.get(str(self.cfg.get("parity", "N")).upper(), "N")
            return ModbusSerialClient(
                port=self.cfg.get("serial_port", "COM4"),
                baudrate=int(self.cfg.get("baudrate", 9600)),
                bytesize=int(self.cfg.get("bytesize", 8)),
                parity=parity,
                stopbits=int(self.cfg.get("stopbits", 1)),
                timeout=float(self.cfg.get("timeout_s", 1.0)),
            )
        from pymodbus.client import ModbusTcpClient  # type: ignore

        return ModbusTcpClient(
            self.cfg.get("host", "127.0.0.1"),
            port=int(self.cfg.get("port", 502)),
        )

    def _modbus_call(self, method: str, *args, **kwargs):
        """兼容 pymodbus 2.x slave 与 3.x device_id 参数。"""
        fn = getattr(self._client, method)
        try:
            return fn(*args, device_id=self.unit_id, **kwargs)
        except TypeError:
            return fn(*args, slave=self.unit_id, **kwargs)

    def connect(self) -> bool:
        if not self.enabled:
            return False
        try:
            import pymodbus  # noqa: F401
        except ImportError:
            logger.warning("pymodbus 未安装，IO 以日志模式运行")
            self._connected = False
            self._last_error = "pymodbus_not_installed"
            return False

        retries = max(1, int(self.cfg.get("connect_retries", 3)))
        delay_s = float(self.cfg.get("connect_retry_delay_s", 1.0))
        for attempt in range(retries):
            if attempt > 0:
                wait = delay_s * attempt
                logger.info(
                    "Modbus 连接重试 %s/%s，等待 %.1fs（串口可能尚未释放）",
                    attempt + 1,
                    retries,
                    wait,
                )
                time.sleep(wait)
            if self._connect_once():
                return True
        return False

    def _connect_once(self) -> bool:
        self.disconnect()
        try:
            self._client = self._create_client()
            ok = bool(self._client.connect())
            self._connected = ok
            self._last_error = ""
            if ok:
                self._prev_inputs = [False] * IO_CHANNEL_COUNT
                seed = self.read_discrete_inputs(IO_CHANNEL_COUNT)
                if seed:
                    self._prev_inputs = list(seed[:IO_CHANNEL_COUNT])
                self.set_link_ok(True)
                label = self.cfg.get("serial_port") if self.transport == "rtu" else (
                    f"{self.cfg.get('host')}:{self.cfg.get('port', 502)}"
                )
                logger.info("Modbus %s 已连接: %s", self.transport.upper(), label)
            else:
                self.set_link_ok(False)
                self._last_error = "connect_failed"
                logger.warning("Modbus %s 连接失败", self.transport.upper())
            return ok
        except ImportError:
            logger.warning("pymodbus 未安装，IO 以日志模式运行")
            self._connected = False
            self._last_error = "pymodbus_not_installed"
            return False
        except PermissionError as exc:
            self._connected = False
            self._last_error = f"serial_permission_error: {exc}"
            self.set_link_ok(False)
            logger.warning("Modbus 串口被占用/拒绝访问: %s", exc)
            return False
        except Exception as exc:
            logger.warning("Modbus 连接失败: %s", exc)
            self._connected = False
            self._last_error = str(exc)
            self.set_link_ok(False)
            return False

    def _release_client(self) -> None:
        with self._pulse_lock:
            for t in self._pulse_timers.values():
                try:
                    t.cancel()
                except Exception:
                    pass
            self._pulse_timers = {}
        client = self._client
        was_connected = self._connected
        self._connected = False
        self._client = None
        if was_connected and client is not None:
            coil = self._link_ok_index()
            if coil is not None and self.enabled:
                try:
                    fn = getattr(client, "write_coil")
                    try:
                        fn(coil, False, device_id=self.unit_id)
                    except TypeError:
                        fn(coil, False, slave=self.unit_id)
                except Exception:
                    pass
        if client is not None:
            try:
                client.close()
            except Exception:
                pass

    def disconnect(self) -> None:
        self._release_client()

    def write_coil(self, address: int, value: bool) -> bool:
        if not self.enabled:
            logger.debug("IO mock: coil[%s]=%s", address, value)
            return True
        if not self.is_connected():
            return False
        try:
            result = self._modbus_call("write_coil", int(address), bool(value))
            if hasattr(result, "isError") and result.isError():
                logger.error("Modbus 写线圈失败: addr=%s", address)
                self._last_error = f"write_coil_failed: addr={address}"
                self._mark_disconnected()
                return False
            return True
        except Exception as exc:
            logger.error("Modbus 写入失败: %s", exc)
            self._last_error = f"write_coil_exception: {exc}"
            self._mark_disconnected()
            return False

    def apply_output_states(self, states: dict[int, bool]) -> None:
        pulse_ms = int(self.cfg.get("output_pulse_ms") or 0)

        def _schedule_off(addr: int, delay_s: float) -> None:
            def _off():
                # 定时回写 OFF：若此时已断线则 write_coil 会失败并标记断线
                self.write_coil(addr, False)

            timer = threading.Timer(delay_s, _off)
            timer.daemon = True
            with self._pulse_lock:
                old = self._pulse_timers.get(addr)
                if old:
                    try:
                        old.cancel()
                    except Exception:
                        pass
                self._pulse_timers[addr] = timer
            timer.start()

        for address, value in states.items():
            addr = int(address)
            val = bool(value)
            if not val:
                with self._pulse_lock:
                    old = self._pulse_timers.pop(addr, None)
                    if old:
                        try:
                            old.cancel()
                        except Exception:
                            pass
                self.write_coil(addr, False)
                continue

            # val=True
            if pulse_ms > 0:
                if self.write_coil(addr, True):
                    _schedule_off(addr, pulse_ms / 1000.0)
            else:
                self.write_coil(addr, True)

    def _mark_disconnected(self) -> None:
        self._release_client()

    def read_discrete_inputs(self, count: int = IO_CHANNEL_COUNT) -> Optional[list[bool]]:
        if not self.enabled or not self.is_connected():
            return None
        try:
            result = self._modbus_call("read_discrete_inputs", 0, count=int(count))
            if result is None or (hasattr(result, "isError") and result.isError()):
                logger.warning("Modbus 读离散输入失败")
                self._last_error = "read_discrete_inputs_failed"
                self._mark_disconnected()
                return None
            bits = getattr(result, "bits", None) or []
            return [bool(bits[i]) if i < len(bits) else False for i in range(count)]
        except Exception as exc:
            logger.warning("Modbus 读输入异常: %s", exc)
            self._last_error = f"read_discrete_inputs_exception: {exc}"
            self._mark_disconnected()
            return None

    def read_coils(self, count: int = IO_CHANNEL_COUNT) -> Optional[list[bool]]:
        """读线圈状态（Y1–Y8，FC01）。"""
        if not self.enabled or not self.is_connected():
            return None
        try:
            result = self._modbus_call("read_coils", 0, count=int(count))
            if result is None or (hasattr(result, "isError") and result.isError()):
                logger.warning("Modbus 读线圈失败")
                self._last_error = "read_coils_failed"
                self._mark_disconnected()
                return None
            bits = getattr(result, "bits", None) or []
            return [bool(bits[i]) if i < len(bits) else False for i in range(count)]
        except Exception as exc:
            logger.warning("Modbus 读线圈异常: %s", exc)
            self._last_error = f"read_coils_exception: {exc}"
            self._mark_disconnected()
            return None

    def get_channel_states(self) -> dict[str, list[bool]]:
        """当前 X/Y 通道电平（联调 UI 轮询）。"""
        blank = [False] * IO_CHANNEL_COUNT
        if not self.enabled:
            return {"input_bits": list(blank), "output_bits": list(blank)}
        inputs = self.read_discrete_inputs(IO_CHANNEL_COUNT)
        outputs = self.read_coils(IO_CHANNEL_COUNT)
        return {
            "input_bits": inputs if inputs is not None else list(blank),
            "output_bits": outputs if outputs is not None else list(blank),
        }

    def test_output(self, channel: int, value: bool) -> bool:
        """联调：写单路线圈（FC05）。"""
        ch = max(0, min(IO_CHANNEL_COUNT - 1, int(channel)))
        return self.write_coil(ch, bool(value))

    def set_link_ok(self, ok: bool) -> None:
        """通信成功线圈：ON=连接正常。"""
        coil = self._link_ok_index()
        if coil is None:
            return
        if not self.enabled:
            logger.debug("IO mock: link_ok(OUT%d)=%s", coil + 1, ok)
            return
        if ok and self.is_connected():
            self.write_coil(coil, True)
        elif not ok:
            if self._client:
                try:
                    self._modbus_call("write_coil", coil, False)
                except Exception:
                    pass
            else:
                logger.debug("IO: link_ok=OFF")

    def write_result(
        self,
        passed: bool,
        trerr: bool = False,
        tool_results: list[dict] | None = None,
    ) -> None:
        if trerr:
            logger.info("IO: TrERR（不驱动结果/工具线圈）")
            return

        states = build_output_states(passed, self.output_assignments, tool_results)
        if not self.enabled:
            logger.debug("IO mock: output states %s", states)
            return
        if states:
            self.apply_output_states(states)

    def set_running(self, running: bool) -> None:
        """运行中线圈：ON=程序处于运行模式。"""
        coil = resolve_output_index(self.output_assignments, "running")
        if coil is None:
            return
        if not self.enabled:
            logger.debug("IO mock: running(OUT%d)=%s", coil + 1, running)
            return
        if self.is_connected():
            self.write_coil(coil, running)

    def set_ready(self, ready: bool) -> None:
        coil = resolve_output_index(self.output_assignments, "ready")
        if coil is not None:
            self.write_coil(coil, ready)

    def _update_prev_inputs(self, inputs: list[bool]) -> None:
        self._prev_inputs = list(inputs[:IO_CHANNEL_COUNT])
        while len(self._prev_inputs) < IO_CHANNEL_COUNT:
            self._prev_inputs.append(False)

    def poll_input_edges(self) -> list[tuple[int, str]]:
        """检测输入分配表上升沿，返回 [(index, role), ...]。"""
        if self.busy:
            return []
        inputs = self.read_discrete_inputs(IO_CHANNEL_COUNT)
        if inputs is None:
            return []

        edges: list[tuple[int, str]] = []
        for i, role in enumerate(self.input_assignments):
            if role == "off":
                continue
            if i < len(inputs) and inputs[i] and not self._prev_inputs[i]:
                edges.append((i, role))

        self._update_prev_inputs(inputs)
        return edges

    def poll_trigger_edges(self) -> bool:
        """兼容旧接口：任一 trigger 上升沿。"""
        trigger_bits = resolve_trigger_bits(self.input_assignments)
        edges = self.poll_input_edges()
        return any(idx in trigger_bits and role == "trigger" for idx, role in edges)

    def status(self) -> dict:
        """当前 IO 连接与分配摘要。"""
        return {
            "enabled": self.enabled,
            "connected": self.is_connected(),
            "transport": self.transport,
            "unit_id": self.unit_id,
            "busy": self.busy,
            "last_error": self._last_error,
            "output_assignments": self.output_assignments,
            "input_assignments": self.input_assignments,
            "outputs": dict(self.cfg.get("outputs") or {}),
            "inputs": dict(self.cfg.get("inputs") or {}),
        }
