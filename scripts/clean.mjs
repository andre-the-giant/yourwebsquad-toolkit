#!/usr/bin/env node
import fs from "fs";
import path from "path";

const targets = [
  ".lighthouseci",
  "build",
  "reports",
  ".astro",
  "node_modules",
  "package-lock.json"
];

for (const target of targets) {
  const fullPath = path.join(process.cwd(), target);
  try {
    fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 3 });
  } catch (err) {
    console.error(`Failed to remove ${target}: ${err.message || err}`);
    process.exit(1);
  }
}

console.log("Workspace cleaned.");
