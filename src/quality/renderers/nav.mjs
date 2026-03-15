function joinBase(basePath, targetPath) {
  const root = String(basePath || "").replace(/\/+$/, "");
  const target = String(targetPath || "").replace(/^\/+/, "");
  if (!root) return `/${target}`;
  return `${root}/${target}`;
}

export function reportNavLinks({ basePath = "" } = {}) {
  return [
    { key: "home", label: "Home", href: joinBase(basePath, "index.html") },
    {
      key: "lighthouse",
      label: "Lighthouse",
      href: joinBase(basePath, "lighthouse/index.html"),
    },
    { key: "pa11y", label: "Pa11y", href: joinBase(basePath, "pa11y.html") },
    { key: "seo", label: "SEO", href: joinBase(basePath, "seo.html") },
    {
      key: "links",
      label: "Link check",
      href: joinBase(basePath, "links.html"),
    },
    {
      key: "jsonld",
      label: "JSON-LD",
      href: joinBase(basePath, "jsonld.html"),
    },
    {
      key: "security",
      label: "Security",
      href: joinBase(basePath, "security.html"),
    },
    { key: "vnu", label: "Nu HTML", href: joinBase(basePath, "vnu.html") },
  ];
}
