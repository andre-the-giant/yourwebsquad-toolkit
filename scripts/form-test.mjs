#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
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

function writePlaceholderReport(reportDir, payload = {}) {
  const stats = payload?.stats || {};
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
</tr>`,
    )
    .join("\n");

  const a11yRows = formA11yResults
    .map(
      (item) => `<tr>
  <td>${escapeHtml(item?.pageUrl || "")}</td>
  <td>${escapeHtml(item?.violationCount ?? 0)}</td>
  <td>${escapeHtml(item?.success ? "pass" : "fail")}</td>
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
    <span class="chip">Failed: ${escapeHtml(stats.failed ?? 0)}</span>
  </div>

  <h2>Frontend validation probes</h2>
  <table>
    <thead>
      <tr><th>Page</th><th>Form index</th><th>Status</th><th>Required fields</th><th>Required invalid</th></tr>
    </thead>
    <tbody>${frontendRows || '<tr><td colspan="5">No frontend probes.</td></tr>'}</tbody>
  </table>

  <h2>API probes</h2>
  <table>
    <thead>
      <tr><th>Page</th><th>Form index</th><th>Valid probe</th><th>Invalid probe</th><th>Status codes</th></tr>
    </thead>
    <tbody>${apiRows || '<tr><td colspan="5">No API probes.</td></tr>'}</tbody>
  </table>

  <h2>Form accessibility (aXe)</h2>
  <table>
    <thead>
      <tr><th>Page</th><th>Violations</th><th>Status</th></tr>
    </thead>
    <tbody>${a11yRows || '<tr><td colspan="3">No form a11y probes.</td></tr>'}</tbody>
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

    const success = response.ok && json?.ok !== false;
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

async function runAxeOnce(url, { reportDir, quiet = false } = {}) {
  const outName = `form-a11y-${slugify(url) || "page"}.json`;
  const args = [
    "axe",
    url,
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
  return {
    pageUrl: url,
    exitCode,
    violationCount: violations.length,
    success: exitCode === 0 && violations.length === 0,
    outputPath: outPath,
  };
}

async function runFormA11yProbes(
  forms = [],
  { reportDir, quiet = false } = {},
) {
  const urls = Array.from(
    new Set(
      (Array.isArray(forms) ? forms : [])
        .map((form) => normalizeUrl(form?.pageUrl))
        .filter(Boolean),
    ),
  );

  const results = [];
  for (const pageUrl of urls) {
    const result = await runAxeOnce(pageUrl, { reportDir, quiet });
    results.push(result);
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportDir = prepareReportDir(args.reportDir);
  const urls = loadUrlsFromFile(args.urlsFile);
  const forms = await discoverForms(urls, { quiet: Boolean(args.quiet) });
  const formA11yResults = await runFormA11yProbes(forms, {
    reportDir,
    quiet: Boolean(args.quiet),
  });
  const frontendProbeResults = await runFrontendProbes(forms, {
    quiet: Boolean(args.quiet),
  });
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
  const failedFrontendProbes = frontendProbeResults.filter(
    (entry) => !entry?.success,
  ).length;
  const failedFormA11y = formA11yResults.filter(
    (entry) => !entry?.success,
  ).length;

  const stats = {
    urlsTested: urls.length,
    totalForms: forms.length,
    testsRun:
      apiProbeResults.length * 2 +
      frontendProbeResults.length +
      formA11yResults.length,
    failed: failedProbes + failedFrontendProbes + failedFormA11y,
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
  });
  writeJson(path.join(reportDir, "issues.json"), []);
  writeJson(path.join(reportDir, "stats.json"), stats);
  fs.writeFileSync(
    path.join(reportDir, "SUMMARY.md"),
    `# Form tests report\n\n- Created: ${createdAt}\n- URLs tested: ${urls.length}\n- Total forms: ${forms.length}\n- Tests run: ${apiProbeResults.length}\n- Failed: ${failedProbes}\n`,
    "utf8",
  );
  writePlaceholderReport(reportDir, {
    stats,
    frontendProbeResults,
    apiProbeResults,
    formA11yResults,
  });

  if (stats.failed > 0) {
    process.exitCode = 1;
  }

  if (!args.quiet) {
    console.log(
      `Form test placeholder completed. URLs: ${urls.length}. Report dir: ${reportDir}`,
    );
    if (process.exitCode === 1) {
      console.log(`Form test failed: ${stats.failed} assertion failure(s).`);
    } else {
      console.log("Form test passed.");
    }
  }
}

main().catch((error) => {
  console.error("form-test failed:", error?.message || String(error));
  process.exit(1);
});
