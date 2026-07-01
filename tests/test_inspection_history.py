"""inspection_history 单元测试。"""

import csv
from pathlib import Path

import pytest

from src.inspection_history import (
    InspectionHistoryStore,
    ng_items_from_tool_results,
    normalize_history_config,
)


def test_normalize_history_config_defaults():
    out = normalize_history_config({})
    assert out["save_policy"] == "none"
    assert out["history"]["enabled"] is False
    assert out["history"]["format"] == "csv"
    assert out["history"]["flush_on_idle_minutes"] == 50


def test_ng_items_from_tool_results():
    items = ng_items_from_tool_results(
        [
            {"name": "色彩识别", "passed": True},
            {"name": "轮廓", "passed": False, "fail_reasons": ["面积不足"]},
        ]
    )
    assert items == "轮廓:面积不足"


def test_record_disabled_no_buffer(tmp_path):
    store = InspectionHistoryStore(
        tmp_path,
        get_config=lambda: {"output": {"history": {"enabled": False}}},
        get_profile=lambda: "config.yaml",
    )
    store.record(passed=True, process_ms=10, seq=1)
    assert store.pending_count() == 0


def test_flush_writes_daily_csv(tmp_path):
    cfg = {
        "output": {
            "history": {
                "enabled": True,
                "dir": "output/history/",
                "flush_on_profile_switch": True,
                "flush_on_idle_minutes": 50,
            }
        }
    }
    store = InspectionHistoryStore(
        tmp_path,
        get_config=lambda: cfg,
        get_profile=lambda: "config.yaml",
    )
    store.record(
        passed=False,
        process_ms=42,
        seq=1,
        tool_results=[{"name": "T1", "passed": False}],
        timestamp="2026-07-01 10:00:00",
    )
    written = store.flush()
    assert written == 1
    assert store.pending_count() == 0
    path = tmp_path / "output" / "history" / "inspection_20260701.csv"
    assert path.exists()
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 1
    assert rows[0]["profile"] == "config.yaml"
    assert rows[0]["result"] == "NG"
    assert rows[0]["seq"] == "1"
    assert rows[0]["process_ms"] == "42"


def test_flush_skips_duplicate_seq_in_file(tmp_path):
    cfg = {"output": {"history": {"enabled": True, "dir": "output/history/"}}}
    store = InspectionHistoryStore(
        tmp_path,
        get_config=lambda: cfg,
        get_profile=lambda: "config.yaml",
    )
    store.record(passed=True, process_ms=5, seq=7, timestamp="2026-07-01 11:00:00")
    assert store.flush() == 1
    store.record(passed=True, process_ms=6, seq=7, timestamp="2026-07-01 11:01:00")
    assert store.pending_count() == 0
    store.record(passed=True, process_ms=8, seq=8, timestamp="2026-07-01 11:02:00")
    written = store.flush()
    assert written == 1
    path = tmp_path / "output" / "history" / "inspection_20260701.csv"
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    seqs = [int(r["seq"]) for r in rows]
    assert seqs.count(7) == 1
    assert 8 in seqs
