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
  "axe",
  "form",
  "seo",
  "links",
  "jsonld",
  "security",
  "sitespeed",
  "vnu",
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

function copyDirectoryIfExists(sourcePath, destinationPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return false;
  const stat = fs.statSync(sourcePath);
  if (!stat.isDirectory()) return false;
  ensureDir(destinationPath);
  for (const child of fs.readdirSync(sourcePath)) {
    const childSource = path.join(sourcePath, child);
    const childTarget = path.join(destinationPath, child);
    const childStat = fs.statSync(childSource);
    if (childStat.isDirectory()) {
      copyDirectoryIfExists(childSource, childTarget);
    } else {
      ensureDir(path.dirname(childTarget));
      fs.copyFileSync(childSource, childTarget);
    }
  }
  return true;
}

function navHtml(runBasePath, selectedChecks = []) {
  const links = reportNavLinks({ basePath: runBasePath, selectedChecks })
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
    infoCount: "Info",
    messagesTotal: "Messages",
    pagesWithIssues: "Pages with issues",
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

function statusPillHtml(label, tone = "info") {
  const safeTone =
    tone === "pass" || tone === "warn" || tone === "fail" || tone === "info"
      ? tone
      : "info";
  return `<span class="status-chip ${safeTone}">${escapeContent(label)}</span>`;
}

function toneForStat(key, numeric) {
  if (
    [
      "errorCount",
      "assertionFailures",
      "runFailures",
      "broken",
      "findingsTotal",
    ].includes(key)
  ) {
    return numeric > 0 ? "fail" : "pass";
  }
  if (["warningCount", "schemaDtsWarningCount"].includes(key)) {
    return numeric > 0 ? "warn" : "pass";
  }
  if (
    [
      "infoCount",
      "urlsTested",
      "pagesTested",
      "reportsGenerated",
      "messagesTotal",
      "pagesWithIssues",
      "skippedExternal",
      "schemaDtsCheckedNodes",
      "schemaDtsIssueCount",
      "schemaDtsErrorCount",
      "linkinatorBroken",
      "brokenCombined",
    ].includes(key)
  ) {
    return "info";
  }
  return "info";
}

function overviewPillsHtml(stats = {}, { excludeKeys = [] } = {}) {
  const hidden = new Set(excludeKeys);
  const pills = Object.entries(stats)
    .filter(([key]) => !hidden.has(key))
    .map(([key, value]) => {
      if (value && typeof value === "object") return null;
      const numeric = Number(value);
      const tone = Number.isFinite(numeric)
        ? toneForStat(key, numeric)
        : "info";
      const label = `${formatStatLabel(key)}: ${formatStatValue(value)}`;
      return statusPillHtml(label, tone);
    })
    .filter(Boolean)
    .join("");
  return pills
    ? `<div class="pill-row">${pills}</div>`
    : `<p class="muted">No stats available</p>`;
}

function lighthouseScoreTone(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "info";
  const outOf100 = n <= 1 ? n * 100 : n;
  if (outOf100 >= 90) return "pass";
  if (outOf100 >= 50) return "warn";
  return "fail";
}

function lighthouseScorePill(score) {
  const value = formatLighthouseScore(score);
  if (value === "-") return statusPillHtml("-", "info");
  return statusPillHtml(value, lighthouseScoreTone(score));
}

function pageReportsTableHtml(checkId, check = {}) {
  const summaries = Array.isArray(check?.meta?.pageSummaries)
    ? check.meta.pageSummaries
    : [];
  if (!summaries.length) {
    return `<p class="muted">No page-level reports found.</p>`;
  }

  const alwaysShowReportLink = checkId === "jsonld";
  const rows = summaries
    .slice(0, 200)
    .map((page) => {
      const errors = Number.isFinite(Number(page?.errors))
        ? Number(page.errors)
        : 0;
      const warnings = Number.isFinite(Number(page?.warnings))
        ? Number(page.warnings)
        : 0;
      const hasIssues = errors + warnings > 0;
      const status = hasIssues
        ? statusPillHtml(
            `${errors + warnings} issue(s)`,
            errors > 0 ? "fail" : "warn",
          )
        : statusPillHtml("No issue", "pass");
      const canOpenReport =
        Boolean(page?.name) && (hasIssues || alwaysShowReportLink);
      const reportCell = canOpenReport
        ? `<a class="report-link-btn" href="./${escapeContent(checkId)}/pages/${escapeContent(page?.name || "")}">Open</a>`
        : `<span class="muted">-</span>`;
      return `<tr>
        <td>${escapeContent(page?.label || page?.name || "-")}</td>
        <td>${escapeContent(String(errors))}</td>
        <td>${escapeContent(String(warnings))}</td>
        <td>${status}</td>
        <td>${reportCell}</td>
      </tr>`;
    })
    .join("");

  return `<div class="table-wrap">
    <table>
      <thead>
        <tr><th>Page</th><th>Errors</th><th>Warnings</th><th>Status</th><th>Report</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
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

function pa11yDetailsHtml(check = {}) {
  const stats =
    check?.stats && typeof check.stats === "object" ? check.stats : {};

  return `<section class="check-card">
    <h2>Pa11y Overview</h2>
    ${overviewPillsHtml(stats)}
  </section>
  <section class="check-card spacer-top">
    <h2>Page Reports</h2>
    ${pageReportsTableHtml("pa11y", check)}
  </section>`;
}

function axeOverviewPillsHtml(stats = {}) {
  const pagesTested = Number(stats?.pagesTested || 0);
  const failedPages = Number(stats?.failedPages || 0);
  const violationCount = Number(stats?.violationCount || 0);
  return `<div class="pill-row">
    ${statusPillHtml(`Pages tested: ${pagesTested}`, "info")}
    ${statusPillHtml(`Execution failures: ${failedPages}`, failedPages > 0 ? "fail" : "pass")}
    ${statusPillHtml(`Violations: ${violationCount}`, violationCount > 0 ? "fail" : "pass")}
  </div>`;
}

function axePageReportsTableHtml(check = {}) {
  const pages = Array.isArray(check?.meta?.pageSummaries)
    ? check.meta.pageSummaries
    : [];
  if (!pages.length) {
    return `<p class="muted">No page-level reports found.</p>`;
  }
  const rows = pages
    .slice(0, 300)
    .map((page) => {
      const violations = Number(page?.violationCount || page?.errors || 0);
      const executionFailed =
        String(page?.status || "").toLowerCase() === "failed" &&
        violations === 0;
      const status = statusPillHtml(
        executionFailed
          ? "Execution failed"
          : violations > 0
            ? `${violations} violation(s)`
            : "No issue",
        executionFailed || violations > 0 ? "fail" : "pass",
      );
      const linkCell = page?.name
        ? `<a class="report-link-btn" href="./axe/pages/${escapeContent(page.name)}">Open</a>`
        : `<span class="muted">-</span>`;
      return `<tr>
        <td>${escapeContent(page?.url || page?.label || "-")}</td>
        <td>${status}</td>
        <td>${linkCell}</td>
      </tr>`;
    })
    .join("");

  return `<div class="table-wrap">
    <table>
      <thead>
        <tr><th>URL</th><th>Violations</th><th>Report</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function axeDetailsHtml(check = {}) {
  return `<section class="check-card">
    <h2>Page Reports</h2>
    ${axePageReportsTableHtml(check)}
  </section>`;
}

function formStatusPill(status) {
  const value = String(status || "-").toLowerCase();
  if (value === "pass") return statusPillHtml("pass", "pass");
  if (value === "fail" || value === "error") {
    return statusPillHtml(value, "fail");
  }
  if (value === "skipped") return statusPillHtml("skipped", "warn");
  if (value === "info" || value === "warn")
    return statusPillHtml(value, "info");
  return `<span class="muted">-</span>`;
}

function pickFormCaseStatus(cases = [], testType) {
  const matches = cases.filter((entry) => entry?.testType === testType);
  if (!matches.length) return "-";
  const statuses = matches.map((entry) =>
    String(entry?.status || "").toLowerCase(),
  );
  if (statuses.includes("error")) return "error";
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("skipped")) return "skipped";
  if (statuses.includes("pass")) return "pass";
  if (statuses.includes("warn")) return "warn";
  if (statuses.includes("info")) return "info";
  return statuses[0] || "-";
}

function formDetailsHtml(check = {}) {
  const stats =
    check?.stats && typeof check.stats === "object" ? check.stats : {};
  const forms = Array.isArray(check?.meta?.forms) ? check.meta.forms : [];
  const testCases = Array.isArray(check?.meta?.testCases)
    ? check.meta.testCases
    : [];
  const execution =
    check?.meta?.execution && typeof check.meta.execution === "object"
      ? check.meta.execution
      : {};
  const preflight =
    check?.meta?.preflight && typeof check.meta.preflight === "object"
      ? check.meta.preflight
      : {};
  const issues = Array.isArray(check?.issues) ? check.issues : [];
  const skippedReason =
    String(stats?.skippedReason || execution?.reason || "").trim() || "";

  const overview = {
    totalForms: Number(stats?.totalForms || forms.length || 0),
    testsRun: Number(stats?.testsRun || 0),
    failedAssertions: Number(stats?.failed || 0),
    preflightFailures: Number(stats?.preflightFailed || 0),
  };
  const overviewPills = [
    statusPillHtml(`Forms tested: ${overview.totalForms}`, "info"),
    statusPillHtml(`Tests run: ${overview.testsRun}`, "info"),
    statusPillHtml(
      `Failed assertions: ${overview.failedAssertions}`,
      overview.failedAssertions > 0 ? "fail" : "pass",
    ),
    statusPillHtml(
      `Preflight failures: ${overview.preflightFailures}`,
      overview.preflightFailures > 0 ? "fail" : "pass",
    ),
  ].join("");

  const rows = forms
    .map((form) => {
      const pageUrl = String(form?.pageUrl || "");
      const formIndex = Number(form?.formIndex ?? 0);
      const relatedCases = testCases.filter(
        (entry) =>
          String(entry?.pageUrl || "") === pageUrl &&
          Number(entry?.formIndex ?? -1) === formIndex,
      );
      const frontend = pickFormCaseStatus(relatedCases, "frontend");
      const apiValid = pickFormCaseStatus(relatedCases, "api-valid");
      const apiInvalid = pickFormCaseStatus(relatedCases, "api-invalid");
      const a11y = pickFormCaseStatus(relatedCases, "a11y");
      const detailText = relatedCases
        .filter(
          (entry) =>
            !["pass", "info"].includes(
              String(entry?.status || "").toLowerCase(),
            ),
        )
        .map(
          (entry) =>
            `${String(entry?.testType || "-")}: ${String(entry?.message || "-")}`,
        )
        .join(" | ");
      return `<tr>
        <td>${escapeContent(pageUrl || "-")}</td>
        <td>${escapeContent(String(form?.id || "-"))}</td>
        <td>${escapeContent(String(form?.formIndex ?? "-"))}</td>
        <td>${escapeContent(String(form?.actionUrl || form?.action || "-"))}</td>
        <td>${escapeContent(String(form?.method || "-"))}</td>
        <td>${formStatusPill(frontend)}</td>
        <td>${formStatusPill(apiValid)}</td>
        <td>${formStatusPill(apiInvalid)}</td>
        <td>${formStatusPill(a11y)}</td>
        <td>${escapeContent(detailText || "-")}</td>
      </tr>`;
    })
    .join("");
  const legacyRefsNotice = Array.isArray(preflight?.notices)
    ? preflight.notices
        .map((entry) => String(entry?.message || ""))
        .find((msg) => msg.includes("Files with remaining legacy references:"))
    : "";
  const preflightLegacyIssue = issues
    .map((entry) => String(entry?.message || ""))
    .find((msg) => msg.includes("legacy /src/content/forms references remain"));

  return `<section class="check-card">
    <h2>Form tests overview</h2>
    <div class="pill-row">${overviewPills}</div>
    ${
      skippedReason
        ? `<p class="muted spacer-top"><strong>Skipped reason:</strong> ${escapeContent(skippedReason)}</p>`
        : ""
    }
    ${
      legacyRefsNotice
        ? `<p class="muted spacer-top"><strong>Legacy reference files:</strong> ${escapeContent(legacyRefsNotice.replace("Files with remaining legacy references: ", ""))}</p>`
        : ""
    }
    ${
      preflightLegacyIssue && !legacyRefsNotice
        ? `<p class="muted spacer-top"><strong>Legacy references:</strong> ${escapeContent(preflightLegacyIssue)}</p>`
        : ""
    }
  </section>
  <section class="check-card spacer-top">
    <h2>Forms found</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Page</th><th>Form ID</th><th>Index</th><th>Action</th><th>Method</th><th>Frontend</th><th>API valid</th><th>API invalid</th><th>a11y</th><th>Details</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="10">No forms were detected for this run.</td></tr>'}</tbody>
      </table>
    </div>
  </section>`;
}

function axePageDetailHtml(page = {}, runBasePath = "", subtitle = "") {
  const violations = Array.isArray(page?.violations) ? page.violations : [];
  const executionFailed =
    String(page?.status || "").toLowerCase() === "failed" &&
    Number(page?.violationCount || 0) === 0;
  const rows = violations
    .map(
      (entry) => `<tr>
      <td>${escapeContent(entry?.id || "-")}</td>
      <td>${escapeContent(entry?.impact || "-")}</td>
      <td>${escapeContent(entry?.nodeCount ?? 0)}</td>
      <td><a href="${escapeContent(entry?.helpUrl || "#")}" target="_blank" rel="noreferrer">${escapeContent(entry?.help || "-")}</a></td>
    </tr>`,
    )
    .join("");
  return renderLayout({
    title: "aXe page report",
    subtitle,
    navHtml: navHtml(runBasePath, ["axe"]),
    stylesheetHref: `${runBasePath}/report.css`,
    bodyHtml: `<section class="check-card">
      <h2>aXe Page Report</h2>
      <p class="muted">${escapeContent(page?.url || "-")}</p>
      <div class="pill-row">
        ${statusPillHtml(`Violations: ${Number(page?.violationCount || 0)}`, Number(page?.violationCount || 0) > 0 ? "fail" : "pass")}
        ${statusPillHtml(`Incomplete: ${Number(page?.incompleteCount || 0)}`, "info")}
        ${executionFailed ? statusPillHtml(`Execution failed${page?.exitCode ? `: ${page.exitCode}` : ""}`, "fail") : ""}
      </div>
    </section>
    ${
      executionFailed
        ? `<section class="check-card spacer-top">
      <h2>Failure</h2>
      <p>${escapeContent(page?.message || "aXe scan failed before reporting violations.")}</p>
    </section>`
        : ""
    }
    <section class="check-card spacer-top">
      <h2>Violations</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Rule</th><th>Impact</th><th>Nodes</th><th>Help</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4">No violations.</td></tr>'}</tbody>
        </table>
      </div>
    </section>`,
  });
}

function seoDetailsHtml(check = {}) {
  const stats =
    check?.stats && typeof check.stats === "object" ? check.stats : {};
  const issues = Array.isArray(check?.issues) ? check.issues : [];
  const issueRows = issues
    .slice(0, 40)
    .map(
      (issue) => `<tr>
        <td>${escapeContent(issue?.severity || "-")}</td>
        <td>${escapeContent(issue?.code || "-")}</td>
        <td>${escapeContent(issue?.message || "-")}</td>
        <td>${escapeContent(issue?.pageUrl || "-")}</td>
      </tr>`,
    )
    .join("");
  return `<section class="check-card">
    <h2>SEO Overview</h2>
    ${overviewPillsHtml(stats)}
  </section>
  <section class="check-card spacer-top">
    <h2>Top Issues</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Severity</th><th>Code</th><th>Message</th><th>Page</th></tr>
        </thead>
        <tbody>${issueRows || '<tr><td colspan="4">No issues</td></tr>'}</tbody>
      </table>
    </div>
  </section>
  <section class="check-card spacer-top">
    <h2>Page Reports</h2>
    ${pageReportsTableHtml("seo", check)}
  </section>`;
}

function vnuPageDetailHtml(page = {}, runBasePath = "", subtitle = "") {
  const issues = Array.isArray(page?.issues) ? page.issues : [];
  const rows = issues
    .map((issue) => {
      const severity = String(issue?.severity || "-").toLowerCase();
      const tone =
        severity === "error"
          ? "fail"
          : severity === "warning"
            ? "warn"
            : "info";
      return `<tr>
        <td>${statusPillHtml(severity === "-" ? "-" : severity, tone)}</td>
        <td>${escapeContent(issue?.line ?? "-")}</td>
        <td>${escapeContent(issue?.column ?? "-")}</td>
        <td>${escapeContent(issue?.message || "-")}</td>
      </tr>`;
    })
    .join("");
  return renderLayout({
    title: "Nu HTML Checker page report",
    subtitle,
    navHtml: navHtml(runBasePath, ["vnu"]),
    stylesheetHref: `${runBasePath}/report.css`,
    bodyHtml: `<section class="check-card">
      <h2>Nu HTML Checker Page Report</h2>
      <p class="muted">${escapeContent(page?.url || page?.label || "-")}</p>
      <div class="pill-row">
        ${statusPillHtml(`Errors: ${Number(page?.errors || 0)}`, Number(page?.errors || 0) > 0 ? "fail" : "pass")}
        ${statusPillHtml(`Warnings: ${Number(page?.warnings || 0)}`, Number(page?.warnings || 0) > 0 ? "warn" : "pass")}
      </div>
    </section>
    <section class="check-card spacer-top">
      <h2>Issues</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Severity</th><th>Line</th><th>Column</th><th>Message</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4">No issues.</td></tr>'}</tbody>
        </table>
      </div>
    </section>`,
  });
}

function linksDetailsHtml(check = {}) {
  const stats =
    check?.stats && typeof check.stats === "object" ? check.stats : {};
  const linksPayload =
    check?.links && typeof check.links === "object" ? check.links : {};
  const broken = Array.isArray(linksPayload.broken) ? linksPayload.broken : [];
  const tools =
    check?.stats?.tools && typeof check.stats.tools === "object"
      ? check.stats.tools
      : {};
  const internalTool =
    tools?.internal && typeof tools.internal === "object" ? tools.internal : {};
  const linkinatorTool =
    tools?.linkinator && typeof tools.linkinator === "object"
      ? tools.linkinator
      : {};
  const brokenRows = broken
    .slice(0, 80)
    .map(
      (entry) => `<tr>
        <td>${escapeContent(entry?.pageUrl || "-")}</td>
        <td>${escapeContent(entry?.linkUrl || "-")}</td>
        <td>${escapeContent(entry?.status || entry?.error || "-")}</td>
        <td>${escapeContent(entry?.selector || "-")}</td>
      </tr>`,
    )
    .join("");
  const toolRows = [
    {
      name: "internal",
      status: Number(internalTool?.brokenCount || 0) > 0 ? "failed" : "passed",
      findings: Number(internalTool?.brokenCount || 0),
      notes:
        Number(internalTool?.skippedExternal || 0) > 0
          ? `skipped external: ${Number(internalTool.skippedExternal)}`
          : "-",
    },
    {
      name: "linkinator",
      status: linkinatorTool?.status || "unknown",
      findings: Number(linkinatorTool?.brokenCount || 0),
      notes: linkinatorTool?.message || "-",
    },
  ]
    .map(
      (tool) => `<tr>
        <td>${escapeContent(tool.name)}</td>
        <td>${escapeContent(tool.status)}</td>
        <td>${escapeContent(String(tool.findings))}</td>
        <td>${escapeContent(tool.notes)}</td>
      </tr>`,
    )
    .join("");
  const linkinatorBroken = Array.isArray(linkinatorTool?.broken)
    ? linkinatorTool.broken
    : [];
  const linkinatorRows = linkinatorBroken
    .slice(0, 120)
    .map(
      (entry) => `<tr>
        <td>${escapeContent(entry?.parent || "-")}</td>
        <td>${escapeContent(entry?.url || "-")}</td>
        <td>${escapeContent(entry?.status || "-")}</td>
      </tr>`,
    )
    .join("");
  const pageSummaries = Array.isArray(check?.meta?.pageSummaries)
    ? check.meta.pageSummaries
    : [];
  const pageReportTable = pageSummaries.length
    ? `<div class="table-wrap">
      <table>
        <thead>
          <tr><th>Page</th><th>Errors</th><th>Report</th></tr>
        </thead>
        <tbody>${pageSummaries
          .slice(0, 200)
          .map((page) => {
            const errors = Number.isFinite(Number(page?.errors))
              ? Number(page.errors)
              : 0;
            const pill = statusPillHtml(
              errors > 0 ? `${errors} error(s)` : "No issue",
              errors > 0 ? "fail" : "pass",
            );
            const linkCell =
              errors > 0
                ? `<a class="report-link-btn" href="./links/pages/${escapeContent(page?.name || "")}">Open</a>`
                : `<span class="muted">-</span>`;
            return `<tr>
              <td>${escapeContent(page?.label || page?.name || "-")}</td>
              <td>${pill}</td>
              <td>${linkCell}</td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>
    </div>`
    : `<p class="muted">No Link-check page reports found.</p>`;

  return `<section class="check-card">
    <h2>Link Check Overview</h2>
    ${overviewPillsHtml(stats, { excludeKeys: ["tools"] })}
  </section>
  <section class="check-card spacer-top">
    <h2>Tool Findings</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Tool</th><th>Status</th><th>Findings</th><th>Notes</th></tr>
        </thead>
        <tbody>${toolRows}</tbody>
      </table>
    </div>
  </section>
  <section class="check-card spacer-top">
    <h2>Broken Links</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Page</th><th>Broken URL</th><th>Status/Error</th><th>Selector</th></tr>
        </thead>
        <tbody>${brokenRows || '<tr><td colspan="4">No broken links</td></tr>'}</tbody>
      </table>
    </div>
  </section>
  <section class="check-card spacer-top">
    <h2>Linkinator Broken Links</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Parent</th><th>Broken URL</th><th>Status</th></tr>
        </thead>
        <tbody>${linkinatorRows || '<tr><td colspan="3">No Linkinator broken links</td></tr>'}</tbody>
      </table>
    </div>
  </section>
  <section class="check-card spacer-top">
    <h2>Page Reports</h2>
    ${pageReportTable}
  </section>`;
}

function jsonldDetailsHtml(check = {}) {
  const stats =
    check?.stats && typeof check.stats === "object" ? check.stats : {};
  const issues = Array.isArray(check?.issues) ? check.issues : [];
  const issueRows = issues
    .slice(0, 80)
    .map(
      (issue) => `<tr>
        <td>${escapeContent(issue?.severity || "-")}</td>
        <td>${escapeContent(issue?.issueMessage || issue?.message || "-")}</td>
        <td>${escapeContent(issue?.pagePath || issue?.file || "-")}</td>
        <td>${escapeContent(
          Array.isArray(issue?.fieldNames) ? issue.fieldNames.join(", ") : "-",
        )}</td>
      </tr>`,
    )
    .join("");
  return `<section class="check-card">
    <h2>JSON-LD Overview</h2>
    ${overviewPillsHtml(stats)}
  </section>
  <section class="check-card spacer-top">
    <h2>Top Issues</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Severity</th><th>Issue</th><th>Page</th><th>Fields</th></tr>
        </thead>
        <tbody>${issueRows || '<tr><td colspan="4">No issues</td></tr>'}</tbody>
      </table>
    </div>
  </section>
  <section class="check-card spacer-top">
    <h2>Page Reports</h2>
    ${pageReportsTableHtml("jsonld", check)}
  </section>`;
}

function securityDetailsHtml(check = {}) {
  const stats =
    check?.stats && typeof check.stats === "object" ? check.stats : {};
  const tools =
    stats?.tools && typeof stats.tools === "object" ? stats.tools : {};
  const toolRows = Object.entries(tools)
    .map(([toolName, tool]) => {
      const findings = Number(tool?.findings || 0);
      return `<tr>
        <td>${escapeContent(toolName)}</td>
        <td>${escapeContent(tool?.status || "-")}</td>
        <td>${escapeContent(findings)}</td>
        <td>${escapeContent(tool?.message || "-")}</td>
      </tr>`;
    })
    .join("");

  const observatoryDiagnostics = Array.isArray(
    tools?.observatory?.details?.headerDiagnostics,
  )
    ? tools.observatory.details.headerDiagnostics
    : [];
  const diagnosticsRows = observatoryDiagnostics
    .slice(0, 40)
    .map(
      (issue) => `<tr>
        <td>${escapeContent(issue?.code || "-")}</td>
        <td>${escapeContent(issue?.message || "-")}</td>
      </tr>`,
    )
    .join("");

  const mainReportLink = check?.meta?.reportHtmlPath
    ? `<a class="report-link-btn" href="./security/report.html">Open Security report.html</a>`
    : `<span class="muted">No Security report.html found</span>`;

  return `<section class="check-card">
    <h2>Security Overview</h2>
    ${overviewPillsHtml(stats, { excludeKeys: ["tools"] })}
    <p class="spacer-top">${mainReportLink}</p>
  </section>
  <section class="check-card spacer-top">
    <h2>Tool Findings</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Tool</th><th>Status</th><th>Findings</th><th>Notes</th></tr>
        </thead>
        <tbody>${toolRows || '<tr><td colspan="4">No tool entries</td></tr>'}</tbody>
      </table>
    </div>
  </section>
  <section class="check-card spacer-top">
    <h2>Header Diagnostics</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Code</th><th>Message</th></tr>
        </thead>
        <tbody>${diagnosticsRows || '<tr><td colspan="2">No diagnostics issues</td></tr>'}</tbody>
      </table>
    </div>
  </section>`;
}

function sitespeedDetailsHtml(check = {}) {
  const stats =
    check?.stats && typeof check.stats === "object" ? check.stats : {};
  const reportLink = check?.meta?.indexHtmlPath
    ? `<a class="report-link-btn" href="./sitespeed/source/">Open Sitespeed.io report</a>`
    : `<span class="muted">No Sitespeed.io report index found</span>`;

  return `<section class="check-card">
    <h2>Sitespeed.io Overview</h2>
    ${overviewPillsHtml(stats)}
    <p class="spacer-top">${reportLink}</p>
  </section>`;
}

function vnuDetailsHtml(check = {}) {
  const stats =
    check?.stats && typeof check.stats === "object" ? check.stats : {};
  const selected = {
    errorCount: stats?.errorCount,
    warningCount: stats?.warningCount,
  };

  return `<section class="check-card">
    <h2>Nu HTML Checker Overview</h2>
    ${overviewPillsHtml(selected)}
  </section>
  <section class="check-card spacer-top">
    <h2>Page Reports</h2>
    ${pageReportsTableHtml("vnu", check)}
  </section>`;
}

function formatMetricNumber(value, suffix = "") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${Math.round(n)}${suffix}`;
}

function formatMetricKilobytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n / 1024).toFixed(1)} KB`;
}

function formatLighthouseScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "-";
  return `${Math.round(n * 100)}`;
}

function encodeHrefPath(pathValue) {
  return String(pathValue || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function lighthouseOverviewTableHtml(check = {}, runBasePath = "") {
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
      const htmlSize = formatMetricKilobytes(item?.htmlSizeBytes);
      const totalSize = formatMetricKilobytes(item?.totalLoadedSizeBytes);
      const loadMs = formatMetricNumber(item?.totalLoadTimeMs, " ms");
      const perf = lighthouseScorePill(item?.scores?.performance);
      const accessibility = lighthouseScorePill(item?.scores?.accessibility);
      const bestPractices = lighthouseScorePill(item?.scores?.bestPractices);
      const seo = lighthouseScorePill(item?.scores?.seo);
      const preferredName = item?.htmlReport || null;
      const reportName = preferredName || htmlReports[index]?.name || null;
      const resolvedName = reportName
        ? reportByName.has(reportName)
          ? reportName
          : reportByName.has(`${reportName}.html`)
            ? `${reportName}.html`
            : htmlReports[index]?.name || null
        : null;
      const report = resolvedName ? reportByName.get(resolvedName) : null;
      const link = resolvedName
        ? report
          ? `<a class="report-link-btn" href="${escapeContent(runBasePath)}/lighthouse/reports/${encodeHrefPath(report.name)}">Open</a>`
          : `<span class="muted">${escapeContent(resolvedName)}</span>`
        : `<span class="muted">-</span>`;
      return `<tr>
        <td>${escapeContent(url)}</td>
        <td>${escapeContent(htmlSize)}</td>
        <td>${escapeContent(totalSize)}</td>
        <td>${escapeContent(loadMs)}</td>
        <td>${perf}</td>
        <td>${accessibility}</td>
        <td>${bestPractices}</td>
        <td>${seo}</td>
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
          <th>Perf</th>
          <th>A11y</th>
          <th>Best Practices</th>
          <th>SEO</th>
          <th>Report</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function lighthouseScoreSummaryTableHtml(check = {}) {
  const metrics = Array.isArray(check?.metrics) ? check.metrics : [];
  if (!metrics.length) {
    return `<p class="muted">No Lighthouse score data available.</p>`;
  }

  const categories = [
    { key: "performance", label: "Performance" },
    { key: "accessibility", label: "Accessibility" },
    { key: "bestPractices", label: "Best Practices" },
    { key: "seo", label: "SEO" },
    { key: "pwa", label: "PWA" },
  ];

  const rows = categories
    .map(({ key, label }) => {
      const values = metrics
        .map((item) => Number(item?.scores?.[key]))
        .filter((n) => Number.isFinite(n));
      if (!values.length) {
        return `<tr><th>${escapeContent(label)}</th><td>-</td><td>0</td></tr>`;
      }
      const average = values.reduce((sum, n) => sum + n, 0) / values.length;
      return `<tr><th>${escapeContent(label)}</th><td>${lighthouseScorePill(average)}</td><td>${escapeContent(String(values.length))}</td></tr>`;
    })
    .join("");

  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Average score (/100)</th>
          <th>Pages</th>
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
  const runBasePath = `/views/html/${encodeURIComponent(runId)}`;
  const stylesheetHref = `${runBasePath}/report.css`;
  ensureDir(outDir);

  const checks =
    dataset?.checks && typeof dataset.checks === "object" ? dataset.checks : {};
  const selectedCheckIds = Array.isArray(dataset?.selectedChecks)
    ? dataset.selectedChecks
    : Object.keys(checks);
  const cards = Object.entries(checks)
    .map(([checkId, check]) =>
      KNOWN_CHECKS.has(checkId)
        ? renderCheckCard(checkId, check, {
            href:
              checkId === "lighthouse"
                ? `${runBasePath}/lighthouse/index.html`
                : `${runBasePath}/${checkId}.html`,
          })
        : renderUnknownCheckFallback(checkId, check, {
            href: `${runBasePath}/${checkId}.html`,
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
    navHtml: navHtml(runBasePath, selectedCheckIds),
    bodyHtml: body,
    stylesheetHref,
  });
  writeText(path.join(outDir, "index.html"), indexHtml);

  for (const [checkId, check] of Object.entries(checks)) {
    if (checkId === "pa11y") {
      if (check?.meta?.reportHtmlPath) {
        copyFileIfExists(
          check.meta.reportHtmlPath,
          path.join(outDir, "pa11y", "report.html"),
        );
      }
      const pa11yPages = Array.isArray(check?.meta?.pageReports)
        ? check.meta.pageReports
        : [];
      for (const report of pa11yPages) {
        if (!report?.name || !report?.path) continue;
        copyFileIfExists(
          report.path,
          path.join(outDir, "pa11y", "pages", report.name),
        );
      }
    }
    if (checkId === "axe") {
      if (check?.meta?.reportHtmlPath) {
        copyFileIfExists(
          check.meta.reportHtmlPath,
          path.join(outDir, "axe", "report.html"),
        );
      }
      const axePages = Array.isArray(check?.meta?.pageSummaries)
        ? check.meta.pageSummaries
        : [];
      for (let i = 0; i < axePages.length; i += 1) {
        const page = axePages[i];
        const name = page?.name || `${String(i + 1).padStart(4, "0")}.html`;
        const html = axePageDetailHtml(page, runBasePath, subtitle);
        writeText(path.join(outDir, "axe", "pages", name), html);
      }
    }
    if (checkId === "form") {
      if (check?.meta?.reportHtmlPath) {
        copyFileIfExists(
          check.meta.reportHtmlPath,
          path.join(outDir, "form", "report.html"),
        );
      }
    }
    if (checkId === "seo") {
      if (check?.meta?.reportHtmlPath) {
        copyFileIfExists(
          check.meta.reportHtmlPath,
          path.join(outDir, "seo", "report.html"),
        );
      }
      const seoPages = Array.isArray(check?.meta?.pageReports)
        ? check.meta.pageReports
        : [];
      for (const report of seoPages) {
        if (!report?.name || !report?.path) continue;
        copyFileIfExists(
          report.path,
          path.join(outDir, "seo", "pages", report.name),
        );
      }
    }
    if (checkId === "links") {
      if (check?.meta?.reportHtmlPath) {
        copyFileIfExists(
          check.meta.reportHtmlPath,
          path.join(outDir, "links", "report.html"),
        );
      }
      const linkPages = Array.isArray(check?.meta?.pageReports)
        ? check.meta.pageReports
        : [];
      for (const report of linkPages) {
        if (!report?.name || !report?.path) continue;
        copyFileIfExists(
          report.path,
          path.join(outDir, "links", "pages", report.name),
        );
      }
    }
    if (checkId === "jsonld") {
      if (check?.meta?.reportHtmlPath) {
        copyFileIfExists(
          check.meta.reportHtmlPath,
          path.join(outDir, "jsonld", "report.html"),
        );
      }
      const jsonldPages = Array.isArray(check?.meta?.pageReports)
        ? check.meta.pageReports
        : [];
      for (const report of jsonldPages) {
        if (!report?.name || !report?.path) continue;
        copyFileIfExists(
          report.path,
          path.join(outDir, "jsonld", "pages", report.name),
        );
      }
    }
    if (checkId === "security") {
      if (check?.meta?.reportHtmlPath) {
        copyFileIfExists(
          check.meta.reportHtmlPath,
          path.join(outDir, "security", "report.html"),
        );
      }
    }
    if (checkId === "sitespeed") {
      if (check?.meta?.reportDirPath) {
        copyDirectoryIfExists(
          check.meta.reportDirPath,
          path.join(outDir, "sitespeed", "source"),
        );
      }
    }
    if (checkId === "vnu") {
      if (check?.meta?.reportHtmlPath) {
        copyFileIfExists(
          check.meta.reportHtmlPath,
          path.join(outDir, "vnu", "report.html"),
        );
      }
      const vnuPages = Array.isArray(check?.meta?.pageSummaries)
        ? check.meta.pageSummaries
        : [];
      for (let i = 0; i < vnuPages.length; i += 1) {
        const page = vnuPages[i];
        const name = page?.name || `${String(i + 1).padStart(4, "0")}.html`;
        const html = vnuPageDetailHtml(page, runBasePath, subtitle);
        writeText(path.join(outDir, "vnu", "pages", name), html);
      }
    }

    const page = renderLayout({
      title: `Check: ${checkId}`,
      subtitle,
      navHtml: navHtml(runBasePath, selectedCheckIds),
      stylesheetHref,
      bodyHtml:
        checkId === "pa11y"
          ? pa11yDetailsHtml(check)
          : checkId === "axe"
            ? axeDetailsHtml(check)
            : checkId === "form"
              ? formDetailsHtml(check)
              : checkId === "seo"
                ? seoDetailsHtml(check)
                : checkId === "links"
                  ? linksDetailsHtml(check)
                  : checkId === "jsonld"
                    ? jsonldDetailsHtml(check)
                    : checkId === "security"
                      ? securityDetailsHtml(check)
                      : checkId === "sitespeed"
                        ? sitespeedDetailsHtml(check)
                        : checkId === "vnu"
                          ? vnuDetailsHtml(check)
                          : checkDetailsHtml(checkId, check),
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

    const lighthouseStats =
      checks.lighthouse?.stats && typeof checks.lighthouse.stats === "object"
        ? checks.lighthouse.stats
        : {};
    const lighthousePage = renderLayout({
      title: "Check: Lighthouse",
      subtitle,
      navHtml: navHtml(runBasePath, selectedCheckIds),
      stylesheetHref,
      bodyHtml: `<section class="check-card">
        <h2>Lighthouse</h2>
        <p class="muted">Overview</p>
        ${overviewPillsHtml(lighthouseStats)}
      </section>
      <section class="check-card spacer-top">
        <h2>Category Scores</h2>
        ${lighthouseScoreSummaryTableHtml(checks.lighthouse)}
      </section>
      <section class="check-card spacer-top">
        <h2>Per-page Metrics</h2>
        ${lighthouseOverviewTableHtml(checks.lighthouse, runBasePath)}
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
