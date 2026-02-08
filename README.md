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
  - Interactive page generator (segment and non-segment routes).
- `yws-toolkit quality <run|a11y|seo|links|jsonld|comment> [-- <args>]`
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
    "clean": "yws-toolkit clean",
    "newpage": "yws-toolkit scaffold newpage",
    "updatecomponents": "yws-toolkit update components",
    "updatetoolkit": "yws-toolkit update toolkit"
  }
}
```

## `scaffold newpage` prerequisites

The generator expects boilerplate-style structure in the target project (`process.cwd()`):

- `public/content/en/menu.json`
- `public/content/fr/menu.json`
- `src/helpers/segments.js`
- `src/pages/[lang]/...`

It also requires a clean git working tree before making changes.

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
