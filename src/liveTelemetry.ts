import { useEffect, useState } from "react";
import type { Position, Route, Telemetry } from "./types";

export interface Runtime {
  telemetryMode: "udp" | "mock";
  timeoutMs: number;
  udpPort: number;
}
export function useLiveTelemetry() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [frame, setFrame] = useState<Telemetry | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const ctrl = new AbortController();
    let stream: EventSource | undefined;
    let lastReceived = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    fetch("/api/runtime", { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("无法读取遥测配置");
        const config: Runtime = await r.json();
        if (!["udp", "mock"].includes(config.telemetryMode))
          throw new Error("遥测模式无效");
        if (ctrl.signal.aborted) return;
        setRuntime(config);
        if (config.telemetryMode === "mock") return;
        stream = new EventSource("/api/telemetry");
        stream.onmessage = (event) => {
          try {
            const next: Telemetry = JSON.parse(event.data);
            if (
              next.source !== "udp" ||
              !Array.isArray(next.position) ||
              next.position.length < 2 ||
              !next.position.every(Number.isFinite)
            )
              return;
            lastReceived = Date.now();
            setFrame(next);
            setError("");
          } catch {
            /* Malformed events never replace the last valid position. */
          }
        };
        stream.onerror = () =>
          setFrame((old) => old && { ...old, connected: false, speedKmh: 0 });
        timer = setInterval(() => {
          if (Date.now() - lastReceived > config.timeoutMs)
            setFrame((old) =>
              old?.connected ? { ...old, connected: false, speedKmh: 0 } : old,
            );
        }, 250);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => {
      ctrl.abort();
      stream?.close();
      clearInterval(timer);
    };
  }, []);
  return { runtime, frame, error };
}

/** Project onto route segments; progress uses the route's road lengths, not direct distance. */
export function matchProgress(position: Position, route?: Route) {
  if (!route) return 0;
  let best = Infinity,
    progress = 0;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1],
      b = route.points[i];
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((position[0] - a[0]) * dx + (position[1] - a[1]) * dz) /
          (dx * dx + dz * dz || 1),
      ),
    );
    const distance = Math.hypot(
      position[0] - a[0] - dx * t,
      position[1] - a[1] - dz * t,
    );
    if (distance < best) {
      best = distance;
      progress =
        route.cumulative[i - 1] +
        (route.cumulative[i] - route.cumulative[i - 1]) * t;
    }
  }
  return Math.min(route.distance, progress);
}
