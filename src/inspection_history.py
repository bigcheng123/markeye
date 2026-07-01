"""检测履历 CSV 缓冲与按日落盘。"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

CSV_COLUMNS = ("timestamp", "profile", "result", "ng_items", "process_ms", "seq")
CSV_BOM = "\ufeff"


def normalize_history_config(output: dict | None) -> dict:
    """归一化 output.history 默认值。"""
    out = dict(output or {})
    hist = dict(out.get("history") or {})
    hist.setdefault("enabled", False)
    hist.setdefault("format", "csv")
    hist.setdefault("dir", "output/history/")
    hist.setdefault("flush_on_profile_switch", True)
    try:
        idle = int(hist.get("flush_on_idle_minutes", 50))
    except (TypeError, ValueError):
        idle = 50
    hist["flush_on_idle_minutes"] = max(0, idle)
    out["history"] = hist
    policy = out.get("save_policy", "none")
    if policy not in ("none", "ok", "ng", "all"):
        policy = "none"
    out["save_policy"] = policy
    out.setdefault("save_dir", "output/images/")
    return out


def ng_items_from_tool_results(tool_results: list[dict] | None) -> str:
    """从工具结果提取 NG 项目描述。"""
    parts: list[str] = []
    for t in tool_results or []:
        if not isinstance(t, dict) or t.get("passed") is not False:
            continue
        name = t.get("name") or t.get("tool") or "tool"
        reasons = t.get("fail_reasons") or []
        if reasons:
            parts.append(f"{name}:{';'.join(str(r) for r in reasons)}")
        else:
            parts.append(str(name))
    return ";".join(parts)


@dataclass
class HistoryRecord:
    timestamp: str
    profile: str
    result: str
    ng_items: str
    process_ms: int
    seq: int


@dataclass
class InspectionHistoryStore:
    """内存缓冲检测履历，按配置时机写入 CSV。"""

    project_root: Path
    get_config: Callable[[], dict]
    get_profile: Callable[[], str]
    _buffer: list[HistoryRecord] = field(default_factory=list, repr=False)
    _seen_seqs: set[int] = field(default_factory=set, repr=False)

    def _history_cfg(self) -> dict:
        output = normalize_history_config(self.get_config().get("output"))
        return output["history"]

    def _history_dir(self) -> Path:
        hist = self._history_cfg()
        return self.project_root / Path(str(hist.get("dir", "output/history/")))

    def enabled(self) -> bool:
        return bool(self._history_cfg().get("enabled"))

    def flush_on_profile_switch(self) -> bool:
        return bool(self._history_cfg().get("flush_on_profile_switch"))

    def flush_on_idle_minutes(self) -> int:
        return int(self._history_cfg().get("flush_on_idle_minutes", 0))

    def record(
        self,
        *,
        passed: bool,
        process_ms: int,
        seq: int,
        tool_results: list[dict] | None = None,
        profile: Optional[str] = None,
        timestamp: Optional[str] = None,
    ) -> None:
        if not self.enabled():
            return
        if seq in self._seen_seqs:
            return
        ts = timestamp or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        prof = profile if profile is not None else self.get_profile()
        rec = HistoryRecord(
            timestamp=ts,
            profile=prof,
            result="OK" if passed else "NG",
            ng_items=ng_items_from_tool_results(tool_results),
            process_ms=int(process_ms),
            seq=int(seq),
        )
        self._buffer.append(rec)
        self._seen_seqs.add(rec.seq)

    def pending_count(self) -> int:
        return len(self._buffer)

    def _file_for_date(self, day: datetime) -> Path:
        name = f"inspection_{day.strftime('%Y%m%d')}.csv"
        return self._history_dir() / name

    def _load_existing_seqs(self, path: Path) -> set[int]:
        if not path.exists():
            return set()
        seqs: set[int] = set()
        try:
            with path.open("r", encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        seqs.add(int(row.get("seq", 0)))
                    except (TypeError, ValueError):
                        continue
        except OSError:
            pass
        return seqs

    def flush(self, *, force: bool = False) -> int:
        """将缓冲写入 CSV；返回写入行数。失败时保留缓冲。"""
        if not self._buffer and not force:
            return 0
        if not self._buffer:
            return 0

        hist_dir = self._history_dir()
        hist_dir.mkdir(parents=True, exist_ok=True)

        by_file: dict[Path, list[HistoryRecord]] = {}
        for rec in self._buffer:
            try:
                day = datetime.strptime(rec.timestamp[:10], "%Y-%m-%d")
            except ValueError:
                day = datetime.now()
            path = self._file_for_date(day)
            by_file.setdefault(path, []).append(rec)

        written = 0
        remaining: list[HistoryRecord] = []

        for path, records in by_file.items():
            existing = self._load_existing_seqs(path)
            to_write = [r for r in records if r.seq not in existing]
            if not to_write:
                continue
            new_file = not path.exists()
            try:
                with path.open("a", encoding="utf-8-sig", newline="") as f:
                    writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
                    if new_file:
                        writer.writeheader()
                    for rec in to_write:
                        writer.writerow(
                            {
                                "timestamp": rec.timestamp,
                                "profile": rec.profile,
                                "result": rec.result,
                                "ng_items": rec.ng_items,
                                "process_ms": rec.process_ms,
                                "seq": rec.seq,
                            }
                        )
                        existing.add(rec.seq)
                        written += 1
            except OSError:
                remaining.extend(records)
                continue

        if remaining:
            self._buffer = remaining
        else:
            self._buffer = []

        return written
