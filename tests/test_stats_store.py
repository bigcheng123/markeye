"""StatsStore 批量持久化测试。"""

from src.stats_store import PERSIST_EVERY_N_RECORDS, StatsStore


def test_stats_deferred_persist(tmp_path):
    path = tmp_path / "stats.json"
    store = StatsStore(str(path))

    for i in range(PERSIST_EVERY_N_RECORDS - 1):
        store.record_success(passed=True, process_ms=10 + i)

    assert not path.exists()

    store.record_success(passed=False, process_ms=20)
    assert path.exists()
    data = path.read_text(encoding="utf-8")
    assert "trigger_total" in data
    assert store.snapshot()["trigger_total"] == PERSIST_EVERY_N_RECORDS


def test_stats_flush_on_reset(tmp_path):
    path = tmp_path / "stats.json"
    store = StatsStore(str(path))
    store.record_success(passed=True, process_ms=5)
    store.reset()
    snap = store.snapshot()
    assert snap["trigger_total"] == 0
    assert path.exists()
