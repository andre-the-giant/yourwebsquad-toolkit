import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAxePayload } from "../../src/quality/checks/axe/normalize.mjs";
import { normalizeVnuPayload } from "../../src/quality/checks/vnu/normalize.mjs";
import { renderCheckCard } from "../../src/quality/renderers/html/templates/check-card.mjs";

test("axe normalization preserves execution failures without violations", () => {
  const normalized = normalizeAxePayload({
    stats: {
      pagesTested: 2,
      failedPages: 2,
      violationCount: 0,
    },
    results: [
      {
        url: "http://127.0.0.1:4321/en",
        status: "failed",
        exitCode: 2,
        message: "aXe command failed for selected page.",
        violationCount: 0,
        incompleteCount: 0,
        violations: [],
      },
    ],
  });

  assert.equal(normalized.failed, true);
  assert.equal(normalized.meta.executionFailures.length, 1);
  assert.equal(
    normalized.meta.pageSummaries[0].message,
    "aXe command failed for selected page.",
  );
});

test("axe home card distinguishes scan failures from accessibility violations", () => {
  const html = renderCheckCard("axe", {
    failed: true,
    stats: {
      violationCount: 0,
      failedPages: 2,
    },
  });

  assert.match(html, /Accessibility scan failures found/);
});

test("vnu normalization builds page summaries grouped by URL", () => {
  const normalized = normalizeVnuPayload({
    stats: {
      urlsTested: 2,
      pagesWithIssues: 1,
      errorCount: 1,
      warningCount: 1,
    },
    issues: [
      {
        severity: "error",
        url: "http://127.0.0.1:4321/en",
        line: 1,
        column: 2,
        message: "Broken markup",
      },
      {
        severity: "warning",
        url: "http://127.0.0.1:4321/en",
        line: 3,
        column: 4,
        message: "Section lacks heading",
      },
    ],
  });

  assert.equal(normalized.meta.pageSummaries.length, 1);
  assert.equal(normalized.meta.pageSummaries[0].errors, 1);
  assert.equal(normalized.meta.pageSummaries[0].warnings, 1);
  assert.equal(normalized.meta.pageSummaries[0].issues.length, 2);
});
