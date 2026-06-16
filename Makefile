.PHONY: dev web build test run tidy sync-web

sync-web:
ifeq ($(OS),Windows_NT)
	powershell -NoProfile -Command "if (Test-Path internal/api/dist) { Remove-Item -Recurse -Force internal/api/dist }; New-Item -ItemType Directory -Force internal/api/dist | Out-Null; Copy-Item -Recurse web/dist/* internal/api/dist/"
else
	rm -rf internal/api/dist && mkdir -p internal/api/dist && cp -r web/dist/* internal/api/dist/
endif

web:
	cd web && npm install && npm run build
	$(MAKE) sync-web

build: web
	go build -o bin/monitor ./cmd/monitor

run: build
	./bin/monitor

dev-api:
	go run ./cmd/monitor

tidy:
	go mod tidy

test:
	go test ./...
