package collector

import (
	"context"
	"log"
	"sync"
	"time"

	"network-monitor/internal/config"
	"network-monitor/internal/store"
)

const pingTimeout = 1500 * time.Millisecond

type SampleHandler func(store.Sample)

type Collector struct {
	cfgMgr   *config.Manager
	store    *store.Store
	onSample SampleHandler

	mu      sync.Mutex
	jitter  JitterTracker
	target  string
	stop    context.CancelFunc
	wg      sync.WaitGroup
}

func New(cfgMgr *config.Manager, st *store.Store, onSample SampleHandler) *Collector {
	return &Collector{
		cfgMgr:   cfgMgr,
		store:    st,
		onSample: onSample,
		target:   cfgMgr.Get().Target,
	}
}

func (c *Collector) Start() {
	c.mu.Lock()
	if c.stop != nil {
		c.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.stop = cancel
	c.mu.Unlock()

	cfg := c.cfgMgr.Get()
	log.Printf(
		"action: collector started target=%s ping_interval_seconds=%g retention_minutes=%d",
		cfg.Target,
		cfg.PingIntervalSeconds,
		cfg.RetentionMinutes,
	)

	c.wg.Add(1)
	go c.loop(ctx)
}

func (c *Collector) Stop() {
	c.mu.Lock()
	cancel := c.stop
	c.stop = nil
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	c.wg.Wait()
	log.Printf("action: collector stopped")
}

func (c *Collector) loop(ctx context.Context) {
	defer c.wg.Done()

	for {
		cfg := c.cfgMgr.Get()
		if cfg.Target != c.target {
			log.Printf("action: collector target changed %s -> %s", c.target, cfg.Target)
			c.target = cfg.Target
			c.jitter.Reset()
		}

		started := time.Now()
		success, latency := Ping(ctx, cfg.Target, pingTimeout)

		var latencyPtr *float64
		var jitterPtr *float64
		if success {
			latencyPtr = &latency
			j := c.jitter.Update(latency)
			jitterPtr = &j
		} else {
			c.jitter.Reset()
		}

		sample := store.Sample{
			TS:        started.UTC().Format(time.RFC3339Nano),
			Host:      cfg.Target,
			Success:   success,
			LatencyMs: latencyPtr,
			JitterMs:  jitterPtr,
		}

		if err := c.store.Insert(sample); err != nil {
			log.Printf("store insert: %v", err)
		} else {
			cutoff := time.Now().Add(-time.Duration(cfg.RetentionMinutes) * time.Minute)
			if err := c.store.Prune(cutoff); err != nil {
				log.Printf("store prune: %v", err)
			}
			if c.onSample != nil {
				c.onSample(sample)
			}
		}

		interval := time.Duration(cfg.PingIntervalSeconds * float64(time.Second))
		elapsed := time.Since(started)
		sleep := interval - elapsed
		if sleep < 0 {
			sleep = 0
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(sleep):
		}
	}
}
