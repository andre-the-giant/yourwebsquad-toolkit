import { defineQualityCheck } from "../../core/quality-check.mjs";
import { collectSecurityFromReportDir } from "./collect.mjs";
import { normalizeSecurityPayload } from "./normalize.mjs";
import { summarizeSecurityPayload } from "./summarize.mjs";

export const securityCheck = defineQualityCheck({
  id: "security",
  async collect(context = {}) {
    return collectSecurityFromReportDir(context.reportDir, {
      logPath: context.logPath,
    });
  },
  async normalize(raw, context = {}) {
    return normalizeSecurityPayload(raw, {
      selected: context.selected !== false,
      failed: Boolean(context.failed),
    });
  },
  async summarize(normalized) {
    return summarizeSecurityPayload(normalized);
  },
  capabilities: {
    supportsRemote: true,
    supportsLocalBuild: false,
  },
});

