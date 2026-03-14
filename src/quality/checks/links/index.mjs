import { defineQualityCheck } from "../../core/quality-check.mjs";
import { collectLinksFromReportDir } from "./collect.mjs";
import { normalizeLinksPayload } from "./normalize.mjs";
import { summarizeLinksPayload } from "./summarize.mjs";

export const linksCheck = defineQualityCheck({
  id: "links",
  async collect(context = {}) {
    return collectLinksFromReportDir(context.reportDir, {
      logPath: context.logPath,
    });
  },
  async normalize(raw, context = {}) {
    return normalizeLinksPayload(raw, {
      selected: context.selected !== false,
      failed: Boolean(context.failed),
    });
  },
  async summarize(normalized) {
    return summarizeLinksPayload(normalized);
  },
  capabilities: {
    supportsRemote: true,
    supportsLocalBuild: true,
  },
});

