import { defineQualityCheck } from "../../core/quality-check.mjs";
import { collectPa11yFromReportDir } from "./collect.mjs";
import { normalizePa11yPayload } from "./normalize.mjs";
import { summarizePa11yPayload } from "./summarize.mjs";

export const pa11yCheck = defineQualityCheck({
  id: "pa11y",
  async collect(context = {}) {
    return collectPa11yFromReportDir(context.reportDir, {
      logPath: context.logPath,
    });
  },
  async normalize(raw, context = {}) {
    return normalizePa11yPayload(raw, {
      selected: context.selected !== false,
      failed: Boolean(context.failed),
    });
  },
  async summarize(normalized) {
    return summarizePa11yPayload(normalized);
  },
  capabilities: {
    supportsRemote: true,
    supportsLocalBuild: true,
  },
});
