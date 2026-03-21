#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { parse } from "node-html-parser";
import puppeteer from "puppeteer";

const DEFAULT_REPORT_DIR = path.join(process.cwd(), "reports", "form");

function parseArgs(argv = []) {
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if ((arg === "--base" || arg === "-b") && argv[i + 1]) {
      options.base = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
      continue;
    }

    if ((arg === "--urls-file" || arg === "-u") && argv[i + 1]) {
      options.urlsFile = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--urls-file=")) {
      options.urlsFile = arg.slice("--urls-file=".length);
      continue;
    }

    if ((arg === "--report-dir" || arg === "-o") && argv[i + 1]) {
      options.reportDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--report-dir=")) {
      options.reportDir = arg.slice("--report-dir=".length);
      continue;
    }

    if (arg === "--quiet" || arg === "-q") {
      options.quiet = true;
    }

    if ((arg === "--migrate-legacy-forms" || arg === "-m") && argv[i + 1]) {
      options.migrateLegacyForms = String(argv[i + 1]).toLowerCase();
      i += 1;
      continue;
    }
    if (arg.startsWith("--migrate-legacy-forms=")) {
      options.migrateLegacyForms = String(
        arg.slice("--migrate-legacy-forms=".length),
      ).toLowerCase();
      continue;
    }
  }

  return options;
}

function prepareReportDir(dirPath) {
  const reportDir = String(dirPath || DEFAULT_REPORT_DIR);
  fs.mkdirSync(reportDir, { recursive: true });

  const artifacts = [
    "stats.json",
    "issues.json",
    "results.json",
    "SUMMARY.md",
    "report.html",
  ];
  for (const name of artifacts) {
    const target = path.join(reportDir, name);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }
  }

  return reportDir;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeUrl(input) {
  try {
    const parsed = new URL(String(input || "").trim());
    parsed.hash = "";
    let normalized = parsed.toString();
    if (normalized.endsWith("/") && parsed.pathname !== "/") {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function loadUrlsFromFile(filePath) {
  if (!filePath) {
    throw new Error("Missing required option: --urls-file");
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`URLs file not found: ${filePath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in URLs file: ${error?.message || error}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("URLs file must be a JSON array.");
  }

  const unique = new Set();
  for (const entry of parsed) {
    const normalized = normalizeUrl(entry);
    if (normalized) unique.add(normalized);
  }
  return Array.from(unique);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function listFormDefinitionFiles(baseDir) {
  if (!baseDir || !fs.existsSync(baseDir)) return [];
  const stack = [baseDir];
  const out = [];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(json|ya?ml)$/i.test(entry.name)) continue;
      out.push(fullPath);
    }
  }

  out.sort();
  return out;
}

function detectFormSourceLayout(projectRoot = process.cwd()) {
  const srcFormsDir = path.join(projectRoot, "src", "forms");
  const legacyFormsDir = path.join(projectRoot, "src", "content", "forms");
  const srcContentDir = path.join(projectRoot, "src", "content");

  const srcFormsFiles = listFormDefinitionFiles(srcFormsDir);
  const legacyFormsFiles = listFormDefinitionFiles(legacyFormsDir);
  const alerts = [];
  const notices = [];
  const recommendations = [];

  if (legacyFormsFiles.length > 0) {
    alerts.push({
      type: "legacy-forms-path",
      severity: "warning",
      message:
        "Legacy form folder detected at /src/content/forms. Migrate forms to /src/forms.",
    });
    recommendations.push(
      "Move files from /src/content/forms to /src/forms, then remove /src/content if no longer needed.",
    );
  }

  if (srcFormsFiles.length === 0) {
    notices.push({
      type: "missing-forms-config",
      severity: "info",
      message: "No form definition files were found under /src/forms.",
    });
  }

  return {
    srcFormsDir,
    srcContentDir,
    legacyFormsDir,
    srcFormsExists: fs.existsSync(srcFormsDir),
    legacyFormsExists: fs.existsSync(legacyFormsDir),
    srcFormsFiles,
    legacyFormsFiles,
    alerts,
    notices,
    recommendations,
  };
}

async function askYesNo(message, { quiet = false } = {}) {
  if (quiet || !process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question(`${message} [y/N]: `))
      .trim()
      .toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function listAllFiles(baseDir) {
  if (!baseDir || !fs.existsSync(baseDir)) return [];
  const stack = [baseDir];
  const out = [];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  out.sort();
  return out;
}

function maybeRemoveDirIfEmpty(targetDir) {
  if (!targetDir || !fs.existsSync(targetDir)) return;
  const entries = fs.readdirSync(targetDir);
  if (entries.length === 0) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

function migrateLegacyFormsLayout(layout = {}) {
  const legacyFormsDir = String(layout?.legacyFormsDir || "");
  const srcFormsDir = String(layout?.srcFormsDir || "");
  const srcContentDir = String(layout?.srcContentDir || "");

  if (!legacyFormsDir || !fs.existsSync(legacyFormsDir)) {
    return { movedFiles: 0, mode: "none" };
  }

  fs.mkdirSync(srcFormsDir, { recursive: true });
  const sourceFiles = listAllFiles(legacyFormsDir);
  const conflicts = [];
  for (const sourceFile of sourceFiles) {
    const rel = path.relative(legacyFormsDir, sourceFile);
    const target = path.join(srcFormsDir, rel);
    if (fs.existsSync(target)) conflicts.push(rel);
  }
  if (conflicts.length > 0) {
    throw new Error(
      `Cannot migrate legacy forms because destination already contains conflicting files: ${conflicts.slice(0, 8).join(", ")}`,
    );
  }

  for (const sourceFile of sourceFiles) {
    const rel = path.relative(legacyFormsDir, sourceFile);
    const target = path.join(srcFormsDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(sourceFile, target);
  }

  if (fs.existsSync(legacyFormsDir)) {
    fs.rmSync(legacyFormsDir, { recursive: true, force: true });
  }
  maybeRemoveDirIfEmpty(path.dirname(legacyFormsDir));
  maybeRemoveDirIfEmpty(srcContentDir);

  return { movedFiles: sourceFiles.length, mode: "merge" };
}

function writePlaceholderReport(reportDir, payload = {}) {
  const stats = payload?.stats || {};
  const issues = Array.isArray(payload?.issues) ? payload.issues : [];
  const testCases = Array.isArray(payload?.testCases) ? payload.testCases : [];
  const preflight = payload?.preflight || {};
  const preflightAlerts = Array.isArray(preflight?.alerts)
    ? preflight.alerts
    : [];
  const preflightNotices = Array.isArray(preflight?.notices)
    ? preflight.notices
    : [];
  const recommendations = Array.isArray(preflight?.recommendations)
    ? preflight.recommendations
    : [];
  const execution = payload?.execution || {};
  const frontendProbeResults = Array.isArray(payload?.frontendProbeResults)
    ? payload.frontendProbeResults
    : [];
  const apiProbeResults = Array.isArray(payload?.apiProbeResults)
    ? payload.apiProbeResults
    : [];
  const formA11yResults = Array.isArray(payload?.formA11yResults)
    ? payload.formA11yResults
    : [];

  const frontendRows = frontendProbeResults
    .map(
      (item) => `<tr>
  <td>${escapeHtml(item?.pageUrl || "")}</td>
  <td>${escapeHtml(item?.formIndex ?? "")}</td>
  <td>${escapeHtml(item?.success ? "pass" : "fail")}</td>
  <td>${escapeHtml(item?.snapshot?.validation?.requiredCount ?? 0)}</td>
  <td>${escapeHtml(item?.snapshot?.validation?.requiredInvalidCount ?? 0)}</td>
  <td>${escapeHtml(item?.error || "")}</td>
</tr>`,
    )
    .join("\n");

  const apiRows = apiProbeResults
    .map(
      (item) => `<tr>
  <td>${escapeHtml(item?.pageUrl || "")}</td>
  <td>${escapeHtml(item?.formIndex ?? "")}</td>
  <td>${escapeHtml(item?.assertions?.validExpectedSuccess ? "pass" : "fail")}</td>
  <td>${escapeHtml(item?.assertions?.invalidExpectedFailure ? "pass" : "fail")}</td>
  <td>${escapeHtml(item?.validProbe?.status ?? "")}/${escapeHtml(item?.invalidProbe?.status ?? "")}</td>
  <td>${escapeHtml(item?.validProbe?.contentType || "")}</td>
  <td>${escapeHtml(item?.validProbe?.error || item?.invalidProbe?.error || "")}</td>
</tr>`,
    )
    .join("\n");

  const a11yRows = formA11yResults
    .map(
      (item) => `<tr>
  <td>${escapeHtml(item?.pageUrl || "")}</td>
  <td>${escapeHtml(item?.formId || "")}</td>
  <td>${escapeHtml(item?.selector || "")}</td>
  <td>${escapeHtml(item?.violationCount ?? 0)}</td>
  <td>${escapeHtml(item?.status || (item?.success ? "pass" : "fail"))}</td>
  <td>${escapeHtml(item?.message || "")}</td>
  <td>${escapeHtml(item?.outputPath || "")}</td>
</tr>`,
    )
    .join("\n");
  const issueRows = issues
    .map(
      (issue) => `<tr>
  <td>${escapeHtml(issue?.type || "")}</td>
  <td>${escapeHtml(issue?.pageUrl || "")}</td>
  <td>${escapeHtml(issue?.formIndex ?? "")}</td>
  <td>${escapeHtml(issue?.message || "")}</td>
</tr>`,
    )
    .join("\n");
  const preflightRows = preflightAlerts
    .map(
      (item) => `<tr>
  <td>${escapeHtml(item?.severity || "warning")}</td>
  <td>${escapeHtml(item?.type || "")}</td>
  <td>${escapeHtml(item?.message || "")}</td>
</tr>`,
    )
    .join("\n");
  const preflightNoticeRows = preflightNotices
    .map(
      (item) => `<tr>
  <td>${escapeHtml(item?.severity || "info")}</td>
  <td>${escapeHtml(item?.type || "")}</td>
  <td>${escapeHtml(item?.message || "")}</td>
</tr>`,
    )
    .join("\n");
  const recommendationRows = recommendations
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  const testCaseRows = testCases
    .map(
      (entry) => `<tr>
  <td>${escapeHtml(entry?.pageUrl || "")}</td>
  <td>${escapeHtml(entry?.formIndex ?? "")}</td>
  <td>${escapeHtml(entry?.testType || "")}</td>
  <td>${escapeHtml(entry?.status || "")}</td>
  <td>${escapeHtml(entry?.message || "")}</td>
</tr>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Form tests report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #111827; }
    h1,h2 { margin-bottom: 8px; }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 20px; }
    .chip { border: 1px solid #d1d5db; border-radius: 999px; padding: 4px 10px; font-size: 12px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f9fafb; }
  </style>
</head>
<body>
  <h1>Form tests report</h1>
  <div class="chips">
    <span class="chip">URLs tested: ${escapeHtml(stats.urlsTested ?? 0)}</span>
    <span class="chip">Forms: ${escapeHtml(stats.totalForms ?? 0)}</span>
    <span class="chip">Tests run: ${escapeHtml(stats.testsRun ?? 0)}</span>
    <span class="chip">Failed assertions: ${escapeHtml(stats.failed ?? 0)}</span>
    <span class="chip">Preflight failures: ${escapeHtml(stats.preflightFailed ?? 0)}</span>
    <span class="chip">Alerts: ${escapeHtml(stats.alerts ?? 0)}</span>
    <span class="chip">Skipped: ${escapeHtml(stats.skipped ? "yes" : "no")}</span>
    <span class="chip">Test cases: ${escapeHtml(testCases.length)}</span>
  </div>

  <p><strong>Execution status:</strong> ${escapeHtml(execution?.status || "completed")}${execution?.reason ? ` - ${escapeHtml(execution.reason)}` : ""}</p>

  <h2>Preflight checks</h2>
  <table>
    <thead>
      <tr><th>Severity</th><th>Type</th><th>Message</th></tr>
    </thead>
    <tbody>${preflightRows || '<tr><td colspan="3">No preflight alerts.</td></tr>'}</tbody>
  </table>
  <table>
    <thead>
      <tr><th>Severity</th><th>Type</th><th>Message</th></tr>
    </thead>
    <tbody>${preflightNoticeRows || '<tr><td colspan="3">No preflight notices.</td></tr>'}</tbody>
  </table>
  ${recommendationRows ? `<p><strong>Recommendations</strong></p><ul>${recommendationRows}</ul>` : ""}

  <h2>Test cases</h2>
  <table>
    <thead>
      <tr><th>Page</th><th>Form index</th><th>Test type</th><th>Status</th><th>Result details</th></tr>
    </thead>
    <tbody>${testCaseRows || '<tr><td colspan="5">No test cases.</td></tr>'}</tbody>
  </table>

  <h2>Frontend validation probes</h2>
  <table>
    <thead>
      <tr><th>Page</th><th>Form index</th><th>Status</th><th>Required fields</th><th>Required invalid</th><th>Error</th></tr>
    </thead>
    <tbody>${frontendRows || '<tr><td colspan="6">No frontend probes.</td></tr>'}</tbody>
  </table>

  <h2>API probes</h2>
  <table>
    <thead>
      <tr><th>Page</th><th>Form index</th><th>Valid probe</th><th>Invalid probe</th><th>Status codes</th><th>Content-Type</th><th>Error</th></tr>
    </thead>
    <tbody>${apiRows || '<tr><td colspan="7">No API probes.</td></tr>'}</tbody>
  </table>

  <h2>Form accessibility (aXe, form scope only)</h2>
  <table>
    <thead>
      <tr><th>Page</th><th>Form id</th><th>Selector</th><th>Violations</th><th>Status</th><th>Details</th><th>Artifact</th></tr>
    </thead>
    <tbody>${a11yRows || '<tr><td colspan="7">No form a11y probes.</td></tr>'}</tbody>
  </table>

  <h2>Failure details</h2>
  <table>
    <thead>
      <tr><th>Type</th><th>Page</th><th>Form index</th><th>Message</th></tr>
    </thead>
    <tbody>${issueRows || '<tr><td colspan="4">No failures.</td></tr>'}</tbody>
  </table>

  <h2>Test type legend</h2>
  <table>
    <thead>
      <tr><th>Test type</th><th>Meaning</th></tr>
    </thead>
    <tbody>
      <tr><td>preflight</td><td>Project structure checks before probes start (for example legacy forms folder detection).</td></tr>
      <tr><td>frontend</td><td>Browser-side required-field validation behavior on discovered forms.</td></tr>
      <tr><td>api-valid</td><td>Submission with a valid payload, expected to succeed with JSON success response.</td></tr>
      <tr><td>api-invalid</td><td>Submission with invalid payload (required fields emptied), expected to fail validation.</td></tr>
      <tr><td>a11y</td><td>Accessibility scan (aXe WCAG 2.1 A/AA tags) scoped to each discovered form selector (form#id).</td></tr>
      <tr><td>suite</td><td>Global form-test execution state (for example skipped with reason).</td></tr>
    </tbody>
  </table>
</body>
</html>`;
  fs.writeFileSync(path.join(reportDir, "report.html"), html, "utf8");
}

async function discoverForms(urls = [], { quiet = false } = {}) {
  const discovered = [];

  for (const url of urls) {
    let html = "";
    try {
      const res = await fetch(url);
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      if (!res.ok || !contentType.includes("text/html")) {
        if (!quiet) {
          console.log(`Skipping non-HTML URL: ${url}`);
        }
        continue;
      }
      html = await res.text();
    } catch (error) {
      if (!quiet) {
        console.log(`Failed to fetch ${url}: ${error?.message || error}`);
      }
      continue;
    }

    const root = parse(html);
    const forms = root.querySelectorAll("form");
    for (let i = 0; i < forms.length; i += 1) {
      const form = forms[i];
      const rawAction = form.getAttribute("action") || "";
      let actionUrl = "";
      if (rawAction.trim()) {
        try {
          actionUrl = new URL(rawAction, url).toString();
        } catch {
          actionUrl = "";
        }
      }
      const method = (form.getAttribute("method") || "post").toLowerCase();
      const id = form.getAttribute("id") || "";
      const name = form.getAttribute("name") || "";
      const inputs = form.querySelectorAll("input,select,textarea");
      const isApiBacked =
        Boolean(actionUrl) &&
        /\/api\//i.test(actionUrl) &&
        /^(post|get)$/i.test(method);

      if (!isApiBacked) {
        continue;
      }
      const fields = inputs
        .map((input) => {
          const tagName = String(input.tagName || "").toLowerCase();
          const inputType =
            tagName === "input"
              ? String(input.getAttribute("type") || "text").toLowerCase()
              : tagName;
          const fieldName = input.getAttribute("name") || "";
          const required = input.hasAttribute("required");
          if (!fieldName.trim()) return null;
          return {
            name: fieldName,
            type: inputType,
            required,
          };
        })
        .filter(Boolean);
      discovered.push({
        pageUrl: url,
        formIndex: i,
        id,
        name,
        action: rawAction,
        actionUrl,
        method,
        fieldCount: inputs.length,
        fields,
      });
    }
  }

  return discovered;
}

function sampleValueForField(field = {}) {
  const name = String(field?.name || "").toLowerCase();
  const type = String(field?.type || "text").toLowerCase();

  if (name.includes("honeypot") || name.includes("middle_name")) {
    return "";
  }
  if (type === "email" || name.includes("email")) {
    return "hello@yourwebsquad.com";
  }
  if (type === "tel" || name.includes("phone")) {
    return "+15145551234";
  }
  if (type === "number") {
    return "1";
  }
  if (type === "date") {
    return "2026-03-21";
  }
  if (type === "checkbox") {
    return "on";
  }
  if (type === "radio" || type === "select") {
    return "test";
  }
  return "Test value";
}

function buildSubmissionPayload(form = {}) {
  const payload = {};
  const fields = Array.isArray(form?.fields) ? form.fields : [];

  for (const field of fields) {
    const key = String(field?.name || "").trim();
    if (!key) continue;
    payload[key] = sampleValueForField(field);
  }

  return payload;
}

function buildInvalidPayloadMissingRequired(form = {}, basePayload = {}) {
  const next = { ...(basePayload || {}) };
  const fields = Array.isArray(form?.fields) ? form.fields : [];
  for (const field of fields) {
    if (!field?.required) continue;
    const key = String(field?.name || "").trim();
    if (!key) continue;
    next[key] = "";
  }
  return next;
}

async function runApiProbe(
  form = {},
  payload = {},
  { quiet = false, headers = {} } = {},
) {
  const actionUrl = String(form?.actionUrl || "").trim();
  const method = String(form?.method || "post").toUpperCase();

  if (!actionUrl) {
    return {
      pageUrl: form?.pageUrl || "",
      formIndex: Number(form?.formIndex || 0),
      actionUrl: "",
      method,
      attempted: false,
      success: false,
      status: null,
      ok: false,
      error: "Missing form action URL.",
    };
  }

  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(payload || {})) {
      params.append(key, String(value ?? ""));
    }

    let target = actionUrl;
    const options = { method, headers: { ...(headers || {}) } };

    if (method === "GET") {
      const sep = actionUrl.includes("?") ? "&" : "?";
      target = `${actionUrl}${sep}${params.toString()}`;
    } else {
      options.headers["Content-Type"] = "application/x-www-form-urlencoded";
      options.body = params.toString();
    }

    const response = await fetch(target, options);
    const contentType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    const isJson = contentType === "application/json";
    const hasBooleanOk = json && typeof json.ok === "boolean";
    const success = response.ok && isJson && hasBooleanOk && json.ok === true;
    return {
      pageUrl: form?.pageUrl || "",
      formIndex: Number(form?.formIndex || 0),
      actionUrl,
      method,
      attempted: true,
      success,
      status: response.status,
      contentType,
      ok: response.ok,
      responseJson: json,
      responseText: json ? null : text.slice(0, 2000),
    };
  } catch (error) {
    if (!quiet) {
      console.log(
        `Probe failed for ${actionUrl}: ${error?.message || String(error)}`,
      );
    }
    return {
      pageUrl: form?.pageUrl || "",
      formIndex: Number(form?.formIndex || 0),
      actionUrl,
      method,
      attempted: true,
      success: false,
      status: null,
      ok: false,
      error: error?.message || String(error),
    };
  }
}

function withEmailTestOverrides(payload = {}) {
  const next = { ...(payload || {}) };
  if (
    typeof next.subject === "string" &&
    !next.subject.startsWith("[THIS IS A TEST] ")
  ) {
    next.subject = `[THIS IS A TEST] ${next.subject}`;
  }
  if (
    typeof next.message === "string" &&
    !next.message.startsWith("THIS IS A TEST - DO NOT ANSWER")
  ) {
    next.message = `THIS IS A TEST - DO NOT ANSWER\n\n${next.message}`;
  }
  if (
    typeof next.body === "string" &&
    !next.body.startsWith("THIS IS A TEST - DO NOT ANSWER")
  ) {
    next.body = `THIS IS A TEST - DO NOT ANSWER\n\n${next.body}`;
  }
  next.__ywsTestRecipient = "hello@yourwebsquad.com";
  return next;
}

async function runFrontendProbes(forms = [], { quiet = false } = {}) {
  if (!forms.length) return [];

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  const results = [];

  try {
    for (const form of forms) {
      const pageUrl = String(form?.pageUrl || "");
      const formIndex = Number(form?.formIndex || 0);
      if (!pageUrl) {
        results.push({
          pageUrl,
          formIndex,
          success: false,
          error: "Missing page URL.",
        });
        continue;
      }

      try {
        await page.goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        const snapshot = await page.evaluate((idx) => {
          const formsOnPage = Array.from(document.querySelectorAll("form"));
          const el = formsOnPage[idx] || null;
          let validation = {
            requiredCount: 0,
            requiredInvalidCount: 0,
            assertionPassed: true,
          };

          if (el instanceof HTMLFormElement) {
            const requiredControls = Array.from(
              el.querySelectorAll(
                "input[required], select[required], textarea[required]",
              ),
            ).filter((control) => control instanceof HTMLElement);

            validation.requiredCount = requiredControls.length;

            for (const control of requiredControls) {
              if (
                control instanceof HTMLInputElement ||
                control instanceof HTMLTextAreaElement
              ) {
                control.value = "";
              } else if (control instanceof HTMLSelectElement) {
                control.selectedIndex = -1;
              }
            }

            const invalidCount = requiredControls.filter((control) => {
              return "checkValidity" in control
                ? !control.checkValidity()
                : false;
            }).length;
            validation.requiredInvalidCount = invalidCount;
            validation.assertionPassed =
              validation.requiredCount === 0 ||
              validation.requiredInvalidCount > 0;
          }

          return {
            formsCount: formsOnPage.length,
            found: Boolean(el),
            id: el?.getAttribute("id") || "",
            name: el?.getAttribute("name") || "",
            action: el?.getAttribute("action") || "",
            method: (el?.getAttribute("method") || "post").toLowerCase(),
            validation,
          };
        }, formIndex);

        results.push({
          pageUrl,
          formIndex,
          success: Boolean(
            snapshot?.found && snapshot?.validation?.assertionPassed !== false,
          ),
          snapshot,
        });
      } catch (error) {
        if (!quiet) {
          console.log(
            `Frontend probe failed for ${pageUrl}#${formIndex}: ${error?.message || error}`,
          );
        }
        results.push({
          pageUrl,
          formIndex,
          success: false,
          error: error?.message || String(error),
        });
      }
    }
  } finally {
    await page.close();
    await browser.close();
  }

  return results;
}

async function runFormA11yProbes(
  forms = [],
  { reportDir, quiet = false } = {},
) {
  const results = [];
  const list = Array.isArray(forms) ? forms : [];
  for (const form of list) {
    const pageUrl = normalizeUrl(form?.pageUrl);
    const formIndex = Number(form?.formIndex ?? 0);
    const formId = String(form?.id || "").trim();
    if (!pageUrl) {
      results.push({
        pageUrl: "",
        formIndex,
        formId,
        selector: "",
        exitCode: null,
        violationCount: 0,
        success: false,
        status: "error",
        outputPath: "",
        message: "Missing page URL for form a11y probe.",
      });
      continue;
    }
    if (!formId) {
      results.push({
        pageUrl,
        formIndex,
        formId: "",
        selector: "",
        exitCode: null,
        violationCount: 0,
        success: true,
        status: "skipped",
        outputPath: "",
        message: "Skipped form-only a11y: missing form id attribute.",
      });
      continue;
    }

    const selector = `form#${formId.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1")}`;
    const outName = `form-a11y-${slugify(pageUrl) || "page"}-${slugify(formId) || String(formIndex)}.json`;
    const args = [
      "axe",
      pageUrl,
      "--include",
      selector,
      "--tags",
      "wcag2a,wcag2aa",
      "--dir",
      reportDir,
      "--save",
      outName,
      "--show-errors",
      "false",
    ];
    const exitCode = await new Promise((resolve) => {
      const child = spawn("npx", args, {
        shell: false,
        stdio: quiet ? "ignore" : "inherit",
        env: process.env,
      });
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });

    const outPath = path.join(reportDir, outName);
    let payload = null;
    if (fs.existsSync(outPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
        payload = Array.isArray(parsed) ? parsed[0] || null : parsed;
      } catch {
        payload = null;
      }
    }
    const violations = Array.isArray(payload?.violations)
      ? payload.violations
      : [];
    const status =
      exitCode === 0 ? (violations.length === 0 ? "pass" : "fail") : "error";
    results.push({
      pageUrl,
      formIndex,
      formId,
      selector,
      exitCode,
      violationCount: violations.length,
      success: status === "pass",
      status,
      outputPath: outPath,
      message:
        status === "pass"
          ? "No violations in selected form scope."
          : status === "fail"
            ? `Found ${violations.length} violation(s) in selected form scope.`
            : "aXe command failed for selected form scope.",
    });
  }
  return results;
}

function buildIssues({
  frontendProbeResults = [],
  apiProbeResults = [],
  formA11yResults = [],
} = {}) {
  const issues = [];

  for (const entry of frontendProbeResults) {
    if (entry?.success) continue;
    issues.push({
      type: "frontend",
      pageUrl: entry?.pageUrl || "",
      formIndex: entry?.formIndex ?? "",
      message: entry?.error || "Frontend probe failed.",
    });
  }

  for (const entry of apiProbeResults) {
    const validOk = Boolean(entry?.assertions?.validExpectedSuccess);
    const invalidOk = Boolean(entry?.assertions?.invalidExpectedFailure);
    if (validOk && invalidOk) continue;
    issues.push({
      type: "api",
      pageUrl: entry?.pageUrl || "",
      formIndex: entry?.formIndex ?? "",
      message: `Assertion failure (validExpectedSuccess=${validOk}, invalidExpectedFailure=${invalidOk}).`,
    });
  }

  for (const entry of formA11yResults) {
    if (entry?.status === "pass" || entry?.status === "skipped") continue;
    issues.push({
      type: "a11y",
      pageUrl: entry?.pageUrl || "",
      formIndex: entry?.formIndex ?? "",
      message:
        entry?.message ||
        `aXe violation count: ${Number(entry?.violationCount || 0)}`,
    });
  }

  return issues;
}

function probeStatus(success, error = "") {
  if (error) return "error";
  return success ? "pass" : "fail";
}

function buildTestCases({
  frontendProbeResults = [],
  apiProbeResults = [],
  formA11yResults = [],
  preflight = {},
  execution = {},
} = {}) {
  const cases = [];

  for (const alert of Array.isArray(preflight?.alerts)
    ? preflight.alerts
    : []) {
    cases.push({
      pageUrl: "-",
      formIndex: "",
      testType: "preflight",
      status: alert?.type === "legacy-forms-path" ? "fail" : "warn",
      message: alert?.message || "Preflight alert",
    });
  }

  for (const note of Array.isArray(preflight?.notices)
    ? preflight.notices
    : []) {
    cases.push({
      pageUrl: "-",
      formIndex: "",
      testType: "preflight",
      status: "info",
      message: note?.message || "Preflight notice",
    });
  }

  for (const entry of frontendProbeResults) {
    const requiredCount = Number(
      entry?.snapshot?.validation?.requiredCount || 0,
    );
    const requiredInvalidCount = Number(
      entry?.snapshot?.validation?.requiredInvalidCount || 0,
    );
    cases.push({
      pageUrl: entry?.pageUrl || "",
      formIndex: entry?.formIndex ?? "",
      testType: "frontend",
      status: probeStatus(entry?.success, entry?.error),
      message:
        entry?.error ||
        `required fields: ${requiredCount}, invalid required after blanking: ${requiredInvalidCount}`,
    });
  }

  for (const entry of apiProbeResults) {
    const validProbe = entry?.validProbe || {};
    const validPass = Boolean(entry?.assertions?.validExpectedSuccess);
    cases.push({
      pageUrl: entry?.pageUrl || "",
      formIndex: entry?.formIndex ?? "",
      testType: "api-valid",
      status: probeStatus(validPass, validProbe?.error),
      message:
        validProbe?.error ||
        `status=${validProbe?.status ?? "n/a"}, content-type=${validProbe?.contentType || "n/a"}, ok=${String(validProbe?.responseJson?.ok)}`,
    });

    const invalidProbe = entry?.invalidProbe || {};
    const invalidPass = Boolean(entry?.assertions?.invalidExpectedFailure);
    cases.push({
      pageUrl: entry?.pageUrl || "",
      formIndex: entry?.formIndex ?? "",
      testType: "api-invalid",
      status: probeStatus(invalidPass, invalidProbe?.error),
      message:
        invalidProbe?.error ||
        `status=${invalidProbe?.status ?? "n/a"}, content-type=${invalidProbe?.contentType || "n/a"}, expected failure on invalid payload`,
    });
  }

  for (const entry of formA11yResults) {
    cases.push({
      pageUrl: entry?.pageUrl || "",
      formIndex: entry?.formIndex ?? "",
      testType: "a11y",
      status: entry?.status || probeStatus(entry?.success, ""),
      message:
        entry?.message ||
        `aXe violations: ${Number(entry?.violationCount || 0)}`,
    });
  }

  if (execution?.status === "skipped") {
    cases.push({
      pageUrl: "-",
      formIndex: "",
      testType: "suite",
      status: "skipped",
      message: execution?.reason || "Form tests skipped",
    });
  }

  return cases;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportDir = prepareReportDir(args.reportDir);
  const urls = loadUrlsFromFile(args.urlsFile);
  let preflight = detectFormSourceLayout(process.cwd());
  const quiet = Boolean(args.quiet);
  let migrationDecision = "not-needed";
  let migrationPerformed = false;
  let skipped = false;
  let skippedReason = "";

  if (preflight.legacyFormsFiles.length > 0) {
    const mode = String(args.migrateLegacyForms || "prompt");
    let shouldMigrate = false;

    if (mode === "yes" || mode === "true") {
      shouldMigrate = true;
      migrationDecision = "yes";
    } else if (mode === "no" || mode === "false") {
      shouldMigrate = false;
      migrationDecision = "no";
    } else {
      const answer = await askYesNo(
        "Legacy forms found in /src/content/forms. Migrate now to /src/forms and continue form tests?",
        { quiet },
      );
      shouldMigrate = Boolean(answer);
      migrationDecision =
        answer === null ? "no-non-interactive" : shouldMigrate ? "yes" : "no";
    }

    if (shouldMigrate) {
      const migration = migrateLegacyFormsLayout(preflight);
      migrationPerformed = migration.movedFiles > 0;
      preflight = detectFormSourceLayout(process.cwd());
      preflight.notices.push({
        type: "legacy-forms-migrated",
        severity: "info",
        message: `Migrated ${migration.movedFiles} file(s) from /src/content/forms to /src/forms.`,
      });
    } else {
      skipped = true;
      skippedReason =
        "Legacy folder structure detected and migration declined. Form tests skipped.";
    }
  }

  let forms = [];
  let formA11yResults = [];
  let frontendProbeResults = [];
  const apiProbeResults = [];
  let payloadsPreview = [];

  if (!skipped) {
    forms = await discoverForms(urls, { quiet });
    if (forms.length === 0) {
      skipped = true;
      skippedReason = "No generated form has been detected on tested URLs.";
      preflight.notices.push({
        type: "no-generated-forms-detected",
        severity: "info",
        message: skippedReason,
      });
    }
  }

  if (!skipped) {
    formA11yResults = await runFormA11yProbes(forms, {
      reportDir,
      quiet,
    });
    frontendProbeResults = await runFrontendProbes(forms, {
      quiet,
    });
  }
  if (!skipped) {
    payloadsPreview = forms.map((form) => ({
      pageUrl: form.pageUrl,
      formIndex: form.formIndex,
      actionUrl: form.actionUrl,
      method: form.method,
      payload: buildSubmissionPayload(form),
    }));
    for (const item of payloadsPreview) {
      const baseForm = forms.find(
        (entry) =>
          entry.pageUrl === item.pageUrl && entry.formIndex === item.formIndex,
      );

      const validPayload = withEmailTestOverrides(item.payload);
      const validProbe = await runApiProbe(
        {
          pageUrl: item.pageUrl,
          formIndex: item.formIndex,
          actionUrl: item.actionUrl,
          method: item.method,
        },
        validPayload,
        {
          quiet,
          headers: {
            "X-YWS-Test-Recipient": "hello@yourwebsquad.com",
            "X-YWS-Test-Subject-Prefix": "[THIS IS A TEST] ",
            "X-YWS-Test-Body-Prefix": "THIS IS A TEST - DO NOT ANSWER",
          },
        },
      );
      const invalidPayload = buildInvalidPayloadMissingRequired(
        baseForm,
        item.payload,
      );
      const invalidProbe = await runApiProbe(
        {
          pageUrl: item.pageUrl,
          formIndex: item.formIndex,
          actionUrl: item.actionUrl,
          method: item.method,
        },
        invalidPayload,
        { quiet },
      );

      apiProbeResults.push({
        pageUrl: item.pageUrl,
        formIndex: item.formIndex,
        actionUrl: item.actionUrl,
        method: item.method,
        validProbe,
        invalidProbe,
        assertions: {
          validExpectedSuccess: Boolean(validProbe.success),
          invalidExpectedFailure: !invalidProbe.success,
        },
      });
    }
  }
  const createdAt = new Date().toISOString();
  const execution = {
    status: skipped ? "skipped" : "completed",
    reason: skippedReason || "",
    migrationDecision,
  };
  const failedProbes = apiProbeResults.filter(
    (entry) =>
      !entry?.assertions?.validExpectedSuccess ||
      !entry?.assertions?.invalidExpectedFailure,
  ).length;
  const failedFrontendProbes = frontendProbeResults.filter(
    (entry) => !entry?.success,
  ).length;
  const failedFormA11y = formA11yResults.filter(
    (entry) => !entry?.success,
  ).length;
  const issues = buildIssues({
    frontendProbeResults,
    apiProbeResults,
    formA11yResults,
  });
  let preflightFailed = 0;
  if (preflight.legacyFormsFiles.length > 0 && !migrationPerformed) {
    preflightFailed = 1;
    issues.push({
      type: "preflight",
      pageUrl: "",
      formIndex: "",
      message:
        "Legacy /src/content/forms detected and migration was declined. Form tests were skipped.",
    });
  }
  const testCases = buildTestCases({
    frontendProbeResults,
    apiProbeResults,
    formA11yResults,
    preflight,
    execution,
  });

  const stats = {
    urlsTested: urls.length,
    totalForms: forms.length,
    testsRun:
      apiProbeResults.length * 2 +
      frontendProbeResults.length +
      formA11yResults.length,
    failed: failedProbes + failedFrontendProbes + failedFormA11y,
    preflightFailed,
    alerts: preflight.alerts.length,
    skipped,
    skippedReason: skippedReason || null,
    migrationDecision,
    createdAt,
    baseUrl: args.base || null,
    urlsFile: args.urlsFile || null,
  };

  writeJson(path.join(reportDir, "results.json"), {
    forms,
    formA11yResults,
    frontendProbeResults,
    payloadsPreview,
    apiProbeResults,
    preflight,
    execution,
    testCases,
  });
  writeJson(path.join(reportDir, "issues.json"), issues);
  writeJson(path.join(reportDir, "stats.json"), stats);
  fs.writeFileSync(
    path.join(reportDir, "SUMMARY.md"),
    `# Form tests report\n\n- Created: ${createdAt}\n- URLs tested: ${stats.urlsTested}\n- Total forms: ${stats.totalForms}\n- Tests run: ${stats.testsRun}\n- Failed assertions: ${stats.failed}\n- Preflight failures: ${stats.preflightFailed}\n- Alerts: ${stats.alerts}\n- Skipped: ${stats.skipped ? "yes" : "no"}\n- Skip reason: ${stats.skippedReason || "n/a"}\n`,
    "utf8",
  );
  writePlaceholderReport(reportDir, {
    stats,
    issues,
    preflight,
    execution,
    testCases,
    frontendProbeResults,
    apiProbeResults,
    formA11yResults,
  });

  const totalFailed = stats.failed + stats.preflightFailed;
  if (totalFailed > 0) {
    process.exitCode = 1;
  }

  if (!args.quiet) {
    console.log(
      `Form test placeholder completed. URLs: ${urls.length}. Report dir: ${reportDir}`,
    );
    if (preflight.alerts.length > 0) {
      console.log(`Preflight alerts: ${preflight.alerts.length}`);
      for (const alert of preflight.alerts) {
        console.log(`- [${alert.severity}] ${alert.message}`);
      }
      for (const recommendation of preflight.recommendations) {
        console.log(`  Recommendation: ${recommendation}`);
      }
    }
    if (process.exitCode === 1) {
      console.log(
        `Form test failed: ${stats.failed} assertion failure(s), ${stats.preflightFailed} preflight failure(s).`,
      );
      if (stats.skippedReason) {
        console.log(`Form test skipped reason: ${stats.skippedReason}`);
      }
    } else {
      if (stats.skipped) {
        console.log(`Form test passed (skipped): ${stats.skippedReason}`);
      } else {
        console.log("Form test passed.");
      }
    }
  }
}

main().catch((error) => {
  console.error("form-test failed:", error?.message || String(error));
  process.exit(1);
});
