import fs from "node:fs";
import path from "node:path";
import { qualityStorePaths } from "./paths.mjs";
import { safeReadJson } from "./helpers.mjs";

function toTimestamp(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

export function readLatestRunId(cwd = process.cwd()) {
  const { latestPath } = qualityStorePaths(cwd);
  const payload = safeReadJson(latestPath);
  if (!payload || typeof payload.runId !== "string") return null;
  return payload.runId;
}

export function listRuns(cwd = process.cwd()) {
  const { runsRoot } = qualityStorePaths(cwd);
  if (!fs.existsSync(runsRoot)) return [];

  const entries = fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runId = entry.name;
      const runDir = path.join(runsRoot, runId);
      const meta = safeReadJson(path.join(runDir, "meta.json")) || {};
      const datasetPath = path.join(runDir, "dataset.json");
      const checks = meta?.checks || [];
      return {
        runId,
        createdAt: meta.createdAt || null,
        target: meta.target || null,
        checksCount: Array.isArray(checks) ? checks.length : 0,
        path: runDir,
        hasDataset: fs.existsSync(datasetPath),
      };
    })
    .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));

  return entries;
}

