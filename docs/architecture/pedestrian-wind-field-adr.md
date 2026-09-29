# ADR: Deepen Pedestrian Wind Field

## Status

Proposed on 2026-09-30 from the architecture review of 2026-09-24 (candidate D). The repository owner confirmed the recommended answer to every question in the Grilling Record on 2026-09-30. Accepted when this document merges to `main`; implementation follows the tracer bullets in §5.

This is the one candidate of that review that adds routes, so the design document's `c4-cfd-api` card and `docs/agents/repository-boundaries.md` change in the same PR as this ADR; the owner's confirmation of the Grilling Record is the decision the repository's rule for new APIs asks for. No change to the CFD Case Run, CFD Run Workflow or CFD Settings Catalog decisions; owner decision D6 (run results stay with the streaming host) is unchanged.

## Context

Paths: `M` = `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging`.

A finished wind direction leaves one number in `cfd-run-result/v1`: `pedestrian_1p5m.U_magnitude_max` (`M/cfd_job_service.py:662`). The sampled plane itself, clipped to the building bbox ± 3H with one `|U|` per polygon (about 20,000 polygons), sits in the overlay layer; `M/cfd_pipeline/usd_results.py:181` computes the minimum and drops it, and the area-weighted mean and 95th percentile exist only in the CLI convergence study (`M/cfd_pipeline/convergence.py:137`). The result carries no location, so the coordinator's finding rule can only say "this direction exceeds the threshold" (`bim-review-coordinator/src/services/cfdRunWorkflow/workflow.ts:423`) and open a governance annotation on the whole pedestrian prim without an `ifc_guid` (`findingIssuePayload.ts`). Governance stores such a finding as `kind=annotation` (its trigger refuses a formal issue without `ifc_guid` and `model_version_id`), the BCF export skips annotations (`governance-service/bcf/bcf_writer.py:106`), the 3D highlight needs a guid (`web-viewer-sample/src/console/governance/issueHighlightItems.ts:8`) and the model-version diff's issue impact reads `kind=issue` only. The viewer copies the legend's colour scale and unit into constants (`WindEnvironmentPanel.tsx:93-98`) although the layer authors them as `customData cfd:legend`.

What exists to close the loop: the converted `model.usdc` keeps every element as `/World/Elements/<IfcClass>/G_<GlobalId>` with its triangles and `bim:ifc_guid` (`M/cfd_pipeline/usd_geometry.py:58-99`); the exclusion list carries the guids of the elements the shell dropped, doors included (`M/cfd_pipeline/preprocess.py:97-106`); the finding threshold is chosen by the user at finding time (0.5–30 m/s), not at solve time.

Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Grilling Record

The repository owner confirmed the recommended answer for each question (2026-09-30).

| Question | Recommended answer (adopted) | Strongest objection | Adjudication |
|---|---|---|---|
| Where and when are the exceedance zones computed? | On demand, by a Pedestrian Wind Field module on the streaming host: `GET /api/cfd-runs/{run_id}/directions/{tag}/exceedance?threshold_u_m_s=` derives the zones and their elements from the stored sampled plane, cached per (run, tag, threshold); the coordinator's finding workflow calls it and proxies it to the panel. The result gains `U_mean` (area-weighted), `U_p95` and `U_min`. | A new route means the design document and the boundaries file change first. | The threshold belongs to the user and the field data belongs to the streaming host (D6); only an on-demand query keeps both. Pre-computing a fixed set of thresholds would turn the panel's free input into a menu; letting the coordinator parse the field would move result authority. |
| Which elements does a zone belong to? | Candidates are every element of `model.usdc` whose z-range meets the pedestrian band [ground, ground + 3 m], any class, doors included; a zone is attributed to the up to three nearest candidates whose XY-footprint distance is ≤ 2 m, with the distance recorded. A zone is a set of over-threshold polygons connected through shared vertices; zones under 1 m² are dropped. A zone with no candidate returns `elements: []`. | Restrict to the shell classes. | Doors and entrances are exactly the places a reviewer wants named. Nearest-one would miss the second wall at a corner; no cap would pull in dozens of curtain-wall members. Storey or `IfcSpace` attribution is not possible with this data (no space boundaries, duplicated storey names). |
| How do zones become issues? | One issue per element per run, aggregated across directions (each exceeding direction's peak, zone area and distance in the description; severity is the worst, `high` above 1.5 × threshold). With a `model_version_id` the issue is `kind=issue` with the element's `ifc_guid`; without a session it stays an annotation naming the guid. `usd_prim_path` remains the pedestrian-plane prim of the worst direction (the Issue Center CFD filter and the overlay location stay valid; the element is located by guid). A direction whose zones have no elements opens one direction-level annotation with the zone centroid and area. The ledger finding key becomes (run, `ifc_guid` or direction, threshold, model binding); existing direction-level findings are kept as they are. | One issue per element per direction. | Sixteen directions would give one door sixteen issues. |
| Which contracts change? | New `cfd-exceedance/v1` (streaming route plus coordinator pass-through `GET /api/cfd/runs/{runId}/directions/{deg}/exceedance`, declared in the Coordinator Browser Contract). Additive on `cfd-run-result/v1`: `pedestrian_1p5m.U_mean`, `U_p95`, `U_min` and a per-direction `legend` (colour scale, pressure range and units, taken verbatim from the layer's `cfd:legend`); the viewer reads it and drops its constants. Additive on the finding response and the ledger finding: `elements[]` with `ifc_guid`, `ifc_type`, `distance_m`. | Keep the legend in the viewer. | The unit mislabel found in the review is what a copied legend produces. |
| Tests, cutover and name? | Behaviour tests at each interface (§Verification); `U_mean` shared with the CLI study through one function; one real run on 181 for evidence; five tracer bullets (§5); the term is **Pedestrian Wind Field**. | — | — |

## Decision

### 1. Responsibility boundary

Introduce one deep module named **Pedestrian Wind Field** on the streaming host (`M/cfd_pipeline/wind_field.py`, reached through `M/cfd_job_service.py`). For one wind direction of a finished run it owns: the sampled pedestrian plane as a queryable field; its statistics (`U_max`, area-weighted `U_mean`, `U_p95`, `U_min`); the exceedance zones for any threshold (connectivity, minimum area, area, centroid, peak); the attribution of zones to building elements (candidate band, distance rule, cap); the units and colour scale of the authored layer; and the per-(run, tag, threshold) cache. It writes the statistics and the legend into the result document at postprocess time and answers exceedance queries afterwards.

It does not own: the finding policy (threshold semantics, severity, idempotency, governance payload — CFD Run Workflow), the run store or HTTP framing (`cfd_job_service.py`), the sampling itself (`postprocess_case` keeps writing the VTK and the layer), the overlay prim path (CFD Overlay Address, a separate candidate) or any weather weighting.

### 2. Public surface

```python
@dataclass(frozen=True)
class FieldStats:
    u_max: float; u_mean: float; u_p95: float; u_min: float; polygons: int; area_m2: float

@dataclass(frozen=True)
class ZoneElement:
    ifc_guid: str; ifc_type: str; usd_prim_path: str; distance_m: float

@dataclass(frozen=True)
class ExceedanceZone:
    area_m2: float; centroid_xy: tuple[float, float]; u_max: float; polygons: int; elements: tuple[ZoneElement, ...]

def field_stats(plane: VtkSurface) -> FieldStats: ...                       # shared with convergence.py
def exceedance(plane: VtkSurface, threshold_u_m_s: float, elements: Sequence[ElementGeometry], *,
               ground_z: float, band_height_m: float = 3.0, max_distance_m: float = 2.0,
               max_elements: int = 3, min_area_m2: float = 1.0) -> tuple[ExceedanceZone, ...]: ...
def legend_of(layer_path: Path) -> dict: ...                                # customData cfd:legend, verbatim
```

Streaming route: `GET /api/cfd-runs/{run_id}/directions/{tag}/exceedance?threshold_u_m_s=<0.5..30>` → `cfd-exceedance/v1` `{ schema, run_id, wind_from_degrees, threshold_u_m_s, frame, stats, zones[] }`; 400 on a threshold outside the request bound, 404 for an unknown run or tag, 409 `run_not_ready` while the direction has no result. `frame` states whether directions are relative to project north (the run's `assumptions`). Coordinator route: `GET /api/cfd/runs/{runId}/directions/{deg}/exceedance?threshold_u_m_s=` passes it through (same guard as the other CFD reads). The plane and the elements are read once per (run, tag) and the zones once per threshold; the cache is in-process and bounded.

### 3. Findings

`CfdRunWorkflow.evaluateFindings` asks the exceedance query for every evaluated direction and groups zones by element across directions. Per element it opens one governance issue: `kind=issue` with `ifc_guid` and `model_version_id` when the command carries a model binding, an annotation otherwise; title and description name the run, the threshold, the element (guid, class) and each exceeding direction with its peak, zone area and distance; `usd_prim_path` is the pedestrian-plane prim of the worst direction; severity is `high` when any direction exceeds 1.5 × threshold. A direction whose zones all have `elements: []` opens one direction-level annotation as today, with the zone centroids and areas in the description. Idempotency stays in the ledger `findings[]`, keyed by (run, `ifc_guid` or direction, threshold, model binding); the governance lookup for a lost ledger matches on `usd_prim_path` and a title that contains the guid. `cfdFindingIssuePayload` stays a pure function; the `evaluated[]` reply gains `elements[]`.

### 4. Contracts

- New `tests/contracts/cfd-exceedance-v1.schema.json`, pinned by the root contract suite and mirrored by the coordinator zod (`browser-contract-drift`).
- `cfd-run-result-v1.schema.json`, additive: `pedestrian_1p5m` gains `U_mean`, `U_p95`, `U_min`; the direction gains optional `legend` (`{ U: { min, max, unit }, p: { min, max, unit, available } }`, authored values). Older results without them still validate.
- `cfd-run-ledger-record-v1.schema.json` and the finding response, additive: `ifc_guid`, `ifc_type`, `directions[]` and `zone_area_m2` (optional) on a finding, `elements[]` on a direction's evaluation. *Amended in bullet 2:* `wind_from_degrees` stays a single number (the worst direction) so the ledger schema remains additive for older readers; the aggregated directions are the new `directions[]`.
- Design document `c4-cfd-api` card and `docs/agents/repository-boundaries.md`: the exceedance route and the `kind=issue` finding, changed in this PR.

### 5. Incremental cutover

0. This ADR, the `CONTEXT.md` term, the `c4-cfd-api` card and the boundaries file (this PR).
1. Streaming: `wind_field.py` with `field_stats` (replacing the copy in `convergence.py`), `exceedance` and `legend_of`; the result gains the statistics and the legend; the exceedance route and `cfd-exceedance/v1`; tests on synthetic planes and a synthetic `model.usdc` (two walls, a door, a far wall).
2. Coordinator: the pass-through route; `evaluateFindings` on element-level findings with the in-memory exceedance port; ledger and finding contracts; OpenAPI and viewer types regenerated.
3. Viewer: per-direction exceedance summary (zones, peaks, elements) in the wind panel; the legend read from the result and the constants deleted; finding replies listed per element.
4. Evidence: one `fast_preview` single-direction run on canonical Linux 181, driven in the owner's Chrome: zones and elements shown, findings opened as `kind=issue` with guids, the Issues page lists them, the BCF export contains the topics, the 3D highlight lands on the element. Recorded under `docs/evidence/` without project names or coordinates.

## Considered Options

- Pre-compute zones for a fixed threshold set at postprocess: rejected (Grilling Record, row 1).
- Let the coordinator download the layer and compute zones: rejected; it contradicts D6 and the coordinator has no USD or numeric runtime.
- Attribute to the shell classes only, or to the single nearest element: rejected (row 2).
- One issue per element per direction: rejected (row 3).
- Introduce Pedestrian Wind Field: accepted.

## Consequences

### Positive

- A finding names elements, so it reaches BCF, the 3D highlight and the version diff's issue impact.
- Field statistics and the legend have one producer; the CLI study and the panel read it.
- Comparison views and comfort classes (later candidates) get a common base: statistics and zones per direction.

### Negative

- Two new routes and one new contract schema; the design document card grows.
- Attribution is geometric (footprint distance); it cannot tell a door from the wall around it when both are within 2 m, so up to three elements are named and the reviewer decides.
- Element-level findings can be many for a long façade; the 1 m² floor and the 2 m rule bound them, but a run over a large building may still open dozens of issues per threshold.

## Verification

1. `tools/cfd`: `pytest tests -q` including the new `test_wind_field.py` (zones, minimum area, attribution order and cap, empty attribution, statistics equal to the convergence study's).
2. `bim-streaming-server`: `pytest tests/test_cfd_job_service.py tests/test_cfd_openfoam_runner.py tests/test_cfd_options_estimate.py -q` plus the exceedance route tests (cache hit, 400/404/409).
3. Root: `pytest tests -q` with the new schema and the additive changes.
4. `bim-review-coordinator`: `npx vitest run tests/cfd-run-workflow.test.ts tests/cfd-run-routes.test.ts tests/browser-contract-drift.test.ts`; `npm run contract:check`.
5. `web-viewer-sample`: `npx vitest run src/console/unified/WindEnvironmentPanel.test.tsx`, `npm run typecheck`.
6. Bullet 4's real-site evidence, in the owner's Chrome, step by step with screenshots.
7. `git diff --check`; `scripts/deploy.ps1` unchanged.

## Rollback

Source revert per tracer bullet. The contract changes are additive, so older result and ledger documents keep validating; element-level findings already opened in governance remain as issues (governance is the issue authority and has no CFD-specific state).
