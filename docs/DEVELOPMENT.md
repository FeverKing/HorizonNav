# Development

## Requirements

- Go 1.23+
- Node.js 22.6+ and npm (22.6+ is required for the TypeScript test runner)
- Python 3 only for the release packaging script

## Local development

```bash
npm ci
npm run dev
```

The launcher builds the frontend and Go server, then starts both:

| Service | Address | Purpose |
| --- | --- | --- |
| Vite | `127.0.0.1:5174` | Frontend with hot reload |
| Go HTTP | `127.0.0.1:5175` | API, proxied by Vite under `/api` |
| Go UDP | `127.0.0.1:9998` | Telemetry receiver |

Development uses `config.dev.yaml` in `mock` mode. The simulation toolbar only appears with a development frontend and mock backend. Switch `telemetry.mode` to `udp` and restart to test live packets. Go changes require restarting the launcher. Ctrl+C stops both processes. If changing the development HTTP port, update the Vite proxy as well.

## Architecture

| File | Responsibility |
| --- | --- |
| `main.go` | HTTP API, SSE, frontend hosting, startup/shutdown |
| `config.go` | Strict YAML parsing, path resolution and validation |
| `router.go` | External CSR graph, Dijkstra, alternatives, directions, road snapping |
| `telemetry.go` | UDP decoding, independent forwarding queues, stale-data detection |
| `src/App.tsx` | Search, route selection, navigation and user interface |
| `src/MapView.tsx` | Leaflet map, camera, compass, routes and scale |
| `src/liveTelemetry.ts` | Runtime config, SSE client and route-progress projection |
| `src/telemetry.ts` | Mock driving provider |
| `src/useRecovery.ts` | Deviation detection, rerouting and return-to-road state |

Data flows from game UDP packets to the Go receiver. Raw packets are copied into each forwarding target’s bounded queue before decoding. Recognized packets update the latest telemetry frame. SSE publishes at most 20 Hz; the browser projects position onto the selected route and updates guidance. Stale data never silently switches to mock.

Coordinates are game-world metres `[X, Z, Y]`, not latitude/longitude. Routing respects directed arcs; complete turn restrictions and height-aware map matching are not implemented. Keep `data/graph.json`, `data/roads.json`, and the corresponding frontend road/map assets in sync. Data updates take effect after restarting the server.

## APIs

- `GET /api/health`: service and graph status.
- `GET /api/runtime`: telemetry mode, UDP port and timeout.
- `GET /api/telemetry`: SSE normalized frames.
- `GET /api/telemetry/status`: receive, decode, forwarding and drop counters.
- `POST /api/route`: `{from:[x,z], to:[x,z], destination:"name"}`.
- `POST /api/snap`: `{position:[x,z]}`.
- `POST /api/mock-event`: `{position,kind:"road"|"terrain",routePoints}`; mock mode only.

HTTP request bodies are limited to 8 KB. Routing concurrency is bounded. Each forwarding queue holds 256 packets; a slow target drops its own new packets rather than blocking other targets. SSE clients do not accumulate frames. `IsRaceOn=0` and telemetry timeout both suspend effective live navigation.

## Validation

```bash
npm run check
go vet ./...
npm run test:race
```

Tests cover directed and unreachable paths, all 74 landmarks, route metrics and deduplication, external-data validation, YAML config, packet decoding, two-target byte-for-byte forwarding, forwarding disabled/self-loop cases, stale frames, HTTP/SSE and frontend route projection. The race detector requires a supported C toolchain.

Synthetic packets are not a substitute for real-game validation. Verify coordinates, heading calibration, packet length, multilayer roads, route loops and reconnect behavior against actual gameplay before claiming compatibility.

## Production and releases

```bash
npm run build
go build -trimpath -o HorizonNav .
./HorizonNav
```

On Windows use `-o HorizonNav.exe`. The executable reads `config.yaml` beside itself; `-config` overrides the location. Frontend and routing paths are relative to the configuration, not the shell’s working directory. Routing data is external, not embedded.

```bash
python3 scripts/package.py
python3 scripts/package.py --targets windows-amd64 darwin-arm64 linux-amd64 --out ./releases
```

The script builds the frontend, cross-compiles Go with `CGO_ENABLED=0`, copies `dist/`, `data/`, config and usage notes, and creates ZIP files. Preserve executable permissions on macOS/Linux. Smoke-test the native package from outside the source directory. Cross-compilation alone does not verify runtime behavior on Windows/Linux.

For a release, commit the tested sources, create an annotated version tag, build packages from that revision, generate SHA-256 checksums, then upload the archives and checksum file to GitHub Releases. Never include `node_modules`, development caches, credentials or local test configs.

Third-party notices are in `docs/licenses/` and copied into release `dist/licenses/`. See `docs/SOURCE-DATA.md` for map-data provenance.
