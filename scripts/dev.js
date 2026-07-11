#!/usr/bin/env node
// Runs `electron-forge start` and automatically restarts the Electron main
const path = require("node:path");
const fs = require("node:fs");
const { api } = require("@electron-forge/core");

const projectRoot = path.resolve(__dirname, "..");
const watchTargets = ["src/main.ts", "src/main", "src/preload.ts", "src/shared"].map((p) =>
  path.join(projectRoot, p)
);

async function main() {
  await api.start({ dir: projectRoot, interactive: true });

  let timer = null;
  const restart = (event, filename) => {
    if (filename && !/\.(ts|tsx|json)$/.test(filename)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`\n[dev] change detected${filename ? ` (${filename})` : ""}, restarting main process...`);
      process.stdin.emit("data", Buffer.from("rs\n"));
    }, 300);
  };

  for (const target of watchTargets) {
    if (!fs.existsSync(target)) continue;
    fs.watch(target, { recursive: true }, restart);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
