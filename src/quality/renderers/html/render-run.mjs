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

function navHtml() {
  const links = reportNavLinks()
    .map((link) => `<a href="${escapeContent(link.href)}">${escapeContent(link.label)}</a>`)
    .join("");
  return `<div class="report-nav">${links}</div>`;
}

function checkDetailsHtml(checkId, check = {}) {
  const stats = check?.stats && typeof check.stats === "object" ? check.stats : {};
  const isKnown = KNOWN_CHECKS.has(checkId);
  const statsRows = Object.entries(stats)
    .map(
      ([key, value]) =>
        `<tr><th>${escapeContent(key)}</th><td>${escapeContent(value)}</td></tr>`,
    )
    .join("");
  return `<section class="check-card">
    <h2>${escapeContent(checkId)}</h2>
    ${isKnown ? "" : "<p>No dedicated detail template yet for this check.</p>"}
    <table>${statsRows || "<tr><td>No stats</td></tr>"}</table>
  </section>`;
}

export function renderHtmlRun({ cwd = process.cwd(), runId, dataset }) {
  if (!runId) throw new Error("renderHtmlRun requires runId.");
  const reportRoot = path.join(cwd, "reports");
  const outDir = path.join(reportRoot, "views", "html", runId);
  ensureDir(outDir);

  const checks = dataset?.checks && typeof dataset.checks === "object" ? dataset.checks : {};
  const cards = Object.entries(checks)
    .map(([checkId, check]) =>
      KNOWN_CHECKS.has(checkId)
        ? renderCheckCard(checkId, check)
        : renderUnknownCheckFallback(checkId, check),
    )
    .join("\n");

  const subtitle = `Run ${runId} - ${dataset?.target?.name || dataset?.target?.key || "unknown target"}`;
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

  const currentFile = fileURLToPath(import.meta.url);
  const cssSource = path.join(path.dirname(currentFile), "assets", "report.css");
  const cssTarget = path.join(outDir, "report.css");
  fs.copyFileSync(cssSource, cssTarget);

  const files = fs
    .readdirSync(outDir)
    .map((name) => ({
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
