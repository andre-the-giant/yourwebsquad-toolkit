import { defineQualityCheck } from "../../core/quality-check.mjs";
import { collectFormFromReportDir } from "./collect.mjs";
import { normalizeFormPayload } from "./normalize.mjs";
import { summarizeFormPayload } from "./summarize.mjs";

export const formCheck = defineQualityCheck({
  id: "form",
  async collect(context = {}) {
    return collectFormFromReportDir(context.reportDir, {
      logPath: context.logPath,
    });
  },
  async normalize(raw, context = {}) {
    return normalizeFormPayload(raw, {
      selected: context.selected !== false,
      failed: Boolean(context.failed),
    });
  },
  async summarize(normalized) {
    return summarizeFormPayload(normalized);
  },
  capabilities: {
    supportsRemote: true,
    supportsLocalBuild: true,
  },
});
