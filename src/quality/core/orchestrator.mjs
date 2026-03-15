import { orderedSelectedChecks } from "./config.mjs";

export function resolveCheckExecutionPlan({
  selectedChecks,
  qualityConfig,
  checkHandlers,
  registeredChecks,
}) {
  const orderedIds = orderedSelectedChecks(selectedChecks, qualityConfig);
  const byId = new Map();
  for (const check of Array.isArray(registeredChecks) ? registeredChecks : []) {
    if (!check?.id) continue;
    byId.set(check.id, check);
  }
  for (const [id, handler] of Object.entries(checkHandlers || {})) {
    byId.set(id, { id, ...handler });
  }

  const plan = [];
  for (const id of orderedIds) {
    const handler = byId.get(id);
    if (!handler) continue;
    const run = typeof handler.run === "function" ? handler.run : null;
    plan.push({
      id,
      name: handler.name || id,
      run,
      enabled: Boolean(handler.enabled),
      capabilities: handler.capabilities || null,
      check: handler.check || null,
    });
  }
  return plan;
}

export async function runQualityChecks({
  checks = [],
  quietMode = false,
  logger = console,
  buildDataset = null,
  datasetContext = null,
}) {
  const failures = [];
  const summaries = {};
  const checkResults = {};

  for (const check of checks) {
    const { id, name, run, enabled } = check;
    if (!enabled) {
      logger.log(`⏭️  ${name} (skipped)`);
      checkResults[id] = null;
      continue;
    }
    if (typeof run !== "function") {
      logger.log(`⏭️  ${name} (no runner configured)`);
      checkResults[id] = null;
      continue;
    }
    logger.log(`➡️  ${name}${quietMode ? " (quiet logging)" : ""}`);
    try {
      const result = await run();
      checkResults[id] = result || null;
      summaries[id] = result?.summary || "";
      if (result?.summary) {
        logger.log(result.summary);
      } else {
        logger.log(`✅ ${name} completed`);
      }
      if (result?.failed) {
        failures.push(name);
      }
    } catch (error) {
      failures.push(name);
      checkResults[id] = null;
      summaries[id] = "";
      logger.error(`❌ ${name} crashed: ${error?.message || error}`);
    }
  }

  const dataset =
    typeof buildDataset === "function"
      ? await buildDataset({
          checks: checkResults,
          failures,
          summaries,
          context: datasetContext || {},
        })
      : null;

  return { checks: checkResults, failures, summaries, dataset };
}

export function buildChecksPlanFromRunners({
  plan = [],
  runners = {},
  targetUsesLocalBuild = true,
}) {
  return plan.map((entry) => {
    const enabled = Boolean(entry.enabled);
    return {
      id: entry.id,
      name: entry.name,
      enabled,
      run: async () => {
        const runner = runners[entry.id];
        if (typeof runner !== "function") return null;
        return runner();
      },
    };
  });
}

export async function runPlannedQualityChecks({
  plan = [],
  runners = {},
  targetUsesLocalBuild = true,
  selectedChecks = {},
  quietMode = false,
  logger = console,
  buildDataset = null,
  datasetContext = null,
}) {
  const checks = buildChecksPlanFromRunners({
    plan,
    runners,
    targetUsesLocalBuild,
  });

  return runQualityChecks({
    checks,
    quietMode,
    logger,
    buildDataset,
    datasetContext,
  });
}
