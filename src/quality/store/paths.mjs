import path from "node:path";

export function qualityStorePaths(cwd = process.cwd()) {
  const reportRoot = path.join(cwd, "reports");
  const runsRoot = path.join(reportRoot, "runs");
  const viewsRoot = path.join(reportRoot, "views");
  const latestPath = path.join(reportRoot, "latest.json");
  return { reportRoot, runsRoot, viewsRoot, latestPath };
}

