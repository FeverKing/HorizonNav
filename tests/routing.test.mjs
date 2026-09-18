import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Router, loadRouter } from "../server/router.mjs";
import { distanceToLine, mockDeviation } from "../server/recovery.mjs";
const root = new URL("..", import.meta.url).pathname,
  router = loadRouter(root),
  places = JSON.parse(fs.readFileSync(root + "/public/places.json"));
test("single direction is respected: reverse trip takes the legal detour", () => {
  const graph = {
    positions: [
      [0, 0],
      [100, 0],
      [100, 100],
    ],
    indptr: [0, 1, 2, 3],
    indices: [1, 2, 0],
    weights: [100, 100, 141.4],
    edgeRoads: [0, 0, 0],
  };
  const r = new Router(graph, { 0: { road_type: "b" } });
  assert.deepEqual(r.path(0, 1).nodes, [0, 1]);
  assert.deepEqual(r.path(1, 0).nodes, [1, 2, 0]);
});
test("unreachable directed node returns no route", () => {
  const r = new Router(
    {
      positions: [
        [0, 0],
        [10, 0],
      ],
      indptr: [0, 1, 1],
      indices: [1],
      weights: [10],
      edgeRoads: [0],
    },
    { 0: { road_type: "b" } },
  );
  assert.equal(r.path(1, 0), null);
});
test("all 74 supplied destinations can be reached from Tokyo using directed graph", () => {
  const start = router.nearest([-1955, -4810]).node;
  for (const place of places) {
    const snap = router.nearest(place.position);
    assert.ok(snap.distance < 1500, place.name + " snapping distance");
    const path = router.path(start, snap.node);
    assert.ok(path, place.name + " reachable");
    for (let i = 0; i < path.edges.length; i++) {
      assert.equal(router.g.indices[path.edges[i]], path.nodes[i + 1]);
      assert.ok(
        path.edges[i] >= router.g.indptr[path.nodes[i]] &&
          path.edges[i] < router.g.indptr[path.nodes[i] + 1],
      );
    }
  }
});
test("route estimates and progress are internally consistent and alternatives are unique", () => {
  const p = router.plan(
    [-1955, -4810],
    places.find((p) => p.id === "festival_site").position,
    "嘉年华",
  );
  assert.ok(p.routes.length >= 1);
  const seen = new Set();
  for (const r of p.routes) {
    assert.ok(r.distance > 1000);
    assert.ok(r.duration > 0);
    assert.ok(Math.abs(r.distance - r.cumulative.at(-1)) < 1);
    assert.equal(r.points.length, r.cumulative.length);
    assert.equal(r.points.length, r.times.length);
    assert.equal(r.steps.at(-1).kind, "arrive");
    const hash = JSON.stringify(r.points);
    assert.ok(!seen.has(hash));
    seen.add(hash);
    for (let i = 1; i < r.cumulative.length; i++)
      assert.ok(r.cumulative[i] >= r.cumulative[i - 1]);
  }
});
test("same-node and out-of-map route requests fail explicitly", () => {
  assert.throws(() => router.plan([50000, 50000], [0, 0]), /路网较远/);
  assert.throws(() => router.plan([-1955, -4810], [-1955, -4810]), /同一路段/);
});
test("deviation uses distance to segments, not sparse waypoints", () => {
  assert.equal(
    distanceToLine(
      [500, 30],
      [
        [0, 0],
        [1000, 0],
      ],
    ),
    30,
  );
  assert.equal(
    distanceToLine(
      [-30, 0],
      [
        [0, 0],
        [1000, 0],
      ],
    ),
    30,
  );
});
test("mock road deviation lies on a real road; terrain departure is far from road", () => {
  const route = router.plan(
      [-1955, -4810],
      places.find((p) => p.id === "festival_site").position,
    ).routes[0],
    points = route.points.filter(
      (_, i) => i % Math.ceil(route.points.length / 70) === 0,
    );
  points.push(route.points.at(-1));
  const onroad = mockDeviation(router, route.points[0], "road", points);
  assert.ok(router.nearest(onroad.position).distance < 1);
  assert.ok(distanceToLine(onroad.position, points) >= 160);
  const offroad = mockDeviation(router, route.points[0], "terrain", points);
  assert.ok(router.nearest(offroad.position).distance > 160);
  const nearest = router.nearest(offroad.position);
  const replanned = router.plan(nearest.position, route.points.at(-1));
  assert.ok(replanned.routes.length);
});
