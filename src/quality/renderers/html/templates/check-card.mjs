import { escapeContent } from "./layout.mjs";

function statusClass(check = {}) {
  if (check.failed) return "fail";
  return "pass";
}

export function renderCheckCard(checkId, check = {}) {
  const label = check?.label || checkId;
  const status = check.failed ? "Issues" : "Pass";
  const stats =
    check?.stats && typeof check.stats === "object" ? check.stats : {};
  const statRows = Object.entries(stats)
    .slice(0, 4)
    .map(
      ([key, value]) =>
        `<li><strong>${escapeContent(key)}:</strong> ${escapeContent(value)}</li>`,
    )
    .join("");

  return `<section class="check-card">
    <h2>${escapeContent(label)}</h2>
    <p><span class="status-chip ${statusClass(check)}">${escapeContent(status)}</span></p>
    <ul>${statRows || "<li>No stats available</li>"}</ul>
  </section>`;
}

export function renderUnknownCheckFallback(checkId, check = {}) {
  const status = check.failed ? "Issues" : "Recorded";
  return `<section class="check-card">
    <h2>${escapeContent(checkId)}</h2>
    <p><span class="status-chip ${check.failed ? "fail" : "info"}">${escapeContent(status)}</span></p>
    <p>No dedicated template yet for this check.</p>
  </section>`;
}
