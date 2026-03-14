#!/usr/bin/env node

import { cleanRunsKeep } from "../src/quality/store/index.mjs";

function parseArgs(argv) {
  const opts = { keep: 5, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "--keep" || arg === "-k") && argv[i + 1]) {
      opts.keep = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--keep=")) {
      opts.keep = Number(arg.slice("--keep=".length));
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
if (!Number.isFinite(options.keep) || options.keep < 0) {
  console.error("--keep must be a non-negative number.");
  process.exit(1);
}

const summary = cleanRunsKeep({
  cwd: process.cwd(),
  keep: options.keep,
  dryRun: options.dryRun,
  force: options.force,
});

if (options.dryRun) {
  console.log(
    `Dry run: ${summary.targeted} run(s) targeted, ${summary.deleted} deleted.`,
  );
  for (const result of summary.results) {
    const action = result.reason === "latest-protected" ? "blocked" : "delete";
    console.log(`- ${result.runId}: ${action}`);
  }
  process.exit(0);
}

console.log(
  `Cleaned runs: kept ${summary.keep}, deleted ${summary.deleted}/${summary.targeted} targeted.`,
);

