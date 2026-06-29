"""Modbus IO 占位实现（联调前仅记录输出）。"""

from __future__ import annotations

import logging

logger = logging.getLogger("markeye.io")


class ModbusIOService:
    """STEP4 输出分配 — 联调前 Mock 线圈写入。"""

    def __init__(self, config: dict):
        self.cfg = config.get("io", {})
        self._client = None

    @property
    def enabled(self) -> bool:
        return bool(self.cfg.get("enabled", False))

    def connect(self) -> bool:
        if not self.enabled:
            return False
        try:
            from pymodbus.client import ModbusTcpClient  # type: ignore

            self._client = ModbusTcpClient(
                self.cfg.get("host", "127.0.0.1"),
                port=self.cfg.get("port", 502),
            )
            return self._client.connect()
        except ImportError:
            logger.warning("pymodbus 未安装，IO 以日志模式运行")
            return False
        except Exception as exc:
            logger.warning("Modbus 连接失败: %s", exc)
            return False

    def disconnect(self) -> None:
        if self._client:
            self._client.close()
            self._client = None

    def write_result(self, passed: bool, trerr: bool = False) -> None:
        outputs = self.cfg.get("outputs", {})
        if trerr:
            logger.info("IO: TrERR（不驱动 OK/NG 线圈）")
            return
        coil = outputs.get("ok") if passed else outputs.get("ng")
        label = "OK" if passed else "NG"
        if not self.enabled:
            logger.debug("IO mock: %s coil=%s", label, coil)
            return
        if self._client and coil is not None:
            try:
                self._client.write_coil(coil, True, slave=self.cfg.get("unit_id", 1))
            except Exception as exc:
                logger.error("Modbus 写入失败: %s", exc)
        else:
            logger.info("IO: %s (coil=%s)", label, coil)

    def set_ready(self, ready: bool) -> None:
        coil = self.cfg.get("outputs", {}).get("ready")
        if coil is not None and self._client:
            try:
                self._client.write_coil(coil, ready, slave=self.cfg.get("unit_id", 1))
            except Exception:
                pass
