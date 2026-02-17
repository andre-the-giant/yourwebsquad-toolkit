#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const DEFAULT_REPORT_DIR =
  process.env.SECURITY_REPORT_DIR ||
  path.join(process.cwd(), "reports/security");
const DEFAULT_TIMEOUT_MS = Number(process.env.SECURITY_TIMEOUT_MS || 900000);

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.base ?? DEFAULT_BASE_URL;
const REPORT_DIR = args.reportDir ?? DEFAULT_REPORT_DIR;
const QUIET_MODE = Boolean(args.quiet);
const TIMEOUT_MS = Number.isFinite(args.timeoutMs)
  ? args.timeoutMs
  : DEFAULT_TIMEOUT_MS;

if (args.help) {
  printHelp();
  process.exit(0);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if ((arg === "--base" || arg === "-b") && argv[i + 1]) {
      options.base = argv[i + 1];
      i += 1;
      continue;
    }
    if ((arg === "--report-dir" || arg === "-o") && argv[i + 1]) {
      options.reportDir = argv[i + 1];
      i += 1;
      continue;
    }
    if ((arg === "--timeout-ms" || arg === "-m") && argv[i + 1]) {
      options.timeoutMs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
    }
  }
  return options;
}

function printHelp() {
  console.log("Usage:");
  console.log(
    "  yws-toolkit quality security [--base <url>] [--report-dir <dir>] [--timeout-ms <ms>] [--quiet]",
  );
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function ensureCleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isLocalOrPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    return true;
  }
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
  return false;
}

function getObservatoryHost(baseUrl) {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}

async function collectHeaderDiagnostics(targetUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });

    const issues = [];
    const finalUrl = res.url || targetUrl;
    const protocol = (() => {
      try {
        return new URL(finalUrl).protocol;
      } catch {
        return "";
      }
    })();

    const get = (name) => (res.headers.get(name) || "").trim();
    const hsts = get("strict-transport-security");
    const csp = get("content-security-policy");
    const xfo = get("x-frame-options");
    const xcto = get("x-content-type-options");
    const referrer = get("referrer-policy");
    const permissions = get("permissions-policy");

    if (protocol === "https:" && !hsts) {
      issues.push({
        code: "missing-strict-transport-security",
        message: "Missing Strict-Transport-Security header on HTTPS response.",
      });
    }
    if (!csp) {
      issues.push({
        code: "missing-content-security-policy",
        message: "Missing Content-Security-Policy header.",
      });
    } else if (/\bunsafe-inline\b/i.test(csp)) {
      issues.push({
        code: "csp-unsafe-inline",
        message: "Content-Security-Policy contains 'unsafe-inline'.",
      });
    }
    if (!xfo) {
      issues.push({
        code: "missing-x-frame-options",
        message: "Missing X-Frame-Options header.",
      });
    }
    if (!xcto || xcto.toLowerCase() !== "nosniff") {
      issues.push({
        code: "x-content-type-options-not-nosniff",
        message: "X-Content-Type-Options should be set to 'nosniff'.",
      });
    }
    if (!referrer) {
      issues.push({
        code: "missing-referrer-policy",
        message: "Missing Referrer-Policy header.",
      });
    }
    if (!permissions) {
      issues.push({
        code: "missing-permissions-policy",
        message: "Missing Permissions-Policy header.",
      });
    }

    return {
      issues,
      statusCode: res.status,
      finalUrl,
      error: null,
    };
  } catch (error) {
    return {
      issues: [],
      statusCode: null,
      finalUrl: targetUrl,
      error:
        error?.name === "AbortError"
          ? "timeout"
          : String(error?.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchObservatoryScan(host) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const endpoint = new URL(
      "https://observatory-api.mdn.mozilla.net/api/v2/scan",
    );
    endpoint.searchParams.set("host", host);
    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
    });
    const raw = await res.text();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      raw,
      json,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runObservatory(baseUrl) {
  const host = getObservatoryHost(baseUrl);
  if (!host) {
    return {
      status: "error",
      findings: 0,
      message: "Could not resolve hostname from base URL.",
      details: null,
    };
  }
  if (isLocalOrPrivateHost(host)) {
    return {
      status: "skipped",
      findings: 0,
      message:
        "HTTP Observatory API requires a publicly reachable domain. Skipping local/private host.",
      details: { host },
    };
  }

  let response;
  try {
    response = await fetchObservatoryScan(host);
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    return {
      status: "error",
      findings: 0,
      message: isAbort
        ? "HTTP Observatory API request timed out."
        : `HTTP Observatory API request failed: ${error?.message || error}`,
      details: { host },
    };
  }

  if (response?.json) {
    writeJson(path.join(REPORT_DIR, "observatory.json"), response.json);
  } else if (response?.raw) {
    fs.writeFileSync(
      path.join(REPORT_DIR, "observatory.raw.txt"),
      response.raw,
      "utf8",
    );
  }

  const scan = response?.json || {};
  const testsFailed = Number(scan.tests_failed || 0);
  const details = {
    host,
    id: Number(scan.id || 0) || null,
    detailsUrl: scan.details_url || null,
    grade: scan.grade || null,
    score: Number.isFinite(scan.score) ? scan.score : null,
    testsPassed: Number(scan.tests_passed || 0),
    testsFailed,
    testsQuantity: Number(scan.tests_quantity || 0),
    statusCode: Number(scan.status_code || 0),
    error: scan.error || null,
    headerDiagnostics: [],
    diagnosticsStatusCode: null,
    diagnosticsFinalUrl: null,
    diagnosticsError: null,
  };

  const diagnostics = await collectHeaderDiagnostics(baseUrl);
  details.headerDiagnostics = diagnostics.issues;
  details.diagnosticsStatusCode = diagnostics.statusCode;
  details.diagnosticsFinalUrl = diagnostics.finalUrl;
  details.diagnosticsError = diagnostics.error;

  if (!response?.json) {
    return {
      status: "error",
      findings: 0,
      message: `Unexpected HTTP Observatory response (status ${response?.status || 0}).`,
      details,
    };
  }

  if (scan.error) {
    return {
      status: response.ok ? "failed" : "error",
      findings: Math.max(1, testsFailed),
      message: `HTTP Observatory error: ${scan.error}`,
      details,
    };
  }

  if (!response.ok) {
    return {
      status: "error",
      findings: testsFailed,
      message: `HTTP Observatory API returned HTTP ${response.status}.`,
      details,
    };
  }

  return {
    status: testsFailed > 0 ? "failed" : "passed",
    findings: testsFailed,
    message:
      testsFailed > 0
        ? `HTTP Observatory found ${testsFailed} failed checks.`
        : "HTTP Observatory found no failed checks.",
    details,
  };
}

function writeMarkdownSummary(baseUrl, observatory, statsPath) {
  const details = observatory?.details || {};
  const diagnostics = Array.isArray(details.headerDiagnostics)
    ? details.headerDiagnostics
    : [];
  const lines = [
    "# Security audit report",
    "",
    `Target: ${baseUrl}`,
    "",
    "| Tool | Status | Findings | Notes |",
    "| --- | --- | --- | --- |",
    `| observatory | ${observatory.status} | ${Number(observatory.findings || 0)} | ${observatory.message || ""} |`,
    "",
    "## Observatory details",
    "",
    `- Grade: ${details.grade ?? "-"}`,
    `- Score: ${Number.isFinite(details.score) ? details.score : "-"}`,
    `- Tests: ${details.testsPassed ?? 0} passed / ${details.testsFailed ?? 0} failed / ${details.testsQuantity ?? 0} total`,
    `- HTTP status: ${details.statusCode ?? "-"}`,
    details.detailsUrl
      ? `- Detailed MDN view: ${details.detailsUrl}`
      : "- Detailed MDN view: not available",
    "",
    "### Header diagnostics (heuristic)",
    "",
    diagnostics.length
      ? diagnostics
          .map((issue) => `- \`${issue.code}\`: ${issue.message}`)
          .join("\n")
      : "- No obvious header issues detected by local diagnostics.",
    details.diagnosticsError
      ? `- Diagnostics warning: ${details.diagnosticsError}`
      : "",
    "",
    `Stats JSON: ${statsPath}`,
    "",
  ];
  const summaryPath = path.join(REPORT_DIR, "SUMMARY.md");
  fs.writeFileSync(summaryPath, lines.join("\n"), "utf8");
  return summaryPath;
}

function writeHtmlSummary(baseUrl, observatory, findingsTotal) {
  const details = observatory?.details || {};
  const diagnostics = Array.isArray(details.headerDiagnostics)
    ? details.headerDiagnostics
    : [];
  const rowClass =
    observatory.status === "passed"
      ? "ok"
      : observatory.status === "skipped"
        ? "skip"
        : "bad";

  const detailItems = [
    `<li><strong>Grade:</strong> ${escapeHtml(details.grade || "-")}</li>`,
    `<li><strong>Score:</strong> ${Number.isFinite(details.score) ? details.score : "-"}</li>`,
    `<li><strong>Tests:</strong> ${Number(details.testsPassed || 0)} passed / ${Number(details.testsFailed || 0)} failed / ${Number(details.testsQuantity || 0)} total</li>`,
    `<li><strong>HTTP status:</strong> ${Number(details.statusCode || 0) || "-"}</li>`,
    details.detailsUrl
      ? `<li><strong>Detailed MDN view:</strong> <a href="${escapeHtml(details.detailsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(details.detailsUrl)}</a></li>`
      : "<li><strong>Detailed MDN view:</strong> not available</li>",
  ];

  const diagnosticsList = diagnostics.length
    ? `<ul>${diagnostics
        .map(
          (issue) =>
            `<li><code>${escapeHtml(issue.code)}</code>: ${escapeHtml(issue.message)}</li>`,
        )
        .join("")}</ul>`
    : "<p>No obvious header issues detected by local diagnostics.</p>";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Security audit report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #0b1021; color: #e8ecf5; }
    h1 { margin-bottom: 0; }
    .summary { color: #9fb3ff; margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #1f2a45; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #11172d; }
    tr.ok td { color: #9ef5a1; }
    tr.bad td { color: #ff8a8a; }
    tr.skip td { color: #ffd27f; }
    .details { margin-top: 18px; padding: 14px; border: 1px solid #1f2a45; border-radius: 8px; background: #11172d; }
    .details h2 { margin: 0 0 10px; font-size: 16px; }
    .details h3 { margin: 12px 0 6px; font-size: 14px; }
    .details ul { margin: 0; padding-left: 18px; }
    .details li { margin: 4px 0; color: #e8ecf5; }
    .details p { margin: 6px 0; color: #e8ecf5; }
    .details a { color: #9fb3ff; }
  </style>
</head>
<body>
  <h1>Security audit report</h1>
  <p class="summary">Target: ${escapeHtml(baseUrl)} · Total findings: ${findingsTotal}</p>
  <table>
    <thead>
      <tr><th>Tool</th><th>Status</th><th>Findings</th><th>Notes</th></tr>
    </thead>
    <tbody>
      <tr class="${rowClass}">
        <td>observatory</td>
        <td>${escapeHtml(observatory.status)}</td>
        <td>${Number(observatory.findings || 0)}</td>
        <td>${escapeHtml(observatory.message || "")}</td>
      </tr>
    </tbody>
  </table>
  <section class="details">
    <h2>Observatory details</h2>
    <ul>${detailItems.join("")}</ul>
    <h3>Header diagnostics (heuristic)</h3>
    ${diagnosticsList}
    ${details.diagnosticsError ? `<p>Diagnostics warning: ${escapeHtml(details.diagnosticsError)}</p>` : ""}
  </section>
</body>
</html>`;
  const reportPath = path.join(REPORT_DIR, "report.html");
  fs.writeFileSync(reportPath, html, "utf8");
  return reportPath;
}

async function main() {
  const normalizedBaseUrl = normalizeUrl(BASE_URL);
  if (!normalizedBaseUrl) {
    console.error(`Invalid --base URL: ${BASE_URL}`);
    process.exit(1);
  }

  ensureCleanDir(REPORT_DIR);
  console.log(`🔐 Running security audit against ${normalizedBaseUrl}`);

  const observatory = await runObservatory(normalizedBaseUrl);
  const findingsTotal = Number(observatory.findings || 0);
  const failed =
    observatory.status === "failed" || observatory.status === "error";

  const stats = {
    baseUrl: normalizedBaseUrl,
    generatedAt: new Date().toISOString(),
    findingsTotal,
    failed,
    failedTools: failed ? ["observatory"] : [],
    tools: {
      observatory,
    },
  };

  const statsPath = path.join(REPORT_DIR, "stats.json");
  writeJson(statsPath, stats);
  const summaryPath = writeMarkdownSummary(
    normalizedBaseUrl,
    observatory,
    statsPath,
  );
  const reportPath = writeHtmlSummary(
    normalizedBaseUrl,
    observatory,
    findingsTotal,
  );

  console.log(`📄 Security summary (md): ${summaryPath}`);
  console.log(`📄 Security report (html): ${reportPath}`);
  console.log(`📄 Security stats (json): ${statsPath}`);

  if (failed) {
    console.error(`❌ Security checks failed. Findings: ${findingsTotal}`);
    process.exit(1);
  }

  console.log(`✅ Security checks passed. Findings: ${findingsTotal}`);
}

main().catch((error) => {
  console.error(
    `Unexpected error in security-audit: ${error?.message || error}`,
  );
  process.exit(1);
});
