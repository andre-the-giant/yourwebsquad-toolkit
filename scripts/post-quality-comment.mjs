#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function formatScore(score) {
  if (typeof score !== "number") return "–";
  return `${Math.round(score * 100)}`;
}

// SEO
const seoIssues = safeReadJson(path.join("seo-report", "issues.json")) || [];
const seoPages = new Set(seoIssues.map((i) => i.pageUrl));
const seoErrorCount = seoIssues.filter((i) => i.severity === "error").length;
const seoWarnCount = seoIssues.filter((i) => i.severity === "warn").length;

// Pa11y
const pa11yStats = safeReadJson(path.join("pa11y-report", "stats.json"));

// Lighthouse
let lhManifest =
  safeReadJson(path.join("lhci-report", "manifest.json")) ||
  safeReadJson(path.join(".lighthouseci", "manifest.json")) ||
  [];
const lhCategories = ["performance", "accessibility", "best-practices", "seo"];
const lhSummary = {};
for (const cat of lhCategories) {
  lhSummary[cat] = { minScore: null, minUrl: null };
}
for (const run of lhManifest) {
  const url = run.url;
  const summary = run.summary || {};
  for (const cat of lhCategories) {
    const score = summary[cat];
    if (typeof score !== "number") continue;
    const current = lhSummary[cat].minScore;
    if (current === null || score < current) {
      lhSummary[cat].minScore = score;
      lhSummary[cat].minUrl = url;
    }
  }
}

let body = "## 🔍 Automated quality summary\n\n";

// Lighthouse section
body += "### Lighthouse (LHCI)\n";
if (!lhManifest.length) {
  body += "- No Lighthouse data found. Did LHCI run and write `lhci-report/manifest.json`?\n\n";
} else {
  const urlsTested = new Set(lhManifest.map((r) => r.url));
  body += `- Pages tested: **${urlsTested.size}**\n`;
  body += "- Minimum scores across tested pages:\n";
  body += lhCategories
    .map((cat) => {
      const { minScore, minUrl } = lhSummary[cat];
      if (minScore === null) return `  - ${cat}: no data`;
      return `  - **${cat}**: **${formatScore(minScore)}** / 100 (worst: \`${minUrl}\`)`;
    })
    .join("\n");
  body += "\n\n";
}

// Pa11y section
body += "### Accessibility (Pa11y)\n";
if (!pa11yStats) {
  body += "- No Pa11y stats found. Expected `pa11y-report/stats.json`.\n\n";
} else {
  body += `- Pages tested: **${pa11yStats.pagesTested}**\n`;
  body += `- Issues: **${pa11yStats.errorCount}**\n`;
  if (typeof pa11yStats.warningCount === "number") {
    body += `- Warnings: **${pa11yStats.warningCount}**\n`;
  }
  body += "\n";
}

// SEO section
body += "### SEO audit (custom crawler)\n";
if (!seoIssues.length) {
  if (seoPages.size === 0) {
    body += "- No SEO issues and no pages recorded. Did the SEO audit run?\n\n";
  } else {
    body += `- Pages tested: **${seoPages.size}**\n`;
    body += "- ✅ No SEO issues found.\n\n";
  }
} else {
  body += `- Pages tested: **${seoPages.size || "unknown"}**\n`;
  body += `- Error-level issues: **${seoErrorCount}**\n`;
  body += `- Warning-level issues: **${seoWarnCount}**\n\n`;

  const byPage = new Map();
  for (const issue of seoIssues) {
    if (!byPage.has(issue.pageUrl)) byPage.set(issue.pageUrl, []);
    byPage.get(issue.pageUrl).push(issue);
  }

  const worstPages = Array.from(byPage.entries())
    .map(([url, issues]) => ({
      url,
      errors: issues.filter((i) => i.severity === "error").length,
      warns: issues.filter((i) => i.severity === "warn").length
    }))
    .sort((a, b) => b.errors - a.errors || b.warns - a.warns)
    .slice(0, 3);

  if (worstPages.length) {
    body += "Worst pages by SEO issues:\n";
    for (const p of worstPages) {
      body += `- \`${p.url}\`: **${p.errors} errors**, **${p.warns} warnings**\n`;
    }
    body += "\n";
  }
}

body += "_Full details are available in the workflow artifacts (Lighthouse, Pa11y, SEO reports)._";

const { GITHUB_REPOSITORY, GITHUB_EVENT_PATH, GITHUB_TOKEN } = process.env;

if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN is not set; cannot post PR comment.");
  process.exit(0);
}

if (!GITHUB_REPOSITORY || !GITHUB_EVENT_PATH) {
  console.error(
    "Missing GITHUB_REPOSITORY or GITHUB_EVENT_PATH; are we running in GitHub Actions?"
  );
  process.exit(0);
}

const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, "utf8"));
const prNumber = event.pull_request && event.pull_request.number;

if (!prNumber) {
  console.error(
    "No pull_request number found in event payload. This script should run on pull_request events."
  );
  process.exit(0);
}

const [owner, repo] = GITHUB_REPOSITORY.split("/");

const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;

const headers = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json"
};

console.log(`💬 Posting quality summary comment to PR #${prNumber}...`);

const res = await fetch(apiUrl, {
  method: "POST",
  headers,
  body: JSON.stringify({ body })
});

if (!res.ok) {
  const text = await res.text();
  console.error("Failed to post PR comment:", res.status, text);
  process.exit(0);
}

console.log("✅ Quality summary comment posted.");
