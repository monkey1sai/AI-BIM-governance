# architecture-rework-2026-05-14

## Why

新版架構工作台將 AI-BIM-governance 從目前 worker-only demo runtime 調整為更接近 SaaS / full-stack deployment 的架構：

- `_bim-control` 增加 fake Revit Plugin / RVT intake facade。
- `_worker` Docker 化並縮為 RVT→IFC export bridge。
- `bim-review-coordinator`、`bim-streaming-server`、`web-viewer-sample` 以 `bim-review-platform` 作為整合部署邊界。
- 採用 B 方案：`bim-streaming-server` 成為 IFC→USDC conversion job authority。
- coordinator 變薄，專注 session lifecycle、Kit pool、viewport sharing、primary/secondary artifact binding。
- USD stage composition 以 primary root model + session layer + secondary subLayers 來管理 multi-artifact review。

目前 repo 的 source-of-truth 仍多處把 `_worker` 視為 artifact + conversion facade，並把 `bim-streaming-server` 定義為 runtime / WebRTC / DataChannel 服務。這次 change 先用 OpenSpec 將新版架構邊界、合約、任務與驗收條件固定下來，避免直接進 code 時跨服務責任混亂。

## What changes

### Added capabilities

- `bim-control-revit-intake-facade`
- `worker-rvt-ifc-bridge`
- `bim-review-platform-boundary`
- `streaming-ifc-usdc-conversion-authority`
- `streaming-usd-stage-composition`
- `conversion-webhook-lifecycle`

### Modified existing capabilities

- `worker-artifact-pipeline`
- `review-session-request-lifecycle`
- `multi-artifact-kit-routing`
- `streaming-multi-layer-payload-loading`
- `session-first-review-viewer`
- `demo-runtime-readiness-smoke`
- `documentation-source-of-truth`

## Scope

### In scope

- Define service boundaries for the new architecture.
- Define B 方案 explicitly: `bim-streaming-server` owns IFC→USDC conversion job state.
- Define `_worker` as RVT→IFC bridge only.
- Define fake Revit intake API in `_bim-control`.
- Define webhooks:
  - `_bim-control` → `_worker`: `rvt_uploaded`
  - `_worker` → `bim-streaming-server`: `ifc_ready`
  - `bim-streaming-server` → `_bim-control`: `conversion_result_ready` / `conversion_failed`
  - `bim-streaming-server` → `bim-review-coordinator`: optional runtime artifact readiness notification
- Define `bim-review-platform` as a deployment boundary, not a nested repo.
- Preserve mapping, lineage, quality metrics, sidecar carrier, and no-fake-GUID rules during conversion ownership migration.
- Define primary / secondary USD stage composition semantics.
- Define smoke / readiness evidence tiers for the new flow.

### Out of scope

- Production SSO / RBAC / tenant billing.
- Real DB migration.
- Real S3 / MinIO migration, except interface placeholders.
- Real AI / carbon / building regulation computation.
- Real Revit runtime implementation inside this repo.
- Creating nested Git repos, submodules, or subtree splits.
- Dedicated multi-Kit GPU runtime proof before two live GPU-backed Kit endpoints exist.
- OVAS Helm migration implementation; only boundary compatibility may be documented.

## Non-goals

- This change SHALL NOT delete existing `_worker` converter code during proposal stage.
- This change SHALL NOT claim existing historical worker conversion evidence as proof of the new streaming-server authority until new B-scheme evidence exists.
- This change SHALL NOT merge `coordinator`, `streaming-server`, and `viewer` into one process.

## Success criteria

- `openspec validate architecture-rework-2026-05-14 --strict` passes.
- The proposal clearly states that `bim-streaming-server` owns IFC→USDC conversion jobs under B 方案.
- The proposal clearly states that `_worker` no longer owns USDC conversion jobs.
- The spec deltas preserve mapping / lineage / quality metrics semantics.
- The spec deltas define blocked/deferred readiness states for missing Revit license, missing IFC fixture, missing converter app, missing Kit launcher, and missing GPU runtime.
- Reviewers can apply this change without guessing service ownership.
