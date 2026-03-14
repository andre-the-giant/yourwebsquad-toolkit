import { listRuns } from "./list-runs.mjs";
import { deleteRun } from "./delete-run.mjs";

function timestamp(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

export function pruneRunsOlderThan(options = {}) {
  const cwd = options.cwd || process.cwd();
  const olderThanDays = Number.isFinite(options.olderThanDays)
    ? Number(options.olderThanDays)
    : 30;
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const runs = listRuns(cwd);
  const victims = runs.filter((run) => timestamp(run.createdAt) < cutoff);

  const results = victims.map((entry) =>
    deleteRun(entry.runId, { cwd, dryRun, force }),
  );

  return {
    olderThanDays,
    cutoffIso: new Date(cutoff).toISOString(),
    totalRuns: runs.length,
    targeted: victims.length,
    deleted: results.filter((item) => item.deleted).length,
    results,
  };
}

