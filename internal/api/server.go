package api

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

//go:embed all:dist
var webDist embed.FS

type Server struct {
	httpServer *http.Server
	handlers   *Handlers
	sse        *SSEHub
}

func NewServer(cfgHost string, cfgPort int, handlers *Handlers, sse *SSEHub) *Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", handlers.Health)
	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handlers.GetConfig(w, r)
		case http.MethodPut:
			handlers.PutConfig(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/summary", handlers.Summary)
	mux.HandleFunc("/api/samples", handlers.Samples)
	mux.HandleFunc("/api/live", handlers.Live)
	mux.HandleFunc("/api/speedtest", handlers.SpeedTest)
	mux.HandleFunc("/api/speedtest/results", handlers.SpeedTestResults)
	mux.Handle("/api/events", sse)

	staticFS, err := fs.Sub(webDist, "dist")
	if err != nil {
		log.Printf("static fs: %v", err)
		staticFS = webDist
	}
	fileServer := http.FileServer(http.FS(staticFS))
	mux.Handle("/", spaHandler(staticFS, fileServer))

	addr := net.JoinHostPort(cfgHost, fmt.Sprintf("%d", cfgPort))
	return &Server{
		httpServer: &http.Server{
			Addr:              addr,
			Handler:           withCORS(mux),
			ReadHeaderTimeout: 10 * time.Second,
		},
		handlers: handlers,
		sse:      sse,
	}
}

func (s *Server) ListenAndServe() error {
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return s.httpServer.Shutdown(ctx)
}

func spaHandler(staticFS fs.FS, fileServer http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(staticFS, path); err != nil {
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Config-Token")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
