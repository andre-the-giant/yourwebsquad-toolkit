#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { preferIpv4Loopback } from "../src/quality/common/url.mjs";

const DEFAULT_BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const DEFAULT_REPORT_DIR =
  process.env.VNU_REPORT_DIR || path.join(process.cwd(), "reports/vnu");
const VNU_INCLUDE_CSS = process.env.VNU_INCLUDE_CSS === "1";
const VNU_IGNORE_ASTRO_STYLE_IS_GLOBAL =
  process.env.VNU_IGNORE_ASTRO_STYLE_IS_GLOBAL !== "0";

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "--base" || arg === "-b") && argv[i + 1]) {
      opts.base = argv[i + 1];
      i += 1;
      continue;
    }
    if ((arg === "--report-dir" || arg === "-o") && argv[i + 1]) {
      opts.reportDir = argv[i + 1];
      i += 1;
      continue;
    }
    if ((arg === "--urls-file" || arg === "-u") && argv[i + 1]) {
      opts.urlsFile = argv[i + 1];
      i += 1;
      continue;
    }
    if ((arg === "--source-dir" || arg === "-s") && argv[i + 1]) {
      opts.sourceDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--quiet") {
      opts.quiet = true;
    }
  }
  return opts;
}

function resolveCommandForSpawn(cmd) {
  if (process.platform !== "win32") return cmd;
  const name = String(cmd || "").toLowerCase();
  if (name === "npm" || name === "npx") {
    return `${cmd}.cmd`;
  }
  return cmd;
}

function ensureCleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function loadUrlsFromFile(file, baseUrl) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((u) => {
        try {
          return new URL(u, baseUrl).toString();
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function runCommand(cmd, cmdArgs, { quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(resolveCommandForSpawn(cmd), cmdArgs, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (!quiet) process.stderr.write(chunk);
    });

    child.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function parseVnuJson(output) {
  const text = String(output || "").trim();
  if (!text) return { version: null, messages: [] };
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return { version: null, messages: [] };
      }
    }
    return { version: null, messages: [] };
  }
}

function normalizeSeverity(message) {
  if (message?.type === "error") return "error";
  if (message?.subType === "warning") return "warning";
  return "info";
}

function messageText(message) {
  return String(message?.message || "").trim();
}

function isCssValidatorMessage(message) {
  const text = messageText(message);
  return /^css\s*:/i.test(text);
}

function isAstroStyleIsGlobalMessage(message) {
  const text = messageText(message);
  return /attribute\s*["“]is:global["”]\s*not\s*allowed\s*on\s*element\s*["“]style["”]\s*at\s*this\s*point\.?/i.test(
    text,
  );
}

function shouldIgnoreMessage(message) {
  if (!VNU_INCLUDE_CSS && isCssValidatorMessage(message)) return true;
  if (
    VNU_IGNORE_ASTRO_STYLE_IS_GLOBAL &&
    isAstroStyleIsGlobalMessage(message)
  ) {
    return true;
  }
  return false;
}

function uniqueCount(items) {
  return new Set(items.filter(Boolean)).size;
}

function collectHtmlFiles(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  const out = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const fullPath = path.join(current, name);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!name.endsWith(".html")) continue;
      out.push(fullPath);
    }
  };
  walk(dirPath);
  return out;
}

function mapUrlToBuildFile(url, { baseUrl, sourceDir }) {
  try {
    const root = new URL(baseUrl);
    const target = new URL(url, root);
    if (target.origin !== root.origin) return null;
    let pathname = decodeURIComponent(target.pathname || "/");
    if (!pathname.startsWith("/")) pathname = `/${pathname}`;
    const relativePath =
      pathname === "/"
        ? "index.html"
        : path.join(pathname.replace(/^\/+/, ""), "index.html");
    const filePath = path.join(sourceDir, relativePath);
    return fs.existsSync(filePath) ? filePath : null;
  } catch {
    return null;
  }
}

function toReportUrl(rawUrl, { baseUrl, sourceDir }) {
  const value = String(rawUrl || "");
  if (!value.startsWith("file:")) return value || null;
  if (!sourceDir) return value;
  try {
    const filePath = decodeURIComponent(new URL(value).pathname);
    const relativePath = path.relative(sourceDir, filePath);
    if (relativePath.startsWith("..")) return value;
    const root = `${baseUrl.replace(/\/+$/, "")}/`;
    if (relativePath.endsWith("/index.html")) {
      return new URL(
        relativePath.slice(0, -"index.html".length),
        root,
      ).toString();
    }
    if (relativePath.endsWith(".html")) {
      return new URL(relativePath.slice(0, -".html".length), root).toString();
    }
    return new URL(relativePath, root).toString();
  } catch {
    return value;
  }
}

function buildReportHtml({ stats, issues, baseUrl }) {
  const rows = issues
    .slice(0, 400)
    .map(
      (issue) => `<tr>
  <td>${issue.severity}</td>
  <td>${issue.url || "-"}</td>
  <td>${issue.line ?? "-"}</td>
  <td>${issue.column ?? "-"}</td>
  <td>${issue.message}</td>
</tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nu HTML Checker report</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.45;margin:24px;background:#0b1220;color:#e6edf6}
    a{color:#93c5fd}
    .card{border:1px solid #2a3858;border-radius:10px;padding:16px;margin:0 0 16px;background:#111a2d}
    table{width:100%;border-collapse:collapse}
    th,td{border-bottom:1px solid #263556;padding:8px;vertical-align:top;text-align:left}
    .pill{display:inline-block;border-radius:999px;padding:3px 10px;border:1px solid #37517e;margin-right:8px}
  </style>
</head>
<body>
  <h1>Nu HTML Checker (vnu)</h1>
  <p>Target: ${baseUrl}</p>
  <section class="card">
    <p><span class="pill">URLs tested: ${stats.urlsTested}</span><span class="pill">Pages with issues: ${stats.pagesWithIssues}</span><span class="pill">Errors: ${stats.errorCount}</span><span class="pill">Warnings: ${stats.warningCount}</span></p>
  </section>
  <section class="card">
    <h2>Issues</h2>
    <table>
      <thead><tr><th>Severity</th><th>URL</th><th>Line</th><th>Column</th><th>Message</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No issues</td></tr>'}</tbody>
    </table>
  </section>
</body>
</html>`;
}

function buildSummaryMarkdown({ stats }) {
  const lines = [
    "# Nu HTML Checker report",
    "",
    `- URLs tested: ${stats.urlsTested}`,
    `- Pages with issues: ${stats.pagesWithIssues}`,
    `- Errors: ${stats.errorCount}`,
    `- Warnings: ${stats.warningCount}`,
    `- Info: ${stats.infoCount}`,
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = preferIpv4Loopback(args.base || DEFAULT_BASE_URL);
  const reportDir = args.reportDir || DEFAULT_REPORT_DIR;
  const quiet = Boolean(args.quiet);
  const sourceDir = args.sourceDir ? path.resolve(args.sourceDir) : null;
  const urls = args.urlsFile
    ? loadUrlsFromFile(args.urlsFile, baseUrl)
    : [baseUrl];
  const htmlFiles = sourceDir ? collectHtmlFiles(sourceDir) : [];
  const selectedHtmlFiles =
    sourceDir && urls.length
      ? urls
          .map((url) => mapUrlToBuildFile(url, { baseUrl, sourceDir }))
          .filter(Boolean)
      : [];

  if (!urls.length && !htmlFiles.length && !selectedHtmlFiles.length) {
    console.error("No URLs or source files provided for Nu HTML Checker.");
    process.exit(1);
  }

  ensureCleanDir(reportDir);

  const targets = sourceDir
    ? selectedHtmlFiles.length
      ? selectedHtmlFiles
      : htmlFiles
    : urls;
  const cmdArgs = [
    "--yes",
    "vnu-jar",
    "--format",
    "json",
    "--stdout",
    "--exit-zero-always",
    ...(sourceDir ? ["--skip-non-html"] : []),
    ...targets,
  ];
  const run = await runCommand("npx", cmdArgs, { quiet });
  const payload = parseVnuJson(run.stdout || run.stderr);
  const allMessages = Array.isArray(payload?.messages) ? payload.messages : [];
  const messages = allMessages.filter(
    (message) => !shouldIgnoreMessage(message),
  );
  const issues = messages.map((message) => ({
    severity: normalizeSeverity(message),
    type: message?.type || null,
    subType: message?.subType || null,
    url: toReportUrl(message?.url || null, { baseUrl, sourceDir }),
    line: Number.isFinite(message?.lastLine) ? Number(message.lastLine) : null,
    column: Number.isFinite(message?.lastColumn)
      ? Number(message.lastColumn)
      : null,
    message: String(message?.message || "").trim(),
  }));

  const errorCount = issues.filter(
    (issue) => issue.severity === "error",
  ).length;
  const warningCount = issues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const infoCount = issues.filter((issue) => issue.severity === "info").length;
  const pagesWithIssues = uniqueCount(
    issues
      .filter(
        (issue) => issue.severity === "error" || issue.severity === "warning",
      )
      .map((issue) => issue.url),
  );

  const stats = {
    urlsTested: sourceDir ? targets.length : urls.length,
    pagesWithIssues,
    messagesIgnored: allMessages.length - messages.length,
    messagesTotal: issues.length,
    errorCount,
    warningCount,
    infoCount,
    version: payload?.version || null,
  };

  fs.writeFileSync(
    path.join(reportDir, "stats.json"),
    `${JSON.stringify(stats, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(reportDir, "issues.json"),
    `${JSON.stringify(issues, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(reportDir, "SUMMARY.md"),
    buildSummaryMarkdown({ stats }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(reportDir, "report.html"),
    buildReportHtml({ stats, issues, baseUrl }),
    "utf8",
  );

  console.log(`Nu HTML Checker errors: ${errorCount}`);
  if (warningCount) {
    console.log(`Nu HTML Checker warnings: ${warningCount}`);
  }

  if (run.code !== 0 || errorCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    `Unexpected error in vnu-html-check: ${error?.message || String(error)}`,
  );
  process.exit(1);
});
