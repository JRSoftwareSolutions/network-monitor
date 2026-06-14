from src.metrics_cache import MetricsCache


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
