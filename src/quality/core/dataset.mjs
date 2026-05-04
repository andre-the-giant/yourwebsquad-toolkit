import path from "node:path";
import { collectLighthouseFromReportDir } from "../checks/lighthouse/collect.mjs";
import { normalizeLighthousePayload } from "../checks/lighthouse/normalize.mjs";
import { collectPa11yFromReportDir } from "../checks/pa11y/collect.mjs";
import { normalizePa11yPayload } from "../checks/pa11y/normalize.mjs";
import { collectAxeFromReportDir } from "../checks/axe/collect.mjs";
import { normalizeAxePayload } from "../checks/axe/normalize.mjs";
import { collectFormFromReportDir } from "../checks/form/collect.mjs";
import { normalizeFormPayload } from "../checks/form/normalize.mjs";
import { collectSeoFromReportDir } from "../checks/seo/collect.mjs";
import { normalizeSeoPayload } from "../checks/seo/normalize.mjs";
import { collectLinksFromReportDir } from "../checks/links/collect.mjs";
import { normalizeLinksPayload } from "../checks/links/normalize.mjs";
import { collectJsonldFromReportDir } from "../checks/jsonld/collect.mjs";
import { normalizeJsonldPayload } from "../checks/jsonld/normalize.mjs";
import { collectSecurityFromReportDir } from "../checks/security/collect.mjs";
import { normalizeSecurityPayload } from "../checks/security/normalize.mjs";
import { collectSitespeedFromReportDir } from "../checks/sitespeed/collect.mjs";
import { normalizeSitespeedPayload } from "../checks/sitespeed/normalize.mjs";
import { collectVnuFromReportDir } from "../checks/vnu/collect.mjs";
import { normalizeVnuPayload } from "../checks/vnu/normalize.mjs";
import { collectWappalyzerFromReportDir } from "../checks/wappalyzer/collect.mjs";
import { normalizeWappalyzerPayload } from "../checks/wappalyzer/normalize.mjs";

const CHECK_KEYS = [
  "lighthouse",
  "pa11y",
  "axe",
  "form",
  "seo",
  "links",
  "jsonld",
  "security",
  "sitespeed",
  "vnu",
  "wappalyzer",
];

export function selectedCheckIds(selectedChecks) {
  return CHECK_KEYS.filter((key) => Boolean(selectedChecks?.[key]));
}

function checkFailedMap(failures = []) {
  const failedSet = new Set(failures);
  return {
    lighthouse: failedSet.has("Lighthouse"),
    pa11y: failedSet.has("Pa11y"),
    axe: failedSet.has("aXe"),
    form: failedSet.has("Form tests"),
    seo: failedSet.has("SEO audit"),
    links: failedSet.has("Link check"),
    jsonld: failedSet.has("JSON-LD validation"),
    security: failedSet.has("Security audit"),
    sitespeed: failedSet.has("Sitespeed.io"),
    vnu: failedSet.has("Nu HTML Checker (vnu)"),
    wappalyzer: failedSet.has("Wappalyzer stack detection"),
  };
}

export function buildCanonicalDataset({
  runId,
  createdAt,
  selectedTarget,
  baseUrl,
  selectedChecks,
  failures = [],
  reportRoot,
  logRoot,
}) {
  const failed = checkFailedMap(failures);
  const checks = {};

  if (selectedChecks?.lighthouse) {
    const raw = collectLighthouseFromReportDir(
      path.join(reportRoot, "lighthouse"),
      {
        logPath: path.join(logRoot, "lighthouse.log"),
      },
    );
    checks.lighthouse = normalizeLighthousePayload(raw, {
      selected: true,
      failed: failed.lighthouse,
    });
  }
  if (selectedChecks?.pa11y) {
    const raw = collectPa11yFromReportDir(path.join(reportRoot, "pa11y"), {
      logPath: path.join(logRoot, "pa11y.log"),
    });
    checks.pa11y = normalizePa11yPayload(raw, {
      selected: true,
      failed: failed.pa11y,
    });
  }
  if (selectedChecks?.axe) {
    const raw = collectAxeFromReportDir(path.join(reportRoot, "axe"), {
      logPath: path.join(logRoot, "axe.log"),
    });
    checks.axe = normalizeAxePayload(raw, {
      selected: true,
      failed: failed.axe,
    });
  }
  if (selectedChecks?.form) {
    const raw = collectFormFromReportDir(path.join(reportRoot, "form"), {
      logPath: path.join(logRoot, "form.log"),
    });
    checks.form = normalizeFormPayload(raw, {
      selected: true,
      failed: failed.form,
    });
  }
  if (selectedChecks?.seo) {
    const raw = collectSeoFromReportDir(path.join(reportRoot, "seo"), {
      logPath: path.join(logRoot, "seo.log"),
    });
    checks.seo = normalizeSeoPayload(raw, {
      selected: true,
      failed: failed.seo,
    });
  }
  if (selectedChecks?.links) {
    const raw = collectLinksFromReportDir(path.join(reportRoot, "links"), {
      logPath: path.join(logRoot, "links.log"),
    });
    checks.links = normalizeLinksPayload(raw, {
      selected: true,
      failed: failed.links,
    });
  }
  if (selectedChecks?.jsonld) {
    const raw = collectJsonldFromReportDir(path.join(reportRoot, "jsonld"), {
      logPath: path.join(logRoot, "jsonld.log"),
    });
    checks.jsonld = normalizeJsonldPayload(raw, {
      selected: true,
      failed: failed.jsonld,
    });
  }
  if (selectedChecks?.security) {
    const raw = collectSecurityFromReportDir(
      path.join(reportRoot, "security"),
      {
        logPath: path.join(logRoot, "security.log"),
      },
    );
    checks.security = normalizeSecurityPayload(raw, {
      selected: true,
      failed: failed.security,
    });
  }
  if (selectedChecks?.sitespeed) {
    const raw = collectSitespeedFromReportDir(
      path.join(reportRoot, "sitespeed"),
      {
        logPath: path.join(logRoot, "sitespeed.log"),
      },
    );
    checks.sitespeed = normalizeSitespeedPayload(raw, {
      selected: true,
      failed: failed.sitespeed,
    });
  }
  if (selectedChecks?.vnu) {
    const raw = collectVnuFromReportDir(path.join(reportRoot, "vnu"), {
      logPath: path.join(logRoot, "vnu.log"),
    });
    checks.vnu = normalizeVnuPayload(raw, {
      selected: true,
      failed: failed.vnu,
    });
  }
  if (selectedChecks?.wappalyzer) {
    const raw = collectWappalyzerFromReportDir(
      path.join(reportRoot, "wappalyzer"),
      {
        logPath: path.join(logRoot, "wappalyzer.log"),
      },
    );
    checks.wappalyzer = normalizeWappalyzerPayload(raw, {
      selected: true,
      failed: failed.wappalyzer,
    });
  }

  return {
    schemaVersion: "1.0.0",
    runId,
    createdAt,
    target: {
      key: selectedTarget?.key || null,
      name: selectedTarget?.name || null,
      baseUrl,
      usesLocalBuild: Boolean(selectedTarget?.usesLocalBuild),
    },
    selectedChecks: selectedCheckIds(selectedChecks),
    failures,
    checks,
  };
}

export function assignDatasetRunId(dataset, runId) {
  if (!dataset || typeof dataset !== "object") return null;
  return {
    ...dataset,
    runId,
  };
}
