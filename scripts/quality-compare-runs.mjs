#!/usr/bin/env node

import {
  readLatestRunId,
  listRuns,
  readRun,
} from "../src/quality/store/index.mjs";

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "--base" || arg === "-b") && argv[i + 1]) {
      options.base = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
      continue;
    }
    if ((arg === "--head" || arg === "-h") && argv[i + 1]) {
      options.head = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--head=")) {
      options.head = arg.slice("--head=".length);
    }
  }
  return options;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function extractMetrics(checkId, payload) {
  if (!payload) return {};
  if (checkId === "links") {
    const links = payload.links || {};
    const broken = Array.isArray(links.broken)
      ? links.broken.length
      : toNumber(links.broken);
    return {
      broken,
      skippedExternal: toNumber(links.skippedExternal),
    };
  }
  const stats = payload.stats || {};
  return {
    errors: toNumber(stats.errorCount),
    warnings: toNumber(stats.warningCount),
    findings: toNumber(stats.findingsTotal),
    assertionFailures: toNumber(stats.assertionFailures),
    runFailures: toNumber(stats.runFailures),
  };
}

function compareCheck(checkId, baseRun, headRun) {
  const basePayload = baseRun?.dataset?.checks?.[checkId] || null;
  const headPayload = headRun?.dataset?.checks?.[checkId] || null;
  const baseMetrics = extractMetrics(checkId, basePayload);
  const headMetrics = extractMetrics(checkId, headPayload);
  const allMetricKeys = Array.from(
    new Set([...Object.keys(baseMetrics), ...Object.keys(headMetrics)]),
  );
  const deltas = {};
  for (const key of allMetricKeys) {
    deltas[key] = toNumber(headMetrics[key]) - toNumber(baseMetrics[key]);
  }
  return { base: baseMetrics, head: headMetrics, delta: deltas };
}

const args = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const latest = readLatestRunId(cwd);
const runs = listRuns(cwd);
const head = args.head || latest || runs[0]?.runId;
const base = args.base || runs.find((entry) => entry.runId !== head)?.runId;

if (!head || !base) {
  console.error(
    "Unable to resolve both runs for comparison. Provide --base and --head explicitly.",
  );
  process.exit(1);
}

const baseRun = readRun(base, cwd);
const headRun = readRun(head, cwd);
if (!baseRun || !headRun) {
  console.error(`Missing run data for base=${base} or head=${head}.`);
  process.exit(1);
}

const checkIds = Array.from(
  new Set([
    ...Object.keys(baseRun.dataset?.checks || {}),
    ...Object.keys(headRun.dataset?.checks || {}),
  ]),
).sort();

console.log(`Comparing runs:`);
console.log(`- base: ${base}`);
console.log(`- head: ${head}`);
if (!checkIds.length) {
  console.log("No check payloads found in either dataset.");
  process.exit(0);
}

for (const checkId of checkIds) {
  const metrics = compareCheck(checkId, baseRun, headRun);
  console.log(`\n[${checkId}]`);
  for (const [key, delta] of Object.entries(metrics.delta)) {
    const sign = delta > 0 ? "+" : "";
    const baseVal = metrics.base[key] ?? 0;
    const headVal = metrics.head[key] ?? 0;
    console.log(`- ${key}: ${baseVal} -> ${headVal} (${sign}${delta})`);
  }
}
