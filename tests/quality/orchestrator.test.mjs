import test from "node:test";
import assert from "node:assert/strict";

import { registerDefaultQualityChecks } from "../../src/quality/checks/index.mjs";
import { orderedSelectedChecks } from "../../src/quality/core/config.mjs";
import {
  buildChecksPlanFromRunners,
  resolveCheckExecutionPlan,
  runPlannedQualityChecks,
  runQualityChecks,
} from "../../src/quality/core/orchestrator.mjs";
import { clearQualityCheckRegistry } from "../../src/quality/core/registry.mjs";

test("default checks register and execution plan follows config order", () => {
  clearQualityCheckRegistry();
  const checks = registerDefaultQualityChecks();

  const selectedChecks = {
    lighthouse: true,
    pa11y: false,
    axe: false,
    seo: true,
    links: true,
    jsonld: false,
    security: false,
  };
  const qualityConfig = {
    checks: {
      order: ["links", "seo", "lighthouse"],
    },
  };

  const ordered = orderedSelectedChecks(selectedChecks, qualityConfig);
  assert.deepEqual(ordered, ["links", "seo", "lighthouse"]);

  const plan = resolveCheckExecutionPlan({
    selectedChecks,
    qualityConfig,
    registeredChecks: checks.map((check) => ({
      ...check,
      enabled: Boolean(selectedChecks[check.id]),
    })),
  });

  assert.deepEqual(
    plan.map((entry) => entry.id),
    ["links", "seo", "lighthouse"],
  );
});

test("runQualityChecks skips enabled entries without run()", async () => {
  const logs = [];
  const result = await runQualityChecks({
    checks: [
      {
        id: "demo",
        name: "Demo",
        enabled: true,
        run: null,
      },
    ],
    logger: {
      log(message) {
        logs.push(String(message));
      },
      error(message) {
        logs.push(String(message));
      },
    },
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.checks.demo, null);
  assert.equal(result.dataset, null);
  assert.ok(logs.some((line) => line.includes("no runner configured")));
});

test("runQualityChecks returns dataset built from execution result", async () => {
  const result = await runQualityChecks({
    checks: [
      {
        id: "demo",
        name: "Demo",
        enabled: true,
        async run() {
          return { summary: "ok", failed: false, value: 42 };
        },
      },
    ],
    buildDataset({ checks, failures, summaries, context }) {
      return {
        checks,
        failures,
        summaries,
        context,
      };
    },
    datasetContext: {
      runId: "__pending__",
    },
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.summaries.demo, "ok");
  assert.equal(result.checks.demo?.value, 42);
  assert.equal(result.dataset?.context?.runId, "__pending__");
});

test("buildChecksPlanFromRunners keeps enabled checks runnable", async () => {
  const checks = buildChecksPlanFromRunners({
    plan: [
      { id: "jsonld", name: "JSON-LD", enabled: true },
      { id: "seo", name: "SEO", enabled: true },
    ],
    targetUsesLocalBuild: false,
    runners: {
      jsonld: async () => ({ summary: "jsonld", failed: false }),
      seo: async () => ({ summary: "seo", failed: false }),
    },
  });

  assert.equal(checks[0].enabled, true);
  assert.equal(checks[1].enabled, true);
});

test("runPlannedQualityChecks delegates plan+runners", async () => {
  const logs = [];
  const result = await runPlannedQualityChecks({
    plan: [
      { id: "jsonld", name: "JSON-LD validation", enabled: true },
      { id: "seo", name: "SEO audit", enabled: true },
    ],
    runners: {
      jsonld: async () => ({ summary: "jsonld done", failed: false }),
      seo: async () => ({ summary: "seo done", failed: false }),
    },
    targetUsesLocalBuild: false,
    selectedChecks: {
      jsonld: true,
      seo: true,
    },
    logger: {
      log(message) {
        logs.push(String(message));
      },
      error(message) {
        logs.push(String(message));
      },
    },
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.checks.jsonld?.summary, "jsonld done");
});
