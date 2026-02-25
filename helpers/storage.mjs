function isStorageSupported(storage) {
  if (!storage) return false;

  try {
    const probeKey = "__yws_storage_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

function normalizeCookieOptions(cookie = {}) {
  return {
    path: cookie.path ?? "/",
    sameSite: cookie.sameSite ?? "Lax",
    secure: cookie.secure,
    domain: cookie.domain,
    maxAge: cookie.maxAge ?? 60 * 60 * 24 * 365,
  };
}

function toCookieName(prefix, key) {
  return `${prefix}${key}`;
}

function readCookie(documentRef, cookieName) {
  if (!documentRef?.cookie) return null;

  const needle = `${encodeURIComponent(cookieName)}=`;
  const cookies = documentRef.cookie.split(";");

  for (const rawCookie of cookies) {
    const entry = rawCookie.trim();
    if (!entry.startsWith(needle)) continue;

    const rawValue = entry.slice(needle.length);
    return decodeURIComponent(rawValue);
  }

  return null;
}

function writeCookie(documentRef, cookieName, value, options) {
  if (!documentRef) return false;

  const encodedName = encodeURIComponent(cookieName);
  const encodedValue = encodeURIComponent(String(value));
  const parts = [`${encodedName}=${encodedValue}`];

  if (options.maxAge !== undefined && options.maxAge !== null) {
    parts.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`);
  }
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");

  documentRef.cookie = parts.join("; ");
  return true;
}

function removeCookie(documentRef, cookieName, options) {
  if (!documentRef) return false;

  return writeCookie(documentRef, cookieName, "", {
    ...options,
    maxAge: 0,
  });
}

function listCookieNames(documentRef, prefix) {
  if (!documentRef?.cookie) return [];

  return documentRef.cookie
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [rawName] = item.split("=");
      return decodeURIComponent(rawName);
    })
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length));
}

/**
 * Create storage helpers that prefer localStorage and fallback to cookies.
 *
 * Methods are safe in SSR/non-browser contexts: reads return `null`, writes are no-op.
 */
export function createStorageHelpers({
  prefix = "",
  cookie = {},
  storage = globalThis?.localStorage,
  documentRef = globalThis?.document,
} = {}) {
  const cookieOptions = normalizeCookieOptions(cookie);
  const useLocalStorage = isStorageSupported(storage);
  const hasCookieSupport = Boolean(
    documentRef && typeof documentRef.cookie === "string",
  );

  function setItem(key, value, options = {}) {
    const storageKey = toCookieName(prefix, key);

    if (useLocalStorage) {
      try {
        storage.setItem(storageKey, String(value));
        return true;
      } catch {
        // Fallback to cookies if localStorage fails at runtime.
      }
    }

    return writeCookie(documentRef, storageKey, value, {
      ...cookieOptions,
      ...options,
    });
  }

  function getItem(key) {
    const storageKey = toCookieName(prefix, key);

    if (useLocalStorage) {
      try {
        return storage.getItem(storageKey);
      } catch {
        // Fallback to cookies if localStorage fails at runtime.
      }
    }

    return readCookie(documentRef, storageKey);
  }

  function getOrCreate(key, valueOrFactory, options = {}) {
    const existing = getItem(key);
    if (existing !== null) return existing;

    const nextValue =
      typeof valueOrFactory === "function" ? valueOrFactory() : valueOrFactory;

    setItem(key, nextValue, options);
    return String(nextValue);
  }

  function hasItem(key) {
    return getItem(key) !== null;
  }

  function removeItem(key, options = {}) {
    const storageKey = toCookieName(prefix, key);

    if (useLocalStorage) {
      try {
        storage.removeItem(storageKey);
        return true;
      } catch {
        // Fallback to cookies if localStorage fails at runtime.
      }
    }

    return removeCookie(documentRef, storageKey, {
      ...cookieOptions,
      ...options,
    });
  }

  function keys() {
    if (useLocalStorage) {
      try {
        const names = [];
        for (let i = 0; i < storage.length; i += 1) {
          const name = storage.key(i);
          if (!name) continue;
          if (!name.startsWith(prefix)) continue;
          names.push(name.slice(prefix.length));
        }
        return names;
      } catch {
        // Fallback to cookies if localStorage fails at runtime.
      }
    }

    return listCookieNames(documentRef, prefix);
  }

  function key(index) {
    return keys()[index] ?? null;
  }

  function length() {
    return keys().length;
  }

  function clear(options = {}) {
    const entries = keys();
    for (const entry of entries) {
      removeItem(entry, options);
    }
    return true;
  }

  function setJson(key, value, options = {}) {
    return setItem(key, JSON.stringify(value), options);
  }

  function getJson(key, fallback = null) {
    const raw = getItem(key);
    if (raw === null) return fallback;

    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  return {
    backend: useLocalStorage
      ? "localStorage"
      : hasCookieSupport
        ? "cookie"
        : "none",
    setItem,
    getItem,
    getOrCreate,
    hasItem,
    removeItem,
    clear,
    key,
    keys,
    length,
    setJson,
    getJson,
  };
}
