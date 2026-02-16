#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DEFAULT_BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const DEFAULT_REPORT_DIR =
  process.env.LHCI_REPORT_DIR || path.join(process.cwd(), "reports/lighthouse");

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.base ?? DEFAULT_BASE_URL;
const REPORT_DIR = args.reportDir ?? DEFAULT_REPORT_DIR;
const URLS_FILE = args.urlsFile;
const CONFIG_PATH = args.configPath || path.join(process.cwd(), "lighthouserc.cjs");
const QUIET_MODE = Boolean(args.quiet || process.env.LHCI_LOG_LEVEL === "silent");

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "--base" || arg === "-b") && argv[i + 1]) {
      opts.base = argv[i + 1];
      i += 1;
    } else if ((arg === "--report-dir" || arg === "-o") && argv[i + 1]) {
      opts.reportDir = argv[i + 1];
      i += 1;
    } else if ((arg === "--urls-file" || arg === "-u") && argv[i + 1]) {
      opts.urlsFile = argv[i + 1];
      i += 1;
    } else if ((arg === "--config" || arg === "-c") && argv[i + 1]) {
      opts.configPath = argv[i + 1];
      i += 1;
    } else if (arg === "--quiet") {
      opts.quiet = true;
    }
  }
  return opts;
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

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureCleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function runCommand(cmd, cmdArgs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      shell: true,
      stdio: QUIET_MODE ? ["ignore", "pipe", "pipe"] : "inherit",
      env: process.env
    });

    let out = "";
    if (QUIET_MODE) {
      child.stdout.on("data", (chunk) => {
        out += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        out += chunk.toString();
      });
    }

    child.on("exit", (code) => {
      resolve({ code: code ?? 1, output: out });
    });
  });
}

function loadAssertionThresholds(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return {};

  let config;
  try {
    config = require(configPath);
  } catch {
    return {};
  }

  const assertions = config?.ci?.assert?.assertions || {};
  const thresholds = {};
  for (const [key, value] of Object.entries(assertions)) {
    if (!key.startsWith("categories:")) continue;
    const category = key.split(":")[1];
    if (!category) continue;

    let level = "error";
    let options = {};
    if (Array.isArray(value)) {
      level = String(value[0] || "error").toLowerCase();
      options = value[1] || {};
    } else if (typeof value === "string") {
      level = value.toLowerCase();
    }

    if (level === "off") continue;
    if (!Number.isFinite(options?.minScore)) continue;

    thresholds[category] = Number(options.minScore);
  }
  return thresholds;
}

function loadJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function evaluateAssertions(jsonFiles, thresholds) {
  let assertionFailures = 0;
  const failures = [];

  for (const file of jsonFiles) {
    const report = loadJsonIfExists(file);
    if (!report?.categories) continue;
    const url =
      report.finalDisplayedUrl ||
      report.finalUrl ||
      report.requestedUrl ||
      file;

    for (const [category, minScore] of Object.entries(thresholds)) {
      const score = report?.categories?.[category]?.score;
      if (typeof score !== "number") continue;
      if (score < minScore) {
        assertionFailures += 1;
        failures.push({
          url,
          category,
          score,
          minScore
        });
      }
    }
  }

  return { assertionFailures, failures };
}

async function main() {
  const urls = URLS_FILE
    ? loadUrlsFromFile(URLS_FILE, BASE_URL)
    : [BASE_URL];
  if (!urls.length) {
    console.error("No URLs provided for lighthouse.");
    process.exit(1);
  }

  ensureCleanDir(REPORT_DIR);

  const runFailures = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    const baseName = `${String(i + 1).padStart(3, "0")}-${slugify(new URL(url).pathname || "root")}`;
    const outBase = path.join(REPORT_DIR, baseName);
    if (!QUIET_MODE) {
      console.log(`Running Lighthouse ${i + 1}/${urls.length}: ${url}`);
    }

    const cmdArgs = [
      "lighthouse",
      url,
      "--output=json",
      "--output=html",
      `--output-path=${outBase}`,
      "--quiet",
      "--chrome-flags=\"--headless --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage\""
    ];

    const result = await runCommand("npx", cmdArgs);
    if (result.code !== 0) {
      runFailures.push({ url, code: result.code });
      if (QUIET_MODE && result.output.trim()) {
        const lines = result.output.trim().split("\n").slice(-8).join("\n");
        console.error(lines);
      }
    }
  }

  const jsonFiles = fs
    .readdirSync(REPORT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(REPORT_DIR, f));

  const thresholds = loadAssertionThresholds(CONFIG_PATH);
  const { assertionFailures, failures } = evaluateAssertions(jsonFiles, thresholds);

  const stats = {
    urlsTested: urls.length,
    reportsGenerated: jsonFiles.length,
    assertionFailures,
    runFailures: runFailures.length,
    failures,
    runFailureUrls: runFailures.map((entry) => entry.url)
  };
  fs.writeFileSync(
    path.join(REPORT_DIR, "stats.json"),
    JSON.stringify(stats, null, 2),
    "utf8",
  );

  console.log(`found: ${assertionFailures}`);
  if (runFailures.length) {
    console.error(`Lighthouse run failures: ${runFailures.length}`);
  }

  if (assertionFailures > 0 || runFailures.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Unexpected error in lighthouse-audit: ${error?.message || error}`);
  process.exit(1);
});

