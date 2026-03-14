# Quality Scripts Architecture

## Context

This document defines the architecture direction for the quality testing subsystem in `yourwebsquad-toolkit`.

Current state:

- Quality checks are launched from consumer projects via `npm run test` (typically mapped to `yws-toolkit quality run`).
- Reports are generated under `reports/` and include mixed artifacts: HTML, JSON, logs, and markdown.
- Quality scripts currently mix multiple concerns in the same files:
- Data collection (crawl/audit/test execution)
- Result normalization and aggregation
- Rendering and styling (embedded HTML/CSS)
- Filesystem/report orchestration
- Some scripts in `scripts/` are unrelated to quality and should stay isolated from the quality architecture work.

The goal is to redesign quality scripts so data and presentation are decoupled, and reporting outputs become extensible (HTML today, PDF/dashboard tomorrow) without rewriting audit collectors.

## Requirements

Functional requirements:

- Keep `npm run test` workflow and current quality command entrypoints working.
- Separate quality data production from report presentation.
- Support multiple presentation layers from the same collected dataset:
- HTML (current baseline)
- PDF (new target option)
- Future dashboard-oriented outputs
- Allow re-rendering reports from previously collected datasets without rerunning audits.
- Support multiple saved datasets (snapshots) and comparative/evolution views over time.
- Define clear boundaries between:
- Orchestration/CLI
- Audit collectors
- Normalized data model
- Renderers/exporters
- Storage/snapshot management

Non-functional requirements:

- Keep command entrypoints stable while allowing internal report/data structure changes.
- Refactor incrementally to reduce implementation risk.
- Deterministic file layout and metadata for each dataset.
- Stable, versioned schema for normalized data.
- Testability at module level (collectors, normalizers, renderers) and integration level (CLI flows).

Scope requirements:

- Analyze every file in `scripts/` and classify quality-related vs non-quality.
- Produce a granular implementation task plan in this document using checklists.
- Do not start implementation until explicit user "go".

Out of scope for this phase:

- Refactoring consumer project code outside toolkit integration points.
- Rewriting all visual design immediately; architecture first, visuals second.

## Proposed Plan

### Summary

We will redesign the quality subsystem around immutable run snapshots, with data collection fully separated from rendering.
We will keep `npm run test` and existing entry commands functional while freely changing internal report/data structures.
We will deliver HTML first on top of the new data model, then add PDF and dashboard capabilities without changing collectors.

### Key Changes (Decision Complete)

- `scripts/` split by responsibility:
- Quality domain scripts: `run-quality-suite`, `lighthouse-audit`, `pa11y-crawl-and-test`, `seo-audit`, `link-check`, `jsonld-validate`, `security-audit`, `post-quality-comment`.
- Non-quality scripts stay separate: `clean`, `newpage`, `update-components`, `update-toolkit`, `bumpitup`.
- New internal architecture under `src/quality`:
- `orchestrator`: run lifecycle, target/env resolution, check scheduling.
- `collectors`: one collector per check, no HTML/CSS writing.
- `normalizers`: map raw tool outputs into canonical schema.
- `store`: snapshot persistence and lookup.
- `renderers`: format adapters (`html` first, `pdf` next, dashboard feed).
- `contracts`: schema versioning and validation.
- Canonical storage model (immutable snapshots):
- `reports/runs/<runId>/meta.json`
- `reports/runs/<runId>/dataset.json`
- `reports/runs/<runId>/raw/<check>/*`
- `reports/runs/<runId>/logs/*`
- `reports/views/html/<runId>/*` (presentation output, v1)
- `reports/views/pdf/<runId>/*` (presentation output, phase 2)
- `reports/latest.json` pointer to latest run id
- Public CLI/interface changes:
- Keep `yws-toolkit quality run` as entrypoint, now producing snapshot-based output.
- Add `yws-toolkit quality render --run <runId> --format <html|pdf>`.
- Add `yws-toolkit quality list-runs`.
- Add `yws-toolkit quality compare --base <runId> --head <runId>` (data-level diff; renderer can consume).
- Add run cleanup commands for development and maintenance:
- `yws-toolkit quality clean-runs --keep <N>`
- `yws-toolkit quality delete-run --run <runId>`
- `yws-toolkit quality prune-runs --older-than <days>`
- Canonical dataset contract (versioned):
- Top-level: `schemaVersion`, `runId`, `createdAt`, `target`, `checks`, `summary`.
- Per-check normalized payload: status, metrics, findings, pages, links to raw artifacts.
- No renderer-owned fields in collector outputs.

### Extensibility Model (Add New Tests Easily)

- The quality suite is plugin-like, based on a single `QualityCheck` contract.
- Each check module implements the same lifecycle:
- `collect` (tool execution and raw artifacts)
- `normalize` (raw -> canonical check payload)
- `summarize` (compact metrics for CLI/index rendering)
- Checks are registered through a central registry (`src/quality/core/registry.mjs`), not hardcoded in runner switch blocks.
- The orchestrator only iterates the registry and executes enabled checks; it does not contain per-check business logic.
- A project-level config (`quality.config.*`) controls enabled checks, order, thresholds, and check-specific options.
- Unknown/new checks still appear in report index and run metadata using generic renderer cards, even without custom templates.
- Data and presentation are strictly separated:
- `reports/runs/*` is data-only (canonical, raw, logs, metadata).
- `reports/views/*` is presentation-only (HTML/PDF exports).
- Run lifecycle management is built in:
- Keep/delete/prune operations must remove both run data (`reports/runs/<runId>`) and all associated views (`reports/views/*/<runId>`).
- Cleanup commands support `--dry-run` for safe preview.
- Cleanup commands prevent deleting the latest run unless `--force` is provided.
- Adding a new test should require only:
- Create `src/quality/checks/<checkId>/` with `collect`, `normalize`, `summarize`.
- Register check in registry.
- Add optional custom renderer partial.
- Add check fixtures + schema/normalizer tests.

### Completed During Planning

- [x] Context and requirements were documented in this file.
- [x] Target storage split was decided: `reports/runs/*` (data) vs `reports/views/*` (presentation).
- [x] Extensibility model was defined (`QualityCheck` contract + central registry + config-driven enablement).
- [x] Run lifecycle cleanup capabilities were defined (`clean-runs`, `delete-run`, `prune-runs` + `--dry-run`/`--force` rules).
- [x] Stable command-entrypoint policy was confirmed (`npm run test`, `yws-toolkit quality *`).

### Implementation Checklist

- [x] Write `contracts/run-schema-v1.json` and `contracts/check-schema-v1.json`.
- [x] Define `QualityCheck` interface contract (id, capabilities, collect, normalize, summarize).
- [x] Implement central check registry and replace hardcoded check branching with registry-driven execution.
- [x] Add `quality.config` loading and validation (enabled checks, order, thresholds, check options).
- [x] Create `src/quality/store` with snapshot writer/reader and `latest` pointer management.
- [x] Extract shared URL/crawl/normalization helpers from existing scripts into `src/quality/common`.
- [x] Convert Lighthouse script to collector + normalizer outputting canonical payload.
- [x] Convert Pa11y script to collector + normalizer outputting canonical payload.
- [x] Convert SEO script to collector + normalizer outputting canonical payload.
- [x] Convert Link script to collector + normalizer outputting canonical payload.
- [x] Convert JSON-LD script to collector + normalizer outputting canonical payload.
- [x] Convert Security script to collector + normalizer outputting canonical payload.
- [x] Add `src/quality/core/orchestrator.mjs` with `runQualityChecks(context)` entrypoint.
- [x] Move check execution order resolution into orchestrator (use `orderedSelectedChecks`).
- [x] Move check collect/normalize/summarize calls into orchestrator loop.
- [x] Return unified orchestrator result shape: `{ checks, failures, summaries, dataset }`.
- [x] Move dataset assembly out of `run-quality-suite.mjs` into orchestrator.
- [x] Keep `run-quality-suite.mjs` as CLI shell that delegates quality execution to orchestrator.
- [x] Add `src/quality/renderers/types.mjs` with renderer contract (`render(dataset, options)`).
- [x] Define artifact manifest structure in renderer layer (`format`, `runId`, `files[]`).
- [x] Add `src/quality/renderers/html/render-run.mjs`.
- [x] Add `src/quality/renderers/html/templates/layout.mjs`.
- [x] Add `src/quality/renderers/html/templates/check-card.mjs`.
- [x] Add `src/quality/renderers/html/assets/report.css` and remove inline CSS duplication from renderer output path.
- [x] Wire `scripts/quality-render.mjs` to call renderer interface instead of raw file copy for HTML.
- [x] Add HTML fallback card template for unknown/new checks.
- [x] Add HTML fallback detail section for unknown/new checks.
- [x] Add `src/quality/renderers/nav.mjs` for shared report navigation model.
- [x] Replace per-script `REPORT_NAV_MODEL` usage with renderer-provided navigation for generated views.
- [x] Ensure cross-report links are built only in renderer layer (no nav generation in check scripts).
- [x] Rework `post-quality-comment` to read canonical dataset instead of per-script ad hoc files.
- [x] Update CLI command routing to new quality modules while preserving command names.
- [x] Add `quality list-runs` command.
- [x] Add `quality render`, `quality list-runs`, `quality compare` commands.
- [x] Add `quality clean-runs --keep <N>` command.
- [x] Add `quality delete-run --run <runId>` command.
- [x] Add `quality prune-runs --older-than <days>` command.
- [x] Implement shared run cleanup service with `dry-run`, `force`, and latest-run protection.
- [x] Define and document final CLI flags (name, type, default, validation, examples) for all quality commands, including cleanup commands.
- [x] Update README quality docs with new run snapshot model and command examples.

### Test Plan

- [ ] Unit tests: schema validation for full dataset and each check payload.
- [ ] Unit tests: each normalizer maps representative raw outputs to canonical format.
- [x] Unit tests: registry loading and `quality.config` resolution/validation.
- [x] Unit tests: snapshot store read/write/list/latest pointer behavior.
- [ ] Integration tests: `quality run` (dev target) writes valid snapshot and HTML artifacts.
- [ ] Integration tests: `quality render --run <id> --format html` re-renders without recollection.
- [ ] Integration tests: `quality compare` returns stable diff payload for two snapshots.
- [ ] Integration tests: cleanup commands delete matching run data and all associated view outputs.
- [ ] Integration tests: cleanup `--dry-run` reports actions without deleting files.
- [ ] Integration tests: latest-run deletion blocked unless `--force`.
- [ ] Integration tests: add a synthetic check plugin fixture and verify it appears without orchestrator changes.
- [ ] Regression tests: `npm run test` still invokes `yws-toolkit quality run` successfully.

### Assumptions and Defaults

- Chosen by you:
- Data scope: immutable Run Snapshot model.
- Renderer priority: HTML first on new architecture.
- Compatibility strategy: stable command entrypoints (`npm run test`, `yws-toolkit quality *`), internal structure can evolve freely.
- Default behavior:
- `quality run` always creates a new `runId`.
- HTML is rendered by default after collection.
- PDF renderer is phase 2 and consumes existing canonical dataset only.

## Migration Status (Updated March 14, 2026)

- Completed in code:
- Orchestrator now resolves ordered execution plan from config/selection.
- Quality checks execute through orchestrator loop (`runQualityChecks`) using `checksPlan`.
- Orchestrator return shape is unified: `{ checks, failures, summaries, dataset }`.
- Canonical dataset assembly was moved out of `scripts/run-quality-suite.mjs` into `src/quality/core/dataset.mjs`, and is invoked through orchestrator.
- `run-quality-suite` now consumes orchestrator failures/dataset outputs and only performs run-id finalization for persisted dataset.
- `run-quality-suite` now publishes `reports/` using renderer output (`quality-render`) so the active HTML UI comes from template files under `src/quality/renderers/html/templates`.

- Still to complete in this migration sequence:
- Keep `run-quality-suite.mjs` as a thinner CLI shell delegating orchestration concerns to `src/quality/core/orchestrator.mjs`.
- Move remaining report navigation/cross-link generation fully into renderer layer.
- Add missing schema/normalizer/integration/regression tests listed in checklist.
