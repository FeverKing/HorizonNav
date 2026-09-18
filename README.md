# HorizonNav

[English](README.md) | [简体中文](README.zh-CN.md)

A navigation companion for Forza Horizon: interactive maps, route planning, turn guidance, automatic rerouting, and live UDP telemetry with multi-target forwarding.

## Screenshots

<p>
  <img src="docs/screenshots/route.png" alt="Route planning" width="260" />
  <img src="docs/screenshots/navigation.png" alt="Navigation with simulated telemetry" width="260" />
</p>

Screenshots use simulated telemetry.

## Quick start

1. Download your platform package from [Releases](https://github.com/FeverKing/HorizonNav/releases).
2. Extract the entire folder and edit `config.yaml` if needed.
3. Run `HorizonNav.exe` on Windows, or `./HorizonNav` on macOS/Linux.
4. Open **http://localhost:5173**. On a phone, use your computer’s LAN IP and the same port.
5. Enable **Data Out** in the game. Set the destination to your computer’s IP and UDP port **9999**.

No Node.js, Go, Python, or database is required to run a release package.

```text
HorizonNav.exe       # HorizonNav on macOS/Linux
config.yaml
dist/                # Frontend and map assets
data/                # External routing graph
```

## Configuration

Edit `config.yaml`, then restart:

- `http.host` / `http.port`: web server address (default `0.0.0.0:5173`).
- `frontend.path`: frontend directory (default `./dist`).
- `data.path`: external routing data directory (default `./data`).
- `telemetry.host` / `telemetry.port`: UDP receiver (default `0.0.0.0:9999`).
- `telemetry.mode`: `udp` for live data, `mock` for simulated driving.
- `telemetry.forward.enabled`: enable raw UDP forwarding; list destinations under `targets`.

```yaml
forward:
  enabled: true
  targets:
    - "127.0.0.1:10000"
    - "192.168.1.20:10001"
```

Place this block under `telemetry`. Do not forward back to the receiver or create forwarding loops.

The default config is loaded from beside the executable. Relative paths are resolved against the config file. Use `HorizonNav -config /path/to/config.yaml` to select another config.

## Notes

Use on a trusted local network; the web server has no authentication. Allow the configured TCP/UDP ports through your firewall when connecting from other devices. Packages are not code-signed.

See [Development](docs/DEVELOPMENT.md), [Telemetry](docs/TELEMETRY.md), and [Map data](docs/SOURCE-DATA.md) for details.
