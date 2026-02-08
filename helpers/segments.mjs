function normalizeLocale(locale = "en") {
  return locale === "fr" ? "fr" : "en";
}

export function createSegmentHelpers({ segments = {} } = {}) {
  function getSegment(locale = "en", key = "artist") {
    const loc = normalizeLocale(locale);
    const map = segments[key];
    if (!map) return null;
    return map[loc] || map.fr || null;
  }

  function assertSegmentMatch(locale, key, value) {
    const expected = getSegment(locale, key);
    if (expected && value !== expected) {
      throw new Error(
        `Segment mismatch for ${key}: expected ${expected} got ${value}`,
      );
    }
    return true;
  }

  function getSegmentKey(segmentValue) {
    if (!segmentValue) return null;
    return (
      Object.entries(segments).find(([, locales]) =>
        Object.values(locales).includes(segmentValue),
      )?.[0] || null
    );
  }

  function mapSegmentToLocale(segmentValue, targetLocale = "en") {
    const key = getSegmentKey(segmentValue);
    if (!key) return segmentValue;
    return getSegment(targetLocale, key) || segmentValue;
  }

  function pathFor(locale = "en", key = "artist", slug) {
    const loc = normalizeLocale(locale);
    const segment = getSegment(loc, key);
    if (!segment) return null;
    const suffix = slug ? `${slug}/` : "";
    return `/${loc}/${segment}/${suffix}`;
  }

  function alternatesFor(key = "artist", slug) {
    const map = segments[key] || {};
    return Object.keys(map).map((loc) => ({
      lang: loc,
      path: pathFor(loc, key, slug),
    }));
  }

  return {
    getSegment,
    assertSegmentMatch,
    getSegmentKey,
    mapSegmentToLocale,
    pathFor,
    alternatesFor,
    segments,
  };
}
