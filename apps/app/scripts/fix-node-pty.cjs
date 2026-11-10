// node-pty ships a prebuilt N-API binary that loads in Electron as-is (no
// rebuild), but on macOS it also ships a `spawn-helper` executable that its
// postinstall chmod +x's. This repo blocks install scripts (npm allow-scripts),
// so that never runs and pty.spawn fails with "posix_spawnp failed". Re-apply the
// executable bit here (idempotent), run before building/launching the app.

const { chmodSync, existsSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, join } = require("node:path");

try {
  const req = createRequire(__filename);
  const ptyRoot = dirname(req.resolve("node-pty/package.json"));
  const candidates = [
    join(ptyRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    join(ptyRoot, "build", "Release", "spawn-helper"),
  ];
  let fixed = 0;
  for (const p of candidates) {
    if (existsSync(p)) {
      chmodSync(p, 0o755);
      fixed++;
    }
  }
  console.log(`fix-node-pty: made ${fixed} spawn-helper(s) executable`);
} catch (e) {
  // node-pty not installed (or resolvable) — nothing to fix.
  console.log(`fix-node-pty: skipped (${e.message})`);
}
