import threading

from src.api.cache import MetricsPayloadCache


def test_metrics_payload_cache_reuses_until_new_sample_or_window():
    cache = MetricsPayloadCache()
    calls = {"n": 0}

    def builder():
        calls["n"] += 1
        return {"v": calls["n"]}

    assert cache.get(15, "t1", builder)["v"] == 1
    assert cache.get(15, "t1", builder)["v"] == 1
    assert calls["n"] == 1
    assert cache.get(30, "t1", builder)["v"] == 2
    assert calls["n"] == 2
    assert cache.get(30, "t2", builder)["v"] == 3
    assert calls["n"] == 3


def test_metrics_payload_cache_builds_once_under_concurrency():
    cache = MetricsPayloadCache()
    calls = {"n": 0}
    barrier = threading.Barrier(4)
    results: list[dict] = []

    def builder():
        calls["n"] += 1
        return {"v": calls["n"]}

    def worker() -> None:
        barrier.wait()
        results.append(cache.get(15, "t1", builder))

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert calls["n"] == 1
    assert all(item["v"] == 1 for item in results)
