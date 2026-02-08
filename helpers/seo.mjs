const hreflangMapDefault = {
  fr: "fr-FR",
  en: "en",
};
const defaultLangValue = "en";

const defaultSeoValues = {
  title: "Your Web Squad | Astro Boilerplate",
  description:
    "Starter template for fast, accessible, multi-tenant Astro sites.",
  image: "/assets/og/default.png",
  imageAlt: "Open Graph placeholder",
  siteName: "Your Web Squad",
};

function cleanSiteUrl(value) {
  return (value || "").replace(/\/+$/, "");
}

function resolveBaseUrl(url) {
  const normalized = cleanSiteUrl(url);
  if (!normalized) return "http://localhost/";
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function buildSeo(
  { site, locale, path = "/", overrides = {}, alternates } = {},
  {
    siteUrl = process.env.SITE_URL || "",
    hreflangMap = hreflangMapDefault,
    defaultLang = defaultLangValue,
    seoDefaults = {},
  } = {},
) {
  const resolvedSiteUrl = cleanSiteUrl(site || siteUrl);
  const defaults = {
    ...defaultSeoValues,
    twitterSite: resolvedSiteUrl,
    twitterCreator: resolvedSiteUrl,
    ...seoDefaults,
  };

  const base = resolveBaseUrl(resolvedSiteUrl);
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const canonical = new URL(cleanPath, base).toString();
  const frPath = cleanPath.replace(/^en\//, "fr/");
  const enPath = cleanPath.replace(/^fr\//, "en/");
  const defaultPath = cleanPath.replace(/^en\//, "fr/");
  const xDefaultUrl = new URL(defaultPath, base).toString();

  const hrefLangs = (
    alternates && alternates.length
      ? alternates
      : [
          { lang: "fr", path: frPath },
          { lang: "en", path: enPath },
        ]
  )
    .map(({ lang, path: hrefPath, url }) => {
      const mappedLang = hreflangMap[lang] || lang;
      const target = url || new URL(hrefPath, base).toString();
      return { lang: mappedLang, url: target };
    })
    .reduce((acc, curr) => {
      if (
        !acc.some((item) => item.lang === curr.lang && item.url === curr.url)
      ) {
        acc.push(curr);
      }
      return acc;
    }, [])
    .concat([{ lang: "x-default", url: xDefaultUrl }])
    .reduce((acc, curr) => {
      if (
        !acc.some((item) => item.lang === curr.lang && item.url === curr.url)
      ) {
        acc.push(curr);
      }
      return acc;
    }, []);

  const title = overrides.title || defaults.title;
  const description = overrides.description || defaults.description;
  const image = overrides.image || defaults.image;
  const imageAlt = overrides.imageAlt || defaults.imageAlt;
  const siteName = overrides.siteName || defaults.siteName;
  const twitterSite = overrides.twitterSite || defaults.twitterSite;
  const twitterCreator = overrides.twitterCreator || defaults.twitterCreator;
  const effectiveLocale = locale || defaultLang;
  const mappedLocale =
    hreflangMap[effectiveLocale] || effectiveLocale || defaultLang;
  const ogLocale = effectiveLocale.startsWith("fr") ? "fr_FR" : "en_US";

  return {
    title,
    description,
    image,
    imageAlt,
    siteName,
    twitterSite,
    twitterCreator,
    canonical,
    locale: mappedLocale,
    ogLocale,
    hrefLangs,
  };
}

export function buildJsonLd(
  {
    locale = "en",
    path = "/",
    org = {},
    sameAs = [],
    openingHours = [],
    image,
    breadcrumbs = [],
    extras = [],
  } = {},
  {
    siteUrl = process.env.SITE_URL || "",
    seoDefaults = {},
    businessType = seoDefaults.businessType || "LocalBusiness",
  } = {},
) {
  const rootUrl = cleanSiteUrl(siteUrl);
  const defaultOrgUrl = resolveBaseUrl(rootUrl);
  const {
    name = "Your Business",
    url = defaultOrgUrl,
    telephone = "+00 0 00 00 00 00",
    streetAddress = "123 Placeholder St.",
    addressLocality = "City",
    postalCode = "00000",
    addressCountry = "XX",
    geo = { latitude: 0, longitude: 0 },
  } = org;

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    url,
  };

  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const webpage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    url: new URL(cleanPath, url).toString(),
    inLanguage: locale,
  };

  const localBusiness = {
    "@context": "https://schema.org",
    "@type": businessType,
    name,
    url,
    telephone,
    address: {
      "@type": "PostalAddress",
      streetAddress,
      addressLocality,
      postalCode,
      addressCountry,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: geo.latitude,
      longitude: geo.longitude,
    },
  };

  if (sameAs?.length) {
    localBusiness.sameAs = sameAs;
  }
  if (openingHours?.length) {
    localBusiness.openingHours = openingHours;
  }
  if (image) {
    localBusiness.image = image;
  }

  const structured = [website, webpage, localBusiness];

  if (breadcrumbs?.length) {
    structured.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map((item, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        name: item.name,
        item: item.url,
      })),
    });
  }

  if (extras?.length) {
    structured.push(...extras);
  }

  return structured;
}
