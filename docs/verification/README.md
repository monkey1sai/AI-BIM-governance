# Verification Evidence Index

本資料夾保存歷史驗證紀錄；它不是 current runtime contract。判斷現行行為時，先讀：

- `AGENTS.md`
- `docs/contracts/local-dev-runbook.md`
- `docs/contracts/conversion-api.md`
- `docs/agents/product-operability-and-script-contract.md`
- `docs/runbooks/DOCKER_WEB_PLANE_HOST_NATIVE_KIT.md`

## Evidence Tiers

| Tier | 可宣稱 | 不可宣稱 |
|---|---|---|
| `api-only` | API contract / response shape passed | browser 或 runtime visual passed |
| `governance-cpu-semantic` | governance-service CPU semantic rule-run passed | Kit/WebRTC visual passed |
| `runtime-stage-load` | Kit/streaming loaded artifact or stage truth passed | viewport frame visibly rendered |
| `visual-frame-visible` | browser screenshot / trace shows non-black visible frame | full-system complete |
| `full-system` | governance CPU semantic E2E + Kit WebRTC visual/runtime E2E both passed | any partial tier alone |

## Superseded Evidence

Pre-Phase-B reports that start or verify `_worker` / `_bim-control` are archival only. They may explain history, but they must not be used as startup, smoke, health, or current readiness instructions.

Known archival examples:

- `docs/verification/2026-05-08-spec-end-to-end-verification.md`
- `docs/verification/2026-05-11-worker-real-conversion-quality.md`

## Artifact URL Rule

Artifact URLs are opaque identifiers. Consumers must not infer tenant, project, job, or derived-file layout from example paths in historical evidence or API examples. If a contract needs path semantics, it must state that explicitly in the current contract file.
