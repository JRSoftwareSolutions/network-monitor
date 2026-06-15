import threading

from src.api.cache import MetricsCache


def test_metrics_cache_live_reuses_until_new_sample():
    cache = MetricsCache()
    calls = {"n": 0}

    def builder():
        calls["n"] += 1
        return {"v": calls["n"]}

    assert cache.get_live("t1", builder)["v"] == 1
    assert cache.get_live("t1", builder)["v"] == 1
    assert calls["n"] == 1
    assert cache.get_live("t2", builder)["v"] == 2
    assert calls["n"] == 2


def test_metrics_cache_builds_once_under_concurrency():
    cache = MetricsCache()
    calls = {"n": 0}
    barrier = threading.Barrier(4)
    results: list[dict] = []

    def builder():
        calls["n"] += 1
        return {"v": calls["n"]}

    def worker() -> None:
        barrier.wait()
        results.append(cache.get_live("t1", builder))

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert calls["n"] == 1
    assert all(item["v"] == 1 for item in results)
