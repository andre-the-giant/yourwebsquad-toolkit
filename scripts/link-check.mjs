#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import waitOn from "wait-on";
import { load as loadHtml } from "cheerio";

const DEFAULT_BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const DEFAULT_REPORT_DIR = process.env.LINK_REPORT_DIR || path.join(process.cwd(), "reports/links");
const DEFAULT_SITE_PORT = Number(process.env.SITE_PORT || 4321);

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.base ?? DEFAULT_BASE_URL;
const REPORT_DIR = args.reportDir ?? DEFAULT_REPORT_DIR;
const URLS_FILE = args.urlsFile;
const CHECK_EXTERNAL = args.skipExternal ? false : process.env.CHECK_EXTERNAL_LINKS !== "0";
const QUIET_MODE = Boolean(args.quiet || process.env.LINKS_QUIET === "1");

const visited = new Set();
const toVisit = new Set([BASE_URL]);
const linkCache = new Map(); // normalizedUrl -> result

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--base" || arg === "-b") && argv[i + 1]) {
      opts.base = argv[++i];
    } else if ((arg === "--report-dir" || arg === "-o") && argv[i + 1]) {
      opts.reportDir = argv[++i];
    } else if ((arg === "--urls-file" || arg === "-u") && argv[i + 1]) {
      opts.urlsFile = argv[++i];
    } else if (arg === "--skip-external") {
      opts.skipExternal = true;
    } else if (arg === "--quiet") {
      opts.quiet = true;
    }
  }
  return opts;
}

function sitePortFromBase() {
  try {
    const u = new URL(BASE_URL);
    return Number(u.port) || DEFAULT_SITE_PORT;
  } catch {
    return DEFAULT_SITE_PORT;
  }
}

async function waitForServer(url) {
  await waitOn({ resources: [url], timeout: 20000 });
}

function runCommand(cmd, args, { label = cmd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: true });
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function startStaticServer(dir, port, { quiet = QUIET_MODE } = {}) {
  const args = ["serve", dir, "-l", String(port)];
  const opts = quiet ? { stdio: "ignore", shell: true } : { stdio: "inherit", shell: true };
  const child = spawn("npx", args, opts);
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && !quiet) {
      console.error(`⚠️  Static server exited with code ${code}`);
    }
  });
  return child;
}

function ensureReportDirClean(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

async function ensureBuildExists() {
  const buildDir = path.join(process.cwd(), "build");
  const hasBuild = fs.existsSync(buildDir);
  if (hasBuild) return;
  if (!QUIET_MODE) console.log("🏗️  No build found, running npm run build for link check...");
  await runCommand("npm", ["run", "build"], { label: "npm run build" });
}

async function ensureSiteServer() {
  let healthy = false;
  try {
    const res = await fetchWithTimeout(BASE_URL, "HEAD");
    healthy = res && res.ok;
  } catch {
    healthy = false;
  }

  if (healthy) return null;

  await ensureBuildExists();
  const port = sitePortFromBase();
  const server = startStaticServer("./build", port, { quiet: QUIET_MODE });
  await waitForServer(BASE_URL);
  if (!QUIET_MODE) {
    console.log(`✅ Started static server for link check at ${BASE_URL}`);
  }
  return server;
}

function fileExistsForPath(pathname) {
  const clean = pathname.replace(/^\/+/, "").replace(/\/$/, "");
  const dirPath = path.join(process.cwd(), "build", clean);
  const indexPath = path.join(dirPath, "index.html");
  const directHtml = path.join(process.cwd(), "build", `${clean}.html`);
  return fs.existsSync(indexPath) || fs.existsSync(directHtml);
}

function getUrlsFromSitemap(baseUrl) {
  const candidates = [
    path.join(process.cwd(), "build", "sitemap-0.xml"),
    path.join(process.cwd(), "build", "sitemap.xml")
  ];
  const sitemapPath = candidates.find(fs.existsSync);
  if (!sitemapPath) return [];
  try {
    const xml = fs.readFileSync(sitemapPath, "utf8");
    const $ = loadHtml(xml, { xmlMode: true });
    const urls = new Set();
    $("loc").each((_, el) => {
      const loc = $(el).text().trim();
      if (!loc) return;
      let pathname;
      try {
        pathname = new URL(loc).pathname;
      } catch {
        return;
      }
      if (!pathname.startsWith("/en") && !pathname.startsWith("/fr")) return;
      if (!fileExistsForPath(pathname)) return;
      const target = new URL(pathname, baseUrl).toString();
      urls.add(normalizeUrl(target));
    });
    return Array.from(urls).sort();
  } catch {
    return [];
  }
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

function isInternal(url) {
  return normalizeUrl(url).startsWith(normalizeUrl(BASE_URL));
}

function loadUrlsFromFile(file, baseUrl) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((u) => {
          try {
            return normalizeUrl(new URL(u, baseUrl).toString());
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }
  } catch {
    // ignore
  }
  return [];
}

async function fetchWithTimeout(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(url, { method, redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkLink(url, isExternal) {
  const normalized = normalizeUrl(url);
  if (linkCache.has(normalized)) return linkCache.get(normalized);

  if (isExternal && !CHECK_EXTERNAL) {
    const skipped = { url: normalized, ok: true, skipped: true, isExternal, status: 0 };
    linkCache.set(normalized, skipped);
    return skipped;
  }

  let res;
  let error;

  try {
    res = await fetchWithTimeout(normalized, "HEAD");
    if (!res.ok && res.status >= 400) {
      // try GET in case HEAD is blocked
      res = await fetchWithTimeout(normalized, "GET");
    }
  } catch (err) {
    error = err;
  }

  if (!res) {
    const result = {
      url: normalized,
      ok: false,
      status: 0,
      error: error?.message || "Request failed",
      isExternal
    };
    linkCache.set(normalized, result);
    return result;
  }

  const result = { url: normalized, ok: res.ok, status: res.status, isExternal, finalUrl: res.url };
  linkCache.set(normalized, result);
  return result;
}

async function crawl() {
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
    const $ = loadHtml(html);

    $("a[href]").each((_, el) => {
      let href = $(el).attr("href");
      if (!href) return;
      if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return;

      let absolute;
      try {
        absolute = href.startsWith("http") ? href : new URL(href, url).toString();
      } catch {
        return;
      }

      if (!isInternal(absolute)) return;
      const normalized = normalizeUrl(absolute);
      if (!visited.has(normalized) && !toVisit.has(normalized)) {
        toVisit.add(normalized);
      }
    });
  }

  return Array.from(visited).sort();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSelector($, el) {
  const parts = [];
  let current = el;
  while (current && current.type === "tag") {
    const name = (current.name || "").toLowerCase() || "elem";
    const id = current.attribs?.id;
    const classes = (current.attribs?.class || "").split(/\s+/).filter(Boolean);
    if (id) {
      parts.unshift(`${name}#${id}`);
      break;
    }
    let piece = name;
    if (classes.length) {
      piece += `.${classes[0]}`;
    }
    const siblings =
      current.parent?.children?.filter(
        (child) => child.type === "tag" && child.name === current.name
      ) || [];
    if (siblings.length > 1) {
      const index = siblings.indexOf(current);
      if (index >= 0) piece += `:nth-of-type(${index + 1})`;
    }
    parts.unshift(piece);
    current = current.parent;
  }
  return parts.length ? parts.join(" > ") : "unknown";
}

function writeMarkdown(pages, broken, skippedExternal, reportDir) {
  const lines = ["# Link check report", ""];
  lines.push(`Pages crawled: ${pages.length}`);
  lines.push(`Broken links: ${broken.length}`);
  if (skippedExternal > 0) {
    lines.push(
      `External links skipped (set CHECK_EXTERNAL_LINKS=1 to include): ${skippedExternal}`
    );
  }
  lines.push("");

  if (broken.length === 0) {
    lines.push("✅ No broken links found.");
  } else {
    for (const issue of broken) {
      lines.push(
        `- ${issue.pageUrl} → ${issue.linkUrl} (status: ${issue.status || "failed"}${issue.isExternal ? ", external" : ""})`
      );
      if (issue.selector) lines.push(`  - Selector: \`${issue.selector}\``);
      if (issue.text) lines.push(`  - Text: ${issue.text}`);
      if (issue.error) lines.push(`  - Error: ${issue.error}`);
    }
  }

  const summaryPath = path.join(reportDir, "SUMMARY.md");
  fs.writeFileSync(summaryPath, lines.join("\n"), "utf8");
  return summaryPath;
}

function writeHtml(pages, broken, skippedExternal, reportDir, { brokenOnly = false } = {}) {
  const filteredPages = brokenOnly
    ? pages
        .map((page) => {
          const brokenLinks = page.links.filter((l) => !l.ok && !l.skipped);
          return brokenLinks.length ? { ...page, links: brokenLinks } : null;
        })
        .filter(Boolean)
    : pages;

  const sections = filteredPages
    .map((page) => {
      const rows = page.links.length
        ? page.links
            .map((link) => {
              const cls = !link.ok ? "error" : link.skipped ? "skipped" : "ok";
              const statusText = link.skipped
                ? "skipped"
                : link.status
                  ? `${link.status}${link.isExternal ? " · external" : ""}`
                  : link.isExternal
                    ? "external"
                    : "unknown";
              const selector = link.selector
                ? `<div class="selector">${escapeHtml(link.selector)}</div>`
                : "";
              const text = link.text ? `<div class="selector">${escapeHtml(link.text)}</div>` : "";
              return `<li class="${cls}">
                <div class="url">${escapeHtml(link.linkUrl)}</div>
                <div class="meta">${escapeHtml(statusText)}</div>
                ${selector}
                ${text}
                ${link.error ? `<div class="err">Error: ${escapeHtml(link.error)}</div>` : ""}
              </li>`;
            })
            .join("")
        : '<li class="ok">No links found</li>';

      const brokenCount = page.links.filter((l) => !l.ok && !l.skipped).length;
      return `
        <section class="page">
          <h2>${escapeHtml(page.url)}</h2>
          <div class="counts"><span class="${brokenCount ? "error" : "ok"}">${brokenCount} broken</span></div>
          <ul class="links">${rows}</ul>
        </section>
      `;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Link check report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #0b1021; color: #e8ecf5; }
    h1 { margin-bottom: 0; }
    .summary { margin: 0 0 20px; color: #9fb3ff; }
    .page { background: #11172d; border: 1px solid #1f2a45; border-radius: 8px; padding: 16px; margin-bottom: 18px; }
    .page h2 { margin: 0 0 6px; font-size: 18px; }
    .counts { font-size: 13px; margin-bottom: 10px; }
    .links { list-style: none; padding: 0; margin: 0; }
    .links li { border-top: 1px solid #1f2a45; padding: 10px 0; }
    .links li:first-child { border-top: none; }
    .links li.ok .url { color: #9ef5a1; }
    .links li.error .url { color: #ff8a8a; }
    .links li.skipped .url { color: #ffd27f; }
    .meta { font-size: 12px; color: #b8c4ff; margin-top: 4px; }
    .err { color: #ff8a8a; font-size: 13px; margin-top: 4px; }
    a { color: #9fb3ff; }
  </style>
</head>
<body>
  <h1>Link check report</h1>
  <p class="summary">${filteredPages.length} pages · ${broken.length} broken links${skippedExternal ? ` · ${skippedExternal} external skipped` : ""}</p>
  ${sections || '<p class="summary">No broken links.</p>'}
</body>
</html>`;

  const htmlPath = path.join(reportDir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

async function main() {
  ensureReportDirClean(REPORT_DIR);

  if (!CHECK_EXTERNAL && !QUIET_MODE) {
    console.log("ℹ️  External links will be skipped (set CHECK_EXTERNAL_LINKS=1 to include).");
  }

  let server = null;
  try {
    try {
      server = await ensureSiteServer();
    } catch (err) {
      console.error(`❌ Unable to start or reach site server at ${BASE_URL}: ${err.message}`);
      throw err;
    }

    let pages = [];
    if (URLS_FILE) {
      if (!QUIET_MODE) console.log(`🔍 Loading URLs from ${URLS_FILE} for link check...`);
      pages = loadUrlsFromFile(URLS_FILE, BASE_URL);
    }
    if (!pages.length) {
      pages = getUrlsFromSitemap(BASE_URL);
    }
    if (!pages.length) {
      if (!QUIET_MODE) console.log(`🔍 Crawling site for link check at ${BASE_URL}...`);
      pages = await crawl();
    }
    if (!QUIET_MODE) {
      console.log(`✅ Found ${pages.length} pages:`);
      pages.forEach((u) => console.log("  -", u));
    }

    const pageResults = [];
    let skippedExternal = 0;

    for (const pageUrl of pages) {
      let res;
      try {
        res = await fetch(pageUrl);
      } catch (err) {
        console.error(`❌ Failed to fetch ${pageUrl}: ${err.message}`);
        pageResults.push({
          url: pageUrl,
          links: [{ linkUrl: pageUrl, ok: false, status: 0, error: err.message, isExternal: false }]
        });
        continue;
      }

      const html = await res.text();
      const $ = loadHtml(html);
      const links = [];

      $("a[href]").each((_, el) => {
        let href = $(el).attr("href");
        if (!href) return;
        if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return;

        let absolute;
        try {
          absolute = href.startsWith("http") ? href : new URL(href, pageUrl).toString();
        } catch {
          return;
        }

        const normalized = normalizeUrl(absolute);
        const isExternal = !isInternal(normalized);
        const selector = buildSelector($, el);
        const text = ($(el).text() || "").trim().slice(0, 120);
        links.push({ linkUrl: normalized, isExternal, selector, text: text || undefined });
      });

      const uniqueUrls = Array.from(new Set(links.map((l) => l.linkUrl)));
      const resultsByUrl = new Map();
      for (const url of uniqueUrls) {
        const sample = links.find((l) => l.linkUrl === url);
        const result = await checkLink(url, sample?.isExternal);
        resultsByUrl.set(url, result);
      }

      const evaluated = [];
      for (const link of links) {
        const result = resultsByUrl.get(link.linkUrl);
        evaluated.push({ ...link, ...result });
        if (result.skipped) skippedExternal += 1;
      }

      pageResults.push({ url: pageUrl, links: evaluated });
    }

    const broken = pageResults.flatMap((page) =>
      page.links
        .filter((l) => !l.ok && !l.skipped)
        .map((l) => ({
          pageUrl: page.url,
          linkUrl: l.linkUrl,
          status: l.status,
          error: l.error,
          isExternal: l.isExternal,
          selector: l.selector,
          text: l.text
        }))
    );

    ensureDir(REPORT_DIR);

    const summaryPath = writeMarkdown(pageResults, broken, skippedExternal, REPORT_DIR);
    const htmlPath = writeHtml(pageResults, broken, skippedExternal, REPORT_DIR, {
      brokenOnly: QUIET_MODE
    });
    const jsonPath = path.join(REPORT_DIR, "links.json");
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ pages: pageResults, broken, skippedExternal }, null, 2),
      "utf8"
    );

    if (QUIET_MODE) {
      if (broken.length === 0) {
        console.log("\n🎉 Link check passed: no broken links found.");
      } else {
        console.log(`\n🚫 Broken links (${broken.length}):`);
        broken.forEach((issue) => {
          const statusText = issue.status ? `status ${issue.status}` : issue.error || "failed";
          const scope = issue.isExternal ? "external" : "internal";
          console.log(`- ${issue.pageUrl} → ${issue.linkUrl} (${statusText}, ${scope})`);
        });
        console.log(`Details saved to ${summaryPath}`);
      }
    } else {
      console.log(`\n📄 Link check summary (md): ${summaryPath}`);
      console.log(`📄 Link check report (html): ${htmlPath}`);
      console.log(`📄 Link data (json): ${jsonPath}`);
    }

    if (broken.length > 0) {
      if (!QUIET_MODE) {
        console.error(`\n🚫 Link check failed: ${broken.length} broken links found.`);
      }
      process.exitCode = 1;
    } else {
      if (!QUIET_MODE) {
        console.log("\n🎉 Link check passed: no broken links found.");
      }
    }
  } finally {
    if (server && !server.killed) {
      server.kill("SIGINT");
    }
  }
}

main().catch((err) => {
  console.error("Unexpected error in link check script:", err);
  process.exit(1);
});
