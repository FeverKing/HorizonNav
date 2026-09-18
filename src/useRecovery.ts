import { useEffect, useRef, useState } from "react";
import type {
  Place,
  Plan,
  Position,
  Route,
  Settings,
  Telemetry,
} from "./types";
export type RecoveryStatus =
  "normal" | "deviated" | "rerouting" | "off-road" | "returning" | "error";
export function distanceToRoute(p: Position, points: Position[]) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      t = Math.max(
        0,
        Math.min(
          1,
          ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1),
        ),
      );
    best = Math.min(
      best,
      Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz),
    );
  }
  return best;
}
interface Args {
  active: boolean;
  route?: Route;
  destination: Place | null;
  raw: Telemetry;
  paused: boolean;
  settings: Settings;
  onPlan: (plan: Plan) => void;
  onBlock: (blocked: boolean) => void;
  onMessage: (s: string) => void;
}
export function useRecovery(args: Args) {
  const [status, setStatus] = useState<RecoveryStatus>("normal"),
    [position, setPosition] = useState<Position | null>(null),
    [target, setTarget] = useState<Position | null>(null),
    [eventBusy, setEventBusy] = useState(false),
    [error, setError] = useState("");
  const latest = useRef(args),
    current = useRef(position),
    generation = useRef(0),
    request = useRef<AbortController | null>(null),
    grace = useRef(0),
    pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = args;
  current.current = position;
  useEffect(() => {
    args.onBlock(status !== "normal" || !!position);
  }, [status, position, args.onBlock]);
  useEffect(() => {
    if (args.active) return;
    generation.current++;
    request.current?.abort();
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    setStatus("normal");
    setPosition(null);
    setTarget(null);
    setEventBusy(false);
    setError("");
  }, [args.active]);
  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    },
    [],
  );
  async function replan(p: Position) {
    const id = ++generation.current;
    request.current?.abort();
    const ctrl = new AbortController();
    request.current = ctrl;
    setStatus("rerouting");
    setError("");
    try {
      const r = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: p,
          to: latest.current.destination?.position,
          destination: latest.current.destination?.name,
        }),
        signal: ctrl.signal,
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "重新规划失败");
      if (id !== generation.current || !latest.current.active) return;
      grace.current = Date.now() + 1500;
      latest.current.onPlan(result);
      setPosition(null);
      setTarget(null);
      setStatus("normal");
      latest.current.onMessage("路线已更新，继续前往目的地");
    } catch (e) {
      if ((e as Error).name === "AbortError" || id !== generation.current)
        return;
      setError((e as Error).message);
      setStatus("error");
    }
  }
  useEffect(() => {
    if (
      !args.active ||
      !args.route ||
      status !== "normal" ||
      Date.now() < grace.current
    )
      return;
    const p = position || args.raw.position;
    if (distanceToRoute(p, args.route.points) < 70) return;
    setStatus("deviated");
    if (args.raw.source === "mock") setPosition(p);
    const id = ++generation.current;
    const ctrl = new AbortController();
    request.current = ctrl;
    // Brief hysteresis prevents one noisy telemetry sample from replacing the route.
    pendingTimer.current = setTimeout(async () => {
      pendingTimer.current = null;
      if (id !== generation.current || !latest.current.active) return;
      if (
        latest.current.raw.source === "udp" &&
        latest.current.route &&
        distanceToRoute(
          latest.current.raw.position,
          latest.current.route.points,
        ) < 70
      ) {
        setStatus("normal");
        return;
      }
      try {
        const r = await fetch("/api/snap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            position:
              latest.current.raw.source === "udp"
                ? latest.current.raw.position
                : current.current || p,
          }),
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error("无法检查附近道路");
        const snap = await r.json();
        if (id !== generation.current || !latest.current.active) return;
        if (snap.offRoad) {
          setTarget(snap.position);
          setStatus("off-road");
        } else
          await replan(
            latest.current.raw.source === "udp"
              ? latest.current.raw.position
              : current.current || p,
          );
      } catch (e) {
        if ((e as Error).name !== "AbortError" && id === generation.current) {
          setError("无法连接算路服务，请重试");
          setStatus("error");
        }
      }
    }, 900);
    // Cancellation is driven by generation / abort on exit; status changes must not cancel this transition.
    return undefined;
  }, [args.active, args.route, args.raw.position, position, status]);
  useEffect(() => {
    if (!args.active || args.raw.source !== "udp" || status !== "off-road")
      return;
    let busy = false;
    const ctrl = new AbortController();
    const timer = setInterval(async () => {
      if (busy || !latest.current.raw.connected) return;
      busy = true;
      try {
        const p = latest.current.raw.position;
        const r = await fetch("/api/snap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: p }),
          signal: ctrl.signal,
        });
        if (!r.ok) return;
        const snap = await r.json();
        if (ctrl.signal.aborted) return;
        setTarget(snap.position);
        if (snap.distance < 120) await replan(p);
      } catch {
        /* Retry while live frames continue. */
      } finally {
        busy = false;
      }
    }, 750);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, [args.active, args.raw.source, status]);
  useEffect(() => {
    if (status !== "returning" || !target || args.paused) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const p = current.current;
      if (!p) return;
      const now = performance.now(),
        step =
          Math.min((now - last) / 1000, 0.4) *
          (latest.current.settings.speed / 3.6) *
          latest.current.settings.rate;
      last = now;
      const d = Math.hypot(target[0] - p[0], target[1] - p[1]);
      if (d < Math.max(6, step)) {
        clearInterval(timer);
        setPosition(target);
        void replan(target);
        return;
      }
      const t = step / d;
      setPosition([
        p[0] + (target[0] - p[0]) * t,
        p[1] + (target[1] - p[1]) * t,
        (p[2] || 100) + ((target[2] || 100) - (p[2] || 100)) * t,
      ]);
    }, 100);
    return () => clearInterval(timer);
  }, [status, target, args.paused]);
  async function simulate(kind: "road" | "terrain") {
    if (!latest.current.route || eventBusy || status !== "normal") return;
    setEventBusy(true);
    setError("");
    const points = latest.current.route.points,
      stride = Math.max(1, Math.ceil(points.length / 70)),
      routePoints = points.filter((_, i) => i % stride === 0);
    if (routePoints.at(-1) !== points.at(-1)) routePoints.push(points.at(-1)!);
    const id = generation.current;
    try {
      const r = await fetch("/api/mock-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          position: latest.current.raw.position,
          routePoints,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (id === generation.current && latest.current.active) {
        grace.current = 0;
        setPosition(data.position);
        latest.current.onMessage(
          kind === "road"
            ? "模拟车辆已驶入附近另一条道路"
            : "模拟车辆已驶离路网",
        );
      }
    } catch (e) {
      latest.current.onMessage((e as Error).message || "无法触发模拟场景");
    } finally {
      setEventBusy(false);
    }
  }
  const d = target
      ? Math.hypot(
          target[0] - (position || args.raw.position)[0],
          target[1] - (position || args.raw.position)[1],
        )
      : 0,
    heading =
      position && target
        ? (Math.atan2(target[0] - position[0], target[1] - position[1]) * 180) /
          Math.PI
        : args.raw.heading;
  const frame: Telemetry = position
    ? {
        ...args.raw,
        position,
        heading,
        speedKmh:
          status === "returning" && !args.paused ? args.settings.speed : 0,
      }
    : args.raw;
  return {
    status,
    frame,
    target,
    distance: d,
    eventBusy,
    error,
    simulate,
    returnToRoad: () => setStatus("returning"),
    retry: () => replan(position || args.raw.position),
  };
}
