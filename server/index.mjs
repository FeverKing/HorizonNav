import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRouter } from "./router.mjs";
import { mockDeviation } from "./recovery.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const router = loadRouter(root),
  app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    map: "Brio",
    nodes: router.g.positions.length,
    telemetry: "mock",
  }),
);
app.post("/api/route", (req, res) => {
  const { from, to, destination } = req.body || {};
  const valid = (p) =>
    Array.isArray(p) &&
    p.length >= 2 &&
    p
      .slice(0, 2)
      .every(
        (v) =>
          typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 50000,
      );
  if (!valid(from) || !valid(to))
    return res.status(400).json({ error: "请选择有效的起点和终点。" });
  try {
    res.json(
      router.plan(
        from,
        to,
        typeof destination === "string" ? destination.slice(0, 100) : "目的地",
      ),
    );
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.status ? e.message : "路线计算暂时不可用，请稍后重试。",
    });
    if (!e.status) console.error(e);
  }
});
app.post("/api/snap", (req, res) => {
  const p = req.body?.position;
  if (
    !Array.isArray(p) ||
    p.length < 2 ||
    !p
      .slice(0, 2)
      .every(
        (v) =>
          typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 50000,
      )
  )
    return res.status(400).json({ error: "无效车辆坐标" });
  const snap = router.nearest(p);
  res.json({ ...snap, offRoad: snap.distance > 160 });
});
app.post("/api/mock-event", (req, res) => {
  const { position, kind, routePoints } = req.body || {};
  const valid = (p) =>
    Array.isArray(p) &&
    p.length >= 2 &&
    p
      .slice(0, 2)
      .every(
        (v) =>
          typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 50000,
      );
  if (
    !valid(position) ||
    !["road", "terrain"].includes(kind) ||
    !Array.isArray(routePoints) ||
    routePoints.length < 2 ||
    routePoints.length > 80 ||
    !routePoints.every(valid)
  )
    return res.status(400).json({ error: "场景参数不正确" });
  try {
    res.json(mockDeviation(router, position, kind, routePoints));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
if (process.argv.includes("--dev")) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(
    express.static(path.join(root, "dist"), {
      maxAge: "1h",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html"))
          res.setHeader("Cache-Control", "no-store");
      },
    }),
  );
  app.get("/{*path}", (_req, res) =>
    res
      .set("Cache-Control", "no-store")
      .sendFile(path.join(root, "dist/index.html")),
  );
}
app.use((err, _req, res, _next) =>
  res.status(err.status || 500).json({
    error:
      err.type === "entity.parse.failed"
        ? "请求格式不正确。"
        : "服务暂时不可用。",
  }),
);
const port = Number(process.env.PORT || 5173),
  host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(`Horizon Nav ready: http://${host}:${port}`),
);
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE" ? `端口 ${port} 已占用，请设置 PORT。` : e,
  );
  process.exit(1);
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
