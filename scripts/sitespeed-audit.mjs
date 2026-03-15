#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { preferIpv4Loopback } from "../src/quality/common/url.mjs";

const DEFAULT_BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const DEFAULT_REPORT_DIR =
  process.env.SITESPEED_REPORT_DIR ||
  path.join(process.cwd(), "reports/sitespeed");

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
    if (arg === "--quiet") {
      opts.quiet = true;
    }
  }
  return opts;
}

function resolveCommandForSpawn(cmd) {
  if (process.platform !== "win32") return cmd;
  const name = String(cmd || "").toLowerCase();
  if (name === "npm" || name === "npx") return `${cmd}.cmd`;
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

function runCommandCapture(cmd, cmdArgs, { quiet = false } = {}) {
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
    child.on("error", (error) => {
      resolve({
        code: 1,
        stdout,
        stderr,
        error: String(error?.message || error),
      });
    });
    child.on("exit", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        error: null,
      });
    });
  });
}

function countFilesByExtension(rootDir, ext) {
  if (!rootDir || !fs.existsSync(rootDir)) return 0;
  let count = 0;
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const fullPath = path.join(current, name);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (name.toLowerCase().endsWith(ext)) count += 1;
    }
  };
  walk(rootDir);
  return count;
}

function writeSummaryMarkdown({ baseUrl, stats }) {
  const lines = [
    "# Sitespeed.io report",
    "",
    `Target: ${baseUrl}`,
    "",
    `- URLs tested: ${stats.urlsTested}`,
    `- Run failures: ${stats.runFailures}`,
    `- HTML files generated: ${stats.reportsGenerated}`,
    stats.errorMessage ? `- Error: ${stats.errorMessage}` : "",
    "",
  ];
  fs.writeFileSync(
    path.join(path.resolve(stats.reportDir), "SUMMARY.md"),
    `${lines.filter(Boolean).join("\n")}\n`,
    "utf8",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = preferIpv4Loopback(args.base || DEFAULT_BASE_URL);
  const reportDir = path.resolve(args.reportDir || DEFAULT_REPORT_DIR);
  const quiet = Boolean(args.quiet);
  const urls = args.urlsFile
    ? loadUrlsFromFile(args.urlsFile, baseUrl)
    : [baseUrl];
  if (!urls.length) {
    console.error("No URLs provided for Sitespeed.io.");
    process.exit(1);
  }

  ensureCleanDir(reportDir);
  const cmdArgs = [
    "--yes",
    "sitespeed.io",
    ...urls,
    "--outputFolder",
    reportDir,
    "--browsertime.headless",
    "true",
  ];
  const run = await runCommandCapture("npx", cmdArgs, { quiet });

  const stats = {
    urlsTested: urls.length,
    runFailures: run.code === 0 ? 0 : 1,
    reportsGenerated: countFilesByExtension(reportDir, ".html"),
    reportDir,
    errorMessage:
      run.error ||
      (run.code !== 0
        ? String(run.stderr || run.stdout || "sitespeed failed")
            .trim()
            .slice(0, 500)
        : null),
  };

  fs.writeFileSync(
    path.join(reportDir, "stats.json"),
    `${JSON.stringify(stats, null, 2)}\n`,
    "utf8",
  );
  writeSummaryMarkdown({ baseUrl, stats });

  if (run.code !== 0) {
    console.error("Sitespeed.io reported failures.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    `Unexpected error in sitespeed-audit: ${error?.message || String(error)}`,
  );
  process.exit(1);
});
