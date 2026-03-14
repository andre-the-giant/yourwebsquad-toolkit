#!/usr/bin/env node

import { deleteRun } from "../src/quality/store/index.mjs";

function parseArgs(argv) {
  const opts = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "--run" || arg === "-r") && argv[i + 1]) {
      opts.runId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--run=")) {
      opts.runId = arg.slice("--run=".length);
      continue;
    }
    if (arg === "--dry-run") {
      opts.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      opts.force = true;
    }
  }
  return opts;
}

const options = parseArgs(process.argv.slice(2));
if (!options.runId) {
  console.error(
    "Usage: yws-toolkit quality delete-run --run <runId> [--dry-run] [--force]",
  );
  process.exit(1);
}

const result = deleteRun(options.runId, {
  cwd: process.cwd(),
  dryRun: options.dryRun,
  force: options.force,
});

if (result.reason === "not-found") {
  console.log(`Run ${options.runId} not found.`);
  process.exit(0);
}
if (result.reason === "latest-protected") {
  console.error(
    `Run ${options.runId} is the latest run. Re-run with --force to delete it.`,
  );
  process.exit(1);
}

if (options.dryRun) {
  console.log(`Dry run: ${result.actions.length} path(s) would be deleted.`);
  for (const action of result.actions) {
    console.log(`- ${action.path}`);
  }
  process.exit(0);
}

console.log(`Deleted run ${options.runId} (${result.actions.length} path(s)).`);
