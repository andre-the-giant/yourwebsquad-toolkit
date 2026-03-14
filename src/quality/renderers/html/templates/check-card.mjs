import { escapeContent } from "./layout.mjs";

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function friendlyCheckName(checkId) {
  const map = {
    lighthouse: "Lighthouse",
    pa11y: "Accessibility (Pa11y)",
    seo: "SEO",
    links: "Link Check",
    jsonld: "JSON-LD",
    security: "Security",
  };
  return map[checkId] || checkId;
}

function statusForCheck(checkId, check = {}) {
  const stats = check?.stats || {};
  if (check.failed) {
    if (checkId === "links") return { label: "Broken links found", tone: "fail" };
    if (checkId === "lighthouse") return { label: "Issues found", tone: "fail" };
    return { label: "Needs attention", tone: "fail" };
  }
  const warningCount = asNumber(stats.warningCount);
  if (warningCount > 0) {
    return { label: `${warningCount} warnings`, tone: "warn" };
  }
  return { label: "Healthy", tone: "pass" };
}

function friendlyStats(checkId, check = {}) {
  const stats =
    check?.stats && typeof check.stats === "object" ? check.stats : {};
  const labels = {
    urlsTested: "URLs tested",
    reportsGenerated: "Reports generated",
    assertionFailures: "Assertions failed",
    runFailures: "Run failures",
    errorCount: "Errors",
    warningCount: "Warnings",
    pagesTested: "Pages tested",
    findingsTotal: "Findings",
    broken: "Broken links",
    skippedExternal: "External links skipped",
  };
  return Object.entries(stats)
    .slice(0, 4)
    .map(
      ([key, value]) =>
        `<li><strong>${escapeContent(labels[key] || key)}:</strong> ${escapeContent(value)}</li>`,
    )
    .join("");
}

export function renderCheckCard(checkId, check = {}, options = {}) {
  const label = check?.label || friendlyCheckName(checkId);
  const status = statusForCheck(checkId, check);
  const statRows = friendlyStats(checkId, check);
  const href = options.href || `./${checkId}.html`;

  return `<section class="check-card">
    <h2>${escapeContent(label)}</h2>
    <p><span class="status-chip ${escapeContent(status.tone)}">${escapeContent(status.label)}</span></p>
    <ul>${statRows || "<li>No stats available</li>"}</ul>
    <p><a class="check-link" href="${escapeContent(href)}">Open details</a></p>
  </section>`;
}

export function renderUnknownCheckFallback(checkId, check = {}, options = {}) {
  const status = check.failed ? "Issues" : "Recorded";
  const href = options.href || `./${checkId}.html`;
  return `<section class="check-card">
    <h2>${escapeContent(checkId)}</h2>
    <p><span class="status-chip ${check.failed ? "fail" : "info"}">${escapeContent(status)}</span></p>
    <p>No dedicated template yet for this check.</p>
    <p><a class="check-link" href="${escapeContent(href)}">Open details</a></p>
  </section>`;
}
