#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  qualityStorePaths,
  readLatestRunId,
  readRun,
} from "../src/quality/store/index.mjs";
import { renderHtmlRun } from "../src/quality/renderers/html/render-run.mjs";

function parseArgs(argv) {
  const options = { format: "html" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "--run" || arg === "-r") && argv[i + 1]) {
      options.runId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--run=")) {
      options.runId = arg.slice("--run=".length);
      continue;
    }
    if ((arg === "--format" || arg === "-f") && argv[i + 1]) {
      options.format = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--format=")) {
      options.format = arg.slice("--format=".length);
    }
  }
  return options;
}

function copyPath(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const child of fs.readdirSync(source)) {
      copyPath(path.join(source, child), path.join(destination, child));
    }
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function cleanCurrentView(reportRoot) {
  for (const target of [
    "index.html",
    "logs",
    "lighthouse",
    "pa11y",
    "seo",
    "links",
    "jsonld",
    "security",
  ]) {
    const full = path.join(reportRoot, target);
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
}

const args = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const { reportRoot, viewsRoot } = qualityStorePaths(cwd);
const runId = args.runId || readLatestRunId(cwd);
const format = String(args.format || "html").toLowerCase();

if (!runId) {
  console.error("No run id provided and no latest run available.");
  process.exit(1);
}

const run = readRun(runId, cwd);
if (!run?.dataset) {
  console.error(`Run ${runId} is missing dataset.json.`);
  process.exit(1);
}

let sourceRoot = path.join(viewsRoot, format, runId);
if (format === "html") {
  const manifest = renderHtmlRun({
    cwd,
    runId,
    dataset: run.dataset,
  });
  sourceRoot = manifest.rootDir;
}
if (!fs.existsSync(sourceRoot)) {
  console.error(`No ${format} view artifacts found for run ${runId} at ${sourceRoot}.`);
  process.exit(1);
}

fs.mkdirSync(reportRoot, { recursive: true });
cleanCurrentView(reportRoot);
for (const child of fs.readdirSync(sourceRoot)) {
  copyPath(path.join(sourceRoot, child), path.join(reportRoot, child));
}

console.log(`Rendered ${format} view for run ${runId} into reports/.`);
