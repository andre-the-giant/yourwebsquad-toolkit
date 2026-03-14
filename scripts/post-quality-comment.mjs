#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { readLatestRunId, readRun } from "../src/quality/store/index.mjs";

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(value) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return "unknown date";
  return new Date(ts).toISOString();
}

function chunk(lines = []) {
  return `${lines.join("\n")}\n\n`;
}

function loadCanonicalSnapshot(cwd = process.cwd()) {
  const runId = readLatestRunId(cwd);
  if (!runId) return null;
  const run = readRun(runId, cwd);
  if (!run?.dataset) return null;
  return {
    runId,
    createdAt: run.meta?.createdAt || run.dataset?.createdAt || null,
    dataset: run.dataset,
  };
}

function loadLegacyData(cwd = process.cwd()) {
  const base = path.join(cwd, "reports");
  const seoIssues =
    safeReadJson(path.join(cwd, "seo-report", "issues.json")) ||
    safeReadJson(path.join(base, "seo", "issues.json")) ||
    [];
  const pa11yStats =
    safeReadJson(path.join(cwd, "pa11y-report", "stats.json")) ||
    safeReadJson(path.join(base, "pa11y", "stats.json"));
  const lighthouseStats =
    safeReadJson(path.join(base, "lighthouse", "stats.json")) || null;

  return {
    seoIssues: Array.isArray(seoIssues) ? seoIssues : [],
    pa11yStats,
    lighthouseStats,
  };
}

function worstSeoPages(issues = []) {
  const byPage = new Map();
  for (const issue of issues) {
    const pageUrl = String(issue?.pageUrl || "").trim();
    if (!pageUrl) continue;
    if (!byPage.has(pageUrl)) byPage.set(pageUrl, []);
    byPage.get(pageUrl).push(issue);
  }
  return Array.from(byPage.entries())
    .map(([url, pageIssues]) => ({
      url,
      errors: pageIssues.filter((i) => i?.severity === "error").length,
      warns: pageIssues.filter((i) => i?.severity === "warn").length,
    }))
    .sort((a, b) => b.errors - a.errors || b.warns - a.warns)
    .slice(0, 3);
}

function buildBodyFromCanonical(snapshot) {
  const dataset = snapshot?.dataset || {};
  const checks = dataset?.checks || {};

  const lines = [];
  lines.push("## 🔍 Automated quality summary");
  lines.push("");
  lines.push(`- Run: \`${snapshot.runId}\``);
  lines.push(`- Created: ${formatDate(snapshot.createdAt)}`);
  lines.push(`- Target: **${dataset?.target?.name || dataset?.target?.key || "unknown"}**`);
  lines.push("");

  const lhStats = checks?.lighthouse?.stats || null;
  lines.push("### Lighthouse");
  if (!lhStats) {
    lines.push("- No Lighthouse stats in canonical dataset.");
  } else {
    lines.push(`- Pages tested: **${toNumber(lhStats.urlsTested)}**`);
    lines.push(`- Assertion failures: **${toNumber(lhStats.assertionFailures)}**`);
    lines.push(`- Run failures: **${toNumber(lhStats.runFailures)}**`);
  }
  lines.push("");

  const pa11yStats = checks?.pa11y?.stats || null;
  lines.push("### Pa11y");
  if (!pa11yStats) {
    lines.push("- No Pa11y stats in canonical dataset.");
  } else {
    lines.push(`- Pages tested: **${toNumber(pa11yStats.pagesTested)}**`);
    lines.push(`- Issues: **${toNumber(pa11yStats.errorCount)}**`);
    lines.push(`- Warnings: **${toNumber(pa11yStats.warningCount)}**`);
  }
  lines.push("");

  const seoStats = checks?.seo?.stats || null;
  const seoIssues = Array.isArray(checks?.seo?.issues) ? checks.seo.issues : [];
  lines.push("### SEO audit");
  if (!seoStats && !seoIssues.length) {
    lines.push("- No SEO data in canonical dataset.");
  } else {
    lines.push(
      `- Pages tested: **${toNumber(seoStats?.pagesTested || 0) || "unknown"}**`,
    );
    lines.push(`- Error-level issues: **${toNumber(seoStats?.errorCount || 0)}**`);
    lines.push(
      `- Warning-level issues: **${toNumber(seoStats?.warningCount || 0)}**`,
    );
    const worst = worstSeoPages(seoIssues);
    if (worst.length) {
      lines.push("");
      lines.push("Worst pages by SEO issues:");
      for (const page of worst) {
        lines.push(
          `- \`${page.url}\`: **${page.errors} errors**, **${page.warns} warnings**`,
        );
      }
    }
  }
  lines.push("");
  lines.push(
    "_Summary generated from canonical run dataset (`reports/runs/<runId>/dataset.json`)._",
  );

  return lines.join("\n");
}

function buildBodyFromLegacy(legacy) {
  const seoIssues = legacy?.seoIssues || [];
  const seoPages = new Set(seoIssues.map((issue) => issue?.pageUrl).filter(Boolean));
  const seoErrorCount = seoIssues.filter((i) => i?.severity === "error").length;
  const seoWarnCount = seoIssues.filter((i) => i?.severity === "warn").length;
  const pa11yStats = legacy?.pa11yStats || null;
  const lhStats = legacy?.lighthouseStats || null;

  const lines = [];
  lines.push("## 🔍 Automated quality summary");
  lines.push("");
  lines.push("_Canonical run dataset not found; using legacy report files._");
  lines.push("");
  lines.push("### Lighthouse");
  if (!lhStats) {
    lines.push("- No Lighthouse stats found.");
  } else {
    lines.push(`- Pages tested: **${toNumber(lhStats.urlsTested)}**`);
    lines.push(`- Assertion failures: **${toNumber(lhStats.assertionFailures)}**`);
    lines.push(`- Run failures: **${toNumber(lhStats.runFailures)}**`);
  }
  lines.push("");
  lines.push("### Pa11y");
  if (!pa11yStats) {
    lines.push("- No Pa11y stats found.");
  } else {
    lines.push(`- Pages tested: **${toNumber(pa11yStats.pagesTested)}**`);
    lines.push(`- Issues: **${toNumber(pa11yStats.errorCount)}**`);
    lines.push(`- Warnings: **${toNumber(pa11yStats.warningCount)}**`);
  }
  lines.push("");
  lines.push("### SEO audit");
  if (!seoIssues.length) {
    lines.push("- No SEO issues found.");
  } else {
    lines.push(`- Pages tested: **${seoPages.size || "unknown"}**`);
    lines.push(`- Error-level issues: **${seoErrorCount}**`);
    lines.push(`- Warning-level issues: **${seoWarnCount}**`);
  }
  lines.push("");
  lines.push("_Full details are available in workflow artifacts._");
  return lines.join("\n");
}

async function main() {
  const canonical = loadCanonicalSnapshot(process.cwd());
  const legacy = loadLegacyData(process.cwd());

  const body = canonical
    ? buildBodyFromCanonical(canonical)
    : buildBodyFromLegacy(legacy);

  const { GITHUB_REPOSITORY, GITHUB_EVENT_PATH, GITHUB_TOKEN } = process.env;
  if (!GITHUB_TOKEN) {
    console.error("GITHUB_TOKEN is not set; cannot post PR comment.");
    process.exit(0);
  }
  if (!GITHUB_REPOSITORY || !GITHUB_EVENT_PATH) {
    console.error(
      "Missing GITHUB_REPOSITORY or GITHUB_EVENT_PATH; are we running in GitHub Actions?",
    );
    process.exit(0);
  }

  const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, "utf8"));
  const prNumber = event.pull_request && event.pull_request.number;
  if (!prNumber) {
    console.error(
      "No pull_request number found in event payload. This script should run on pull_request events.",
    );
    process.exit(0);
  }

  const [owner, repo] = GITHUB_REPOSITORY.split("/");
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  console.log(`Posting quality summary comment to PR #${prNumber}...`);
  const res = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Failed to post PR comment:", res.status, text);
    process.exit(0);
  }

  console.log("Quality summary comment posted.");
}

main().catch((error) => {
  console.error(`Unexpected error posting quality summary: ${error?.message || error}`);
  process.exit(0);
});
