#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { structuredDataTestHtml } = require("structured-data-testing-tool");
const { Google, Twitter, Facebook } = require("structured-data-testing-tool/presets");

const args = process.argv.slice(2);
const targetDir = path.resolve(process.cwd(), args.find((arg) => !arg.startsWith("--")) || "build");
const urlsFile =
  args.find((arg) => arg.startsWith("--urls-file="))?.split("=")[1] ||
  path.join(process.cwd(), "reports", "urls.json");
const presets = [Google, Twitter, Facebook].filter(Boolean);

function normalizePath(p) {
  return p.replace(/\/+$/, "");
}

function filePathForUrl(urlString) {
  try {
    const url = new URL(urlString);
    const cleanPath = normalizePath(url.pathname || "/");
    const asDir = path.join(targetDir, cleanPath);
    const htmlInDir = path.join(asDir, "index.html");
    const directHtml = path.join(targetDir, `${cleanPath}.html`);
    if (fs.existsSync(htmlInDir)) return htmlInDir;
    if (fs.existsSync(directHtml)) return directHtml;
    return null;
  } catch {
    return null;
  }
}

function loadHtmlFilesFromUrls() {
  if (!urlsFile || !fs.existsSync(urlsFile)) return null;
  try {
    const urls = JSON.parse(fs.readFileSync(urlsFile, "utf8"));
    if (!Array.isArray(urls)) return null;
    const files = urls
      .map(filePathForUrl)
      .filter(Boolean)
      .filter((file, idx, arr) => arr.indexOf(file) === idx);
    return files;
  } catch {
    return null;
  }
}

function readHtmlFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return readHtmlFiles(full);
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      return [full];
    }
    return [];
  });
}

function formatTest(test) {
  const pathLabel = test.test || test.description || "Unknown test";
  const message =
    test?.error?.message || test?.message || test?.error || test?.expect || "Validation failed";
  const groups = Array.isArray(test?.groups) ? test.groups.join(" > ") : test.group || "";
  return `${groups ? `${groups}: ` : ""}${pathLabel} — ${message}`;
}

async function validateFile(file, issues) {
  const html = fs.readFileSync(file, "utf8");
  let result;

  try {
    result = await structuredDataTestHtml(html, {
      url: `file://${file}`,
      presets
    });
  } catch (err) {
    if (err?.type === "VALIDATION_FAILED" && err.res) {
      result = err.res;
    } else {
      issues.push({
        file,
        level: "error",
        message: `Validator crashed: ${err?.message || err}`
      });
      return;
    }
  }

  const failed = Array.isArray(result?.failed) ? result.failed : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

  if (!failed.length && !warnings.length) return;

  issues.push({
    file,
    level: failed.length ? "error" : "warning",
    errors: failed.map(formatTest),
    warnings: warnings.map(formatTest)
  });
}

async function main() {
  if (!fs.existsSync(targetDir)) {
    console.error(
      `❌ Target directory not found: ${targetDir}. Did you run "npm run build" first?`
    );
    process.exit(1);
  }

  const htmlFiles = loadHtmlFilesFromUrls() || readHtmlFiles(targetDir);
  if (!htmlFiles.length) {
    console.warn(`⚠️ No HTML files found under ${targetDir}`);
    return;
  }

  const issues = [];
  for (const file of htmlFiles) {
    if (
      file === path.join(targetDir, "index.html") ||
      file.startsWith(path.join(targetDir, "admin"))
    ) {
      continue;
    }
    await validateFile(file, issues);
  }

  if (issues.length) {
    const withErrors = issues.filter((i) => i.level === "error" && i.errors?.length);
    const withWarnings = issues.filter((i) => i.warnings?.length);

    console.error(
      `❌ JSON-LD validation found ${withErrors.length} page(s) with errors` +
        (withWarnings.length ? ` and ${withWarnings.length} with warnings.` : ".")
    );

    issues.forEach((issue) => {
      const errors = issue.errors || [];
      const warnings = issue.warnings || [];
      console.error(`\n🔗 ${issue.file}`);
      if (errors.length) {
        errors.forEach((err) => console.error(`  ✖ ${err}`));
      }
      if (warnings.length) {
        warnings.forEach((warn) => console.error(`  ⚠️ ${warn}`));
      }
      if (issue.message && !errors.length && !warnings.length) {
        console.error(`  ✖ ${issue.message}`);
      }
    });

    if (withErrors.length) {
      process.exit(1);
    }
  } else {
    console.log(`✅ JSON-LD validation passed for ${htmlFiles.length} HTML file(s).`);
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err?.message || err}`);
  process.exit(1);
});
