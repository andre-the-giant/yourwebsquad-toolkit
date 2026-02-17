#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const candidate = trimmed.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function runCommand(cmd, cmdArgs, { quiet = QUIET_MODE, timeoutMs } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const child = spawn(cmd, cmdArgs, {
      shell: false,
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer = null;

    if (quiet) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);
    }

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      finish({
        code: 1,
        stdout,
        stderr: `${stderr}\n${error?.message || error}`.trim(),
        timedOut: false,
      });
    });

    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      finish({
        code: code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function resolveObservatoryBin() {
  try {
    const packageJsonPath =
      require.resolve("@mdn/mdn-http-observatory/package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const binEntry = packageJson?.bin?.["mdn-http-observatory-scan"];
    if (!binEntry) return null;
    return path.join(path.dirname(packageJsonPath), binEntry);
  } catch {
    return null;
  }
}

function parseObservatoryTarget(baseUrl) {
  const parsed = new URL(baseUrl);
  const host = parsed.hostname;
  const port = parsed.port ? `:${parsed.port}` : "";
  const pathname =
    parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
  return `${host}${port}${pathname}`;
}

async function runObservatory(baseUrl) {
  const target = parseObservatoryTarget(baseUrl);
  const localBin = resolveObservatoryBin();
  const command = localBin ? process.execPath : "npx";
  const commandArgs = localBin
    ? [localBin, target]
    : ["-y", "@mdn/mdn-http-observatory", target];

  const result = await runCommand(command, commandArgs, {
    quiet: true,
    timeoutMs: TIMEOUT_MS,
  });

  if (result.timedOut) {
    return {
      status: "error",
      findings: 0,
      message: "HTTP Observatory scan timed out.",
      details: null,
    };
  }

  const payload = extractJson(result.stdout || result.stderr);
  if (payload) {
    writeJson(path.join(REPORT_DIR, "observatory.json"), payload);
  } else if (result.stdout || result.stderr) {
    fs.writeFileSync(
      path.join(REPORT_DIR, "observatory.raw.txt"),
      `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
      "utf8",
    );
  }

  if (!payload) {
    return {
      status: "error",
      findings: 0,
      message: "Unable to parse HTTP Observatory output.",
      details: null,
    };
  }

  const scan = payload?.scan || {};
  const testsFailed = Number(scan.testsFailed || 0);
  const details = {
    grade: scan.grade || null,
    score: Number.isFinite(scan.score) ? scan.score : null,
    testsPassed: Number(scan.testsPassed || 0),
    testsFailed,
    testsQuantity: Number(scan.testsQuantity || 0),
    statusCode: Number(scan.statusCode || 0),
    error: scan.error || null,
  };

  if (scan.error) {
    return {
      status: "failed",
      findings: Math.max(1, testsFailed),
      message: `HTTP Observatory error: ${scan.error}`,
      details,
    };
  }

  if (result.code !== 0) {
    return {
      status: "error",
      findings: testsFailed,
      message: "HTTP Observatory command failed.",
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
  const lines = [
    "# Security audit report",
    "",
    `Target: ${baseUrl}`,
    "",
    "| Tool | Status | Findings | Notes |",
    "| --- | --- | --- | --- |",
    `| observatory | ${observatory.status} | ${Number(observatory.findings || 0)} | ${observatory.message || ""} |`,
    "",
    `Stats JSON: ${statsPath}`,
    "",
  ];
  const summaryPath = path.join(REPORT_DIR, "SUMMARY.md");
  fs.writeFileSync(summaryPath, lines.join("\n"), "utf8");
  return summaryPath;
}

function writeHtmlSummary(baseUrl, observatory, findingsTotal) {
  const rowClass =
    observatory.status === "passed"
      ? "ok"
      : observatory.status === "skipped"
        ? "skip"
        : "bad";

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
  </style>
</head>
<body>
  <h1>Security audit report</h1>
  <p class="summary">Target: ${baseUrl} · Total findings: ${findingsTotal}</p>
  <table>
    <thead>
      <tr><th>Tool</th><th>Status</th><th>Findings</th><th>Notes</th></tr>
    </thead>
    <tbody>
      <tr class="${rowClass}">
        <td>observatory</td>
        <td>${observatory.status}</td>
        <td>${Number(observatory.findings || 0)}</td>
        <td>${observatory.message || ""}</td>
      </tr>
    </tbody>
  </table>
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
