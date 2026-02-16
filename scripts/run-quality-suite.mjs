#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import inquirer from "inquirer";
import waitOn from "wait-on";
import { parse } from "node-html-parser";

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

const BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const SITE_PORT = Number(process.env.SITE_PORT || 4321);
const REPORT_PORT = Number(process.env.REPORT_PORT || 5555);
const REPORT_ROOT = path.join(process.cwd(), "reports");
const toolkitScriptsDir = path.dirname(fileURLToPath(import.meta.url));
const toolkitScriptPath = (filename) => path.join(toolkitScriptsDir, filename);
const argv = process.argv.slice(2);
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
    name: "All (Lighthouse + Pa11y + SEO + Link check + JSON-LD)",
    value: "all",
  },
  { name: "Lighthouse", value: "lighthouse" },
  { name: "Accessibility (Pa11y)", value: "pa11y" },
  { name: "SEO audit", value: "seo" },
  { name: "Link check", value: "links" },
  { name: "JSON-LD validation", value: "jsonld" },
];

function choiceToFlags(choice) {
  if (choice === "all") {
    return {
      label: "All checks",
      lighthouse: true,
      pa11y: true,
      seo: true,
      links: true,
      jsonld: true,
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
  };
}

async function promptForChecks() {
  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: "Which test do you want to perform?",
      choices: TEST_CHOICES,
      default: "all",
    },
  ]);
  return choiceToFlags(choice);
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
  const stats = readJsonIfExists(path.join(reportDir, "stats.json"));
  if (!stats) return null;
  return { errors: stats.errorCount ?? 0, warnings: stats.warningCount ?? 0 };
}

function summarizeSeo(reportDir) {
  const issues = readJsonIfExists(path.join(reportDir, "issues.json"));
  if (!Array.isArray(issues)) return null;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warn").length;
  return { errors, warnings };
}

function summarizeLinks(reportDir) {
  const data = readJsonIfExists(path.join(reportDir, "links.json"));
  if (!data) return null;
  const broken = Array.isArray(data.broken)
    ? data.broken.length
    : Array.isArray(data?.brokenLinks)
      ? data.brokenLinks.length
      : 0;
  const skipped = Number(data.skippedExternal || 0);
  return { broken, skipped };
}

function summarizeLighthouseAssertions(reportDir, logPath) {
  const stats = readJsonIfExists(path.join(reportDir, "stats.json"));
  if (Number.isFinite(stats?.assertionFailures)) {
    return Number(stats.assertionFailures);
  }
  if (!logPath || !fs.existsSync(logPath)) return null;
  const txt = fs.readFileSync(logPath, "utf8");
  const match = txt.match(/found:\s*(\d+)/i);
  if (match) {
    return Number(match[1]);
  }
  return null;
}

function slugify(value) {
  return (value ?? "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  const spawnOptions = {
    shell: true,
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
      const child = spawn(cmd, args, spawnOptions);
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
    const child = spawn(cmd, args, spawnOptions);

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
  const serveArgs = ["serve", dir, "-l", String(port)];
  const spawnOpts = { shell: true };
  let logStream;

  if (quiet) {
    const logFile = path.join(
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

  const child = spawn("npx", serveArgs, spawnOpts);
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
  if (fs.existsSync(REPORT_ROOT)) {
    fs.rmSync(REPORT_ROOT, { recursive: true, force: true });
  }
  fs.mkdirSync(REPORT_ROOT, { recursive: true });
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    return url;
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
    if (!pathname.startsWith("/en") && !pathname.startsWith("/fr")) continue;
    if (!fileExistsForPath(pathname)) continue;
    const target = new URL(pathname, baseUrl).toString();
    urls.add(normalizeUrl(target));
  }

  return Array.from(urls).sort();
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
    runs.push({
      url,
      scores,
      htmlReport: htmlReport ? path.basename(htmlReport) : null,
    });
  }

  if (!runs.length) return null;
  runs.sort((a, b) => a.url.localeCompare(b.url));

  const md = [
    "# Lighthouse summary",
    "",
    "| URL | Perf | Acc | Best | SEO |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const run of runs) {
    const s = run.scores;
    md.push(
      `| ${run.url} | ${s.performance ?? "-"} | ${s.accessibility ?? "-"} | ${s["best-practices"] ?? "-"} | ${s.seo ?? "-"} |`,
    );
  }
  const mdPath = path.join(reportDir, "SUMMARY.md");
  fs.writeFileSync(mdPath, md.join("\n"), "utf8");

  const rows = runs
    .map((run) => {
      const s = run.scores;
      const link = run.htmlReport
        ? `<a href="./${run.htmlReport}">report</a>`
        : "report";
      return `<tr>
        <td>${run.url}</td>
        <td>${s.performance ?? "-"}</td>
        <td>${s.accessibility ?? "-"}</td>
        <td>${s["best-practices"] ?? "-"}</td>
        <td>${s.seo ?? "-"}</td>
        <td>${link}</td>
      </tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Lighthouse summary</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0b1021; color: #e8ecf5; margin: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #1f2a45; padding: 8px; text-align: left; }
    th { background: #11172d; }
    a { color: #9fb3ff; }
  </style>
</head>
<body>
  <h1>Lighthouse summary</h1>
  <table>
    <thead>
      <tr><th>URL</th><th>Performance</th><th>Accessibility</th><th>Best Practices</th><th>SEO</th><th>Report</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;

  const htmlPath = path.join(reportDir, "summary.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  return { mdPath, htmlPath };
}

function ensureLighthousePlaceholder(reportDir, message) {
  fs.mkdirSync(reportDir, { recursive: true });
  const html = `<!doctype html>
<html><body style="font-family: Arial, sans-serif; background:#0b1021; color:#e8ecf5; padding:20px;">
  <h1>Lighthouse report not available</h1>
  <p>${message}</p>
</body></html>`;
  const htmlPath = path.join(reportDir, "summary.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  return { htmlPath };
}

function createReportIndex() {
  const entries = [
    {
      name: "Lighthouse",
      path: "lighthouse/summary.html",
      fallback: "lighthouse",
      highlight: "Summary + per-page reports",
    },
    {
      name: "Accessibility (Pa11y)",
      path: "pa11y/report.html",
      fallback: "pa11y",
      highlight: "report.html + stats.json",
    },
    {
      name: "SEO",
      path: "seo/report.html",
      fallback: "seo",
      highlight: "report.html + issues.json",
    },
    {
      name: "Link check",
      path: "links/report.html",
      fallback: "links",
      highlight: "report.html + links.json",
    },
    {
      name: "JSON-LD",
      path: "jsonld/report.txt",
      fallback: "jsonld",
      highlight: "report.txt (validator output)",
    },
  ];

  const cards = entries
    .filter(
      (entry) =>
        fs.existsSync(path.join(REPORT_ROOT, entry.path)) ||
        (entry.fallback &&
          fs.existsSync(path.join(REPORT_ROOT, entry.fallback))),
    )
    .map((entry) => {
      const href = fs.existsSync(path.join(REPORT_ROOT, entry.path))
        ? entry.path
        : entry.fallback;
      return `
        <div class="card">
          <h2>${entry.name}</h2>
          <p>${entry.highlight}</p>
          <a href="./${href}">Open</a>
        </div>
      `;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Quality reports</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0b1021; color: #e8ecf5; margin: 30px; }
    h1 { margin-bottom: 8px; }
    p { color: #9fb3ff; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-top: 20px; }
    .card { background: #11172d; border: 1px solid #1f2a45; border-radius: 10px; padding: 16px; }
    .card h2 { margin: 0 0 6px; }
    .card p { margin: 0 0 12px; color: #b8c4ff; }
    a { color: #9fb3ff; font-weight: 600; }
  </style>
</head>
<body>
  <h1>Quality reports</h1>
  <p>Browse the HTML reports generated by npm test.</p>
  <div class="grid">
    ${cards || "<p>No reports found.</p>"}
  </div>
</body>
</html>`;

  const indexPath = path.join(REPORT_ROOT, "index.html");
  fs.writeFileSync(indexPath, html, "utf8");
  return indexPath;
}

async function main() {
  const selectedChecks = await promptForChecks();
  console.log(`🧪 Selected: ${selectedChecks.label}`);

  console.log("🧹 Cleaning previous reports...");
  ensureCleanReports();

  if (QUIET_MODE) {
    console.log(
      `🤫 Quiet mode enabled (use --full or QUIET=0 to stream all output). Logs will be saved to ${LOG_ROOT}.`,
    );
  } else {
    console.log("🔊 Full output enabled; streaming command output directly.");
  }

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
  const siteServer = startStaticServer("./build", SITE_PORT, "site", {
    quiet: QUIET_MODE,
    logName: "site-serve",
  });
  try {
    await waitForServer(BASE_URL);
    console.log(`✅ Site server ready at ${BASE_URL}`);

    console.log("🔎 Discovering site URLs from sitemap (en/fr only)...");
    let urls = getUrlsFromSitemap(BASE_URL);
    if (!urls.length) {
      console.log(
        "ℹ️  Sitemap empty or missing, falling back to crawl of built site.",
      );
      urls = await crawlAllPages(BASE_URL);
    }
    urls = urls.filter((u) => {
      try {
        const p = new URL(u).pathname;
        return p.startsWith("/en") || p.startsWith("/fr");
      } catch {
        return false;
      }
    });
    urls = filterLocationPages(urls);
    if (!urls.length) {
      throw new Error(
        "No URLs found to test (sitemap empty and crawl produced none).",
      );
    }
    console.log(`   Found ${urls.length} pages to test`);
    urls.forEach((u) => console.log("  -", u));

    const urlsFile = writeUrlList(urls);

    const failures = [];

    async function runStep(name, fn, enabled = true) {
      if (!enabled) {
        console.log(`⏭️  ${name} (skipped)`);
        return null;
      }
      console.log(`➡️  ${name}${QUIET_MODE ? " (quiet logging)" : ""}`);
      try {
        const result = await fn();
        if (result?.summary) {
          console.log(result.summary);
        } else {
          console.log(`✅ ${name} completed`);
        }
        if (result?.failed) {
          failures.push(name);
        }
        return result;
      } catch (err) {
        failures.push(name);
        console.error(`❌ ${name} crashed: ${err.message}`);
        return null;
      }
    }

    const lighthouseReportDir = path.join(REPORT_ROOT, "lighthouse");

    await runStep(
      "Lighthouse",
      async () => {
        const result = await runCommand(
          "node",
          [
            toolkitScriptPath("lighthouse-audit.mjs"),
            "--base",
            BASE_URL,
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
          },
        );
        const assertionCount = summarizeLighthouseAssertions(
          lighthouseReportDir,
          result?.logPath,
        );
        const summary =
          assertionCount === null
            ? `Lighthouse completed${result?.logPath ? ` (log: ${result.logPath})` : ""}`
            : assertionCount > 0
              ? `Lighthouse assertions: ${assertionCount} (log: ${result.logPath})`
              : "Lighthouse: 0 assertion failures";
        const failed =
          assertionCount > 0 || (result?.exitCode && result.exitCode !== 0);
        return { summary, failed };
      },
      selectedChecks.lighthouse,
    );
    let lighthouseSummary = null;
    if (selectedChecks.lighthouse) {
      lighthouseSummary = generateLighthouseSummary(
        path.join(REPORT_ROOT, "lighthouse"),
      );
      if (!lighthouseSummary) {
        lighthouseSummary = ensureLighthousePlaceholder(
          path.join(REPORT_ROOT, "lighthouse"),
          "Lighthouse output was not generated (step may have failed).",
        );
      }
    }

    await runStep(
      "Accessibility (Pa11y)",
      async () => {
        const result = await runCommand(
          "node",
          [
            toolkitScriptPath("pa11y-crawl-and-test.mjs"),
            "--base",
            BASE_URL,
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
        const counts = summarizePa11y(path.join(REPORT_ROOT, "pa11y"));
        const errors = counts?.errors ?? 0;
        const warnings = counts?.warnings ?? 0;
        const summary =
          errors || warnings
            ? `Pa11y issues: ${errors} errors${warnings ? `, ${warnings} warnings` : ""}`
            : "Pa11y issues: 0";
        const failed =
          errors > 0 || (result?.exitCode && result.exitCode !== 0);
        return { summary, failed };
      },
      selectedChecks.pa11y,
    );

    await runStep(
      "SEO audit",
      async () => {
        const result = await runCommand(
          "node",
          [
            toolkitScriptPath("seo-audit.mjs"),
            "--base",
            BASE_URL,
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
        const counts = summarizeSeo(path.join(REPORT_ROOT, "seo"));
        const errors = counts?.errors ?? 0;
        const warnings = counts?.warnings ?? 0;
        const summary =
          errors || warnings
            ? `SEO issues: ${errors} errors${warnings ? `, ${warnings} warnings` : ""}`
            : "SEO issues: 0";
        const failed =
          errors > 0 || (result?.exitCode && result.exitCode !== 0);
        return { summary, failed };
      },
      selectedChecks.seo,
    );

    await runStep(
      "Link check",
      async () => {
        const result = await runCommand(
          "node",
          [
            toolkitScriptPath("link-check.mjs"),
            "--base",
            BASE_URL,
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
        const counts = summarizeLinks(path.join(REPORT_ROOT, "links"));
        const broken = counts?.broken ?? 0;
        const summary = broken
          ? `Link check: ${broken} broken link(s)`
          : "Link check: 0 broken links";
        const failed =
          broken > 0 || (result?.exitCode && result.exitCode !== 0);
        return { summary, failed };
      },
      selectedChecks.links,
    );

    await runStep(
      "JSON-LD validation",
      async () => {
        const result = await runCommand(
          "node",
          [
            toolkitScriptPath("jsonld-validate.mjs"),
            "build",
            `--urls-file=${urlsFile}`,
          ],
          {
            label: "JSON-LD validation",
            logName: "jsonld",
            allowFailure: true,
            forceLog: true,
            quiet: QUIET_MODE,
          },
        );

        const reportDir = path.join(REPORT_ROOT, "jsonld");
        fs.mkdirSync(reportDir, { recursive: true });
        const reportPath = path.join(reportDir, "report.txt");
        if (result?.logPath && fs.existsSync(result.logPath)) {
          fs.copyFileSync(result.logPath, reportPath);
        } else {
          fs.writeFileSync(reportPath, "No log output captured.", "utf8");
        }

        const failed = result?.exitCode && result.exitCode !== 0;
        const summary = failed
          ? "JSON-LD issues found (see reports/jsonld/report.txt)"
          : "JSON-LD: 0 issues detected";
        return { summary, failed };
      },
      selectedChecks.jsonld,
    );

    console.log("🛑 Stopping site server...");
    siteServer.kill("SIGINT");

    const indexPath = createReportIndex();
    console.log(`📁 Report index created at ${indexPath}`);
    if (lighthouseSummary?.htmlPath) {
      console.log(`📊 Lighthouse summary: ${lighthouseSummary.htmlPath}`);
    }

    const reportUrl = `http://localhost:${REPORT_PORT}/`;
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
    // Ensure site server is not left running if something throws
    if (!siteServer.killed) {
      siteServer.kill("SIGINT");
    }
  }
}

main().catch((err) => {
  console.error("Unexpected error in test suite:", err);
  process.exit(1);
});
