function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderLayout({
  title,
  subtitle = "",
  navHtml = "",
  bodyHtml = "",
  stylesheetHref = "./report.css",
}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${escapeHtml(stylesheetHref)}" />
</head>
<body>
  <main class="report-page">
    <header class="report-header">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="report-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      ${navHtml}
    </header>
    ${bodyHtml}
  </main>
</body>
</html>`;
}

export function escapeContent(value) {
  return escapeHtml(value);
}
