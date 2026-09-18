export function distanceToLine(point, points) {
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
          ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) /
            (dx * dx + dz * dz || 1),
        ),
      );
    best = Math.min(
      best,
      Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz),
    );
  }
  return best;
}
export function mockDeviation(router, position, kind, routePoints) {
  if (kind === "road") {
    let best = null,
      score = Infinity;
    for (let i = 0; i < router.g.positions.length; i++) {
      const p = router.g.positions[i],
        d = Math.hypot(p[0] - position[0], p[1] - position[1]);
      if (d < 300 || d > 2000) continue;
      const offset = distanceToLine(p, routePoints);
      if (offset < 160) continue;
      const s = Math.abs(d - 700);
      if (s < score) {
        score = s;
        best = p;
      }
    }
    if (best) return { position: best, kind: "road" };
    throw Object.assign(
      new Error("附近暂无适合的偏航道路，请行驶一段距离后重试。"),
      { status: 422 },
    );
  }
  let best = null,
    distance = 0;
  for (const radius of [400, 700, 1100, 1600])
    for (let a = 0; a < 16; a++) {
      const theta = (a * Math.PI) / 8,
        p = [
          position[0] + Math.cos(theta) * radius,
          position[1] + Math.sin(theta) * radius,
          position[2] || 100,
        ],
        snap = router.nearest(p);
      if (snap.distance > distance && distanceToLine(p, routePoints) > 200) {
        distance = snap.distance;
        best = p;
      }
    }
  if (best && distance > 160) return { position: best, kind: "terrain" };
  throw Object.assign(new Error("附近路网较密，暂时无法生成远离道路的场景。"), {
    status: 422,
  });
}
