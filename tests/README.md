# `tests/` — repo-root contract fixtures & external-platform fakes

These artifacts exist so that **deleting `_worker/` and `_bim-control/`**
(OpenSpec change `local-coordinator-ifc-ready-intake-boundary`, T2 BREAKING)
does not strand verification capability.

> **Not a runtime profile.** Per `design.md` D4 these are TEST-ONLY doubles.
> They MUST NOT be started by product runtime, `compose.*`, `scripts/start-all`,
> health checks, or smoke as services. The company cloud `bim-control` and the
> customer-edge IFC Worker are **external** systems; this repo only simulates
> them in tests.

## Layout

| Path | Replaces | Purpose |
|---|---|---|
| `contracts/ifc_ready_payload.json` | external IFC Worker → coordinator request | Frozen `POST /api/external/ifc-ready` payload contract (T3 anchor) |
| `contracts/conversion_result_callback.json` | coordinator → company cloud callback | Frozen metadata-only callback contract; **T5.4 / OQ1 mitigation** (real endpoint stays `pending`) |
| `fakes/external_ifc_worker_client.py` | historical worker flow-driver role | Build / POST a spec-correct ifc-ready request |
| `fakes/cloud_bim_control_api.py` | external company cloud control-plane double | Receive callbacks + **enforce metadata-only**; minimal control-plane reads |

## Endpoint replacement map (deleted services → fake/contract)

Historical `_worker` — IFC source list / conversion create+query / artifact-group
readiness: under B-scheme the external entry becomes the coordinator
`POST /api/external/ifc-ready` (T3) and `bim-streaming-server` internal
conversion (T4). `fakes/external_ifc_worker_client` drives the ifc-ready side;
the conversion engine is exercised via `bim-streaming-server` tests.

Historical `_bim-control` — conversion-result callback receiver + control-plane
metadata reads: replaced by `fakes/cloud_bim_control_api` (callback receipt with
the metadata-only guard, plus `get_model_version_artifacts` /
`get_review_issues` doubles the coordinator uses).

## Open Question status (do NOT block apply body)

- **OQ1** company-cloud callback endpoint/auth → frozen in
  `conversion_result_callback.json`; real wiring is T5.4 `pending`.
- **OQ2/OQ3** artifact ref scheme / external id format → placeholder example
  values; swap when the external platform team confirms.
- **OQ4/OQ5** Service-auth issuance / SSO → `intranet-dev` AuthProvider shape
  frozen; replaceable provider, T7.3 `pending`.

## Deletion (T2) prerequisite checklist — gated on user confirmation

- [x] `tests/contracts/` frozen from current spec + existing event shapes
- [x] `tests/fakes/` contract-anchored doubles created (non-destructive, additive)
- [x] (T2) rewire smoke/tests to fakes; remove `_worker`/`_bim-control` from
      `start-all`/health/compose; delete the two service directories
- [x] (T2) GitNexus impact analysis on affected symbols before deletion;
      HIGH/CRITICAL reported first

> T2 destructive work has completed in PR #63. These fakes remain test-only
> verification doubles and must not be promoted into runtime services.
