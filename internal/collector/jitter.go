package collector

import "math"

type JitterTracker struct {
	prev *float64
}

func (j *JitterTracker) Update(latencyMs float64) float64 {
	if j.prev == nil {
		j.prev = &latencyMs
		return 0
	}
	delta := math.Abs(latencyMs - *j.prev)
	j.prev = &latencyMs
	return delta
}

func (j *JitterTracker) Reset() {
	j.prev = nil
}
