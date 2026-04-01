function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildFormKey(pageUrl, formIndex) {
  return `${String(pageUrl || "")}::${String(formIndex ?? "")}`;
}

export function normalizeFormPayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const issues = Array.isArray(raw?.issues) ? raw.issues : [];
  const results =
    raw?.results && typeof raw.results === "object" ? raw.results : {};
  const forms = Array.isArray(results?.forms) ? results.forms : [];
  const testCases = Array.isArray(results?.testCases) ? results.testCases : [];
  const preflight =
    results?.preflight && typeof results.preflight === "object"
      ? results.preflight
      : null;
  const execution =
    results?.execution && typeof results.execution === "object"
      ? results.execution
      : null;
  const caseGroups = new Map();
  for (const testCase of testCases) {
    const key = buildFormKey(testCase?.pageUrl, testCase?.formIndex);
    if (!caseGroups.has(key)) caseGroups.set(key, []);
    caseGroups.get(key).push(testCase);
  }
  const formSummaries = forms.map((form) => {
    const relatedCases =
      caseGroups.get(buildFormKey(form?.pageUrl, form?.formIndex)) || [];
    const failures = relatedCases.filter((entry) => {
      const status = String(entry?.status || "").toLowerCase();
      return !["pass", "info"].includes(status);
    });
    return {
      ...form,
      cases: relatedCases,
      failures,
    };
  });

  const failedCount =
    stats && typeof stats === "object"
      ? toNumber(stats.failed) + toNumber(stats.preflightFailed)
      : issues.filter((issue) => issue?.status === "failed").length;

  return {
    selected: options.selected !== false,
    failed: Boolean(options.failed) || failedCount > 0,
    stats,
    issues,
    meta: {
      logPath: raw?.logPath || null,
      hasReportHtml: Boolean(raw?.hasReportHtml),
      hasSummaryMd: Boolean(raw?.hasSummaryMd),
      reportHtmlPath: raw?.reportHtmlPath || null,
      summaryMdPath: raw?.summaryMdPath || null,
      testedForms:
        stats && typeof stats === "object" ? toNumber(stats.totalForms) : 0,
      forms: formSummaries,
      testCases,
      preflight,
      execution,
    },
  };
}
