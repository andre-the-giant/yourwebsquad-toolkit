# ToolFuckinKit

Shared CLI tooling for projects based on `yourwebsquad-boilerplate`.

It centralizes formatting, quality checks, dependency updaters, and page scaffolding so consumer projects stay lean and consistent.

<img src="https://yourwebsquad.com/img/logo-black-square.png" width="200">

https://YourWebSquad.com

## Introduction

Use a pinned GitHub tag in the consumer project's `package.json`:

```json
{
  "dependencies": {
    "yourwebsquad-toolkit": "github:andre-the-giant/yourwebsquad-toolkit#v1.2.0"
  }
}
```

Then install:

```bash
npm install
```

## CLI usage

The binary is `yws-toolkit`.

```bash
yws-toolkit --help
```

Available commands:

- `yws-toolkit format [--check] [-- <prettier args>]`
  - Runs Prettier with Astro plugin resolution from toolkit.
  - Defaults to `--write` when `--check` is not provided.
- `yws-toolkit clean [-- <args>]`
  - Cleans current workspace by removing: `.lighthouseci`, `build`, `reports`, `.astro`, `node_modules`, `package-lock.json`.
- `yws-toolkit scaffold newpage`
  - Interactive page generator. Single-locale projects scaffold root non-segment routes; multilingual projects scaffold localized segment or non-segment routes.
- `yws-toolkit quality <run|a11y|seo|links|jsonld|security|comment|render|compare|list-runs|delete-run|clean-runs|flush-runs|prune-runs> [-- <args>]`
  - Runs quality checks from the current project directory.
- `yws-toolkit update <components|toolkit> [-- <args>]`
  - Interactive tag-based dependency updater for:
    - `yourwebsquad-components`
    - `yourwebsquad-toolkit`

## Recommended npm scripts (consumer project)

```json
{
  "scripts": {
    "format": "yws-toolkit format .",
    "format:check": "yws-toolkit format --check .",
    "jsonld:check": "yws-toolkit quality jsonld",
    "test": "yws-toolkit quality run",
    "test:a11y": "yws-toolkit quality a11y",
    "test:seo": "yws-toolkit quality seo",
    "test:links": "yws-toolkit quality links",
    "test:security": "yws-toolkit quality security",
    "test:clean": "yws-toolkit quality flush-runs",
    "clean": "yws-toolkit clean",
    "newpage": "yws-toolkit scaffold newpage",
    "updatecomponents": "yws-toolkit update components",
    "updatetoolkit": "yws-toolkit update toolkit"
  }
}
```

## Helpers

Helper modules are exported as package subpaths.

Import pattern:

```js
import { createStorageHelpers } from "yourwebsquad-toolkit/helpers/storage";
```

Available helper modules:

- `yourwebsquad-toolkit/helpers/content`
- `yourwebsquad-toolkit/helpers/jsonld`
- `yourwebsquad-toolkit/helpers/props`
- `yourwebsquad-toolkit/helpers/segments`
- `yourwebsquad-toolkit/helpers/seo`
- `yourwebsquad-toolkit/helpers/storage`

### `helpers/content`

Export: `createContentHelpers(options?)`

Options:

- `contentRoot` (`string`): root folder for content files. Default: `public/content` in current project.
- `cache` (`Map`): optional shared cache map.

Exposed methods:

- `getContent(locale = "en", slug)`: loads and caches `public/content/<locale>/<slug>.json`.
- `getCompany(slug)`: loads and caches `public/content/company/<slug>.json`.
- `clearContentCache()`: clears in-memory content cache.

### `helpers/jsonld`

Export: `createJsonLdScript(nodes)`

Exposed methods:

- `createJsonLdScript(nodes)`: serializes JSON-LD nodes into a `<script type="application/ld+json">...</script>` string.

### `helpers/props`

Export: `validateProps(schema, props)`

Exposed methods:

- `validateProps(schema, props)`: validates props against a schema and throws on invalid values.

Supported schema rule fields:

- `required` (`boolean`)
- `type` (`"string" | "number" | "boolean" | "object" | "array"`)
- `validate` (`(value) => boolean | string`)

### `helpers/segments`

Export: `createSegmentHelpers(options?)`

Options:

- `segments` (`object`): segment map by key and locale (for example `artist: { en: "artist", fr: "artiste" }`).

Exposed methods:

- `getSegment(locale = "en", key = "artist")`: returns localized segment value.
- `assertSegmentMatch(locale, key, value)`: throws when value does not match expected localized segment.
- `getSegmentKey(segmentValue)`: resolves segment key from a localized segment value.
- `mapSegmentToLocale(segmentValue, targetLocale = "en")`: maps a segment value to another locale.
- `pathFor(locale = "en", key = "artist", slug)`: builds route path (for example `/en/artist/slug/`).
- `alternatesFor(key = "artist", slug)`: returns alternate localized paths array.
- `segments`: original segments map.

### `helpers/seo`

Exports:

- `buildSeo(input?, options?)`
- `buildJsonLd(input?, options?)`

`buildSeo` method details:

- Builds canonical URL, hreflang links, OG/Twitter fields, and merged defaults.
- Returns: `title`, `description`, `image`, `imageAlt`, `siteName`, `twitterSite`, `twitterCreator`, `canonical`, `locale`, `ogLocale`, `hrefLangs`.

`buildJsonLd` method details:

- Builds a JSON-LD array for website/webpage/local business plus optional breadcrumbs and extras.
- Returns an array of schema nodes ready to render.

### `helpers/storage`

Export: `createStorageHelpers(options?)`

Purpose:

- Uses `localStorage` when available.
- Automatically falls back to cookies when `localStorage` is unavailable.

Options:

- `prefix` (`string`): optional key prefix to namespace all entries.
- `cookie` (`object`): cookie defaults when fallback is used.
- `storage` (`Storage`): custom storage object override.
- `documentRef` (`Document`): custom document object override.

Supported cookie fields:

- `path` (`string`, default `/`)
- `sameSite` (`string`, default `Lax`)
- `secure` (`boolean`)
- `domain` (`string`)
- `maxAge` (`number`, default one year in seconds)

Exposed methods:

- `backend`: `"localStorage"`, `"cookie"`, or `"none"` based on selected backend.
- `setItem(key, value, options?)`: stores a string value.
- `getItem(key)`: returns stored string value or `null`.
- `getOrCreate(key, valueOrFactory, options?)`: returns existing value or writes/returns a new one.
- `hasItem(key)`: boolean existence check.
- `removeItem(key, options?)`: removes one key.
- `clear(options?)`: removes all keys managed by this helper (respecting `prefix`).
- `key(index)`: returns key name by index or `null`.
- `keys()`: returns all key names managed by this helper.
- `length()`: returns number of managed keys.
- `setJson(key, value, options?)`: serializes and stores JSON.
- `getJson(key, fallback = null)`: parses JSON and returns fallback on missing/invalid data.

## `scaffold newpage` prerequisites

The generator expects boilerplate-style structure in the target project (`process.cwd()`):

- `public/content/en/menu.json`
- `public/content/fr/menu.json`
- `src/helpers/segments.js`
- `src/pages/[lang]/...` for localized routes
- `src/pages/...` for single-locale projects with `i18n.routing.prefixDefaultLocale: false`

Route selection rules:

- Single-locale + `prefixDefaultLocale: false`: non-segment root routes only (`/slug/`)
- Multilingual: choose between segment (`/[lang]/[segment]/`) and non-segment (`/[lang]/[slug]/`) routes

It also requires a clean git working tree before making changes.

## `quality run` target environments

`yws-toolkit quality run` now prompts for:

- `development` (default): uses `BASE_URL` or `http://localhost:4321`, builds locally, and serves `./build`.
- `production`: uses `SITE_URL` from environment variables or `.env` / `.env.local`.
- `staging`: uses `STAGING_URL` from environment variables or `.env` / `.env.local`.

Optional flags:

- `--target development|production|staging`
- `--base <url>` (overrides target and runs against the exact URL)

### Check availability by environment

The test selection prompt adapts to the selected target environment.

- `development`:
  - JSON-LD validation: available
  - Security audit: unavailable (requires remote server target)
- `staging` / `production` / `--base` (remote):
  - JSON-LD validation: unavailable (local build only)
  - Security audit: available

### Run snapshots

`yws-toolkit quality run` now also writes immutable snapshots:

- Data layer: `reports/runs/<runId>/`
- Presentation layer: `reports/views/html/<runId>/`
- Latest pointer: `reports/latest.json`

`reports/index.html` and per-check report folders are still generated for immediate viewing.

### Quality command flags

`yws-toolkit quality render`

- `--run <runId>`: run to render into `reports/` (defaults to latest run).
- `--format <html|pdf>`: view format to materialize (currently `html` available).

`yws-toolkit quality compare`

- `--base <runId>`: baseline run id.
- `--head <runId>`: target run id to compare against baseline.

`yws-toolkit quality list-runs`

- No required flags. Lists known runs and marks latest.

`yws-toolkit quality clean-runs`

- `--keep <N>`: keep newest `N` runs, target older ones for deletion.
- `--dry-run`: show what would be deleted without deleting.
- `--force`: allow deleting latest run when it is targeted.

`yws-toolkit quality flush-runs`

- Deletes all run history (`keep=0`, `force=true`).
- `--dry-run`: preview deletions without deleting.

`yws-toolkit quality delete-run`

- `--run <runId>`: run id to delete.
- `--dry-run`: preview paths that would be deleted.
- `--force`: allow deleting latest run.

`yws-toolkit quality prune-runs`

- `--older-than <days>`: target runs older than this age.
- `--dry-run`: show what would be deleted without deleting.
- `--force`: allow deleting latest run when it matches prune criteria.

### Lighthouse output

When Lighthouse is selected in `yws-toolkit quality run`, the generated summary now includes:

- HTML size (document transfer size)
- Total loaded size (HTML + all loaded resources transfer size)
- Total load time
- Live per-page progress in quiet mode (`➡️  Lighthouse (quiet logging)` then `assessing page X / Y`)

Generated files:

- `reports/lighthouse/summary.html`
- `reports/lighthouse/SUMMARY.md`
- `reports/lighthouse/metrics.json`

### JSON-LD output

When JSON-LD validation is selected on `development`, reports are generated under `reports/jsonld`:

- `report.html`: summary table (`URL`, `Errors`, `Warnings`, `Report`)
- `pages/*.html`: one detail report per page, including extracted schema and issue details
- `issues.json`: all JSON-LD issues
- `stats.json`: aggregate counts (`pagesTested`, `errorCount`, `warningCount`, ...)
- `report.txt`: compatibility text summary with pointers to artifacts

## Security checks

`yws-toolkit quality security` runs:

- MDN HTTP Observatory (`@mdn/mdn-http-observatory`)
- `testssl.sh` (optional; enable with `--with-testssl` or `SECURITY_USE_TESTSSL=1`)

Generated files:

- `reports/security/report.html`
- `reports/security/SUMMARY.md`
- `reports/security/stats.json`
- `reports/security/testssl.json` (when testssl is enabled)

## Release / versioning

This repo uses git tags (`vX.Y.Z`) as consumable versions.

From toolkit repo:

```bash
npm run bumpitup
```

Then consumer projects can update with:

```bash
npm run updatetoolkit
```

## Local development (toolkit repo)

- `npm run toolkit -- --help` to test the CLI entry.
- `npm run format` to format this repository.
