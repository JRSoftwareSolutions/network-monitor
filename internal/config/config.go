package config

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"

	"gopkg.in/yaml.v3"
)

var targetPattern = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9.\-:]*[a-zA-Z0-9])?$`)

type Thresholds struct {
	PingGreat   float64 `json:"ping_great" yaml:"ping_great"`
	PingGood    float64 `json:"ping_good" yaml:"ping_good"`
	PingOkay    float64 `json:"ping_okay" yaml:"ping_okay"`
	PingMax     float64 `json:"ping_max" yaml:"ping_max"`
	JitterGreat float64 `json:"jitter_great" yaml:"jitter_great"`
	JitterGood  float64 `json:"jitter_good" yaml:"jitter_good"`
	JitterOkay  float64 `json:"jitter_okay" yaml:"jitter_okay"`
	JitterMax   float64 `json:"jitter_max" yaml:"jitter_max"`
	LossGood    float64 `json:"loss_good" yaml:"loss_good"`
	LossOkay    float64 `json:"loss_okay" yaml:"loss_okay"`
	LossMax     float64 `json:"loss_max" yaml:"loss_max"`
}

type Config struct {
	Target              string  `yaml:"target"`
	PingIntervalSeconds float64 `yaml:"ping_interval_seconds"`
	RetentionMinutes    int     `yaml:"retention_minutes"`
	ListenHost          string  `yaml:"listen_host"`
	ListenPort          int     `yaml:"listen_port"`
	DataDir             string  `yaml:"data_dir"`
	Thresholds          Thresholds `yaml:"thresholds"`
}

type Manager struct {
	mu       sync.RWMutex
	path     string
	cfg      Config
	rootDir  string
}

func Default() Config {
	return Config{
		Target:              "1.1.1.1",
		PingIntervalSeconds: 1,
		RetentionMinutes:    180,
		ListenHost:          "127.0.0.1",
		ListenPort:          8080,
		DataDir:             "./data",
		Thresholds: Thresholds{
			PingGreat:   40,
			PingGood:    70,
			PingOkay:    110,
			PingMax:     200,
			JitterGreat: 8,
			JitterGood:  15,
			JitterOkay:  30,
			JitterMax:   60,
			LossGood:    1,
			LossOkay:    3,
			LossMax:     15,
		},
	}
}

func NewManager(path string) (*Manager, error) {
	rootDir := filepath.Dir(path)
	if rootDir == "." {
		var err error
		rootDir, err = os.Getwd()
		if err != nil {
			return nil, err
		}
	}

	m := &Manager{path: path, rootDir: rootDir, cfg: Default()}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := m.Save(); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else if err := m.Load(); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *Manager) Load() error {
	data, err := os.ReadFile(m.path)
	if err != nil {
		return err
	}
	cfg := Default()
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return err
	}
	if err := cfg.Validate(); err != nil {
		return err
	}
	m.mu.Lock()
	m.cfg = cfg
	m.mu.Unlock()
	return nil
}

func (m *Manager) Save() error {
	m.mu.RLock()
	data, err := yaml.Marshal(m.cfg)
	m.mu.RUnlock()
	if err != nil {
		return err
	}
	return os.WriteFile(m.path, data, 0o644)
}

func (m *Manager) Get() Config {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg
}

func (m *Manager) Update(patch ConfigUpdate) (Config, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if patch.Target != nil {
		if err := validateTarget(*patch.Target); err != nil {
			return m.cfg, err
		}
		m.cfg.Target = *patch.Target
	}
	if patch.PingIntervalSeconds != nil {
		v := *patch.PingIntervalSeconds
		if v < 0.25 || v > 60 {
			return m.cfg, fmt.Errorf("ping_interval_seconds must be between 0.25 and 60")
		}
		m.cfg.PingIntervalSeconds = v
	}
	if patch.RetentionMinutes != nil {
		v := *patch.RetentionMinutes
		if v < 5 || v > 1440 {
			return m.cfg, fmt.Errorf("retention_minutes must be between 5 and 1440")
		}
		m.cfg.RetentionMinutes = v
	}
	if err := m.cfg.Validate(); err != nil {
		return m.cfg, err
	}
	if err := os.WriteFile(m.path, mustYAML(m.cfg), 0o644); err != nil {
		return m.cfg, err
	}
	return m.cfg, nil
}

type ConfigUpdate struct {
	Target              *string  `json:"target"`
	PingIntervalSeconds *float64 `json:"ping_interval_seconds"`
	RetentionMinutes    *int     `json:"retention_minutes"`
}

func (c *Config) Validate() error {
	if err := validateTarget(c.Target); err != nil {
		return err
	}
	if c.PingIntervalSeconds < 0.25 || c.PingIntervalSeconds > 60 {
		return fmt.Errorf("ping_interval_seconds must be between 0.25 and 60")
	}
	if c.RetentionMinutes < 5 || c.RetentionMinutes > 1440 {
		return fmt.Errorf("retention_minutes must be between 5 and 1440")
	}
	if c.ListenPort < 1 || c.ListenPort > 65535 {
		return fmt.Errorf("listen_port must be between 1 and 65535")
	}
	if c.ListenHost == "" {
		c.ListenHost = "127.0.0.1"
	}
	if c.DataDir == "" {
		c.DataDir = "./data"
	}
	return nil
}

func (m *Manager) DBPath() string {
	cfg := m.Get()
	return filepath.Join(m.resolvePath(cfg.DataDir), "monitor.db")
}

func (m *Manager) resolvePath(p string) string {
	if filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(m.rootDir, p)
}

func validateTarget(target string) error {
	if target == "" || len(target) > 253 {
		return fmt.Errorf("invalid target")
	}
	if !targetPattern.MatchString(target) {
		return fmt.Errorf("invalid target format")
	}
	return nil
}

func mustYAML(cfg Config) []byte {
	data, err := yaml.Marshal(cfg)
	if err != nil {
		panic(err)
	}
	return data
}
