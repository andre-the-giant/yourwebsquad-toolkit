import fs from "node:fs";
import path from "node:path";
import { listRuns, readLatestRunId } from "./list-runs.mjs";
import { qualityStorePaths } from "./paths.mjs";
import { safeReadJson, writeJson } from "./helpers.mjs";

function existingViewTargets(viewsRoot, runId) {
  if (!fs.existsSync(viewsRoot)) return [];
  return fs
    .readdirSync(viewsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(viewsRoot, entry.name, runId))
    .filter((target) => fs.existsSync(target));
}

export function deleteRun(runId, options = {}) {
  if (!runId) {
    throw new Error("deleteRun requires a runId.");
  }
  const cwd = options.cwd || process.cwd();
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const { runsRoot, viewsRoot, latestPath } = qualityStorePaths(cwd);
  const latestRunId = readLatestRunId(cwd);
  const runDir = path.join(runsRoot, runId);

  if (!fs.existsSync(runDir)) {
    return { runId, deleted: false, reason: "not-found", actions: [] };
  }
  if (latestRunId === runId && !force) {
    return { runId, deleted: false, reason: "latest-protected", actions: [] };
  }

  const actions = [{ type: "delete", path: runDir }];
  for (const viewPath of existingViewTargets(viewsRoot, runId)) {
    actions.push({ type: "delete", path: viewPath });
  }

  if (dryRun) {
    return { runId, deleted: false, reason: "dry-run", actions };
  }

  for (const action of actions) {
    fs.rmSync(action.path, { recursive: true, force: true });
  }

  if (latestRunId === runId) {
    const nextLatest = listRuns(cwd)[0]?.runId || null;
    const prev = safeReadJson(latestPath);
    writeJson(latestPath, {
      runId: nextLatest,
      updatedAt: new Date().toISOString(),
      previousRunId: prev?.runId || null,
    });
  }

  return { runId, deleted: true, reason: "deleted", actions };
}
