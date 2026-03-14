import fs from "node:fs";
import path from "node:path";
import { qualityStorePaths } from "./paths.mjs";
import { safeReadJson } from "./helpers.mjs";

export function readRun(runId, cwd = process.cwd()) {
  if (!runId) return null;
  const { runsRoot } = qualityStorePaths(cwd);
  const runDir = path.join(runsRoot, runId);
  if (!fs.existsSync(runDir)) return null;
  const meta = safeReadJson(path.join(runDir, "meta.json"));
  const dataset = safeReadJson(path.join(runDir, "dataset.json"));
  return { runId, runDir, meta, dataset };
}

