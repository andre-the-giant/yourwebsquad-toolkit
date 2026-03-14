export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    // Keep trailing slashes so trailingSlash:"always" projects stay canonical.
    return u.toString();
  } catch {
    return url;
  }
}

export function preferIpv4Loopback(url) {
  try {
    const u = new URL(url);
    const host = String(u.hostname || "").toLowerCase();
    if (host === "localhost" || host === "::1") {
      u.hostname = "127.0.0.1";
    }
    return u.toString();
  } catch {
    return url;
  }
}

