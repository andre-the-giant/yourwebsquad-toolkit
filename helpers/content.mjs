import fs from "node:fs/promises";
import path from "node:path";

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export function createContentHelpers({
  contentRoot = path.resolve(process.cwd(), "public", "content"),
  cache = new Map(),
} = {}) {
  async function getContent(locale = "en", slug) {
    const key = `${locale}:${slug}`;
    if (cache.has(key)) return cache.get(key);

    const filePath = path.join(contentRoot, locale, `${slug}.json`);
    const data = await readJson(filePath);
    cache.set(key, data);
    return data;
  }

  async function getCompany(slug) {
    const key = `company:${slug}`;
    if (cache.has(key)) return cache.get(key);

    const filePath = path.join(contentRoot, "company", `${slug}.json`);
    const data = await readJson(filePath);
    cache.set(key, data);
    return data;
  }

  function clearContentCache() {
    cache.clear();
  }

  return {
    getContent,
    getCompany,
    clearContentCache,
  };
}
