#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "node-html-parser";

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

function writePlaceholderReport(reportDir, stats) {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Form tests report</title>
</head>
<body>
  <h1>Form tests report</h1>
  <p>Placeholder report. Implementation in progress.</p>
  <pre>${JSON.stringify(stats, null, 2)}</pre>
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
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    const success = response.ok && (json?.ok !== false);
    return {
      pageUrl: form?.pageUrl || "",
      formIndex: Number(form?.formIndex || 0),
      actionUrl,
      method,
      attempted: true,
      success,
      status: response.status,
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
  if (typeof next.subject === "string" && !next.subject.startsWith("[THIS IS A TEST] ")) {
    next.subject = `[THIS IS A TEST] ${next.subject}`;
  }
  if (typeof next.message === "string" && !next.message.startsWith("THIS IS A TEST - DO NOT ANSWER")) {
    next.message = `THIS IS A TEST - DO NOT ANSWER\n\n${next.message}`;
  }
  if (typeof next.body === "string" && !next.body.startsWith("THIS IS A TEST - DO NOT ANSWER")) {
    next.body = `THIS IS A TEST - DO NOT ANSWER\n\n${next.body}`;
  }
  next.__ywsTestRecipient = "hello@yourwebsquad.com";
  return next;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportDir = prepareReportDir(args.reportDir);
  const urls = loadUrlsFromFile(args.urlsFile);
  const forms = await discoverForms(urls, { quiet: Boolean(args.quiet) });
  const payloadsPreview = forms.map((form) => ({
    pageUrl: form.pageUrl,
    formIndex: form.formIndex,
    actionUrl: form.actionUrl,
    method: form.method,
    payload: buildSubmissionPayload(form),
  }));
  const apiProbeResults = [];
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
        quiet: Boolean(args.quiet),
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
      { quiet: Boolean(args.quiet) },
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
  const createdAt = new Date().toISOString();
  const failedProbes = apiProbeResults.filter(
    (entry) =>
      !entry?.assertions?.validExpectedSuccess ||
      !entry?.assertions?.invalidExpectedFailure,
  ).length;

  const stats = {
    urlsTested: urls.length,
    totalForms: forms.length,
    testsRun: apiProbeResults.length * 2,
    failed: failedProbes,
    createdAt,
    baseUrl: args.base || null,
    urlsFile: args.urlsFile || null,
  };

  writeJson(path.join(reportDir, "results.json"), {
    forms,
    payloadsPreview,
    apiProbeResults,
  });
  writeJson(path.join(reportDir, "issues.json"), []);
  writeJson(path.join(reportDir, "stats.json"), stats);
  fs.writeFileSync(
    path.join(reportDir, "SUMMARY.md"),
    `# Form tests report\n\n- Created: ${createdAt}\n- URLs tested: ${urls.length}\n- Total forms: ${forms.length}\n- Tests run: ${apiProbeResults.length}\n- Failed: ${failedProbes}\n`,
    "utf8",
  );
  writePlaceholderReport(reportDir, stats);

  if (!args.quiet) {
    console.log(
      `Form test placeholder completed. URLs: ${urls.length}. Report dir: ${reportDir}`,
    );
  }
}

main().catch((error) => {
  console.error("form-test failed:", error?.message || String(error));
  process.exit(1);
});
