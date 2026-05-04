import { defineQualityCheck } from "../../core/quality-check.mjs";
import { collectWappalyzerFromReportDir } from "./collect.mjs";
import { normalizeWappalyzerPayload } from "./normalize.mjs";
import { summarizeWappalyzerPayload } from "./summarize.mjs";

export const wappalyzerCheck = defineQualityCheck({
  id: "wappalyzer",
  async collect(context = {}) {
    return collectWappalyzerFromReportDir(context.reportDir, {
      logPath: context.logPath,
    });
  },
  async normalize(raw, context = {}) {
    return normalizeWappalyzerPayload(raw, {
      selected: context.selected !== false,
      failed: Boolean(context.failed),
    });
  },
  async summarize(normalized) {
    return summarizeWappalyzerPayload(normalized);
  },
  capabilities: {
    supportsRemote: true,
    supportsLocalBuild: true,
  },
});
