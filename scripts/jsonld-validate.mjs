#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import Validator from "@adobe/structured-data-validator";
import WebAutoExtractor from "@marbec/web-auto-extractor";

const argv = process.argv.slice(2);
const targetDir = path.resolve(
  process.cwd(),
  firstPositionalArg(argv) || "build",
);
const urlsFile = resolveUrlsFileArg(argv);
const schemaUrl =
  process.env.SCHEMA_ORG_URL ||
  "https://schema.org/version/latest/schemaorg-all-https.jsonld";
const schemaCachePath = path.join(
  process.cwd(),
  ".yws-cache",
  "schemaorg-all-https.jsonld",
);
const schemaFile = resolveSchemaFileArg(argv);

function firstPositionalArg(args) {
  return args.find((arg) => !arg.startsWith("--"));
}

function resolveUrlsFileArg(args) {
  const equals = args.find((arg) => arg.startsWith("--urls-file="));
  if (equals) return equals.split("=")[1];
  const flagIndex = args.indexOf("--urls-file");
  if (flagIndex > -1 && args[flagIndex + 1]) return args[flagIndex + 1];
  return path.join(process.cwd(), "reports", "urls.json");
}

function resolveSchemaFileArg(args) {
  const equals = args.find((arg) => arg.startsWith("--schema-file="));
  if (equals) return equals.split("=")[1];
  const flagIndex = args.indexOf("--schema-file");
  if (flagIndex > -1 && args[flagIndex + 1]) return args[flagIndex + 1];
  return null;
}

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

function formatPath(pathValue) {
  if (!Array.isArray(pathValue) || pathValue.length === 0) return "";
  return pathValue
    .map((segment) => {
      if (typeof segment === "string") return segment;
      if (segment && typeof segment === "object") {
        const type = segment.type || segment.key || "node";
        const index =
          Number.isInteger(segment.index) && segment.index >= 0
            ? `[${segment.index}]`
            : "";
        return `${type}${index}`;
      }
      return String(segment);
    })
    .join(" > ");
}

function normalizeIssue(issue) {
  return {
    issueMessage: issue?.issueMessage || issue?.message || "Validation issue",
    severity: String(issue?.severity || "ERROR").toUpperCase(),
    path: issue?.path,
    fieldNames: Array.isArray(issue?.fieldNames) ? issue.fieldNames : [],
    location: issue?.location,
  };
}

function normalizeIssues(result) {
  if (Array.isArray(result)) return result.map(normalizeIssue);
  if (Array.isArray(result?.issues)) return result.issues.map(normalizeIssue);
  return [];
}

async function fetchSchemaJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while fetching schema`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
}

async function loadSchemaOrgJson() {
  if (schemaFile) {
    if (!fs.existsSync(schemaFile)) {
      throw new Error(`Schema file not found: ${schemaFile}`);
    }
    return readJson(schemaFile);
  }

  try {
    const schema = await fetchSchemaJson(schemaUrl);
    writeJson(schemaCachePath, schema);
    return schema;
  } catch (error) {
    if (fs.existsSync(schemaCachePath)) {
      console.warn(
        `⚠️ Could not fetch schema.org JSON-LD (${error?.message || error}). Using cached schema: ${schemaCachePath}`,
      );
      return readJson(schemaCachePath);
    }
    throw error;
  }
}

async function main() {
  if (!fs.existsSync(targetDir)) {
    console.error(
      `❌ Target directory not found: ${targetDir}. Did you run "npm run build" first?`,
    );
    process.exit(1);
  }

  const htmlFiles = loadHtmlFilesFromUrls() || readHtmlFiles(targetDir);
  if (!htmlFiles.length) {
    console.warn(`⚠️ No HTML files found under ${targetDir}`);
    return;
  }

  const schemaOrgJson = await loadSchemaOrgJson();
  const validator = new Validator(schemaOrgJson);
  const extractor = new WebAutoExtractor({
    addLocation: true,
    embedSource: ["rdfa", "microdata"],
  });

  const issues = [];
  for (const file of htmlFiles) {
    if (
      file === path.join(targetDir, "index.html") ||
      file.startsWith(path.join(targetDir, "admin"))
    ) {
      continue;
    }

    const html = fs.readFileSync(file, "utf8");
    let validationResult;
    try {
      const extracted = extractor.parse(html);
      validationResult = await validator.validate(extracted);
    } catch (error) {
      issues.push({
        file,
        severity: "ERROR",
        issueMessage: `Validator crashed: ${error?.message || error}`,
        fieldNames: [],
        path: [],
        location: null,
      });
      continue;
    }

    const fileIssues = normalizeIssues(validationResult).map((issue) => ({
      ...issue,
      file,
    }));
    issues.push(...fileIssues);
  }

  if (issues.length > 0) {
    const errorIssues = issues.filter((i) => i.severity === "ERROR");
    const warningIssues = issues.filter((i) => i.severity === "WARNING");
    const filesWithErrors = new Set(errorIssues.map((i) => i.file)).size;
    const filesWithWarnings = new Set(warningIssues.map((i) => i.file)).size;

    console.error(
      `❌ JSON-LD validation found ${filesWithErrors} page(s) with errors` +
        (filesWithWarnings ? ` and ${filesWithWarnings} with warnings.` : "."),
    );

    issues.forEach((issue) => {
      console.error(`\n🔗 ${issue.file}`);
      const prefix = issue.severity === "WARNING" ? "⚠️" : "✖";
      console.error(`  ${prefix} ${issue.issueMessage}`);
      if (issue.fieldNames?.length) {
        console.error(`    fields: ${issue.fieldNames.join(", ")}`);
      }
      const pathLabel = formatPath(issue.path);
      if (pathLabel) {
        console.error(`    path: ${pathLabel}`);
      }
      if (issue.location) {
        console.error(`    location: ${issue.location}`);
      }
    });

    if (errorIssues.length) {
      process.exit(1);
    }
  } else {
    console.log(
      `✅ JSON-LD validation passed for ${htmlFiles.length} HTML file(s).`,
    );
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err?.message || err}`);
  process.exit(1);
});
