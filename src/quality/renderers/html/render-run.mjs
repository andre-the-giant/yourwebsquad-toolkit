import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createArtifactManifest } from "../types.mjs";
import { reportNavLinks } from "../nav.mjs";
import { renderLayout, escapeContent } from "./templates/layout.mjs";
import {
  renderCheckCard,
  renderUnknownCheckFallback,
} from "./templates/check-card.mjs";

const KNOWN_CHECKS = new Set([
  "lighthouse",
  "pa11y",
  "seo",
  "links",
  "jsonld",
  "security",
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, "utf8");
}

function copyFileIfExists(sourcePath, destinationPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return false;
  ensureDir(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
  return true;
}

function navHtml() {
  const links = reportNavLinks()
    .map(
      (link) =>
        `<a href="${escapeContent(link.href)}">${escapeContent(link.label)}</a>`,
    )
    .join("");
  return `<div class="report-nav">${links}</div>`;
}

function formatStatLabel(key) {
  const labels = {
    urlsTested: "URLs tested",
    reportsGenerated: "Reports generated",
    assertionFailures: "Assertions failed",
    runFailures: "Run failures",
    runFailureUrls: "Run failure URLs",
    errorCount: "Errors",
    warningCount: "Warnings",
    pagesTested: "Pages tested",
    findingsTotal: "Findings",
    broken: "Broken links",
    skippedExternal: "External links skipped",
    failures: "Failed assertions",
  };
  return labels[key] || key;
}

function formatStatValue(value) {
  if (Array.isArray(value)) {
    if (!value.length) return "None";
    const first = value[0];
    if (typeof first === "string" || typeof first === "number") {
      return value.slice(0, 5).join(", ");
    }
    return `${value.length} item(s)`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    return keys.length ? `${keys.length} field(s)` : "Object";
  }
  if (value === "" || value === null || value === undefined) return "-";
  return String(value);
}

function checkDetailsHtml(checkId, check = {}) {
  const stats =
    check?.stats && typeof check.stats === "object" ? check.stats : {};
  const isKnown = KNOWN_CHECKS.has(checkId);
  const statsRows = Object.entries(stats)
    .map(
      ([key, value]) =>
        `<tr><th>${escapeContent(formatStatLabel(key))}</th><td>${escapeContent(formatStatValue(value))}</td></tr>`,
    )
    .join("");
  return `<section class="check-card">
    <h2>${escapeContent(checkId)}</h2>
    ${isKnown ? "" : "<p>No dedicated detail template yet for this check.</p>"}
    <table>${statsRows || "<tr><td>No stats</td></tr>"}</table>
  </section>`;
}

function formatMetricNumber(value, suffix = "") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${Math.round(n)}${suffix}`;
}

function lighthouseOverviewTableHtml(check = {}) {
  const metrics = Array.isArray(check?.metrics) ? check.metrics : [];
  const htmlReports = Array.isArray(check?.meta?.htmlReports)
    ? check.meta.htmlReports
    : [];
  const reportByName = new Map(
    htmlReports
      .filter((entry) => entry && entry.name)
      .map((entry) => [entry.name, entry]),
  );
  const rows = metrics
    .map((item, index) => {
      const url = item?.url || "-";
      const htmlSize = formatMetricNumber(item?.htmlSizeBytes, " B");
      const totalSize = formatMetricNumber(item?.totalLoadedSizeBytes, " B");
      const loadMs = formatMetricNumber(item?.totalLoadTimeMs, " ms");
      const reportName = item?.htmlReport || htmlReports[index]?.name || null;
      const report = reportName ? reportByName.get(reportName) : null;
      const link = reportName
        ? report
          ? `<a class="check-link" href="./reports/${escapeContent(report.name)}">Open</a>`
          : `<span class="muted">${escapeContent(reportName)}</span>`
        : `<span class="muted">-</span>`;
      return `<tr>
        <td>${escapeContent(url)}</td>
        <td>${escapeContent(htmlSize)}</td>
        <td>${escapeContent(totalSize)}</td>
        <td>${escapeContent(loadMs)}</td>
        <td>${link}</td>
      </tr>`;
    })
    .join("");
  if (!rows) {
    return `<p class="muted">No Lighthouse metrics available for this run.</p>`;
  }
  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>URL</th>
          <th>HTML size</th>
          <th>Total loaded size</th>
          <th>Total load time</th>
          <th>Report</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export function renderHtmlRun({ cwd = process.cwd(), runId, dataset }) {
  if (!runId) throw new Error("renderHtmlRun requires runId.");
  const reportRoot = path.join(cwd, "reports");
  const outDir = path.join(reportRoot, "views", "html", runId);
  ensureDir(outDir);

  const checks =
    dataset?.checks && typeof dataset.checks === "object" ? dataset.checks : {};
  const cards = Object.entries(checks)
    .map(([checkId, check]) =>
      KNOWN_CHECKS.has(checkId)
        ? renderCheckCard(checkId, check, {
            href:
              checkId === "lighthouse"
                ? "./lighthouse/index.html"
                : `./${checkId}.html`,
          })
        : renderUnknownCheckFallback(checkId, check, {
            href: `./${checkId}.html`,
          }),
    )
    .join("\n");

  const runDate = dataset?.createdAt
    ? new Date(dataset.createdAt).toLocaleString()
    : runId;
  const subtitle = `Run ${runDate} - ${dataset?.target?.name || dataset?.target?.key || "unknown target"}`;
  const body = `<section class="check-grid">${cards || "<p>No check payloads found.</p>"}</section>`;
  const indexHtml = renderLayout({
    title: "Quality Report",
    subtitle,
    navHtml: navHtml(),
    bodyHtml: body,
  });
  writeText(path.join(outDir, "index.html"), indexHtml);

  for (const [checkId, check] of Object.entries(checks)) {
    const page = renderLayout({
      title: `Check: ${checkId}`,
      subtitle,
      navHtml: navHtml(),
      bodyHtml: checkDetailsHtml(checkId, check),
    });
    writeText(path.join(outDir, `${checkId}.html`), page);
  }

  if (checks.lighthouse) {
    const lighthouseReports = Array.isArray(
      checks.lighthouse?.meta?.htmlReports,
    )
      ? checks.lighthouse.meta.htmlReports
      : [];
    for (const report of lighthouseReports) {
      if (!report?.name || !report?.path) continue;
      copyFileIfExists(
        report.path,
        path.join(outDir, "lighthouse", "reports", report.name),
      );
    }

    const statsRows = Object.entries(
      checks.lighthouse?.stats && typeof checks.lighthouse.stats === "object"
        ? checks.lighthouse.stats
        : {},
    )
      .map(
        ([key, value]) =>
          `<tr><th>${escapeContent(formatStatLabel(key))}</th><td>${escapeContent(formatStatValue(value))}</td></tr>`,
      )
      .join("");
    const lighthousePage = renderLayout({
      title: "Check: Lighthouse",
      subtitle,
      navHtml: navHtml(),
      bodyHtml: `<section class="check-card">
        <h2>Lighthouse</h2>
        <p class="muted">Overview</p>
        <div class="table-wrap">
          <table>${statsRows || "<tr><td>No stats available</td></tr>"}</table>
        </div>
      </section>
      <section class="check-card spacer-top">
        <h2>Per-page Metrics</h2>
        ${lighthouseOverviewTableHtml(checks.lighthouse)}
      </section>`,
    });
    writeText(path.join(outDir, "lighthouse", "index.html"), lighthousePage);
  }

  const currentFile = fileURLToPath(import.meta.url);
  const cssSource = path.join(
    path.dirname(currentFile),
    "assets",
    "report.css",
  );
  const cssTarget = path.join(outDir, "report.css");
  fs.copyFileSync(cssSource, cssTarget);

  const files = fs.readdirSync(outDir).map((name) => ({
    path: path.join(outDir, name),
    relPath: name,
  }));

  return createArtifactManifest({
    format: "html",
    runId,
    rootDir: outDir,
    files,
  });
}
