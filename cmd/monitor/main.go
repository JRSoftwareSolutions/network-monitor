package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"network-monitor/internal/api"
	"network-monitor/internal/collector"
	"network-monitor/internal/config"
	"network-monitor/internal/store"
)

func main() {
	root, err := os.Getwd()
	if err != nil {
		log.Fatalf("cwd: %v", err)
	}

	cfgPath := filepath.Join(root, "config.yaml")
	if len(os.Args) > 1 {
		cfgPath = os.Args[1]
	}

	cfgMgr, err := config.NewManager(cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	cfg := cfgMgr.Get()

	st, err := store.Open(cfgMgr.DBPath())
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	startedAt := time.Now()
	sse := api.NewSSEHub()
	handlers := api.NewHandlers(cfgMgr, st, sse, startedAt)

	col := collector.New(cfgMgr, st, func(sample store.Sample) {
		sse.Broadcast("sample", sample)
	})
	col.Start()
	defer col.Stop()

	srv := api.NewServer(cfg.ListenHost, cfg.ListenPort, handlers, sse)

	logURLs(cfg.ListenHost, cfg.ListenPort)

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	<-ctx.Done()
	stop()

	if err := srv.Shutdown(); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func logURLs(host string, port int) {
	local := formatURL("127.0.0.1", port)
	log.Printf("Network Monitor listening on %s://%s:%d", "http", host, port)
	log.Printf("Local dashboard: %s", local)

	if host == "0.0.0.0" || host == "" {
		for _, ip := range lanIPs() {
			log.Printf("LAN dashboard: %s", formatURL(ip, port))
		}
	}
}

func formatURL(host string, port int) string {
	if host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, itoa(port))
}

func lanIPs() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var ips []string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			ip = ip.To4()
			if ip == nil {
				continue
			}
			ips = append(ips, ip.String())
		}
	}
	return ips
}

func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}
