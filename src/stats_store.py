"""检测统计与履历持久化。"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

PERSIST_EVERY_N_RECORDS = 10


@dataclass
class StatsSnapshot:
    trigger_total: int = 0
    ok_count: int = 0
    ng_count: int = 0
    trerr_count: int = 0
    process_ms_max: Optional[int] = None
    process_ms_min: Optional[int] = None
    process_ms_ave: Optional[int] = None
    _process_history: list[int] = field(default_factory=list, repr=False)

    def to_dict(self) -> dict:
        return {
            "trigger_total": self.trigger_total,
            "ok_count": self.ok_count,
            "ng_count": self.ng_count,
            "trerr_count": self.trerr_count,
            "process_ms_max": self.process_ms_max,
            "process_ms_min": self.process_ms_min,
            "process_ms_ave": self.process_ms_ave,
        }

    @classmethod
    def from_dict(cls, data: dict) -> StatsSnapshot:
        snap = cls(
            trigger_total=data.get("trigger_total", 0),
            ok_count=data.get("ok_count", 0),
            ng_count=data.get("ng_count", 0),
            trerr_count=data.get("trerr_count", 0),
            process_ms_max=data.get("process_ms_max"),
            process_ms_min=data.get("process_ms_min"),
            process_ms_ave=data.get("process_ms_ave"),
        )
        snap._process_history = data.get("_process_history", [])
        return snap


class StatsStore:
    """OK/NG/TrERR 计数与处理耗时统计。"""

    def __init__(self, persist_path: Optional[str] = None):
        self._snap = StatsSnapshot()
        self.persist_path = Path(persist_path) if persist_path else None
        self._dirty = False
        self._writes_since_persist = 0
        if self.persist_path and self.persist_path.exists():
            self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.persist_path.read_text(encoding="utf-8"))
            self._snap = StatsSnapshot.from_dict(data)
        except (OSError, json.JSONDecodeError):
            pass

    def _persist(self) -> None:
        if not self.persist_path:
            return
        self.persist_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {**self._snap.to_dict(), "_process_history": self._snap._process_history}
        self.persist_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        self._dirty = False
        self._writes_since_persist = 0

    def _maybe_persist(self, *, force: bool = False) -> None:
        if force or self._writes_since_persist >= PERSIST_EVERY_N_RECORDS:
            if self._dirty:
                self._persist()

    def flush(self) -> None:
        """立即写盘（服务退出或 reset 时调用）。"""
        if self._dirty:
            self._persist()

    def record_success(self, passed: bool, process_ms: int) -> None:
        self._snap.trigger_total += 1
        if passed:
            self._snap.ok_count += 1
        else:
            self._snap.ng_count += 1
        self._record_process_ms(process_ms)
        self._dirty = True
        self._writes_since_persist += 1
        self._maybe_persist()

    def record_trerr(self) -> None:
        self._snap.trerr_count += 1
        self._dirty = True
        self._writes_since_persist += 1
        self._maybe_persist()

    def _record_process_ms(self, process_ms: int) -> None:
        hist = self._snap._process_history
        hist.append(process_ms)
        if len(hist) > 100:
            hist.pop(0)
        self._snap.process_ms_max = max(hist)
        self._snap.process_ms_min = min(hist)
        self._snap.process_ms_ave = round(sum(hist) / len(hist))

    def reset(self) -> None:
        self._snap = StatsSnapshot()
        self._dirty = True
        self._writes_since_persist = PERSIST_EVERY_N_RECORDS
        self._maybe_persist(force=True)

    def snapshot(self) -> dict:
        return self._snap.to_dict()
