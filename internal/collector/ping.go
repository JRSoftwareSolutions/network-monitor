package collector

import (
	"context"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var (
	subMillisPattern = regexp.MustCompile(`(?i)[=<]\s*1\s*ms`)
	latencyPattern   = regexp.MustCompile(`(?i)[=<]\s*(\d+(?:[.,]\d+)?)\s*ms`)
)

func ParsePingOutput(output string, returnCode int) (bool, float64) {
	if subMillisPattern.MatchString(output) {
		if returnCode != 0 && returnCode != 1 {
			return false, 0
		}
		return true, 0.5
	}
	match := latencyPattern.FindStringSubmatch(output)
	if match == nil {
		return false, 0
	}
	latency, err := strconv.ParseFloat(strings.ReplaceAll(match[1], ",", "."), 64)
	if err != nil {
		return false, 0
	}
	if returnCode != 0 && returnCode != 1 {
		return false, 0
	}
	return true, latency
}

func Ping(ctx context.Context, target string, timeout time.Duration) (bool, float64) {
	timeoutMs := int(timeout.Milliseconds())
	if timeoutMs < 100 {
		timeoutMs = 1000
	}

	var args []string
	switch runtime.GOOS {
	case "windows":
		args = []string{"-n", "1", "-w", strconv.Itoa(timeoutMs), target}
	default:
		sec := timeoutMs / 1000
		if sec < 1 {
			sec = 1
		}
		args = []string{"-c", "1", "-W", strconv.Itoa(sec), target}
	}

	cmdCtx, cancel := context.WithTimeout(ctx, timeout+2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, "ping", args...)
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}

	out, err := cmd.CombinedOutput()
	returnCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			returnCode = exitErr.ExitCode()
		} else if cmdCtx.Err() != nil {
			return false, 0
		}
	}
	return ParsePingOutput(string(out), returnCode)
}
