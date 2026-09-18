import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(root, ".cache"), { recursive: true });
const binary = path.join(
  root,
  ".cache",
  process.platform === "win32" ? "fh6map-dev.exe" : "fh6map-dev",
);
const build = spawnSync("go", ["build", "-o", binary, "."], {
  cwd: root,
  stdio: "inherit",
});
if (build.error || build.status) {
  console.error(build.error || "Go build failed");
  process.exit(1);
}
const children = [
  spawn(binary, ["-config", path.join(root, "config.dev.yaml")], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js")], {
    cwd: root,
    stdio: "inherit",
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
for (const child of children) {
  child.on("error", (e) => {
    console.error(e);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
