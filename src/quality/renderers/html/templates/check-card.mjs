import { escapeContent } from "./layout.mjs";

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function friendlyCheckName(checkId) {
  const map = {
    lighthouse: "Lighthouse",
    pa11y: "Accessibility (Pa11y)",
    axe: "Accessibility (aXe)",
    form: "Form tests",
    seo: "SEO",
    links: "Link Check",
    jsonld: "JSON-LD",
    security: "Security",
    sitespeed: "Sitespeed.io",
    vnu: "Nu HTML Checker",
  };
  return map[checkId] || checkId;
}

function statusForCheck(checkId, check = {}) {
  const stats = check?.stats || {};
  if (check.failed) {
    if (checkId === "links")
      return { label: "Broken links found", tone: "fail" };
    if (checkId === "lighthouse")
      return { label: "Issues found", tone: "fail" };
    if (checkId === "vnu")
      return { label: "Markup errors found", tone: "fail" };
    if (checkId === "axe")
      return { label: "Accessibility issues found", tone: "fail" };
    if (checkId === "form") return { label: "Form issues found", tone: "fail" };
    return { label: "Needs attention", tone: "fail" };
  }
  const warningCount = asNumber(stats.warningCount);
  if (warningCount > 0) {
    return { label: `${warningCount} warnings`, tone: "warn" };
  }
  return { label: "Healthy", tone: "pass" };
}

export function renderCheckCard(checkId, check = {}, options = {}) {
  const label = check?.label || friendlyCheckName(checkId);
  const status = statusForCheck(checkId, check);
  const href = options.href || `./${checkId}.html`;

  return `<section class="check-card">
    <h2>${escapeContent(label)}</h2>
    <p><span class="status-chip ${escapeContent(status.tone)}">${escapeContent(status.label)}</span></p>
    <p><a class="report-link-btn" href="${escapeContent(href)}">Open details</a></p>
  </section>`;
}

export function renderUnknownCheckFallback(checkId, check = {}, options = {}) {
  const status = check.failed ? "Issues" : "Recorded";
  const href = options.href || `./${checkId}.html`;
  return `<section class="check-card">
    <h2>${escapeContent(checkId)}</h2>
    <p><span class="status-chip ${check.failed ? "fail" : "info"}">${escapeContent(status)}</span></p>
    <p>No dedicated template yet for this check.</p>
    <p><a class="report-link-btn" href="${escapeContent(href)}">Open details</a></p>
  </section>`;
}
