import fs from "node:fs";
const speeds = {
  freeway: 120,
  a: 80,
  b: 65,
  hidden: 45,
  dirt: 45,
  trail: 30,
  shortcut: 35,
  evolving_world: 40,
};
const roadNames = {
  freeway: "高速公路",
  a: "主干道",
  b: "城市道路",
  hidden: "支路",
  dirt: "砂石路",
  trail: "山间小径",
  shortcut: "近道",
  evolving_world: "季节道路",
};
export class Heap {
  constructor() {
    this.q = [];
  }
  push(v) {
    let i = this.q.length;
    this.q.push(v);
    while (i) {
      let p = (i - 1) >> 1;
      if (this.q[p][0] <= v[0]) break;
      this.q[i] = this.q[p];
      i = p;
    }
    this.q[i] = v;
  }
  pop() {
    const top = this.q[0],
      last = this.q.pop();
    if (this.q.length) {
      let i = 0;
      while (i * 2 + 1 < this.q.length) {
        let c = i * 2 + 1;
        if (c + 1 < this.q.length && this.q[c + 1][0] < this.q[c][0]) c++;
        if (last[0] <= this.q[c][0]) break;
        this.q[i] = this.q[c];
        i = c;
      }
      this.q[i] = last;
    }
    return top;
  }
}
export class Router {
  constructor(graph, roads) {
    this.g = graph;
    this.roads = roads;
  }
  nearest([x, z]) {
    let best = Infinity,
      node = -1;
    this.g.positions.forEach((p, i) => {
      const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
      if (d < best) {
        best = d;
        node = i;
      }
    });
    return {
      node,
      distance: Math.sqrt(best),
      position: this.g.positions[node],
    };
  }
  path(start, end, profile = "recommended") {
    const { positions, indptr, indices, weights, edgeRoads } = this.g;
    const cost = new Float64Array(positions.length).fill(Infinity),
      parents = new Int32Array(positions.length).fill(-1),
      arcs = new Int32Array(positions.length).fill(-1);
    cost[start] = 0;
    const heap = new Heap();
    heap.push([0, start]);
    while (heap.q.length) {
      const [d, u] = heap.pop();
      if (d !== cost[u]) continue;
      if (u === end) break;
      for (let k = indptr[u]; k < indptr[u + 1]; k++) {
        const v = indices[k],
          type = this.roads[edgeRoads[k]]?.road_type || "b",
          speed = speeds[type] || 50;
        const factor =
          profile === "shortest"
            ? 1
            : profile === "noHighway"
              ? type === "freeway"
                ? 6
                : type === "trail"
                  ? 2.4
                  : 1
              : (3.6 / speed) *
                (type === "trail" || type === "shortcut" ? 1.8 : 1);
        const nd = d + weights[k] * factor;
        if (nd < cost[v]) {
          cost[v] = nd;
          parents[v] = u;
          arcs[v] = k;
          heap.push([nd, v]);
        }
      }
    }
    if (!Number.isFinite(cost[end])) return null;
    const nodes = [],
      edges = [];
    for (let n = end; n !== start; n = parents[n]) {
      nodes.push(n);
      edges.push(arcs[n]);
    }
    nodes.push(start);
    nodes.reverse();
    edges.reverse();
    return { nodes, edges };
  }
  describe(path, profile, destination) {
    const { positions, weights, edgeRoads } = this.g,
      points = path.nodes.map((n) => positions[n]);
    let distance = 0,
      duration = 0,
      unpaved = 0,
      highway = 0;
    const cumulative = [0],
      times = [0];
    for (const k of path.edges) {
      const type = this.roads[edgeRoads[k]]?.road_type || "b",
        m = weights[k];
      distance += m;
      duration += (m / (speeds[type] || 50)) * 3.6;
      cumulative.push(distance);
      times.push(duration);
      if (["dirt", "trail", "shortcut"].includes(type)) unpaved += m;
      if (type === "freeway") highway += m;
    }
    const heading = (a, b) =>
      (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
    const steps = [
      {
        at: 0,
        index: 0,
        kind: "straight",
        text: "沿当前道路行驶",
        road:
          roadNames[this.roads[edgeRoads[path.edges[0]]]?.road_type] || "道路",
      },
    ];
    for (let i = 2; i < points.length - 2; i++) {
      const prev = path.edges[i - 1],
        next = path.edges[i],
        r = this.roads[edgeRoads[next]] || {},
        p = this.roads[edgeRoads[prev]] || {};
      const angle =
        ((heading(points[i], points[Math.min(i + 3, points.length - 1)]) -
          heading(points[Math.max(0, i - 3)], points[i]) +
          540) %
          360) -
        180;
      if (cumulative[i] - steps.at(-1).at < 90 || distance - cumulative[i] < 70)
        continue;
      if (
        (edgeRoads[prev] !== edgeRoads[next] && Math.abs(angle) > 30) ||
        (r.road_type === "freeway" && p.road_type !== "freeway")
      ) {
        const kind =
          Math.abs(angle) > 150
            ? "uturn"
            : angle > 28
              ? "right"
              : angle < -28
                ? "left"
                : "straight";
        const road = roadNames[r.road_type] || "连接道路";
        steps.push({
          at: cumulative[i],
          index: i,
          kind,
          text:
            (kind === "right"
              ? "右转"
              : kind === "left"
                ? "左转"
                : kind === "uturn"
                  ? "掉头"
                  : "直行") +
            "进入" +
            road,
          road,
        });
      }
    }
    steps.push({
      at: distance,
      index: points.length - 1,
      kind: "arrive",
      text: "到达" + destination,
      road: destination,
    });
    const names = {
      recommended: "推荐路线",
      shortest: "距离最短",
      noHighway: "少走高速",
    };
    return {
      id: profile,
      label: names[profile],
      profiles: [profile],
      points,
      cumulative,
      times,
      distance: Math.round(distance),
      duration: Math.round(duration),
      unpaved: Math.round(unpaved),
      highway: Math.round(highway),
      steps,
    };
  }
  plan(from, to, destination = "目的地") {
    const a = this.nearest(from),
      b = this.nearest(to);
    if (a.distance > 1500 || b.distance > 1500)
      throw Object.assign(
        new Error("所选位置离路网较远，请选择道路附近的位置。"),
        { status: 422 },
      );
    if (a.node === b.node)
      throw Object.assign(
        new Error("起点与终点位于同一路段，请选择更远的目的地。"),
        { status: 422 },
      );
    const routes = [],
      seen = new Map();
    for (const profile of ["recommended", "shortest", "noHighway"]) {
      const p = this.path(a.node, b.node, profile);
      if (!p) continue;
      const signature = p.nodes.join(",");
      if (seen.has(signature)) {
        seen.get(signature).profiles.push(profile);
        continue;
      }
      const route = this.describe(p, profile, destination);
      routes.push(route);
      seen.set(signature, route);
    }
    if (!routes.length)
      throw Object.assign(
        new Error("无法沿可通行道路到达该位置，请更换起点或终点。"),
        { status: 409 },
      );
    return {
      routes,
      snap: {
        from: a.distance,
        to: b.distance,
        fromPosition: a.position,
        toPosition: b.position,
      },
    };
  }
}
export function loadRouter(root) {
  return new Router(
    JSON.parse(fs.readFileSync(root + "/data/graph.json")),
    JSON.parse(fs.readFileSync(root + "/data/roads.json")),
  );
}
