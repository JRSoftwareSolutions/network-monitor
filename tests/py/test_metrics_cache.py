from src.server import MetricsCache


def test_metrics_cache_live_reuses_until_new_sample():
    cache = MetricsCache()
    calls = {"n": 0}

    def builder():
        calls["n"] += 1
        return {"v": calls["n"]}

    assert cache.get("live", 0, "t1", builder)["v"] == 1
    assert cache.get("live", 0, "t1", builder)["v"] == 1
    assert calls["n"] == 1
    assert cache.get("live", 0, "t2", builder)["v"] == 2
    assert calls["n"] == 2


def test_metrics_cache_full_always_rebuilds():
    cache = MetricsCache()
    calls = {"n": 0}

    def builder():
        calls["n"] += 1
        return {"v": calls["n"]}

    assert cache.get("full", 30, "t1", builder)["v"] == 1
    assert cache.get("full", 30, "t1", builder)["v"] == 2
    assert calls["n"] == 2
