import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  cleanRunsKeep,
  deleteRun,
  listRuns,
  pruneRunsOlderThan,
  readLatestRunId,
  readRun,
  writeRunSnapshot,
} from "../../src/quality/store/index.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yws-quality-store-"));
}

function makeRawFile(cwd, name, value = "raw") {
  const file = path.join(cwd, name);
  fs.writeFileSync(file, value, "utf8");
  return file;
}

test("writeRunSnapshot writes run, latest pointer, and raw/view artifacts", () => {
  const cwd = tempDir();
  const rawFile = makeRawFile(cwd, "raw.txt", "raw-data");
  const htmlFile = makeRawFile(cwd, "view.html", "<html></html>");

  const snapshot = writeRunSnapshot({
    cwd,
    meta: {
      createdAt: "2026-01-01T00:00:00.000Z",
      target: "development",
      checks: ["seo"],
    },
    dataset: {
      schemaVersion: "1.0.0",
      runId: "__pending__",
      createdAt: "2026-01-01T00:00:00.000Z",
      target: { baseUrl: "http://localhost:4321", usesLocalBuild: true },
      selectedChecks: ["seo"],
      failures: [],
      checks: {},
    },
    rawSources: [{ checkId: "seo", path: rawFile, name: "raw.txt" }],
    viewSources: { html: [{ path: htmlFile, name: "index.html" }] },
  });

  assert.ok(snapshot.runId);
  assert.ok(fs.existsSync(path.join(snapshot.runDir, "meta.json")));
  assert.ok(fs.existsSync(path.join(snapshot.runDir, "dataset.json")));
  assert.ok(
    fs.existsSync(path.join(snapshot.runDir, "raw", "seo", "raw.txt")),
    "raw artifact copied",
  );
  assert.ok(
    fs.existsSync(path.join(cwd, "reports", "views", "html", snapshot.runId, "index.html")),
    "view artifact copied",
  );
  assert.equal(readLatestRunId(cwd), snapshot.runId);

  const loaded = readRun(snapshot.runId, cwd);
  assert.ok(loaded);
  assert.equal(loaded.runId, snapshot.runId);
});

test("deleteRun protects latest unless forced", () => {
  const cwd = tempDir();
  const snapshot = writeRunSnapshot({
    cwd,
    meta: { createdAt: "2026-01-01T00:00:00.000Z", target: "dev", checks: [] },
    dataset: {
      schemaVersion: "1.0.0",
      runId: "__pending__",
      createdAt: "2026-01-01T00:00:00.000Z",
      target: { baseUrl: "http://localhost:4321", usesLocalBuild: true },
      selectedChecks: [],
      failures: [],
      checks: {},
    },
  });

  const blocked = deleteRun(snapshot.runId, { cwd });
  assert.equal(blocked.reason, "latest-protected");
  assert.equal(blocked.deleted, false);

  const removed = deleteRun(snapshot.runId, { cwd, force: true });
  assert.equal(removed.deleted, true);
  assert.equal(fs.existsSync(snapshot.runDir), false);
});

test("clean and prune run operations produce expected targeting", () => {
  const cwd = tempDir();

  const old = writeRunSnapshot({
    cwd,
    meta: { createdAt: "2020-01-01T00:00:00.000Z", target: "dev", checks: [] },
    dataset: {
      schemaVersion: "1.0.0",
      runId: "__pending__",
      createdAt: "2020-01-01T00:00:00.000Z",
      target: { baseUrl: "http://localhost:4321", usesLocalBuild: true },
      selectedChecks: [],
      failures: [],
      checks: {},
    },
  });
  const recent = writeRunSnapshot({
    cwd,
    meta: { createdAt: "2026-01-01T00:00:00.000Z", target: "dev", checks: [] },
    dataset: {
      schemaVersion: "1.0.0",
      runId: "__pending__",
      createdAt: "2026-01-01T00:00:00.000Z",
      target: { baseUrl: "http://localhost:4321", usesLocalBuild: true },
      selectedChecks: [],
      failures: [],
      checks: {},
    },
  });

  const dryClean = cleanRunsKeep({ cwd, keep: 1, dryRun: true, force: true });
  assert.equal(dryClean.targeted >= 1, true);

  const dryPrune = pruneRunsOlderThan({
    cwd,
    olderThanDays: 365,
    dryRun: true,
    force: true,
  });
  assert.equal(dryPrune.targeted >= 1, true);

  const runs = listRuns(cwd);
  assert.equal(runs.length >= 2, true);
  assert.ok(old.runId);
  assert.ok(recent.runId);
});

