#!/usr/bin/env node

import { pruneRunsOlderThan } from "../src/quality/store/index.mjs";

function parseArgs(argv) {
  const opts = { olderThanDays: 30, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "--older-than" || arg === "-o") && argv[i + 1]) {
      opts.olderThanDays = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--older-than=")) {
      opts.olderThanDays = Number(arg.slice("--older-than=".length));
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
if (!Number.isFinite(options.olderThanDays) || options.olderThanDays < 0) {
  console.error("--older-than must be a non-negative number of days.");
  process.exit(1);
}

const summary = pruneRunsOlderThan({
  cwd: process.cwd(),
  olderThanDays: options.olderThanDays,
  dryRun: options.dryRun,
  force: options.force,
});

if (options.dryRun) {
  console.log(
    `Dry run: ${summary.targeted} run(s) older than ${options.olderThanDays} day(s) targeted.`,
  );
  for (const result of summary.results) {
    const action = result.reason === "latest-protected" ? "blocked" : "delete";
    console.log(`- ${result.runId}: ${action}`);
  }
  process.exit(0);
}

console.log(
  `Pruned runs older than ${options.olderThanDays} day(s): deleted ${summary.deleted}/${summary.targeted}.`,
);

