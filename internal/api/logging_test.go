package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientAddr(t *testing.T) {
	cases := []struct {
		name       string
		remoteAddr string
		want       string
	}{
		{name: "ipv4", remoteAddr: "192.168.1.10:54321", want: "192.168.1.10"},
		{name: "loopback", remoteAddr: "127.0.0.1:8080", want: "127.0.0.1"},
		{name: "no port", remoteAddr: "127.0.0.1", want: "127.0.0.1"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tc.remoteAddr
			if got := clientAddr(req); got != tc.want {
				t.Fatalf("clientAddr=%q want %q", got, tc.want)
			}
		})
	}
}
