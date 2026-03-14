#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import inquirer from "inquirer";
import waitOn from "wait-on";
import { parse } from "node-html-parser";
import { writeRunSnapshot } from "../src/quality/store/index.mjs";
import {
  applyQualityConfigToSelection,
  loadQualityConfig,
} from "../src/quality/core/config.mjs";
import {
  resolveCheckExecutionPlan,
  runPlannedQualityChecks,
} from "../src/quality/core/orchestrator.mjs";
import {
  assignDatasetRunId,
  buildCanonicalDataset,
  selectedCheckIds,
} from "../src/quality/core/dataset.mjs";
import { registerDefaultQualityChecks } from "../src/quality/checks/index.mjs";
import {
  normalizeUrl,
  preferIpv4Loopback,
} from "../src/quality/common/url.mjs";
import { collectLighthouseFromReportDir } from "../src/quality/checks/lighthouse/collect.mjs";
import { normalizeLighthousePayload } from "../src/quality/checks/lighthouse/normalize.mjs";
import { summarizeLighthousePayload } from "../src/quality/checks/lighthouse/summarize.mjs";
import { collectPa11yFromReportDir } from "../src/quality/checks/pa11y/collect.mjs";
import { normalizePa11yPayload } from "../src/quality/checks/pa11y/normalize.mjs";
import { summarizePa11yPayload } from "../src/quality/checks/pa11y/summarize.mjs";
import { collectSeoFromReportDir } from "../src/quality/checks/seo/collect.mjs";
import { normalizeSeoPayload } from "../src/quality/checks/seo/normalize.mjs";
import { summarizeSeoPayload } from "../src/quality/checks/seo/summarize.mjs";
import { collectLinksFromReportDir } from "../src/quality/checks/links/collect.mjs";
import { normalizeLinksPayload } from "../src/quality/checks/links/normalize.mjs";
import { summarizeLinksPayload } from "../src/quality/checks/links/summarize.mjs";
import { collectJsonldFromReportDir } from "../src/quality/checks/jsonld/collect.mjs";
import { normalizeJsonldPayload } from "../src/quality/checks/jsonld/normalize.mjs";
import { summarizeJsonldPayload } from "../src/quality/checks/jsonld/summarize.mjs";
import { collectSecurityFromReportDir } from "../src/quality/checks/security/collect.mjs";
import { normalizeSecurityPayload } from "../src/quality/checks/security/normalize.mjs";
import { summarizeSecurityPayload } from "../src/quality/checks/security/summarize.mjs";

function npmArgvIncludes(flag) {
  try {
    const parsed = JSON.parse(process.env.npm_config_argv || "{}");
    const original = Array.isArray(parsed?.original) ? parsed.original : [];
    return original.includes(flag);
  } catch {
    return false;
  }
}

function isTruthy(value) {
  return value === "1" || value === "true";
}

function isFalsey(value) {
  return value === "0" || value === "false";
}

const DEFAULT_BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const SITE_PORT = Number(process.env.SITE_PORT || 4321);
const REPORT_PORT = Number(process.env.REPORT_PORT || 5555);
const REPORT_ROOT = path.join(process.cwd(), "reports");
const toolkitScriptsDir = path.dirname(fileURLToPath(import.meta.url));
const toolkitScriptPath = (filename) => path.join(toolkitScriptsDir, filename);
const argv = process.argv.slice(2);
const cliOptions = parseCliArgs(argv);
const fullFlag = argv.includes("--full") || npmArgvIncludes("--full");
const noQuietFlag =
  argv.includes("--no-quiet") || npmArgvIncludes("--no-quiet");
const WANT_FULL_OUTPUT =
  fullFlag ||
  isTruthy(process.env.FULL_OUTPUT) ||
  isTruthy(process.env.npm_config_full);
const QUIET_MODE = WANT_FULL_OUTPUT
  ? false
  : !noQuietFlag && !isFalsey(process.env.QUIET);
const LOG_ROOT = path.join(REPORT_ROOT, "logs");
const LIGHTHOUSE_PROGRESS_PREFIX = "__YWS_LIGHTHOUSE_PROGRESS__";
const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];

const REPORT_THEME_CSS = `
  :root {
    --bg: #081225;
    --bg-elev: #0f1d37;
    --bg-elev-2: #132544;
    --text: #e6edf9;
    --muted: #9bb0d1;
    --line: #24395f;
    --accent: #78a9ff;
    --ok: #2dc98d;
    --warn: #f4c363;
    --fail: #ff7f7f;
    --info: #7ec8ff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: "Avenir Next", "Segoe UI", Arial, sans-serif;
    background: radial-gradient(circle at 15% 0%, #11244a 0, var(--bg) 42%);
    color: var(--text);
  }
  .report-page { padding: 24px; max-width: 1200px; margin: 0 auto; }
  .report-header h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.2; }
  .report-subtitle { margin: 0; color: var(--muted); font-size: 14px; }
  .report-nav { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
  .report-nav a {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg-elev-2) 75%, transparent);
    color: var(--accent);
    text-decoration: none;
    font-weight: 700;
    font-size: 13px;
  }
  .report-nav a:hover {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
    background: color-mix(in srgb, var(--accent) 16%, var(--bg-elev-2));
  }
  .report-section { margin-top: 20px; background: var(--bg-elev); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
  .report-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); margin-top: 18px; }
  .report-card { background: var(--bg-elev-2); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
  .report-card h2 { margin: 0 0 8px; font-size: 18px; }
  .report-card p { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
  .report-card a { color: var(--accent); font-weight: 600; text-decoration: none; }
  .report-card a:hover { text-decoration: underline; }
  .report-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .report-table th, .report-table td { border: 1px solid var(--line); padding: 8px; text-align: left; }
  .report-table th { background: #172b4e; }
  .status-chip {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .status-chip.pass { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, var(--line)); }
  .status-chip.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 35%, var(--line)); }
  .status-chip.fail { color: var(--fail); border-color: color-mix(in srgb, var(--fail) 35%, var(--line)); }
  .status-chip.info { color: var(--info); border-color: color-mix(in srgb, var(--info) 35%, var(--line)); }
  .report-note { margin-top: 14px; color: var(--ok); font-weight: 600; }
  .report-link-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-elev-2));
    color: var(--text);
    text-decoration: none;
    font-weight: 700;
    font-size: 12px;
  }
  .report-link-btn:hover {
    background: color-mix(in srgb, var(--accent) 22%, var(--bg-elev-2));
  }
`;

function statusChipHtml(label, tone = "info") {
  const allowed = new Set(["pass", "warn", "fail", "info"]);
  const safeTone = allowed.has(tone) ? tone : "info";
  return `<span class="status-chip ${safeTone}">${escapeHtml(label)}</span>`;
}

function renderReportNavLinks(links = []) {
  const items = Array.isArray(links)
    ? links
        .filter((link) => link && link.href)
        .map(
          (link) =>
            `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label || "Link")}</a>`,
        )
    : [];
  if (!items.length) return "";
  return `<div class="report-nav">${items.join("")}</div>`;
}

function renderReportShellStart({
  title,
  subtitle = "",
  backHref = "",
  navLinks = [],
}) {
  const nav =
    renderReportNavLinks(navLinks) ||
    (backHref
      ? renderReportNavLinks([
          { href: backHref, label: "← Back to Quality Reports" },
        ])
      : "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>${REPORT_THEME_CSS}</style>
</head>
<body>
  <main class="report-page">
    <header class="report-header">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="report-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      ${nav}
    </header>`;
}

function renderReportShellEnd() {
  return `
  </main>
</body>
</html>`;
}

function parseCliArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--target" || arg === "-t") && args[i + 1]) {
      options.target = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
      continue;
    }
    if ((arg === "--base" || arg === "-b") && args[i + 1]) {
      options.base = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
    }
  }
  return options;
}

function openInBrowser(url) {
  try {
    if (process.platform === "win32") {
      const child = spawn("cmd", ["/c", "start", '""', url], {
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      return true;
    }
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(opener, [url], { stdio: "ignore", detached: true });
    child.on("error", (err) => {
      console.error(`⚠️  Could not open browser: ${err.message}`);
    });
    child.unref();
    return true;
  } catch (err) {
    console.error(`⚠️  Could not open browser: ${err.message}`);
    return false;
  }
}

const TEST_CHOICES = [
  {
    name: "All (Lighthouse + Pa11y + SEO + Link check + JSON-LD + Security)",
    value: "all",
  },
  { name: "Lighthouse", value: "lighthouse" },
  { name: "Pa11y", value: "pa11y" },
  { name: "SEO audit", value: "seo" },
  { name: "Link check", value: "links" },
  { name: "JSON-LD validation", value: "jsonld" },
  { name: "Security audit", value: "security" },
];

const CHECK_KEYS = [
  "lighthouse",
  "pa11y",
  "seo",
  "links",
  "jsonld",
  "security",
];
const CHECK_NAME_BY_ID = {
  lighthouse: "Lighthouse",
  pa11y: "Pa11y",
  seo: "SEO audit",
  links: "Link check",
  jsonld: "JSON-LD validation",
  security: "Security audit",
};

const REPORT_MODULES = [
  {
    key: "lighthouse",
    name: "Lighthouse",
    path: "lighthouse/summary.html",
    fallback: "lighthouse",
    highlight: "Summary + per-page reports",
  },
  {
    key: "pa11y",
    name: "Pa11y",
    path: "pa11y/report.html",
    fallback: "pa11y",
    highlight: "report.html + stats.json",
  },
  {
    key: "seo",
    name: "SEO",
    path: "seo/report.html",
    fallback: "seo",
    highlight: "report.html + issues.json",
  },
  {
    key: "links",
    name: "Link check",
    path: "links/report.html",
    fallback: "links",
    highlight: "report.html + links.json",
  },
  {
    key: "jsonld",
    name: "JSON-LD",
    path: "jsonld/report.html",
    fallback: "jsonld",
    highlight: "report.html + stats.json",
  },
  {
    key: "security",
    name: "Security",
    path: "security/report.html",
    fallback: "security",
    highlight: "report.html + stats.json",
  },
];

const REPORT_NAV_MODEL = [
  { key: "site-home", label: "Home", href: "/" },
  ...REPORT_MODULES.map((module) => ({
    key: module.key,
    label: module.name,
    path: module.path,
    fallback: module.fallback,
  })),
];

function buildCrossNavLinks(currentReportPath, options = {}) {
  const currentFile = String(currentReportPath || "index.html").replace(
    /\\/g,
    "/",
  );
  const currentDir = path.posix.dirname(currentFile);
  const excludeKeys = new Set(options.excludeKeys || []);
  return REPORT_NAV_MODEL.filter((item) => !excludeKeys.has(item.key))
    .map((item) => {
      if (item.href) {
        return {
          ...item,
          href: item.href,
        };
      }
      const target = String(item.path || "").replace(/\\/g, "/");
      if (!target) return null;
      const rel = path.posix.relative(currentDir, target);
      return {
        ...item,
        href: rel || "./",
      };
    })
    .filter(Boolean);
}

function choiceToFlags(choice) {
  if (choice === "all") {
    return {
      label: "All checks",
      lighthouse: true,
      pa11y: true,
      seo: true,
      links: true,
      jsonld: true,
      security: true,
    };
  }
  const name = TEST_CHOICES.find((c) => c.value === choice)?.name || choice;
  return {
    label: name,
    lighthouse: choice === "lighthouse",
    pa11y: choice === "pa11y",
    seo: choice === "seo",
    links: choice === "links",
    jsonld: choice === "jsonld",
    security: choice === "security",
  };
}

function checkDisplayName(checkId) {
  return CHECK_NAME_BY_ID[checkId] || checkId;
}

function buildCheckAvailability(selectedTarget) {
  const isRemoteTarget = !selectedTarget?.usesLocalBuild;
  return {
    lighthouse: { enabled: true },
    pa11y: { enabled: true },
    seo: { enabled: true },
    links: { enabled: true },
    jsonld: isRemoteTarget
      ? {
          enabled: false,
          reason: "Not available on staging/production (local build only)",
        }
      : { enabled: true },
    security: isRemoteTarget
      ? { enabled: true }
      : {
          enabled: false,
          reason: "Not available on development (requires remote server)",
        },
  };
}

function applyAvailabilityToFlags(flags, availability) {
  const next = { ...flags };
  for (const key of CHECK_KEYS) {
    if (availability?.[key]?.enabled === false) {
      next[key] = false;
    }
  }
  return next;
}

async function promptForChecks(selectedTarget) {
  const availability = buildCheckAvailability(selectedTarget);
  const choices = TEST_CHOICES.map((choice) => {
    if (choice.value === "all") return choice;
    const rule = availability?.[choice.value];
    if (rule?.enabled === false) {
      return { ...choice, disabled: rule.reason || "Not available" };
    }
    return choice;
  });

  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: "Which test do you want to perform?",
      choices,
      default: "all",
    },
  ]);
  const selected = applyAvailabilityToFlags(
    choiceToFlags(choice),
    availability,
  );
  if (choice === "all") {
    selected.label = "All available checks";
  }
  return selected;
}

function unquoteEnvValue(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const cleanValue = unquoteEnvValue(rawValue.split(/\s+#/)[0]);
    values[key] = cleanValue;
  }
  return values;
}

function loadProjectEnvValues() {
  const fromDotEnv = parseDotEnvFile(path.join(process.cwd(), ".env"));
  const fromDotEnvLocal = parseDotEnvFile(
    path.join(process.cwd(), ".env.local"),
  );
  return { ...fromDotEnv, ...fromDotEnvLocal };
}

function normalizeBaseUrlInput(input) {
  try {
    return normalizeUrl(new URL(String(input || "").trim()).toString());
  } catch {
    return null;
  }
}

function getConfiguredTargetUrl(key, envValues) {
  const envKey = key === "production" ? "SITE_URL" : "STAGING_URL";
  const raw = process.env[envKey] || envValues[envKey] || "";
  return normalizeBaseUrlInput(raw);
}

function getTargetChoices(envValues) {
  const developmentUrl = normalizeBaseUrlInput(DEFAULT_BASE_URL);
  const productionUrl = getConfiguredTargetUrl("production", envValues);
  const stagingUrl = getConfiguredTargetUrl("staging", envValues);

  return [
    {
      key: "development",
      name: developmentUrl
        ? `Development (${developmentUrl})`
        : `Development (invalid BASE_URL: ${DEFAULT_BASE_URL})`,
      baseUrl: developmentUrl,
      source: "BASE_URL",
      usesLocalBuild: true,
      disabled: !developmentUrl,
    },
    {
      key: "staging",
      name: stagingUrl
        ? `Staging (${stagingUrl})`
        : "Staging (missing STAGING_URL in .env or env vars)",
      baseUrl: stagingUrl,
      source: "STAGING_URL",
      usesLocalBuild: false,
      disabled: !stagingUrl,
    },
    {
      key: "production",
      name: productionUrl
        ? `Production (${productionUrl})`
        : "Production (missing SITE_URL in .env or env vars)",
      baseUrl: productionUrl,
      source: "SITE_URL",
      usesLocalBuild: false,
      disabled: !productionUrl,
    },
  ];
}

async function promptForTarget(envValues) {
  if (cliOptions.base) {
    const explicit = normalizeBaseUrlInput(cliOptions.base);
    if (!explicit) {
      throw new Error(`Invalid --base URL: ${cliOptions.base}`);
    }
    return {
      key: "custom",
      name: `Custom (${explicit})`,
      baseUrl: explicit,
      source: "--base",
      usesLocalBuild: false,
    };
  }

  const targets = getTargetChoices(envValues);
  const byKey = new Map(targets.map((target) => [target.key, target]));
  if (cliOptions.target) {
    const requested = String(cliOptions.target).toLowerCase();
    const selected = byKey.get(requested);
    if (!selected) {
      throw new Error(
        `Unsupported --target value "${cliOptions.target}". Use development, production, or staging.`,
      );
    }
    if (selected.disabled) {
      throw new Error(
        `Cannot use --target ${cliOptions.target}: ${selected.source} is not configured.`,
      );
    }
    return selected;
  }

  const { targetKey } = await inquirer.prompt([
    {
      type: "list",
      name: "targetKey",
      message: "Which environment should the tests run against?",
      choices: targets.map((target) => ({
        name: target.name,
        value: target.key,
        disabled: target.disabled ? "Not configured" : false,
      })),
      default: "development",
    },
  ]);

  return byKey.get(targetKey);
}

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function summarizePa11y(reportDir) {
  const raw = collectPa11yFromReportDir(reportDir);
  const normalized = normalizePa11yPayload(raw, { selected: true });
  const errors = Number(normalized?.stats?.errorCount || 0);
  const warnings = Number(normalized?.stats?.warningCount || 0);
  return { errors, warnings };
}

function summarizeSeo(reportDir) {
  const raw = collectSeoFromReportDir(reportDir);
  const normalized = normalizeSeoPayload(raw, { selected: true });
  const errors = Number(normalized?.stats?.errorCount || 0);
  const warnings = Number(normalized?.stats?.warningCount || 0);
  return { errors, warnings };
}

function summarizeLinks(reportDir) {
  const raw = collectLinksFromReportDir(reportDir);
  const normalized = normalizeLinksPayload(raw, { selected: true });
  const broken = Number(normalized?.stats?.broken || 0);
  const skipped = Number(normalized?.stats?.skippedExternal || 0);
  return { broken, skipped };
}

function summarizeSecurity(reportDir) {
  const raw = collectSecurityFromReportDir(reportDir);
  const normalized = normalizeSecurityPayload(raw, { selected: true });
  return {
    failed: Boolean(normalized?.failed),
    findingsTotal: Number(normalized?.stats?.findingsTotal || 0),
    tools: normalized?.stats?.tools || {},
  };
}

function summarizeJsonld(reportDir) {
  const raw = collectJsonldFromReportDir(reportDir);
  const normalized = normalizeJsonldPayload(raw, { selected: true });
  const stats = normalized?.stats;
  if (!stats) return null;
  return {
    pagesTested: Number(stats.pagesTested || 0),
    errors: Number(stats.errorCount || 0),
    warnings: Number(stats.warningCount || 0),
  };
}

function collectRawSources() {
  const sources = [];
  const direct = [
    { checkId: "suite", path: path.join(REPORT_ROOT, "urls.json"), name: "urls.json" },
    { checkId: "suite", path: path.join(REPORT_ROOT, "logs"), name: "logs" },
    { checkId: "lighthouse", path: path.join(REPORT_ROOT, "lighthouse"), name: "lighthouse" },
    { checkId: "pa11y", path: path.join(REPORT_ROOT, "pa11y"), name: "pa11y" },
    { checkId: "seo", path: path.join(REPORT_ROOT, "seo"), name: "seo" },
    { checkId: "links", path: path.join(REPORT_ROOT, "links"), name: "links" },
    { checkId: "jsonld", path: path.join(REPORT_ROOT, "jsonld"), name: "jsonld" },
    { checkId: "security", path: path.join(REPORT_ROOT, "security"), name: "security" },
  ];
  for (const entry of direct) {
    if (fs.existsSync(entry.path)) {
      sources.push(entry);
    }
  }
  return sources;
}

function collectHtmlViewSources() {
  const entries = [
    { path: path.join(REPORT_ROOT, "index.html"), name: "index.html" },
    {
      path: path.join(REPORT_ROOT, "lighthouse", "summary.html"),
      name: "lighthouse/summary.html",
    },
    { path: path.join(REPORT_ROOT, "pa11y", "report.html"), name: "pa11y/report.html" },
    { path: path.join(REPORT_ROOT, "seo", "report.html"), name: "seo/report.html" },
    { path: path.join(REPORT_ROOT, "links", "report.html"), name: "links/report.html" },
    { path: path.join(REPORT_ROOT, "jsonld", "report.html"), name: "jsonld/report.html" },
    {
      path: path.join(REPORT_ROOT, "security", "report.html"),
      name: "security/report.html",
    },
  ];
  return entries.filter((entry) => fs.existsSync(entry.path));
}

function slugify(value) {
  return (value ?? "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseLighthouseProgressLine(line) {
  if (!String(line || "").startsWith(LIGHTHOUSE_PROGRESS_PREFIX)) return null;
  try {
    return JSON.parse(line.slice(LIGHTHOUSE_PROGRESS_PREFIX.length));
  } catch {
    return null;
  }
}

function createProgressRenderer(label) {
  const isInteractive = Boolean(process.stdout.isTTY);
  let lastMessage = "";
  let spinnerIndex = 0;
  let timer = null;
  let rendered = false;

  const render = () => {
    if (!lastMessage) return;
    if (!isInteractive) {
      console.log(label ? `${label} ${lastMessage}` : lastMessage);
      return;
    }
    const frame = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length];
    const prefix = label ? `${frame} ${label} ` : `${frame}  `;
    process.stdout.write(`\r\x1b[2K${prefix}${lastMessage}`);
    rendered = true;
  };

  return {
    update(message) {
      lastMessage = message;
      if (!isInteractive) {
        render();
        return;
      }
      render();
      if (!timer) {
        timer = setInterval(() => {
          spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
          render();
        }, 180);
        if (typeof timer.unref === "function") {
          timer.unref();
        }
      }
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (isInteractive && rendered) {
        process.stdout.write("\r\x1b[2K");
      }
      lastMessage = "";
      spinnerIndex = 0;
      rendered = false;
    },
  };
}

function formatLighthouseProgressMessage(event) {
  const total = Number(event?.total || 0);
  const current = Number(event?.current || 0);
  const width = total > 0 ? String(total).length : 1;
  const currentLabel = String(current).padStart(width, " ");
  const totalLabel = total > 0 ? String(total) : "?";
  const url = String(event?.url || "").trim();
  return `[ ${currentLabel} / ${totalLabel} ]${url ? ` ${url}` : ""}`;
}

function resolveCommandForSpawn(cmd) {
  if (process.platform !== "win32") return cmd;
  const name = String(cmd || "").toLowerCase();
  if (name === "npm" || name === "npx") {
    return `${cmd}.cmd`;
  }
  return cmd;
}

async function runCommand(cmd, args, options = {}) {
  const {
    label = cmd,
    logName,
    quiet = QUIET_MODE,
    forceLog = false,
    allowFailure = false,
    env: customEnv,
    onLine,
    ...spawnOverrides
  } = options;
  const commandLabel = label || cmd;
  const resolvedCmd = resolveCommandForSpawn(cmd);
  const spawnOptions = {
    shell: false,
    ...spawnOverrides,
    env: { ...process.env, ...customEnv },
  };

  const shouldLogToFile = quiet || forceLog || Boolean(onLine);
  const logFile =
    logName && shouldLogToFile
      ? path.join(
          LOG_ROOT,
          `${logName || slugify(commandLabel) || "command"}.log`,
        )
      : null;
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
  }

  if (!shouldLogToFile && !onLine) {
    spawnOptions.stdio = "inherit";
    return new Promise((resolve, reject) => {
      const child = spawn(resolvedCmd, args, spawnOptions);
      child.on("exit", (code) => {
        if (code === 0 || allowFailure)
          return resolve({ logPath: null, exitCode: code });
        reject(new Error(`${commandLabel} exited with code ${code}`));
      });
    });
  }

  const tailLimit = 4000;
  let tail = "";
  const appendTail = (chunk) => {
    tail += chunk.toString();
    if (tail.length > tailLimit) {
      tail = tail.slice(-tailLimit);
    }
  };

  spawnOptions.stdio = ["ignore", "pipe", "pipe"];

  let stdoutBuffer = "";
  let stderrBuffer = "";
  const flushBuffer = (buffer, type) => {
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (onLine) {
        onLine({ type, line });
      }
    }
    return buffer;
  };

  return new Promise((resolve, reject) => {
    const outStream = logFile ? fs.createWriteStream(logFile) : null;
    const child = spawn(resolvedCmd, args, spawnOptions);

    const handleChunk = (chunk, type) => {
      if (outStream) outStream.write(chunk);
      appendTail(chunk);
      if (!quiet) {
        process[type === "stderr" ? "stderr" : "stdout"].write(chunk);
      }
      if (onLine) {
        if (type === "stderr") {
          stderrBuffer += chunk.toString();
          stderrBuffer = flushBuffer(stderrBuffer, "stderr");
        } else {
          stdoutBuffer += chunk.toString();
          stdoutBuffer = flushBuffer(stdoutBuffer, "stdout");
        }
      }
    };

    child.stdout.on("data", (chunk) => handleChunk(chunk, "stdout"));
    child.stderr.on("data", (chunk) => handleChunk(chunk, "stderr"));

    child.on("exit", (code) => {
      if (outStream) outStream.end();
      if (stdoutBuffer && onLine) flushBuffer(`${stdoutBuffer}\n`, "stdout");
      if (stderrBuffer && onLine) flushBuffer(`${stderrBuffer}\n`, "stderr");
      if (code === 0 || allowFailure)
        return resolve({ logPath: logFile, exitCode: code, tail });
      const err = new Error(`${commandLabel} exited with code ${code}`);
      err.logPath = logFile;
      err.tail = tail;
      reject(err);
    });
  });
}

function startStaticServer(
  dir,
  port,
  label,
  { quiet = QUIET_MODE, logName } = {},
) {
  const serveArgs = [
    "serve",
    "-l",
    `tcp://127.0.0.1:${port}`,
    "--no-port-switching",
    dir,
  ];
  const spawnOpts = { shell: false };
  let logStream;
  let logFile = null;

  if (quiet) {
    logFile = path.join(
      LOG_ROOT,
      `${logName || `${slugify(label)}-server`}.log`,
    );
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    logStream = fs.createWriteStream(logFile);
    spawnOpts.stdio = ["ignore", "pipe", "pipe"];
    spawnOpts.env = { ...process.env, SERVE_SILENT: "true" };
  } else {
    spawnOpts.stdio = "inherit";
  }

  const child = spawn(resolveCommandForSpawn("npx"), serveArgs, spawnOpts);
  child.logFile = logFile;
  if (logStream) {
    child.stdout.on("data", (chunk) => logStream.write(chunk));
    child.stderr.on("data", (chunk) => logStream.write(chunk));
    child.on("exit", () => logStream.end());
  }

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`⚠️  ${label} server exited with code ${code}`);
    }
  });
  return child;
}

function waitForServerExit(child) {
  return new Promise((resolve) => {
    child.on("exit", () => resolve());
    process.on("SIGINT", () => {
      if (!child.killed) {
        child.kill("SIGINT");
      }
      resolve();
    });
  });
}

async function waitForServer(url) {
  await waitOn({ resources: [url], timeout: 30000 });
}

function ensureCleanReports() {
  const legacy = [".lighthouseci", "lhci-report", "pa11y-report", "seo-report"];
  for (const dir of legacy) {
    const full = path.join(process.cwd(), dir);
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(REPORT_ROOT, { recursive: true });
  for (const target of [
    "index.html",
    "urls.json",
    "logs",
    "lighthouse",
    "pa11y",
    "seo",
    "links",
    "jsonld",
    "security",
  ]) {
    const full = path.join(REPORT_ROOT, target);
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
}

function fileExistsForPath(pathname) {
  const clean = pathname.replace(/^\/+/, "").replace(/\/$/, "");
  const dirPath = path.join(process.cwd(), "build", clean);
  const indexPath = path.join(dirPath, "index.html");
  const directHtml = path.join(process.cwd(), "build", `${clean}.html`);
  return fs.existsSync(indexPath) || fs.existsSync(directHtml);
}

function slugifyLocation(value) {
  return slugify(value);
}

function loadLocationSlugs() {
  const file = path.join(
    process.cwd(),
    "public/cms-content/seo/location-specific-content.json",
  );
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const names = Array.isArray(raw?.locations)
      ? raw.locations.map((entry) => entry?.name).filter(Boolean)
      : [];
    return names.map(slugifyLocation).filter(Boolean);
  } catch {
    return [];
  }
}

function filterLocationPages(urls) {
  const locationSlugs = loadLocationSlugs();
  if (!locationSlugs.length) return urls;

  const keep = new Set();
  const firstPerLocale = new Map();

  for (const url of urls) {
    let pathname;
    try {
      pathname = new URL(url).pathname;
    } catch {
      keep.add(url);
      continue;
    }

    const match = pathname.match(/^\/(en|fr)\/([^/]+)\/?$/);
    if (!match) {
      keep.add(url);
      continue;
    }

    const locale = match[1];
    const slug = match[2];
    const isLocation = locationSlugs.includes(slug);

    if (!isLocation) {
      keep.add(url);
      continue;
    }

    if (!firstPerLocale.has(locale)) {
      firstPerLocale.set(locale, url);
      keep.add(url);
    }
  }

  const filtered = urls.filter((u) => keep.has(u));
  const dropped = urls.length - filtered.length;
  if (dropped > 0) {
    console.log(
      `ℹ️  Collapsed location pages: kept 1 per locale, dropped ${dropped} duplicates.`,
    );
  }
  return filtered;
}

function getUrlsFromSitemap(baseUrl) {
  const sitemapPath = path.join(process.cwd(), "build", "sitemap-0.xml");
  if (!fs.existsSync(sitemapPath)) {
    console.warn(
      "⚠️  No sitemap found at build/sitemap.xml; falling back to crawl.",
    );
    return [];
  }

  const xml = fs.readFileSync(sitemapPath, "utf8");
  const urls = new Set();
  const matches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
  for (const match of matches) {
    const loc = (match[1] || "").replaceAll("&amp;", "&").trim();
    if (!loc) continue;
    let pathname;
    try {
      pathname = new URL(loc).pathname;
    } catch {
      continue;
    }
    if (!fileExistsForPath(pathname)) continue;
    const target = new URL(pathname, baseUrl).toString();
    urls.add(normalizeUrl(target));
  }

  return Array.from(urls).sort();
}

function extractLocValuesFromXml(xml) {
  const values = [];
  const matches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
  for (const match of matches) {
    const loc = (match[1] || "").replaceAll("&amp;", "&").trim();
    if (loc) values.push(loc);
  }
  return values;
}

function isSameOrigin(candidate, baseUrl) {
  try {
    const a = new URL(candidate);
    const b = new URL(baseUrl);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

async function fetchText(url) {
  const res = await fetch(url);
  const contentType = res.headers.get("content-type") || "";
  const body = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    contentType,
    body,
  };
}

function isLikelyBotChallengeResponse(fetchResult) {
  const status = Number(fetchResult?.status || 0);
  const body = String(fetchResult?.body || "").toLowerCase();
  if ([401, 403, 406, 415, 429, 503].includes(status)) return true;
  return (
    body.includes("one moment, please") ||
    body.includes("cf-challenge") ||
    body.includes("cloudflare")
  );
}

function reportSitemapFetchFailure(sitemapUrl, fetchResult, diagnostics) {
  const key = `${sitemapUrl}|${fetchResult?.status || "error"}`;
  if (diagnostics?.reported?.has(key)) return;
  diagnostics?.reported?.add(key);

  if (fetchResult?.error) {
    console.warn(
      `⚠️  Could not fetch sitemap ${sitemapUrl}: ${fetchResult.error}`,
    );
    return;
  }

  const contentType = fetchResult?.contentType
    ? ` (${fetchResult.contentType})`
    : "";
  console.warn(
    `⚠️  Sitemap fetch failed: ${sitemapUrl} -> HTTP ${fetchResult?.status || "unknown"}${contentType}`,
  );
  if (isLikelyBotChallengeResponse(fetchResult)) {
    console.warn(
      "ℹ️  Remote server may be blocking automated requests (CDN/WAF challenge).",
    );
  }
}

async function loadRemoteSitemapUrls(
  sitemapUrl,
  baseUrl,
  seen = new Set(),
  depth = 0,
  diagnostics = { reported: new Set() },
) {
  if (seen.has(sitemapUrl) || depth > 3) return [];
  seen.add(sitemapUrl);

  let response;
  try {
    response = await fetchText(sitemapUrl);
  } catch (error) {
    reportSitemapFetchFailure(
      sitemapUrl,
      { error: error?.message || String(error) },
      diagnostics,
    );
    return [];
  }
  if (!response?.ok) {
    reportSitemapFetchFailure(sitemapUrl, response, diagnostics);
    return [];
  }

  const xml = response.body;

  const locValues = extractLocValuesFromXml(xml);
  const pageUrls = [];
  for (const loc of locValues) {
    let absolute;
    try {
      absolute = new URL(loc, baseUrl).toString();
    } catch {
      continue;
    }
    if (!isSameOrigin(absolute, baseUrl)) continue;

    const pathname = new URL(absolute).pathname.toLowerCase();
    if (pathname.endsWith(".xml")) {
      const nested = await loadRemoteSitemapUrls(
        absolute,
        baseUrl,
        seen,
        depth + 1,
        diagnostics,
      );
      pageUrls.push(...nested);
      continue;
    }
    pageUrls.push(normalizeUrl(absolute));
  }

  return pageUrls;
}

async function getUrlsFromRemoteSitemap(baseUrl) {
  const candidates = ["sitemap-0.xml", "sitemap.xml", "sitemap-index.xml"].map(
    (s) => new URL(s, baseUrl).toString(),
  );
  const collected = new Set();
  const seenSitemaps = new Set();
  const diagnostics = { reported: new Set() };

  for (const sitemapUrl of candidates) {
    const urls = await loadRemoteSitemapUrls(
      sitemapUrl,
      baseUrl,
      seenSitemaps,
      0,
      diagnostics,
    );
    for (const url of urls) {
      collected.add(normalizeUrl(url));
    }
  }

  return Array.from(collected).sort();
}

async function crawlAllPages(startUrl) {
  const visited = new Set();
  const toVisit = new Set([startUrl]);
  const base = normalizeUrl(startUrl);

  while (toVisit.size > 0) {
    const [url] = toVisit;
    toVisit.delete(url);
    visited.add(url);

    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      console.error(`❌ Failed to fetch ${url}: ${err.message}`);
      continue;
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) continue;

    const html = await res.text();
    const root = parse(html);

    for (const anchor of root.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href");
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
      )
        continue;
      let absolute;
      try {
        absolute = href.startsWith("http")
          ? href
          : new URL(href, url).toString();
      } catch {
        continue;
      }
      const normalized = normalizeUrl(absolute);
      if (!normalized.startsWith(base)) continue;
      if (!visited.has(normalized) && !toVisit.has(normalized)) {
        toVisit.add(normalized);
      }
    }
  }

  return Array.from(visited).sort();
}

function writeUrlList(urls) {
  const file = path.join(REPORT_ROOT, "urls.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(urls, null, 2), "utf8");
  return file;
}

function findHtmlReport(reportDir, baseName) {
  const candidates = [
    path.join(reportDir, `${baseName}.html`),
    path.join(reportDir, `${baseName}.report.html`),
  ];
  return candidates.find(fs.existsSync);
}

function asFiniteNumber(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function findResourceSummaryItem(report, resourceType) {
  const items = report?.audits?.["resource-summary"]?.details?.items;
  if (!Array.isArray(items)) return null;
  const match = items.find((item) => item?.resourceType === resourceType);
  return match || null;
}

function extractLighthouseMetrics(report) {
  const metrics = report?.audits?.metrics?.details?.items?.[0] || {};
  const totalSummary = findResourceSummaryItem(report, "total");
  const documentSummary = findResourceSummaryItem(report, "document");

  return {
    htmlSizeBytes: asFiniteNumber(documentSummary?.transferSize),
    totalLoadedSizeBytes:
      asFiniteNumber(report?.audits?.["total-byte-weight"]?.numericValue) ??
      asFiniteNumber(totalSummary?.transferSize),
    totalLoadTimeMs:
      asFiniteNumber(metrics.observedLoad) ??
      asFiniteNumber(report?.audits?.["metrics"]?.numericValue),
  };
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "-";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMs(value) {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(value)} ms`;
}

function lighthouseScoreTone(score) {
  if (!Number.isFinite(score)) return "info";
  if (score >= 90) return "pass";
  if (score >= 50) return "warn";
  return "fail";
}

function lighthouseScoreCell(score) {
  if (!Number.isFinite(score)) return statusChipHtml("-", "info");
  return statusChipHtml(String(score), lighthouseScoreTone(score));
}

function generateLighthouseSummary(reportDir) {
  if (!fs.existsSync(reportDir)) return null;
  const files = fs.readdirSync(reportDir);
  const runs = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(reportDir, file);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    if (!data.categories) continue;
    const url =
      data.finalDisplayedUrl ||
      data.finalUrl ||
      data.requestedUrl ||
      data.mainDocumentUrl ||
      file;
    const scores = {};
    for (const [key, cat] of Object.entries(data.categories)) {
      if (cat && typeof cat.score === "number") {
        scores[key] = Math.round(cat.score * 100);
      }
    }
    const baseName = path.basename(file, ".json");
    const htmlReport = findHtmlReport(reportDir, baseName);
    const metrics = extractLighthouseMetrics(data);
    runs.push({
      url,
      scores,
      metrics,
      htmlReport: htmlReport ? path.basename(htmlReport) : null,
    });
  }

  if (!runs.length) return null;
  runs.sort((a, b) => a.url.localeCompare(b.url));

  const md = [
    "# Lighthouse summary",
    "",
    "| URL | Perf | Acc | Best | SEO | HTML size | Total loaded size | Total load time |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const run of runs) {
    const s = run.scores;
    const m = run.metrics || {};
    md.push(
      `| ${run.url} | ${s.performance ?? "-"} | ${s.accessibility ?? "-"} | ${s["best-practices"] ?? "-"} | ${s.seo ?? "-"} | ${formatBytes(m.htmlSizeBytes)} | ${formatBytes(m.totalLoadedSizeBytes)} | ${formatMs(m.totalLoadTimeMs)} |`,
    );
  }
  const mdPath = path.join(reportDir, "SUMMARY.md");
  fs.writeFileSync(mdPath, md.join("\n"), "utf8");

  const metricsData = runs.map((run) => ({
    url: run.url,
    htmlSizeBytes: run.metrics?.htmlSizeBytes ?? null,
    totalLoadedSizeBytes: run.metrics?.totalLoadedSizeBytes ?? null,
    totalLoadTimeMs: run.metrics?.totalLoadTimeMs ?? null,
  }));
  const metricsPath = path.join(reportDir, "metrics.json");
  fs.writeFileSync(metricsPath, JSON.stringify(metricsData, null, 2), "utf8");

  const rows = runs
    .map((run) => {
      const s = run.scores;
      const m = run.metrics || {};
      const link = run.htmlReport
        ? `<a class="report-link-btn" href="./${escapeHtml(run.htmlReport)}">report</a>`
        : "report";
      return `<tr>
        <td>${escapeHtml(run.url)}</td>
        <td>${lighthouseScoreCell(s.performance)}</td>
        <td>${lighthouseScoreCell(s.accessibility)}</td>
        <td>${lighthouseScoreCell(s["best-practices"])}</td>
        <td>${lighthouseScoreCell(s.seo)}</td>
        <td>${formatBytes(m.htmlSizeBytes)}</td>
        <td>${formatBytes(m.totalLoadedSizeBytes)}</td>
        <td>${formatMs(m.totalLoadTimeMs)}</td>
        <td>${link}</td>
      </tr>`;
    })
    .join("\n");

  const html = `${renderReportShellStart({
    title: "Lighthouse Summary",
    subtitle: `${runs.length} pages tested`,
    navLinks: buildCrossNavLinks("lighthouse/summary.html"),
  })}
    <section class="report-section">
      <table class="report-table">
        <thead>
          <tr><th>URL</th><th>Performance</th><th>Accessibility</th><th>Best Practices</th><th>SEO</th><th>HTML size</th><th>Total loaded size</th><th>Total load time</th><th>Report</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>
${renderReportShellEnd()}`;

  const htmlPath = path.join(reportDir, "summary.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  return { mdPath, htmlPath, metricsPath };
}

function ensureLighthousePlaceholder(reportDir, message) {
  fs.mkdirSync(reportDir, { recursive: true });
  const html = `${renderReportShellStart({
    title: "Lighthouse report not available",
    subtitle: "No Lighthouse summary could be generated for this run.",
    navLinks: buildCrossNavLinks("lighthouse/summary.html"),
  })}
    <section class="report-section">
      <p>${escapeHtml(message)}</p>
    </section>
${renderReportShellEnd()}`;
  const htmlPath = path.join(reportDir, "summary.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  return { htmlPath };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTargetLabel(selectedTarget) {
  const key = String(selectedTarget?.key || "").trim();
  if (key) {
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
  const name = String(selectedTarget?.name || "").trim();
  if (name) {
    return name.split("(")[0].trim() || "Target";
  }
  return "Target";
}

function createReportIndex(context = {}) {
  const targetLabel = formatTargetLabel(context.selectedTarget);
  const baseUrl = String(context.baseUrl || "").trim();
  const headerSubtitle = baseUrl
    ? `Testing ${targetLabel} - ${baseUrl}`
    : "Quality report summary";
  const linksSummary = summarizeLinks(path.join(REPORT_ROOT, "links"));
  const noBrokenLinksFound =
    linksSummary && Number(linksSummary.broken || 0) === 0;

  const entries = REPORT_MODULES;

  function resolveEntryStatus(entry) {
    if (entry.name === "Link check") {
      const broken = Number(linksSummary?.broken || 0);
      if (!linksSummary) return { label: "Unknown", tone: "info" };
      if (broken > 0) return { label: `${broken} Broken`, tone: "fail" };
      return { label: "Clean", tone: "pass" };
    }
    if (entry.name === "Lighthouse") {
      const stats = readJsonIfExists(
        path.join(REPORT_ROOT, "lighthouse", "stats.json"),
      );
      const failures =
        Number(stats?.assertionFailures || 0) + Number(stats?.runFailures || 0);
      if (!stats) return { label: "Unknown", tone: "info" };
      if (failures > 0) return { label: `${failures} Issues`, tone: "warn" };
      return { label: "Pass", tone: "pass" };
    }
    if (entry.name === "Pa11y") {
      const stats = readJsonIfExists(
        path.join(REPORT_ROOT, "pa11y", "stats.json"),
      );
      if (!stats) return { label: "Unknown", tone: "info" };
      const errors = Number(stats.errorCount || 0);
      const warnings = Number(stats.warningCount || 0);
      if (errors > 0) return { label: `${errors} Errors`, tone: "fail" };
      if (warnings > 0) return { label: `${warnings} Warnings`, tone: "warn" };
      return { label: "Pass", tone: "pass" };
    }
    if (entry.name === "SEO") {
      const stats = readJsonIfExists(
        path.join(REPORT_ROOT, "seo", "stats.json"),
      );
      if (!stats) return { label: "Unknown", tone: "info" };
      const errors = Number(stats.errorCount || 0);
      const warnings = Number(stats.warningCount || 0);
      if (errors > 0) return { label: `${errors} Errors`, tone: "fail" };
      if (warnings > 0) return { label: `${warnings} Warnings`, tone: "warn" };
      return { label: "Pass", tone: "pass" };
    }
    if (entry.name === "JSON-LD") {
      const stats = readJsonIfExists(
        path.join(REPORT_ROOT, "jsonld", "stats.json"),
      );
      if (!stats) return { label: "Unknown", tone: "info" };
      const errors = Number(stats.errorCount || 0);
      const warnings = Number(stats.warningCount || 0);
      if (errors > 0) return { label: `${errors} Errors`, tone: "fail" };
      if (warnings > 0) return { label: `${warnings} Warnings`, tone: "warn" };
      return { label: "Pass", tone: "pass" };
    }
    if (entry.name === "Security") {
      const stats = readJsonIfExists(
        path.join(REPORT_ROOT, "security", "stats.json"),
      );
      if (!stats) return { label: "Unknown", tone: "info" };
      const findings = Number(stats.findingsTotal || 0);
      if (stats.failed || findings > 0) {
        return {
          label: `${findings} Findings`,
          tone: findings > 0 ? "warn" : "fail",
        };
      }
      return { label: "Pass", tone: "pass" };
    }
    return { label: "Report", tone: "info" };
  }

  const cards = entries
    .filter(
      (entry) =>
        !(noBrokenLinksFound && entry.name === "Link check") &&
        (fs.existsSync(path.join(REPORT_ROOT, entry.path)) ||
          (entry.fallback &&
            fs.existsSync(path.join(REPORT_ROOT, entry.fallback)))),
    )
    .map((entry) => {
      const href = fs.existsSync(path.join(REPORT_ROOT, entry.path))
        ? entry.path
        : entry.fallback;
      const status = resolveEntryStatus(entry);
      return `
        <section class="report-card">
          <h2>${entry.name}</h2>
          <p>${entry.highlight}</p>
          ${statusChipHtml(status.label, status.tone)}
          <div style="margin-top: 10px;">
          <a class="report-link-btn" href="./${href}">Open</a>
          </div>
        </section>
      `;
    })
    .join("\n");

  const html = `${renderReportShellStart({
    title: "Quality Reports",
    subtitle: headerSubtitle,
    navLinks: [{ href: "/", label: "Home" }],
  })}
    ${noBrokenLinksFound ? '<p class="report-note">No broken links found.</p>' : ""}
    <section class="report-section">
      <div class="report-grid">
        ${cards || "<p>No reports found.</p>"}
      </div>
    </section>
${renderReportShellEnd()}`;

  const indexPath = path.join(REPORT_ROOT, "index.html");
  fs.writeFileSync(indexPath, html, "utf8");
  return indexPath;
}

async function main() {
  const registeredChecks = registerDefaultQualityChecks();
  const qualityConfig = await loadQualityConfig(process.cwd());
  const envValues = loadProjectEnvValues();
  const selectedTarget = await promptForTarget(envValues);
  const promptedChecks = await promptForChecks(selectedTarget);
  const availability = buildCheckAvailability(selectedTarget);
  const selectedChecks = applyQualityConfigToSelection(
    promptedChecks,
    qualityConfig,
    availability,
  );
  const selectedBaseUrl = selectedTarget?.baseUrl;
  if (!selectedBaseUrl) {
    throw new Error("No valid base URL resolved for selected target.");
  }
  const baseUrl = selectedTarget.usesLocalBuild
    ? preferIpv4Loopback(selectedBaseUrl)
    : selectedBaseUrl;

  const selectionForOrder = {
    ...selectedChecks,
    jsonld: Boolean(selectedChecks.jsonld && selectedTarget.usesLocalBuild),
  };
  const planForLabel = resolveCheckExecutionPlan({
    selectedChecks: selectionForOrder,
    qualityConfig,
    registeredChecks: registeredChecks.map((check) => ({
      ...check,
      name: checkDisplayName(check.id),
      enabled: Boolean(selectionForOrder[check.id]),
    })),
  });

  const selectedLabel = planForLabel.length
    ? planForLabel.map((entry) => entry.id).join(", ")
    : selectedChecks.label || "none";
  console.log(`🧪 Selected: ${selectedLabel}`);
  console.log(`🌐 Target: ${selectedTarget.name}`);
  console.log(`🔗 Base URL: ${baseUrl}`);
  if (qualityConfig.path) {
    console.log(`⚙️  Quality config loaded: ${qualityConfig.path}`);
  }
  const unavailableChecks = Object.entries(availability)
    .filter(([, rule]) => rule?.enabled === false)
    .map(([key, rule]) => {
      const name =
        TEST_CHOICES.find((choice) => choice.value === key)?.name || key;
      return `${name}${rule?.reason ? ` (${rule.reason})` : ""}`;
    });
  if (unavailableChecks.length) {
    console.log(
      `ℹ️  Unavailable for this target: ${unavailableChecks.join("; ")}`,
    );
  }

  console.log("🧹 Cleaning previous reports...");
  ensureCleanReports();

  if (QUIET_MODE) {
    console.log(
      `🤫 Quiet mode enabled (use --full or QUIET=0 to stream all output). Logs will be saved to ${LOG_ROOT}.`,
    );
  } else {
    console.log("🔊 Full output enabled; streaming command output directly.");
  }

  let siteServer = null;
  try {
    if (selectedTarget.usesLocalBuild) {
      const localSitePort = (() => {
        try {
          const port = Number(new URL(baseUrl).port || 0);
          return port > 0 ? port : SITE_PORT;
        } catch {
          return SITE_PORT;
        }
      })();

      console.log("🏗️  Building site...");
      try {
        await runCommand("npm", ["run", "build"], {
          label: "Build site",
          logName: "build",
        });
      } catch (err) {
        if (err?.logPath) {
          console.error(`❌ Build failed (see ${err.logPath})`);
          const tailLines = (err.tail || "")
            .trim()
            .split("\n")
            .slice(-12)
            .join("\n");
          if (QUIET_MODE && tailLines) {
            console.error(tailLines);
          }
        }
        throw err;
      }

      console.log("🚀 Starting local server for build output...");
      siteServer = startStaticServer("./build", localSitePort, "site", {
        quiet: QUIET_MODE,
        logName: "site-serve",
      });
      await waitForServer(baseUrl);
      if (siteServer.exitCode !== null) {
        const logHint = siteServer.logFile
          ? ` (see ${siteServer.logFile})`
          : "";
        throw new Error(
          `Failed to start local site server on ${baseUrl}. Port ${localSitePort} may already be in use${logHint}.`,
        );
      }
      console.log(`✅ Site server ready at ${baseUrl}`);
    } else {
      console.log("🌍 Remote target selected: skipping local build/server.");
      await waitForServer(baseUrl);
      console.log(`✅ Remote target reachable at ${baseUrl}`);
    }

    console.log("🔎 Discovering site URLs from sitemap...");
    let urls = selectedTarget.usesLocalBuild
      ? getUrlsFromSitemap(baseUrl)
      : await getUrlsFromRemoteSitemap(baseUrl);
    if (!urls.length) {
      console.log(
        selectedTarget.usesLocalBuild
          ? "ℹ️  Sitemap empty or missing, falling back to crawl of built site."
          : "ℹ️  Remote sitemap empty or missing, falling back to crawl of target site.",
      );
      urls = await crawlAllPages(baseUrl);
    }
    urls = filterLocationPages(urls);
    if (!urls.length) {
      throw new Error(
        "No URLs found to test (sitemap empty and crawl produced none).",
      );
    }
    console.log(`   Found ${urls.length} pages to test`);
    urls.forEach((u) => console.log("  -", u));

    const urlsFile = writeUrlList(urls);

    const checkRunners = {};

    const lighthouseReportDir = path.join(REPORT_ROOT, "lighthouse");
    checkRunners.lighthouse = async () => {
      const progress = createProgressRenderer("");
      let result;
      try {
        result = await runCommand(
          "node",
          [
            toolkitScriptPath("lighthouse-audit.mjs"),
            "--base",
            baseUrl,
            "--urls-file",
            urlsFile,
            "--report-dir",
            lighthouseReportDir,
            "--config",
            path.join(process.cwd(), "lighthouserc.cjs"),
            QUIET_MODE ? "--quiet" : "",
          ],
          {
            label: "Lighthouse",
            logName: "lighthouse",
            allowFailure: true,
            forceLog: true,
            onLine: QUIET_MODE
              ? ({ type, line }) => {
                  if (type !== "stdout") return;
                  const event = parseLighthouseProgressLine(line);
                  if (event?.type !== "page-start") return;
                  progress.update(formatLighthouseProgressMessage(event));
                }
              : undefined,
          },
        );
      } finally {
        progress.stop();
      }
      const raw = collectLighthouseFromReportDir(lighthouseReportDir, {
        logPath: result?.logPath,
      });
      const normalized = normalizeLighthousePayload(raw, {
        selected: true,
        failed: Boolean(result?.exitCode && result.exitCode !== 0),
      });
      return summarizeLighthousePayload(normalized);
    };

    checkRunners.pa11y = async () => {
      const result = await runCommand(
        "node",
        [
          toolkitScriptPath("pa11y-crawl-and-test.mjs"),
          "--base",
          baseUrl,
          "--urls-file",
          urlsFile,
          "--report-dir",
          path.join(REPORT_ROOT, "pa11y"),
          QUIET_MODE ? "--quiet" : "",
        ].filter(Boolean),
        {
          label: "Pa11y",
          logName: "pa11y",
          allowFailure: true,
          forceLog: true,
        },
      );
      const raw = collectPa11yFromReportDir(path.join(REPORT_ROOT, "pa11y"), {
        logPath: result?.logPath,
      });
      const normalized = normalizePa11yPayload(raw, {
        selected: true,
        failed: Boolean(result?.exitCode && result.exitCode !== 0),
      });
      return summarizePa11yPayload(normalized);
    };

    checkRunners.seo = async () => {
      const result = await runCommand(
        "node",
        [
          toolkitScriptPath("seo-audit.mjs"),
          "--base",
          baseUrl,
          "--urls-file",
          urlsFile,
          "--report-dir",
          path.join(REPORT_ROOT, "seo"),
          QUIET_MODE ? "--quiet" : "",
        ].filter(Boolean),
        {
          label: "SEO audit",
          logName: "seo",
          allowFailure: true,
          forceLog: true,
        },
      );
      const raw = collectSeoFromReportDir(path.join(REPORT_ROOT, "seo"), {
        logPath: result?.logPath,
      });
      const normalized = normalizeSeoPayload(raw, {
        selected: true,
        failed: Boolean(result?.exitCode && result.exitCode !== 0),
      });
      return summarizeSeoPayload(normalized);
    };

    checkRunners.links = async () => {
      const result = await runCommand(
        "node",
        [
          toolkitScriptPath("link-check.mjs"),
          "--base",
          baseUrl,
          "--urls-file",
          urlsFile,
          "--report-dir",
          path.join(REPORT_ROOT, "links"),
          QUIET_MODE ? "--quiet" : "",
        ].filter(Boolean),
        {
          label: "Link check",
          logName: "links",
          allowFailure: true,
          forceLog: true,
        },
      );
      const raw = collectLinksFromReportDir(path.join(REPORT_ROOT, "links"), {
        logPath: result?.logPath,
      });
      const normalized = normalizeLinksPayload(raw, {
        selected: true,
        failed: Boolean(result?.exitCode && result.exitCode !== 0),
      });
      return summarizeLinksPayload(normalized);
    };

    checkRunners.jsonld = async () => {
      const reportDir = path.join(REPORT_ROOT, "jsonld");
      const result = await runCommand(
        "node",
        [
          toolkitScriptPath("jsonld-validate.mjs"),
          "build",
          `--urls-file=${urlsFile}`,
          `--report-dir=${reportDir}`,
        ],
        {
          label: "JSON-LD validation",
          logName: "jsonld",
          allowFailure: true,
          forceLog: true,
          quiet: QUIET_MODE,
        },
      );
      const raw = collectJsonldFromReportDir(reportDir, {
        logPath: result?.logPath,
      });
      const normalized = normalizeJsonldPayload(raw, {
        selected: true,
        failed: Boolean(result?.exitCode && result.exitCode !== 0),
      });
      const summaryData = summarizeJsonldPayload(normalized);
      return {
        summary: `${summaryData.summary} (report: reports/jsonld/report.html)`,
        failed: summaryData.failed,
      };
    };

    checkRunners.security = async () => {
      const result = await runCommand(
        "node",
        [
          toolkitScriptPath("security-audit.mjs"),
          "--base",
          baseUrl,
          "--report-dir",
          path.join(REPORT_ROOT, "security"),
          QUIET_MODE ? "--quiet" : "",
        ].filter(Boolean),
        {
          label: "Security audit",
          logName: "security",
          allowFailure: true,
          forceLog: true,
        },
      );
      const raw = collectSecurityFromReportDir(path.join(REPORT_ROOT, "security"), {
        logPath: result?.logPath,
      });
      const normalized = normalizeSecurityPayload(raw, {
        selected: true,
        failed: Boolean(result?.exitCode && result.exitCode !== 0),
      });
      return summarizeSecurityPayload(normalized);
    };

    const createdAt = new Date().toISOString();
    const { failures, dataset: pendingDataset } = await runPlannedQualityChecks({
      plan: planForLabel,
      runners: checkRunners,
      targetUsesLocalBuild: selectedTarget.usesLocalBuild,
      selectedChecks,
      quietMode: QUIET_MODE,
      logger: console,
      buildDataset: ({ failures: checkFailures, context }) =>
        buildCanonicalDataset({
          runId: "__pending__",
          createdAt: context.createdAt,
          selectedTarget: context.selectedTarget,
          baseUrl: context.baseUrl,
          selectedChecks: context.selectedChecks,
          failures: checkFailures,
          reportRoot: context.reportRoot,
          logRoot: context.logRoot,
        }),
      datasetContext: {
        createdAt,
        selectedTarget,
        baseUrl,
        selectedChecks,
        reportRoot: REPORT_ROOT,
        logRoot: LOG_ROOT,
      },
    });

    if (siteServer && !siteServer.killed) {
      console.log("🛑 Stopping site server...");
      siteServer.kill("SIGINT");
      siteServer = null;
    }

    try {
      const snapshot = writeRunSnapshot({
        cwd: process.cwd(),
        meta: {
          createdAt,
          target: selectedTarget?.key || selectedTarget?.name || "unknown",
          baseUrl,
          checks: selectedCheckIds(selectedChecks),
          failures,
        },
        dataset: pendingDataset,
        rawSources: collectRawSources(),
      });
      const runId = snapshot.runId;
      const dataset = assignDatasetRunId(pendingDataset, runId);
      fs.writeFileSync(
        path.join(snapshot.runDir, "dataset.json"),
        `${JSON.stringify(dataset, null, 2)}\n`,
        "utf8",
      );
      console.log(`🧾 Run snapshot saved: ${path.join("reports", "runs", runId)}`);

      await runCommand(
        "node",
        [toolkitScriptPath("quality-render.mjs"), "--run", runId, "--format", "html"],
        {
          label: "Render HTML view",
          logName: "render-html",
        },
      );
      console.log(
        `🧩 HTML view rendered from templates: ${path.join("reports", "views", "html", runId)}`,
      );
    } catch (snapshotErr) {
      console.error(`⚠️  Snapshot capture failed: ${snapshotErr.message}`);
    }

    const reportUrl = `http://127.0.0.1:${REPORT_PORT}/`;
    console.log(`🌐 Starting report server on ${reportUrl} (Ctrl+C to stop)`);
    const reportServer = startStaticServer(REPORT_ROOT, REPORT_PORT, "report", {
      quiet: QUIET_MODE,
      logName: "report-serve",
    });
    try {
      await waitForServer(reportUrl);
    } catch {
      console.error(
        `⚠️  Report server did not become ready at ${reportUrl} (continuing anyway).`,
      );
    }
    console.log(`🔗 Reports available at ${reportUrl}`);
    const opened = openInBrowser(reportUrl);
    if (opened) {
      console.log("🖥️ Opening reports in your browser...");
    }

    if (failures.length) {
      console.error(`\n⚠️  Some checks failed: ${failures.join(", ")}`);
      console.error("You can review the HTML reports above.");
      process.exitCode = 1;
    } else {
      console.log("\n🎉 All quality checks passed.");
    }

    await waitForServerExit(reportServer);
  } finally {
    // Ensure site server is not left running if something throws.
    if (siteServer && !siteServer.killed) {
      siteServer.kill("SIGINT");
    }
  }
}

main().catch((err) => {
  console.error("Unexpected error in test suite:", err);
  process.exit(1);
});
