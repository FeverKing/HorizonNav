import { useEffect, useRef, useState } from "react";
import type { Position, Route, Telemetry, Settings } from "./types";
export function sampleRoute(route: Route, metres: number) {
  const d = Math.max(0, Math.min(metres, route.distance));
  let lo = 0,
    hi = route.cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (route.cumulative[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const i = Math.min(lo, route.points.length - 2),
    a = route.points[i],
    b = route.points[i + 1],
    length = route.cumulative[i + 1] - route.cumulative[i],
    t = Math.max(
      0,
      Math.min(1, (d - route.cumulative[i]) / Math.max(0.001, length)),
    );
  return {
    position: [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t,
    ] as Position,
    heading: (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI,
    index: i,
    time: route.times[i] + (route.times[i + 1] - route.times[i]) * t,
  };
}
/** Normalized contract: game X/Z/Y metres, heading clockwise from north. UDP adapters feed the same shape. */
export function useMockTelemetry(
  route: Route | undefined,
  active: boolean,
  paused: boolean,
  settings: Settings,
  origin: Position,
  runId: number,
) {
  const progress = useRef(0),
    [frame, setFrame] = useState<Telemetry>({
      source: "mock",
      session: runId,
      connected: true,
      timestamp: Date.now(),
      position: origin,
      heading: 0,
      speedKmh: 0,
      rpm: 900,
      gear: 0,
      progress: 0,
    });
  useEffect(() => {
    progress.current = 0;
    setFrame({
      source: "mock",
      session: runId,
      connected: true,
      timestamp: Date.now(),
      position: route?.points[0] || origin,
      heading: route ? sampleRoute(route, 0).heading : 0,
      speedKmh: 0,
      rpm: 900,
      gear: 0,
      progress: 0,
    });
  }, [route, origin, runId]);
  useEffect(() => {
    if (!active || !route) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        dt = Math.min((now - last) / 1000, 0.5);
      last = now;
      const speed = paused ? 0 : settings.speed;
      progress.current = Math.min(
        route.distance,
        progress.current + dt * (speed / 3.6) * settings.rate,
      );
      const sample = sampleRoute(route, progress.current),
        arrived = progress.current >= route.distance;
      setFrame({
        source: "mock",
        session: runId,
        connected: true,
        timestamp: Date.now(),
        position: sample.position,
        heading: sample.heading,
        speedKmh: arrived ? 0 : speed,
        rpm: speed ? 2400 + speed * 11 : 900,
        gear: speed ? Math.min(6, Math.max(1, Math.ceil(speed / 28))) : 0,
        progress: progress.current,
      });
    }, 100);
    return () => clearInterval(timer);
  }, [active, route, paused, settings.speed, settings.rate, runId]);
  return frame;
}
