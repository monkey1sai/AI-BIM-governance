# ADR: Deepen CFD Settings Catalog

## Status

Proposed on 2026-09-29 from the architecture review of 2026-09-24 (candidate A). The repository owner confirmed the recommended answer to every question in the Grilling Record on 2026-09-29. Accepted on merge to `main` (PR #961). Implemented: bullets 1–4 in PRs #964, #965, #966 and #967 (merged 2026-09-30), bullet 5 (this documentation pass) closes §5. Not yet deployed to canonical Linux 181; the §Verification item 5 browser E2E waits for a second preset in `cfd_options.json`, which is a settings phase C decision.

Relates to `docs/plans/building-energy-cfd-b-engine-params.md` §4, whose "one copy per place plus consistency tests" route (implemented by B1b, PR #954) this decision replaces. No change to the CFD Case Run or CFD Run Workflow decisions; no change to any run-time payload.

Amended on 2026-09-30 while implementing tracer bullet 2 (§5): the ledger origin cannot be derived from `ORIGIN_FIELDS` and leave the OpenAPI document unchanged, because today's `cfdRunOrigin` requires its six S7 fields and bounds none of `end_time`, `n_procs` and `background_cell_m`. Bullet 2 therefore derives the request sections and the `fieldKey` enumeration only (OpenAPI byte-identical), and the origin derivation moves to bullet 3, which rewrites the ledger JSON schema anyway; the origin shape then becomes uniform (every catalog key nullable and optional, request bounds applied), an additive change recorded there. The generated TypeScript also carries `required` per setting, read from each request section's `required` list, because the zod builder needs it and it is a schema fact rather than an annotation.

Amended on 2026-09-30 while implementing tracer bullet 4 (§5): the viewer keeps the preset-controlled keys the panel does not show inside its form state (seeded from the standard preset, rewritten by `applyPreset`, sent by `buildSettings`), which is how matching over every preset key works without a request-side preset id (Grilling Record Q3). The unverified-preset limitation needs the presets' `verified` flags, so `custom_settings_limitation` takes the options; the runner has no options handle and reads the service's versioned file through `default_options()`, falling back to the field-level wording if that file is unreadable. `_layout_params` stays as a thin view over the new `_engine_params` for its existing callers. Bullets 1–4 are implemented; bullet 5 (documentation) remains.

## Context

Paths: `M` = `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging`.

After settings phase B1b (`main` b37e22f) one panel-exposed CFD setting is restated in: the request schema and its verbatim copy in the estimate-request schema (`tests/contracts/cfd-run-request-v1.schema.json`, `cfd-estimate-request-v1.schema.json`); three `fieldKey` enumerations (`cfd-options-v1`, `cfd-estimate-v1` `custom_fields`, the coordinator zod enum); `REQUEST_FIELD_BOUNDS`, `PRESET_KEYS` and `MESH_LAYOUT_FIELDS` (`M/cfd_options.py`, `M/cfd_job_service.py`); the zod bounds (`bim-review-coordinator/src/contract/schemas/cfd.ts`); the ledger origin in four shapes (`cfd-run-ledger-record-v1.schema.json`, zod, `cfdRunLedger.ts`, `cfdRunWorkflow/workflow.ts`); `panel_fields` in `M/cfd_options.json`; the viewer's origin maps (`cfdSettings.ts`, `WindEnvironmentPanel.tsx`). Adding one numeric panel knob touches 17 files in four languages plus two regenerated files. Every pair is now pinned by a test (`tests/test_cfd_contracts.py:188-250`, `bim-streaming-server/tests/test_cfd_options_estimate.py:105`), so a missed copy fails CI instead of drifting, but each copy is still a hand edit.

Presets are recognised only as `standard`: `settings_profile` (`M/cfd_options.py:270-284`) compares a request with the standard preset alone, and the viewer derives a preset id from the fields shown on the form (`web-viewer-sample/src/console/unified/cfdSettings.ts:91-135`), so two presets that differ only in a hidden key cannot be told apart, selected or sent. Settings phase C intends verified "fast" and "fine" presets.

The repository already has one cross-language declaration: `tests/contracts/kit-datachannel-v1.schema.json` with `x-kit-*` annotations, a Node generator writing committed data-only files for three runtimes, `source-sha256` drift tests and a `--check` job in `pr-safety` ([kit-command-vocabulary-adr.md](kit-command-vocabulary-adr.md)).

Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Grilling Record

The repository owner confirmed the recommended answer for each question (2026-09-29).

| Question | Recommended answer (adopted) | Strongest objection | Adjudication |
|---|---|---|---|
| Where does the single declaration live? | In `cfd-run-request-v1.schema.json`: every setting carries `x-cfd-setting` (section, preset-controlled, unit, step, zh/en label and help, the `CaseParams` field it drives). A Node generator, following the Kit Command Vocabulary pattern, writes committed data files for the streaming host, the coordinator and the viewer. | A contract file starts carrying UI copy. | It is the only option that keeps "the schema is the highest standard" (S0) unchanged; `cfd_options.json` as source would make the frozen schema a generated artifact, and `CaseParams` as source needs a second declaration for the request keys that are not engine fields (`preprocess.*`, `uref_m_s`, `n_procs`). |
| What is generated, what stays hand-written? | Data files only; each runtime builds its validator from the data in its own language (the Python validator already loops over the bounds table; the coordinator gains a small builder turning bounds into zod sections, types still inferred). The generator also rewrites four fixed addresses: the three `fieldKey` enumerations and the four setting sections of the estimate-request schema, refusing any other difference in those files. | The Kit Command Vocabulary decision keeps validators hand-written and rejects generated validators. | The validators are still owned and written by `schemas/cfd.ts` and `cfd_job_service.py`; only their input is data. The builder covers number, integer, minimum, maximum, exclusive minimum, nullable, optional and string enum, and refuses any declaration outside that set instead of guessing. |
| How are presets declared and recognised? | Values stay in `cfd_options.json`; the catalog only says which keys a preset controls. The server derives `preset_match` by comparing the request with every preset key by key; `parse_options_config` refuses two presets with identical values, so at most one matches. `custom_fields` stays relative to `standard`; a match on a preset with `verified: false` yields a "unverified preset" limitation instead of "custom settings". The viewer applies and matches presets over all preset keys, hidden ones included. | A `preset_id` in the request would let two presets share values. | Same values under two names is treated as a defect. If phase C needs it, an additive `preset_id` can be added then. |
| Which keys does the ledger origin record, and which values? | Every catalog key; the four origin shapes are derived from one `ORIGIN_FIELDS` constant. The value is the one the request carried, `null` when omitted (today's B1b meaning: the engine default applied at run time). `wind_from_degrees` and `session_id` are not settings and stay hand-written. | Recording effective values would make old runs self-describing. | The coordinator has no engine defaults; `preset_match` already answers whether a run used the standard preset, and recording request values keeps old ledger records stable when a default changes. |
| Which tests survive? | Pairwise equality tests replaced by generation are deleted in favour of `source-sha256` drift tests (root pytest, viewer Vitest against a fresh render) and a `--check` CI job. Value-level pins (standard preset equals `CaseParams` and profile defaults) stay. Interface behaviour tests stay and gain: out-of-bounds 400, omitted fields take defaults, unknown fields refused, multi-preset recognition, duplicate-preset refusal, viewer matching over hidden keys, and request values reaching `case_meta.params`. Position-indexed and whole-object assertions are rewritten to look up by key. | Drift tests prove freshness, not correctness. | Which is why the behaviour tests are not optional. |
| Cutover order and name? | ADR first, then five tracer bullets (§5); the term is **CFD Settings Catalog**. | — | — |

## Decision

### 1. Responsibility boundary

Introduce one deep module named **CFD Settings Catalog**. Its declaration is the `x-cfd-setting` annotation on every setting in `tests/contracts/cfd-run-request-v1.schema.json`; its implementation is `web-viewer-sample/scripts/generate-cfd-settings-catalog.mjs` (Node built-ins only) and the committed data files it writes. It owns: the list of settings, their sections, types and bounds, which of them a preset controls, their panel metadata, the engine field each drives, and the set recorded in the ledger origin.

It does not own: preset values, `verified` flags, estimate calibration and confirmation thresholds (`M/cfd_options.json`); engine defaults (`CaseParams`, `PreprocessProfile`); request validation and error codes (each runtime); the compute cap; which fields the panel shows (`panel_fields` selection remains a phase C decision).

### 2. Public surface

Generated, committed, data-only, each starting with `source-sha256` of the LF-normalised schema:

- `M/cfd_settings_catalog.py`: `SETTINGS` (key → section, type, bounds, preset-controlled, engine field, panel metadata), `PRESET_KEYS`, `ENGINE_FIELDS` (request key → `CaseParams` field), `ORIGIN_FIELDS`, `SECTIONS`.
- `bim-review-coordinator/src/generated/cfd-settings-catalog.ts`: the same tables as typed constants.
- `web-viewer-sample/src/generated/cfd-settings-catalog.ts`: the same tables.

Rewritten in place by the generator, at exactly these addresses and nowhere else: `$defs.fieldKey.enum` in `cfd-options-v1.schema.json`, `$defs.settingsProfile.properties.custom_fields.items.enum` in `cfd-estimate-v1.schema.json`, the origin setting properties in `cfd-run-ledger-record-v1.schema.json`, and the `preprocess`, `wind`, `mesh` and `solver` properties of `cfd-estimate-request-v1.schema.json`.

Existing owners keep their public names and import the data internally: `cfd_options.py` (`REQUEST_FIELD_BOUNDS`, `PRESET_KEYS`, `settings_profile`, `build_options_document`), `cfd_job_service.py` (`validate_run_request`, `_layout_params` → `ENGINE_FIELDS`), `schemas/cfd.ts` (`cfdMeshSettings` and the other three sections built from the catalog), `cfdRunWorkflow/workflow.ts` and `cfdRunLedger.ts` (origin from `ORIGIN_FIELDS`), `cfdSettings.ts` (`applyPreset`, preset matching, `settingsFromOrigin`).

### 3. Preset recognition

`settings_profile` returns `preset_match` as the id of the one preset whose values equal the request on every preset key (the manual true-north angle is ignored unless the source is manual, as today), else `null`; `custom_fields` lists the keys that differ from `standard`. `custom_settings_limitation` states an unverified preset by id when the match is a preset with `verified: false`. `parse_options_config` refuses a configuration in which two presets have identical values.

### 4. Ledger origin

`origin` records every catalog key with the value the request carried, `null` when omitted; the schema, zod, TypeScript type and workflow assembly all derive from `ORIGIN_FIELDS`. The ledger schema stays additive: a new catalog key adds one optional origin property.

### 5. Incremental cutover

0. This ADR and the `CONTEXT.md` term (this PR).
1. Annotate the schema; add the generator, the streaming data file, the root drift test and the `cfd_catalog` CI scope job; `cfd_options.py` and `cfd_job_service.py` import the data. `build_options_document` output is byte-identical to `main`.
2. Coordinator: zod sections, `fieldKey` and origin derived from the generated constants; `contract:emit` re-run; viewer types regenerated. The OpenAPI diff is empty.
3. The generator takes over the four JSON addresses; the equality tests it replaces are deleted.
4. Preset recognition (§3), viewer matching and applying over all preset keys, origin maps as loops, and the `case_meta.params` arrival test. The only bullet that changes behaviour.
5. Documentation: `building-energy-cfd-b-engine-params.md` §4 notes the replacement; `tools/cfd/README.md`.

## Considered Options

- Keep one copy per place with consistency tests (B contract §4, as implemented by B1b): rejected; every knob is still about fifteen hand edits, and the tests guard only the pairs someone named.
- `cfd_options.json` as the declaration, schemas generated from it: rejected; it inverts S0 and makes the frozen contract a generated artifact.
- `CaseParams` field metadata as the declaration: rejected; request keys are not engine fields one-for-one, and it needs the Python → JSON → TypeScript chain the Kit Command Vocabulary decision rejected in the other direction.
- Generate validator code: rejected for the reasons given in the Kit Command Vocabulary decision.
- Introduce CFD Settings Catalog: accepted.

## Consequences

### Positive

- A setting is declared once; a missed consumer fails at generation or `--check`, not in review.
- Phase C presets are named, recognised and honestly labelled without a contract change.
- `cfd_options.py` and `schemas/cfd.ts` lose their hand-kept tables; `cfdRunRoutes`, `workflow.ts` and the viewer lose their per-field lists.

### Negative

- The request schema carries panel copy in two languages.
- Four addresses in three contract files are no longer hand-editable; edits there are rejected by `--check` and must go through `x-cfd-setting`.
- The zod builder is one more small module with its own tests, and settings whose shape it does not cover stay hand-written next to the derived sections.

## Verification

1. Root: `pytest tests/test_cfd_contracts.py -q` and the new drift test; `node web-viewer-sample/scripts/generate-cfd-settings-catalog.mjs --check`.
2. `bim-streaming-server`: `pytest tests/test_cfd_options_estimate.py tests/test_cfd_job_service.py tests/test_cfd_openfoam_runner.py -q`; `tools/cfd`: `pytest tests -q`.
3. `bim-review-coordinator`: `npm run contract:check`, `npx vitest run tests/cfd-run-workflow.test.ts tests/cfd-run-routes.test.ts tests/browser-contract-drift.test.ts`.
4. `web-viewer-sample`: `npx vitest run src/console/unified/cfdSettings.test.ts src/console/unified/WindEnvironmentPanel.test.tsx`, `npx tsc --noEmit`.
5. After bullet 4, one browser E2E on the console: options load, preset switch including a hidden-key preset, estimate, submit, run detail shows the recorded origin; request/response pairs recorded under `docs/evidence/`.
6. `git diff --check`; `scripts/deploy.ps1` unchanged.

## Rollback

Source revert per tracer bullet. Generated files are committed, so reverting a bullet restores the previous hand-written tables; no persisted state or payload changes.
