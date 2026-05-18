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

## T3 — Coordinator external IFC-ready intake（done，2026-05-18）

- **唯一對外 intake**：`bim-review-coordinator` `POST /api/external/ifc-ready`（+ `GET /api/external/ifc-ready/:jobId`）。caller = 客戶落地端 IFC Worker（落地端內網）。
- **AuthProvider（§4.2）**：`src/services/authProvider.ts` — 介面 + `IntranetDevAuthProvider`（IP allowlist + `X-Webhook-Secret` 共享密鑰或 `X-Webhook-Signature` HMAC-SHA256；要求 `X-Correlation-Id`/`X-Idempotency-Key` + body tenant/project/external_model_version_id）；`createAuthProvider` 工廠，未來 `sso-token-introspection`/`machine-token`/`mTLS` 同介面替換、對外契約不重設計。
- **Idempotency + job state（§4.3）**：`src/services/externalIfcReadyStore.ts` — 以 `idempotency_key`（次要 `correlation_id`）去重，建立本地 conversion job 並綁定 `external_model_version_id`（最小 shadow，非 mirror 公司 MySQL；長期投遞屬 T5 outbox）。
- **Dispatch streaming（§4.4）**：`src/services/streamingConversionClient.ts` — external B-scheme 事件映射為 streaming 既有 internal `ifc_ready_event` 形狀並呼叫 `POST /api/conversions/ifc-to-usdc`（不重寫轉檔核心）。設計：intake 先落地（job+binding）再派工；派工失敗 = 可重試 `dispatch_failed`，**不否定 intake**（重試/補派與雲端 callback outbox 屬 T4/T5）。
- **契約測試（§4.5）**：`tests/external-ifc-ready.test.ts` 讀 `tests/contracts/ifc_ready_payload.json`（單一事實來源）：normal(202)/idempotent replay(200)/missing-secret(401)/wrong-secret(401)/missing-correlation(401)/missing-source_ifc(400)。
- **GitNexus**：`createCoordinatorApp`/`loadConfig` upstream impact = LOW；`detect_changes` risk low / 0 affected processes。
- **驗證**：`npm run verify`（tsc build + vitest）綠，**115 tests pass**（新 6 + 既有 109 無 regression）；worktree 首次需 `npm ci`（opsx self-bootstrap，已執行）。
- **邊界註記**：`bim-review-coordinator/CLAUDE.md` 仍寫舊邊界（查詢 `_bim-control`/`_worker`）；B-scheme 下 coordinator 新增「唯一對外 IFC-ready intake」職責，治理文件層對齊收斂於 **T9**（與 spec `documentation-source-of-truth` 一致）。

## T4 — Streaming internal conversion API 收斂（done，2026-05-18）

- `conversion_authority.py`：`POST /api/conversions/ifc-to-usdc` 即唯一內部端點（coordinator→streaming），**無另一對外 ifc-ready 入口**；加 internal-only docstring（caller=coordinator；非外部 IFC Worker、非 `_worker`）。
- `ConversionAuthoritySettings.bim_control_callback_url` → `str | None = None`（移除對已刪 `_bim-control:8001` 的寫死）。轉檔完成：有 callback_url → `callback_delivery.status="pending"`（投遞 deferred 給 coordinator/T5 outbox）；無 → `status="skipped"`（coordinator 輪詢 /result）。**不打已刪服務**。
- 轉檔核心（外部注入 `converter.convert`、`_build_success_result`、`_assert_publishable_outputs`、idempotency/job store）**未重寫**（§5.2）。
- 測試：`make_client` 與 `ifc_ready_payload` 移除 :8001/:8005 寫死（改 `edge-local://`、無 callback_url）；新增 2 契約測試（reject non-ifc_ready→400；coordinator internal request→job/status/result + callback skipped）。`pytest test_conversion_authority_api.py` **5 pass**（既有 3 無 regression，轉檔核心不變）。
- GitNexus：`ConversionAuthoritySettings` upstream LOW、`create_conversion_job` 僅同檔 route 呼叫（`_worker` 版已刪）、`detect_changes` risk low。
- 過渡：轉檔結果回拋公司雲端（metadata-only callback outbox / retry / dead-letter）屬 **T5**，由 coordinator 驅動。

## T5 — Cloud callback outbox（done，2026-05-18；6.4 real endpoint pending OQ1）

- `src/services/callbackOutbox.ts`：`CallbackOutbox`（in-memory）— `enqueue`（入列前 `assertMetadataOnly` 強制禁 `.usdc`/大型本體）、`attemptDelivery`/`deliverPending`（顯式驅動，無計時器）、retry 累加、耗盡→`dead_letter`（不靜默丟棄）、`evidence[]`（at/attempt/outcome/detail）。`assertMetadataOnly` 與 `tests/fakes/cloud_bim_control_api.py` 的 guard 同義（雙語一致）。
- `app.ts`：`POST /api/internal/conversion-result`（依 `correlation_id` 找 ifc-ready job，組 `conversion_result_ready`/`conversion_failed` metadata-only payload，入 outbox，`recordConversionOutcome`）；`GET /api/internal/callback-outbox/:id`；`POST /api/internal/callback-outbox/deliver`（runtime loop / 測試決定性驅動）；`MetadataOnlyViolation`→422。
- `externalIfcReadyStore`：`getByCorrelation` + `recordConversionOutcome`（conversion_status 與 callback 連結；**callback 投遞狀態與 conversion 成功分離**——conversion 本地 ready 即可查，不因 callback 未 ack 被否定）。
- `config`：`cloudCallbackBaseUrl`（default 空＝OQ1 pending、無 real endpoint）、`callbackOutboxMaxAttempts`（default 5）。
- **6.4 / OQ1**：交付＝OQ1-pending 緩解（凍結契約 + outbox 行為），**非真實公司雲端對接**。target 來源優先 ifc-ready `callback_url`（凍結契約 placeholder），否則 `cloudCallbackBaseUrl`；皆無/不可達 → 保留重試→`dead_letter`，real endpoint 標 pending OQ1。
- 契約測試 `tests/cloud-callback-outbox.test.ts`（讀 `tests/contracts/conversion_result_callback.json`）：5 cases 全過。`npm run verify` 綠，**120 tests pass**（既有 115 無 regression）。GitNexus impact LOW、`detect_changes` risk low。

## T6 — Local artifact shadow metadata（done，2026-05-18）

- `types.ts`：`ShadowMetadata`（精確 12 欄位＝ tenant/project/external_model_version_id/external_conversion_task_id/correlation_id/source_ifc_ref/source_ifc_etag/conversion_job_id/artifact_manifest_ref/callback_url/callback_status/last_callback_attempt_at）；`IfcReadyIntakeJob` 加 `artifact_manifest_ref`。
- `externalIfcReadyStore`：`toShadowMetadata(job, callback?)` 投影最小欄位集（callback_status/last_callback_attempt_at 來自連結的 outbox entry，**不納入** user/RBAC/license/version 歷史等 control-plane 權威欄位）；`recordConversionOutcome` 接 `artifact_manifest_ref`（`external_model_version_id` binding 已在 intake 既有欄位）。
- `app.ts`：`GET /api/external/ifc-ready/:jobId/shadow` → `{ shadow_metadata, data_plane_availability, control_plane_authority }`。data-plane（local conversion status / source_ifc / manifest 可用性）本地可答；control-plane 標 `owner=company-cloud-bim-control`、`not_mirrored=true`、`referenced_by=external_model_version_id`（不重新宣告權威、不 mirror MySQL）。
- 測試 `tests/shadow-metadata.test.ts`：shadow 鍵集恰為 12（無 control-plane 禁用鍵）、control-plane 不重宣告、data-plane 本地可答、callback 與 conversion 分離、未知 jobId→404。`npm run verify` **綠，125 tests pass**（既有 120 無 regression）。GitNexus impact LOW、`detect_changes` risk low。

## T7 — Local web view integration（done，2026-05-18；8.3 real SSO pending OQ5）

- `authProvider.ts`：使用者 auth 與 Service auth 分離。`UserAuthProvider` 介面 + `LocalDevUserAuthProvider`（`Authorization: Bearer <token>` 或 `X-User-Token`；dev token 即 user id；**不做死 EZPLUS SSO**）+ `createUserAuthProvider` 工廠（未來 `sso-token-introspection` 同介面替換，local web view 契約不變）。
- `app.ts`：`POST /api/local-web-view/sessions` — user-auth → 以 `ifc_ready_job_id` 或 `external_model_version_id` 解析 → `LocalWebViewSession`（`artifact_resolution`：source_ifc_ref/manifest/conversion 狀態/`viewer_open_ready`）。實際 USDC streaming 仍走既有 `stream-config`/bim-streaming-server 路徑（T7 只做 data-plane 解析入口，不重複 streaming）。
- `types.ts` 加 `LocalWebViewSession`；`config` 加 `userAuthProvider`（default `local-dev`）。
- **8.3 / OQ5**：`sso_binding` 恆 `pending_oq5`；交付＝可替換 user-auth provider 預留（OQ5-pending 緩解），**非真實公司 SSO 對接**（待 OQ5）。
- 測試 `tests/local-web-view.test.ts`：缺 token→401、Bearer/X-User-Token→201+pending_oq5、emv 解析 + 轉檔 ready→`viewer_open_ready=true`、缺 id→400、無 job→404。`npm run verify` **綠，130 tests pass**（既有 125 無 regression）。GitNexus impact LOW、`detect_changes` risk low。

## T8 — Readiness / smoke / evidence rewrite（done，2026-05-18）

- §9.1：`tests/test_contracts_and_fakes.py`（repo-root pytest，**6 pass**）形式化 T2 前置的 contracts/fakes 為正式覆蓋；`verify-all.ps1`/`.sh` re-add repo-root `tests/` pytest 目標——**default verify 不再依賴已刪 `_worker`/`_bim-control`**，改以外部平台 contracts + test-only fakes 提供 Python 覆蓋。
- §9.2：`scripts/smoke-bscheme-intake.ps1`（專案慣例可重複工具，reuse `smoke-evidence.ps1`）——contract stub（tests/fakes+contracts）→ coordinator intake，分層 tiers：external_platform_contracts / coordinator_bscheme_intake / streaming_internal_conversion / callback_outbox / runtime_image_kit_launcher。
- §9.3：evidence `docs/verification/evidence/2026-05-18-bscheme-intake-smoke/bscheme-readiness.json` 分層加入 Kit launcher + callback outbox tier。本 session 各 tier（依實際已跑檢查）：external_platform_contracts=passed(6)、coordinator_bscheme_intake=passed(130)、streaming_internal_conversion=passed(5)、callback_outbox=passed、**runtime_image_kit_launcher=`deferred`**（沿用 T0，GPU/Kit graphics-vulkan 阻塞；**誠實 deferred，不謊報 passed、不用 host-local Kit 充當 pass**）。
- PowerShell 被環境拒：`.ps1` 為 CI/PowerShell 環境可重複工具；本 session evidence 由等效 node/python 檢查產出（與 T0 同模式）。`detect_changes` risk low。
