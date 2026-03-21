#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_REPORT_DIR = path.join(process.cwd(), "reports", "axe");

function parseArgs(argv = []) {
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if ((arg === "--base" || arg === "-b") && argv[i + 1]) {
      options.base = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
      continue;
    }

    if ((arg === "--urls-file" || arg === "-u") && argv[i + 1]) {
      options.urlsFile = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--urls-file=")) {
      options.urlsFile = arg.slice("--urls-file=".length);
      continue;
    }

    if ((arg === "--report-dir" || arg === "-o") && argv[i + 1]) {
      options.reportDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--report-dir=")) {
      options.reportDir = arg.slice("--report-dir=".length);
      continue;
    }

    if (arg === "--quiet" || arg === "-q") {
      options.quiet = true;
    }
  }

  return options;
}

function normalizeUrl(input) {
  try {
    const parsed = new URL(String(input || "").trim());
    parsed.hash = "";
    let normalized = parsed.toString();
    if (normalized.endsWith("/") && parsed.pathname !== "/") {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
}

function loadUrlsFromFile(filePath) {
  if (!filePath) {
    throw new Error("Missing required option: --urls-file");
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`URLs file not found: ${filePath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in URLs file: ${error?.message || error}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("URLs file must be a JSON array.");
  }

  const unique = new Set();
  for (const entry of parsed) {
    const normalized = normalizeUrl(entry);
    if (normalized) unique.add(normalized);
  }

  const urls = Array.from(unique);
  if (!urls.length) {
    throw new Error("No valid URLs found in --urls-file.");
  }
  return urls;
}

function prepareReportDir(dirPath) {
  const reportDir = String(dirPath || DEFAULT_REPORT_DIR);
  fs.mkdirSync(reportDir, { recursive: true });

  const artifacts = [
    "stats.json",
    "issues.json",
    "results.json",
    "SUMMARY.md",
    "report.html",
  ];
  for (const name of artifacts) {
    const target = path.join(reportDir, name);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }
  }
  return reportDir;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function runAxeForUrl(url, { reportDir, quiet = false } = {}) {
  const safe = slugify(url) || "page";
  const outputFile = `${safe}.axe.json`;
  const args = [
    "axe",
    url,
    "--tags",
    "wcag2a,wcag2aa",
    "--dir",
    reportDir,
    "--save",
    outputFile,
    "--show-errors",
    "false",
  ];

  if (!quiet) {
    console.log(`Running aXe: ${url}`);
  }

  const exitCode = await new Promise((resolve) => {
    const child = spawn("npx", args, {
      stdio: quiet ? "ignore" : "inherit",
      shell: false,
      env: process.env,
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  const outPath = path.join(reportDir, outputFile);
  let payload = null;
  if (fs.existsSync(outPath)) {
    try {
      payload = JSON.parse(fs.readFileSync(outPath, "utf8"));
    } catch {
      payload = null;
    }
  }

  return {
    url,
    exitCode,
    outputPath: outPath,
    payload: Array.isArray(payload) ? payload[0] || null : payload,
  };
}

function countNodes(entries) {
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((sum, item) => {
    const nodes = Array.isArray(item?.nodes) ? item.nodes.length : 0;
    return sum + nodes;
  }, 0);
}

function normalizeAxePageResult(raw = {}) {
  const payload = raw?.payload && typeof raw.payload === "object" ? raw.payload : {};
  const violations = Array.isArray(payload.violations) ? payload.violations : [];
  const incomplete = Array.isArray(payload.incomplete) ? payload.incomplete : [];
  const passes = Array.isArray(payload.passes) ? payload.passes : [];

  return {
    url: raw.url,
    exitCode: Number(raw.exitCode || 0),
    outputPath: raw.outputPath || null,
    status: Number(raw.exitCode || 0) === 0 ? "passed" : "failed",
    violationCount: violations.length,
    violationNodeCount: countNodes(violations),
    incompleteCount: incomplete.length,
    incompleteNodeCount: countNodes(incomplete),
    passCount: passes.length,
    passesNodeCount: countNodes(passes),
    violations: violations.map((entry) => ({
      id: entry?.id || "",
      impact: entry?.impact || null,
      help: entry?.help || "",
      helpUrl: entry?.helpUrl || "",
      tags: Array.isArray(entry?.tags) ? entry.tags : [],
      nodeCount: Array.isArray(entry?.nodes) ? entry.nodes.length : 0,
    })),
  };
}

function buildStats(pageResults = []) {
  const total = pageResults.length;
  const failedPages = pageResults.filter((entry) => entry.status === "failed").length;
  const passedPages = total - failedPages;

  const violationCount = pageResults.reduce(
    (sum, entry) => sum + Number(entry.violationCount || 0),
    0,
  );
  const violationNodeCount = pageResults.reduce(
    (sum, entry) => sum + Number(entry.violationNodeCount || 0),
    0,
  );
  const incompleteCount = pageResults.reduce(
    (sum, entry) => sum + Number(entry.incompleteCount || 0),
    0,
  );
  const incompleteNodeCount = pageResults.reduce(
    (sum, entry) => sum + Number(entry.incompleteNodeCount || 0),
    0,
  );
  const passCount = pageResults.reduce(
    (sum, entry) => sum + Number(entry.passCount || 0),
    0,
  );
  const passesNodeCount = pageResults.reduce(
    (sum, entry) => sum + Number(entry.passesNodeCount || 0),
    0,
  );

  return {
    pagesTested: total,
    passedPages,
    failedPages,
    violationCount,
    violationNodeCount,
    incompleteCount,
    incompleteNodeCount,
    passCount,
    passesNodeCount,
  };
}

function flattenIssues(pageResults = []) {
  const issues = [];
  for (const page of pageResults) {
    const pageUrl = page?.url || "";
    const violations = Array.isArray(page?.violations) ? page.violations : [];
    for (const violation of violations) {
      issues.push({
        pageUrl,
        ruleId: violation?.id || "",
        impact: violation?.impact || null,
        help: violation?.help || "",
        helpUrl: violation?.helpUrl || "",
        tags: Array.isArray(violation?.tags) ? violation.tags : [],
        nodeCount: Number(violation?.nodeCount || 0),
      });
    }
  }
  return issues;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeSummary(reportDir, { stats, pageResults }) {
  const lines = [
    "# aXe accessibility report",
    "",
    `- Created: ${stats.createdAt || "unknown"}`,
    `- Pages tested: ${stats.pagesTested || 0}`,
    `- Passed pages: ${stats.passedPages || 0}`,
    `- Failed pages: ${stats.failedPages || 0}`,
    `- Violations: ${stats.violationCount || 0}`,
    `- Violation nodes: ${stats.violationNodeCount || 0}`,
    `- Incomplete: ${stats.incompleteCount || 0}`,
    "",
    "## Per-page summary",
    "",
  ];

  for (const page of pageResults) {
    lines.push(
      `- ${page.url} | ${page.status} | violations=${page.violationCount} | incomplete=${page.incompleteCount}`,
    );
  }

  fs.writeFileSync(path.join(reportDir, "SUMMARY.md"), `${lines.join("\n")}\n`, "utf8");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeHtmlReport(reportDir, { stats, pageResults, issues }) {
  const pageRows = pageResults
    .map(
      (page) => `<tr>
  <td><a href="${escapeHtml(page.url)}" target="_blank" rel="noreferrer">${escapeHtml(page.url)}</a></td>
  <td>${escapeHtml(page.status)}</td>
  <td>${escapeHtml(page.violationCount)}</td>
  <td>${escapeHtml(page.incompleteCount)}</td>
</tr>`,
    )
    .join("\n");

  const issueRows = issues
    .slice(0, 500)
    .map(
      (issue) => `<tr>
  <td><a href="${escapeHtml(issue.pageUrl)}" target="_blank" rel="noreferrer">${escapeHtml(issue.pageUrl)}</a></td>
  <td>${escapeHtml(issue.ruleId)}</td>
  <td>${escapeHtml(issue.impact || "")}</td>
  <td>${escapeHtml(issue.nodeCount)}</td>
  <td><a href="${escapeHtml(issue.helpUrl || "#")}" target="_blank" rel="noreferrer">${escapeHtml(issue.help || "")}</a></td>
</tr>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>aXe Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #1f2937; }
    h1,h2 { margin-bottom: 8px; }
    .meta { margin-bottom: 16px; }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 20px; }
    .chip { border: 1px solid #d1d5db; border-radius: 999px; padding: 4px 10px; font-size: 12px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f9fafb; }
    .muted { color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <h1>aXe Accessibility Report</h1>
  <p class="meta muted">Created: ${escapeHtml(stats.createdAt || "unknown")}</p>
  <div class="chips">
    <span class="chip">Pages tested: ${escapeHtml(stats.pagesTested || 0)}</span>
    <span class="chip">Passed pages: ${escapeHtml(stats.passedPages || 0)}</span>
    <span class="chip">Failed pages: ${escapeHtml(stats.failedPages || 0)}</span>
    <span class="chip">Violations: ${escapeHtml(stats.violationCount || 0)}</span>
    <span class="chip">Incomplete: ${escapeHtml(stats.incompleteCount || 0)}</span>
  </div>

  <h2>Pages</h2>
  <table>
    <thead>
      <tr><th>URL</th><th>Status</th><th>Violations</th><th>Incomplete</th></tr>
    </thead>
    <tbody>${pageRows || '<tr><td colspan="4">No page results.</td></tr>'}</tbody>
  </table>

  <h2>Issues</h2>
  <p class="muted">Showing up to 500 rows.</p>
  <table>
    <thead>
      <tr><th>URL</th><th>Rule</th><th>Impact</th><th>Nodes</th><th>Help</th></tr>
    </thead>
    <tbody>${issueRows || '<tr><td colspan="5">No issues.</td></tr>'}</tbody>
  </table>
</body>
</html>`;

  fs.writeFileSync(path.join(reportDir, "report.html"), html, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const urls = loadUrlsFromFile(args.urlsFile);
  const reportDir = prepareReportDir(args.reportDir);
  const createdAt = new Date().toISOString();
  if (!args.quiet) {
    console.log("axe-audit args:", args);
    console.log(`Loaded ${urls.length} URL(s).`);
    console.log(`Prepared report directory: ${reportDir}`);
  }

  const rawResults = [];
  for (const url of urls) {
    const result = await runAxeForUrl(url, {
      reportDir,
      quiet: Boolean(args.quiet),
    });
    rawResults.push(result);
  }
  const pageResults = rawResults.map(normalizeAxePageResult);
  const issues = flattenIssues(pageResults);
  const stats = {
    ...buildStats(pageResults),
    createdAt,
    baseUrl: args.base || null,
    urlsFile: args.urlsFile || null,
  };
  writeJson(path.join(reportDir, "results.json"), pageResults);
  writeJson(path.join(reportDir, "issues.json"), issues);
  writeJson(path.join(reportDir, "stats.json"), stats);
  writeSummary(reportDir, { stats, pageResults });
  writeHtmlReport(reportDir, { stats, pageResults, issues });

  const runFailureCount = rawResults.filter((entry) => entry.exitCode !== 0).length;
  const hasViolations = Number(stats.violationCount || 0) > 0;
  if (runFailureCount > 0 || hasViolations) {
    process.exitCode = 1;
  }

  if (!args.quiet) {
    const failedRuns = stats.failedPages;
    const violationTotal = stats.violationCount;
    console.log(
      `Completed aXe runs: ${rawResults.length} total, ${failedRuns} non-zero exit code(s).`,
    );
    console.log(`Detected ${violationTotal} total violation group(s).`);
    if (process.exitCode === 1) {
      console.log(
        `aXe check failed: ${runFailureCount} command failure(s), ${violationTotal} violation group(s).`,
      );
    } else {
      console.log("aXe check passed with zero violations.");
    }
  }
}

main().catch((error) => {
  console.error("axe-audit failed:", error?.message || String(error));
  process.exit(1);
});
