# Apply-phase notes — local-coordinator-ifc-ready-intake-boundary

> 本檔記錄 apply（T0…T9）階段的確認、決策與 gate；propose artifacts（proposal/design/specs/tasks）為需求權威，本檔只記 apply 執行事實。交付節奏＝**滾動單一 PR**（#63），T2 BREAKING 前停下待使用者確認（使用者 2026-05-18 定調）。

## T0 — Runtime image Linux Kit launcher closure（done，outcome = `deferred`）

誠實 `deferred`（非 passed）。詳見 `tasks.md §1` 註記與 `docs/verification/evidence/2026-05-18-t0-kit-launcher/`。可重複工具 `scripts/verify-runtime-kit-launcher.ps1`。

## T1 — OpenSpec boundary 對齊（done）

### 2.1 change-id 與 spec delta 與本 change 一致 — 確認通過

- change-id = `local-coordinator-ifc-ready-intake-boundary`（`.openspec.yaml` schema `spec-driven`, created 2026-05-18；與 `AGENTS.md §1.A` 2026-05-18 修訂建議 change-id、`docs/plans/phase-b-external-platform-webhook-intake-DRAFT-2026-05.md` 一致）。
- spec delta = 7，header 與 `proposal.md ## Capabilities` 完全對應：
  - ADDED(4)：`local-coordinator-ifc-ready-intake-boundary`、`external-cloud-callback-lifecycle`、`local-artifact-shadow-metadata`、`runtime-image-linux-kit-launcher-readiness`
  - MODIFIED(3)：`conversion-webhook-lifecycle`、`streaming-ifc-usdc-conversion-authority`、`documentation-source-of-truth`
- 5 個大型 MODIFIED/REMOVED（`demo-runtime-readiness-smoke`、`runtime-verification-evidence`、`worker-rvt-ifc-bridge`、`bim-control-revit-intake-facade`、`worker-artifact-pipeline`）依 `proposal.md` 範圍紀律，延至 **T9 對 merge 後現行 `openspec/specs/` 撰寫**，避免 propose 階段巨量易碎/stale delta（意圖已在 `## What Changes` 標 BREAKING）。
- `openspec validate "local-coordinator-ifc-ready-intake-boundary" --strict` = **valid**。

### 2.2 control-plane / external caller / data-plane 定位 — 確認已於 design/spec 明確

apply 階段三方定位 source of truth（與 `design.md` Context/D6/D7、相關 spec 一致）：

| 角色 | 定位 | 權威範圍（摘要） |
|---|---|---|
| 公司雲端 `bim-control` | **external control-plane**（外部既有平台） | tenant/customer、project、user、RBAC、license、model version/commit、conversion task request、版本歷史、高階 artifact index、callback 接收狀態 |
| 客戶落地端 IFC Worker | **external caller**（外部 IFC 產出者，落地端內網） | 產出 `.ifc`，machine-to-machine 呼叫本 repo coordinator `POST /api/external/ifc-ready` |
| 本 repo | **local data-plane runtime**（客戶落地端） | local conversion job state、source IFC/USDC/element_mapping local availability、artifact manifest、converter version、runtime image digest、Kit launcher evidence、local web view session、callback outbox retry state；僅保存最小 shadow metadata（非 mirror 公司 MySQL） |

對應權威 spec：`specs/local-artifact-shadow-metadata`（distinct metadata authorities）、`specs/documentation-source-of-truth`（B-scheme 角色定義）、`specs/local-coordinator-ifc-ready-intake-boundary`（caller = customer-edge IFC Worker、coordinator 為唯一對外 intake）、`specs/streaming-ifc-usdc-conversion-authority`（streaming internal-only）。

→ `design.md`/`specs` 已明確承載 2.2 定義，apply 階段不需新增需求；T9 將把上述定位同步寫入 `AGENTS.md`/`CLAUDE.md`/roadmap（治理文件層）。

## T2 — BREAKING gate（pending 使用者確認）

`_worker`/`_bim-control` 自 repo 刪除為不可逆破壞性變更。依使用者定調：先完成非破壞前置（T1 ＋ T8 的 `tests/fakes`＋`tests/contracts` 子集，確保驗證能力不中斷），到「真要刪除」前停下回報、待明確確認後才執行 T2 與後續 T3–T9。
