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

### T2 非破壞前置 — done（2026-05-18，additive only）

已新增（**純新增，未動 `_worker`/`_bim-control`、未改 smoke/start-all、未刪任何東西**）：

- `tests/contracts/ifc_ready_payload.json` — 凍結 coordinator `POST /api/external/ifc-ready` 契約（T3 anchor；OQ3/OQ4 標 placeholder/pending）
- `tests/contracts/conversion_result_callback.json` — 凍結 metadata-only cloud callback 契約（**T5.4 / OQ1 緩解**：real endpoint 標 pending；含 outbox/retry/dead-letter 語意）
- `tests/fakes/external_ifc_worker_client.py` — 外部落地端 IFC Worker double（build/POST spec-correct ifc-ready）
- `tests/fakes/cloud_bim_control_api.py` — 公司雲端 `bim-control` double（收 callback + **強制 metadata-only guard**；最小 control-plane reads）
- `tests/fakes/__init__.py`、`tests/README.md`（宣告 test-only doubles、非 runtime profile，依 D4；endpoint 取代對照、OQ 狀態、T2 刪除前置清單）

Sanity（`python`，PowerShell 被環境拒）：contracts 可解析且 required fields 齊、fakes 可 import、callback ready/failed 記錄與過濾正確、**metadata-only guard 正確拒絕內嵌 `usdc_body`（雲地分離鐵律於測試強制）**、control-plane read doubles 正常 → `T8-PREREQ-SANITY-OK`。

> 注意：此批僅為 T2 的**非破壞前置鷹架**；未勾 `tasks.md` §3（T2 刪除）/ §9（T8 rewrite）任何 box——真正的刪除、smoke/test rewire、start-all/health/compose 收斂、GitNexus impact analysis 屬 T2 本體，**待使用者確認後**才執行。

### T2 本體 — done（2026-05-18，BREAKING；使用者於 AskUserQuestion 確認「確認 T2 並續做 T3–T9」）

- **刪除**：`_worker/`（19 檔）+ `_bim-control/`（14 檔）= 33 檔。**注意流程**：agent `git rm` 被 harness 自動安全防護擋下（不視結構化回答為對原始破壞指令的同意）；agent **未繞過**防護，改由使用者於 session 以 `!git rm -r _worker _bim-control` 手動執行（使用者選「你在 session 手動執行刪除」）。
- **de-wire（15 檔修改）**：見 `tasks.md §3` 註記。compose 移除兩 service + coordinator env/depends_on + volume；startup/stop/health/verify 移除兩服務行；3 支 smoke/demo 改 tombstone 守衛指向 T8；open-demo-consoles 移除死 console。
- **GitNexus（3.5）**：產品碼自 index `9d7db83` 未變動 → stale index 對產品 symbol 仍準確；`BimControlClient` upstream impact = **LOW**（0 callers/processes/modules，無 incoming edges）；`detect_changes` scope=all = **risk low / 0 affected processes / 0 changed symbols**。**無 HIGH/CRITICAL**。
- **驗證**：`openspec validate --strict` valid；`tests/fakes` sanity `T8-PREREQ-SANITY-OK`（刪除未中斷驗證能力）；殘留僅 6 腳本未使用 param 預設值（cosmetic → T9）。
- **過渡狀態（明確）**：coordinator `config.ts`/`app.ts`（`bimControlApiBase`/`conversionApiBase`/`/api/dev/conversions`）與 streaming `conversion_authority.py`（`bim_control_callback_url` 寫死 :8001）對已刪服務的相依，rewire 屬 **T3（intake）/ T4（streaming internal）/ T5（cloud callback outbox）**，緊接其後；rolling PR #63 全部完成且四層驗證綠才 merge（未 merge 不影響 main）。
