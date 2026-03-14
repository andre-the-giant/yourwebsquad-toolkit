import { listRuns } from "./list-runs.mjs";
import { deleteRun } from "./delete-run.mjs";

export function cleanRunsKeep(options = {}) {
  const cwd = options.cwd || process.cwd();
  const keep = Number.isFinite(options.keep) ? Number(options.keep) : 5;
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const runs = listRuns(cwd);
  const victims = runs.slice(Math.max(keep, 0));

  const results = victims.map((entry) =>
    deleteRun(entry.runId, { cwd, dryRun, force }),
  );

  return {
    keep,
    totalRuns: runs.length,
    targeted: victims.length,
    deleted: results.filter((item) => item.deleted).length,
    results,
  };
}

