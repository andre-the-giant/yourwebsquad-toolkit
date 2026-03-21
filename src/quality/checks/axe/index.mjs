import { defineQualityCheck } from "../../core/quality-check.mjs";
import { collectAxeFromReportDir } from "./collect.mjs";
import { normalizeAxePayload } from "./normalize.mjs";
import { summarizeAxePayload } from "./summarize.mjs";

export const axeCheck = defineQualityCheck({
  id: "axe",
  async collect(context = {}) {
    return collectAxeFromReportDir(context.reportDir, {
      logPath: context.logPath,
    });
  },
  async normalize(raw, context = {}) {
    return normalizeAxePayload(raw, {
      selected: context.selected !== false,
      failed: Boolean(context.failed),
    });
  },
  async summarize(normalized) {
    return summarizeAxePayload(normalized);
  },
  capabilities: {
    supportsRemote: true,
    supportsLocalBuild: true,
  },
});
