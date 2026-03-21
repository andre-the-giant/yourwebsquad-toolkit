import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clearQualityCheckRegistry,
  listQualityChecks,
  registerQualityCheck,
} from "../../src/quality/core/registry.mjs";
import {
  applyQualityConfigToSelection,
  loadQualityConfig,
  orderedSelectedChecks,
} from "../../src/quality/core/config.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yws-quality-config-"));
}

test("registry registers and lists quality checks", () => {
  clearQualityCheckRegistry();
  registerQualityCheck({
    id: "demo-check",
    async collect() {
      return {};
    },
    async normalize(raw) {
      return raw;
    },
    async summarize() {
      return { summary: "ok", failed: false };
    },
  });

  const checks = listQualityChecks();
  assert.equal(checks.length, 1);
  assert.equal(checks[0].id, "demo-check");
});

test("quality config loads and normalizes check settings", async () => {
  const cwd = tempDir();
  const configPath = path.join(cwd, "quality.config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        checks: {
          enabled: ["axe", "form", "seo", "links", "invalid"],
          disabled: ["links"],
          order: ["form", "axe", "links", "seo"],
          thresholds: {
            form: { failed: 0 },
            seo: { errorCount: 0, warningCount: 3 },
            invalid: { foo: 1 },
          },
          options: {
            form: { includeUploads: true },
            seo: { strict: true },
            invalid: { foo: "bar" },
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const config = await loadQualityConfig(cwd);
  assert.equal(config.path, configPath);
  assert.deepEqual(config.checks.enabled, ["axe", "form", "seo", "links"]);
  assert.deepEqual(config.checks.disabled, ["links"]);
  assert.deepEqual(config.checks.order, ["form", "axe", "links", "seo"]);
  assert.deepEqual(config.checks.thresholds.form, { failed: 0 });
  assert.deepEqual(config.checks.thresholds.seo, {
    errorCount: 0,
    warningCount: 3,
  });
  assert.deepEqual(config.checks.options.form, { includeUploads: true });
  assert.deepEqual(config.checks.options.seo, { strict: true });
});

test("quality config selection and ordering are applied", () => {
  const selection = {
    lighthouse: true,
    pa11y: true,
    axe: true,
    seo: true,
    links: true,
    jsonld: true,
    security: false,
  };
  const config = {
    checks: {
      enabled: ["seo", "links", "jsonld"],
      disabled: ["links"],
      order: ["jsonld", "seo"],
    },
  };
  const availability = {
    lighthouse: { enabled: true },
    pa11y: { enabled: true },
    axe: { enabled: true },
    seo: { enabled: true },
    links: { enabled: true },
    jsonld: { enabled: false },
    security: { enabled: true },
  };

  const next = applyQualityConfigToSelection(selection, config, availability);
  assert.equal(next.seo, true);
  assert.equal(next.links, false);
  assert.equal(next.jsonld, false);

  const ordered = orderedSelectedChecks(next, config);
  assert.deepEqual(ordered, ["seo"]);
});
