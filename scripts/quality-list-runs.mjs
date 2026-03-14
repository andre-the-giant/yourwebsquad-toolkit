#!/usr/bin/env node

import { listRuns, readLatestRunId } from "../src/quality/store/index.mjs";

const runs = listRuns(process.cwd());
const latest = readLatestRunId(process.cwd());

if (!runs.length) {
  console.log("No quality runs found in reports/runs.");
  process.exit(0);
}

console.log(`Found ${runs.length} run(s):`);
for (const run of runs) {
  const isLatest = latest && run.runId === latest ? " (latest)" : "";
  const createdAt = run.createdAt || "unknown-date";
  const target = run.target || "unknown-target";
  console.log(
    `- ${run.runId}${isLatest} | ${createdAt} | target=${target} | checks=${run.checksCount}`,
  );
}
