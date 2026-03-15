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

const args = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const { viewsRoot } = qualityStorePaths(cwd);
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
  console.error(
    `No ${format} view artifacts found for run ${runId} at ${sourceRoot}.`,
  );
  process.exit(1);
}

console.log(`Rendered ${format} view for run ${runId} into ${sourceRoot}.`);
