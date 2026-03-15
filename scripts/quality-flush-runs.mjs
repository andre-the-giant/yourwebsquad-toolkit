#!/usr/bin/env node

import { cleanRunsKeep } from "../src/quality/store/index.mjs";

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

const options = parseArgs(process.argv.slice(2));
const summary = cleanRunsKeep({
  cwd: process.cwd(),
  keep: 0,
  dryRun: options.dryRun,
  force: true,
});

if (options.dryRun) {
  console.log(
    `Dry run: ${summary.targeted} run(s) targeted, ${summary.deleted} deleted.`,
  );
  for (const result of summary.results) {
    console.log(`- ${result.runId}: delete`);
  }
  process.exit(0);
}

console.log(`Flushed runs: deleted ${summary.deleted}/${summary.targeted}.`);
