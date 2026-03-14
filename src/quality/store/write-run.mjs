import fs from "node:fs";
import path from "node:path";
import { qualityStorePaths } from "./paths.mjs";
import { copyPath, ensureDir, generateRunId, writeJson } from "./helpers.mjs";

function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.filter((item) => item && typeof item.path === "string");
}

export function writeRunSnapshot(options = {}) {
  const cwd = options.cwd || process.cwd();
  const runId = options.runId || generateRunId();
  const meta = options.meta || {};
  const dataset = options.dataset || {};
  const rawSources = normalizeSources(options.rawSources);
  const viewSources = options.viewSources || {};

  const { reportRoot, runsRoot, viewsRoot, latestPath } = qualityStorePaths(cwd);
  ensureDir(reportRoot);
  ensureDir(runsRoot);
  ensureDir(viewsRoot);

  const runDir = path.join(runsRoot, runId);
  ensureDir(runDir);

  writeJson(path.join(runDir, "meta.json"), {
    runId,
    createdAt: meta.createdAt || new Date().toISOString(),
    ...meta,
  });
  writeJson(path.join(runDir, "dataset.json"), dataset);

  for (const source of rawSources) {
    if (!fs.existsSync(source.path)) continue;
    const checkId = source.checkId || "misc";
    const fileName = source.name || path.basename(source.path);
    const dest = path.join(runDir, "raw", checkId, fileName);
    copyPath(source.path, dest);
  }

  for (const [format, entries] of Object.entries(viewSources)) {
    const sources = normalizeSources(entries);
    const formatRoot = path.join(viewsRoot, format, runId);
    for (const source of sources) {
      if (!fs.existsSync(source.path)) continue;
      const fileName = source.name || path.basename(source.path);
      const dest = path.join(formatRoot, fileName);
      copyPath(source.path, dest);
    }
  }

  writeJson(latestPath, { runId, updatedAt: new Date().toISOString() });
  return { runId, runDir };
}

