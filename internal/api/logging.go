package api

import (
	"log"
	"net"
	"net/http"
)

func clientAddr(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func logAction(format string, args ...any) {
	log.Printf("action: "+format, args...)
}
