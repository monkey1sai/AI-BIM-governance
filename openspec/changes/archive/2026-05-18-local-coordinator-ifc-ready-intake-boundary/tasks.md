## 1. T0 Runtime image closure（P0，先行）

- [x] 1.1 在 runtime image 內驗證 produced Linux Kit launcher 可啟動（補 predecessor archive 遺留 `Validate runtime image launches produced Linux Kit launcher`）
- [x] 1.2 產出 evidence：image digest、launcher path、startup log、exit code、sample USDC path
- [x] 1.3 若 GPU/driver/Kit license 阻塞 → 標 `deferred` 並記錄 reason，**不得**標 passed、不得用 host-local Kit 充當 pass

> **T0 Outcome（2026-05-18）= `deferred`（誠實，符合 spec 預期，非 passed）**
> 可重複工具：`scripts/verify-runtime-kit-launcher.ps1`（reuse `scripts/lib/smoke-evidence.ps1`，schema `demo-runtime-readiness-smoke/v1`）。
> Evidence：`docs/verification/evidence/2026-05-18-t0-kit-launcher/`（`kit-launcher-readiness.json` + `kit-launcher-startup.log`）。
> Image `ai-bim-runtime-manager-streaming-server:latest`（`sha256:8f8ff0d7…`，built 2026-05-15）。
> launcher / kit binary **確認存在於 image 內**（entrypoint 未 exit 64；Dockerfile builder+runtime stage 已 `test -x`）。容器內 `nvidia-smi` 成功（RTX 4060 Ti / driver 580.97 / CUDA 13.0，compute 可見）。
> **阻塞點**：容器缺 NVIDIA graphics/Vulkan driver libs（`libGLX_nvidia.so.0` 未掛載）→ Omniverse Kit RTX runtime 無法啟動 → entrypoint exit 75（Docker Desktop / WSL2 graphics-passthrough 限制）。
> 依 `runtime-image-linux-kit-launcher-readiness` spec 誠實標 `deferred` 並記 reason，未謊報 passed、未用 host-local Kit 充當 pass。升為 `passed` 的條件：容器取得 NVIDIA graphics/Vulkan libs（native Linux + NVIDIA Container Toolkit `graphics` capability，或修 WSL2 GL/Vulkan passthrough）後重跑同一工具。

## 2. T1 OpenSpec boundary 對齊（治理文件，apply 階段內）

- [x] 2.1 確認 change-id `local-coordinator-ifc-ready-intake-boundary` 與 spec delta 與本 change 一致
- [x] 2.2 在 design/spec 明確：公司雲端=external control-plane、客戶落地端 IFC Worker=external caller、本 repo=local data-plane runtime

> **T1 done（2026-05-18）** — 確認記錄見 `apply-notes.md` §T1。2.1：change-id 一致、7 spec delta header 與 proposal Capabilities 對應（ADDED 4 / MODIFIED 3，5 大型延 T9）、`validate --strict` valid。2.2：control-plane（公司雲端）/ external caller（落地端 IFC Worker）/ data-plane（本 repo）定位已於 `design.md` Context/D6/D7 與相關 specs 明確承載，apply 不需新增需求；治理文件層（AGENTS/CLAUDE/roadmap）同步收斂於 T9。

## 3. T2 刪除 `_worker` / `_bim-control`

- [x] 3.1 刪除 `_worker/`、`_bim-control/` 服務目錄（先建立 T8 的 tests/fakes 確保驗證能力不中斷後再刪）
- [x] 3.2 移除 `compose.*` / `scripts/*`（start-all/stop-all/health/smoke）對兩者的預設與可選依賴
- [x] 3.3 移除 health / smoke / readiness 對兩者的依賴
- [x] 3.4 改用 `tests/fakes/external_ifc_worker_client`、`tests/fakes/cloud_bim_control_api`、`tests/contracts/*.json` 模擬外部 API（非 runtime profile）
- [x] 3.5 修改前對受影響 symbol 跑 GitNexus impact analysis；HIGH/CRITICAL 先回報

> **T2 done（2026-05-18，BREAKING）** — 確認記錄見 `apply-notes.md` §T2。
> 刪除：`_worker/`（19 檔）、`_bim-control/`（14 檔）共 33 檔（使用者於 session 手動 `git rm`，因自動安全防護擋下 agent 直接刪除）。
> de-wire（15 檔修改）：`compose.runtime-manager.yml`（移除 bim-control/worker service + coordinator env/depends_on + volume）；`start-all.ps1`/`.sh`、`start-local-review-mvp.ps1`（移除兩服務啟動+health+URL）；`stop-all.ps1`/`.sh`（移除 8001/8005）；`dev/demo-health-check.ps1`、`check-runtime-manager-docker.ps1`（移除兩服務 probe）；`verify-all.ps1`/`.sh`（移除兩 pytest 目標，新 tests/ 目標延 T8）；`smoke-worker-review-request.ps1`、`smoke-review-session.ps1`、`run-single-kit-demo.ps1`（tombstone 守衛，指向 T8 contract-stub smoke）；`open-demo-consoles.ps1`（移除死 console）。
> GitNexus（3.5）：產品碼自 index commit `9d7db83` 未變→stale index 對產品 symbol 仍準確；`BimControlClient` upstream impact = **LOW**（0 callers/processes/modules）；`detect_changes` = **risk low / 0 affected processes**。無 HIGH/CRITICAL。
> 驗證：`openspec validate --strict` valid；`tests/fakes` sanity `T8-PREREQ-SANITY-OK`（刪除未中斷驗證能力）。
> 已知過渡狀態：coordinator `config.ts`/`app.ts` 與 streaming `conversion_authority.py` 對已刪服務的 callback/metadata 來源 rewire 屬 **T3/T4/T5**（緊接其後）；6 腳本未使用的 `$BimControlUrl/$WorkerUrl` param 預設值為 cosmetic，折入 **T9** 文件清理。

## 4. T3 Coordinator external intake

- [x] 4.1 `bim-review-coordinator` 新增 `POST /api/external/ifc-ready`（payload schema 對齊 `tests/contracts/ifc_ready_payload.json`）
- [x] 4.2 實作 `AuthProvider`/`AuthModule` 介面 + `intranet-dev` provider（IP allowlist + secret/HMAC + correlation_id + idempotency_key + tenant/project/external_model_version_id）
- [x] 4.3 idempotency（依 `idempotency_key`/`correlation_id`）+ local conversion job state + `external_model_version_id` binding
- [x] 4.4 呼叫 `bim-streaming-server` internal conversion API
- [x] 4.5 單元/契約測試：unauthorized / duplicate / missing-ifc / 正常路徑

> **T3 done（2026-05-18）** — 確認記錄見 `apply-notes.md` §T3。
> 新增：`src/services/authProvider.ts`（`AuthProvider` 介面 + `IntranetDevAuthProvider`：IP allowlist + `X-Webhook-Secret`/HMAC `X-Webhook-Signature` + 必要 correlation/idempotency/tenant/project/external_model_version_id；`createAuthProvider` 工廠可替換）、`src/services/externalIfcReadyStore.ts`（idempotency by `idempotency_key`/`correlation_id` + local job state + `external_model_version_id` binding）、`src/services/streamingConversionClient.ts`（external B-scheme → internal `ifc_ready_event` 映射 + 呼叫 `POST /api/conversions/ifc-to-usdc`）、`tests/external-ifc-ready.test.ts`（契約驅動，讀 `tests/contracts/ifc_ready_payload.json`）。
> 修改：`src/app.ts`（zod `ifcReadyPayloadSchema` + `POST /api/external/ifc-ready` + `GET /api/external/ifc-ready/:jobId` + AuthError→401/403）、`src/config.ts`（+streamingConversionApiBase/authProvider/webhookSecret/ipAllowlist）、`src/types.ts`（+ExternalIfcReadyEvent/IfcReadyIntakeJob）、`tests/unit_kitpool.test.ts`（defaultConfig fixture 補新欄位）。
> 設計：ifc-ready 已接受並落地（local job + binding）後才派工 streaming；派工失敗為可重試 `dispatch_failed`（不否定 intake，重試/補派 + 雲端 callback outbox 屬 T4/T5）。
> GitNexus：`createCoordinatorApp`/`loadConfig` upstream impact = **LOW**；`detect_changes` risk low / 0 affected processes。
> 驗證：`npm run verify`（tsc build + vitest）**綠，115 tests pass**（新 6 + 既有 109 無 regression）。

## 5. T4 Streaming internal conversion API

- [x] 5.1 `bim-streaming-server` 收斂為 internal-only：接受 coordinator internal conversion request，移除對外 ifc-ready 入口
- [x] 5.2 保留 IFC→USDC / element_mapping / manifest 既有轉檔核心（不重寫）
- [x] 5.3 契約測試：coordinator→streaming internal request → conversion_job_id/status/result

> **T4 done（2026-05-18）** — 見 `apply-notes.md` §T4。`POST /api/conversions/ifc-to-usdc` 即唯一內部端點（coordinator→streaming），無另一對外 ifc-ready 入口；加 internal-only docstring（caller=coordinator，非外部 IFC Worker、非 `_worker`）。`ConversionAuthoritySettings.bim_control_callback_url` 改 `str | None = None`（不再寫死已刪 `_bim-control:8001`）；轉檔完成無 callback_url → `callback_delivery.status="skipped"`（coordinator 輪詢 /result，cloud callback outbox 屬 T5）。轉檔核心（converter / `_build_success_result` / `_assert_publishable_outputs`）**未重寫**。測試移除 :8001/:8005 寫死、加 2 契約測試（reject non-ifc_ready、coordinator→streaming→job/status/result+skipped callback）；`pytest test_conversion_authority_api.py` **5 pass**（既有 3 無 regression）。GitNexus `ConversionAuthoritySettings` impact LOW、`detect_changes` risk low。

## 6. T5 Callback to company cloud

- [x] 6.1 實作 `conversion_result_ready` / `conversion_failed` callback（metadata-only，禁傳 `.usdc` 本體）
- [x] 6.2 實作 `callback_outbox` + retry policy + dead-letter state + callback evidence log
- [x] 6.3 契約測試：cloud 不可達→outbox 保留重試、retry 耗盡→dead-letter、callback_status 與 conversion 成功分離
- [x] 6.4 **阻塞項**：真實對接公司雲端 endpoint/auth 待 OQ1 確認（未確認前以 `tests/contracts/conversion_result_callback.json` 凍結契約，real endpoint 標 pending）

> **T5 done（2026-05-18）** — 見 `apply-notes.md` §T5。新增 `src/services/callbackOutbox.ts`（`CallbackOutbox`：enqueue + `deliverPending`/`attemptDelivery` + retry + `dead_letter` + evidence log + `assertMetadataOnly` 強制禁 `.usdc` 本體）；`app.ts` 新增 `POST /api/internal/conversion-result`（組 `conversion_result_ready`/`conversion_failed` metadata-only payload 入 outbox）、`GET /api/internal/callback-outbox/:id`、`POST /api/internal/callback-outbox/deliver`（runtime loop/測試決定性驅動）、`MetadataOnlyViolation`→422；`externalIfcReadyStore` 加 `getByCorrelation`/`recordConversionOutcome`（callback 連結，callback_status 與 conversion 分離）；`config`/`types` 擴充；`unit_kitpool` fixture 補欄位。
> **6.4 / OQ1**：`cloudCallbackBaseUrl` default 空 = 無 real endpoint；target 由 ifc-ready `callback_url`（凍結契約 placeholder）覆寫；無/不可達 target 一律保留重試→`dead_letter`（不靜默丟棄）。**真實公司雲端 endpoint/auth 仍 pending OQ1**——本任務交付的是 OQ1-pending 緩解（契約凍結 + outbox 行為），非真實對接。
> 契約測試 `tests/cloud-callback-outbox.test.ts`（讀 `tests/contracts/conversion_result_callback.json`）：ready→metadata-only enqueue + conversion/callback 狀態分離、不可達→retry→`dead_letter`+evidence、conversion_failed、metadata-only→422、unknown correlation→404。`npm run verify` **綠，120 tests pass**（既有 115 無 regression）。GitNexus `createCoordinatorApp`/`loadConfig` LOW、`detect_changes` risk low。

## 7. T6 Local artifact shadow metadata

- [x] 7.1 定義並實作最小 shadow metadata 欄位集（tenant_id/project_id/external_model_version_id/external_conversion_task_id/correlation_id/source_ifc_ref/source_ifc_etag/conversion_job_id/artifact_manifest_ref/callback_url/callback_status/last_callback_attempt_at）
- [x] 7.2 artifact_manifest 產出與 `external_model_version_id` binding；不 mirror 公司 MySQL
- [x] 7.3 測試：control-plane metadata 不在本地被重新宣告權威；data-plane availability 本地可答

> **T6 done（2026-05-18）** — 見 `apply-notes.md` §T6。`types.ts` 新增 `ShadowMetadata`（精確 12 欄位）+ `IfcReadyIntakeJob.artifact_manifest_ref`；`externalIfcReadyStore` 加 `toShadowMetadata`（投影最小欄位集，callback_status/last_callback_attempt_at 來自連結 outbox）、`recordConversionOutcome` 接 `artifact_manifest_ref`（external_model_version_id binding 已在既有欄位）；`app.ts` 新增 `GET /api/external/ifc-ready/:jobId/shadow`（回 shadow_metadata + data_plane_availability + control_plane_authority 標註 `owner=company-cloud-bim-control`/`not_mirrored=true`，僅以 external_model_version_id 參照）。測試 `tests/shadow-metadata.test.ts`：shadow 僅 12 欄位且無 control-plane 權威鍵（不 mirror MySQL）、control-plane 不重宣告、data-plane 本地可答、callback 與 conversion 分離、404。`npm run verify` **綠，125 tests pass**（既有 120 無 regression）。GitNexus impact LOW、`detect_changes` risk low。

## 8. T7 Local web view integration

- [x] 8.1 `bim-review-coordinator` 提供 local web view session / artifact resolution 入口
- [x] 8.2 預留使用者 SSO flow（現階段用可替換 auth provider；不做死 EZPLUS SSO）
- [x] 8.3 **阻塞項**：local web view ↔ 公司 SSO 銜接待 OQ5 確認

> **T7 done（2026-05-18）** — 見 `apply-notes.md` §T7。`authProvider.ts` 新增 **使用者** auth（與 T3 machine-to-machine Service auth 分離）：`UserAuthProvider` 介面 + `LocalDevUserAuthProvider`（`Authorization: Bearer`/`X-User-Token`，dev token 即 user id；**不做死 EZPLUS SSO**）+ `createUserAuthProvider` 工廠。`app.ts` 新增 `POST /api/local-web-view/sessions`（user-auth → 解析 ifc_ready_job_id 或 external_model_version_id → `LocalWebViewSession`，含 data-plane `artifact_resolution` 與 `viewer_open_ready`；實際 USDC streaming 仍走既有 stream-config）。`types.ts` 加 `LocalWebViewSession`；`config` 加 `userAuthProvider`。**8.3 / OQ5**：`sso_binding` 在 OQ5 確認前恆 `pending_oq5`，交付＝可替換 provider 預留（OQ5-pending 緩解），**非真實公司 SSO 對接**。測試 `tests/local-web-view.test.ts`：缺 token→401、Bearer/X-User-Token→201+pending_oq5+artifact_resolution、emv 解析 + 轉檔 ready→viewer_open_ready、缺 id→400、無 job→404。`npm run verify` **綠，130 tests pass**（既有 125 無 regression）。GitNexus impact LOW、`detect_changes` risk low。

## 9. T8 Readiness / smoke / evidence rewrite

- [x] 9.1 default smoke 不依賴 `_worker`/`_bim-control`
- [x] 9.2 新 smoke 用 contract stub 呼叫 coordinator intake，驗 conversion + callback outbox + Kit launcher evidence
- [x] 9.3 evidence 分層加入 Kit launcher / callback outbox；GPU/Kit 阻塞標 deferred 不謊報

> **T8 done（2026-05-18）** — 見 `apply-notes.md` §T8。`tests/test_contracts_and_fakes.py`（repo-root pytest，**6 pass**）形式化 T2 前置 fakes/contracts 為正式覆蓋；`verify-all.ps1`/`.sh` re-add repo-root `tests/` pytest 目標（§9.1：default verify 改以 contracts+fakes 取代已刪兩服務覆蓋，不再依賴 `_worker`/`_bim-control`）。新增 `scripts/smoke-bscheme-intake.ps1`（§9.2 contract stub → coordinator intake；分層 tiers：external_platform_contracts / coordinator_bscheme_intake / streaming_internal_conversion / callback_outbox / runtime_image_kit_launcher）。Evidence `docs/verification/evidence/2026-05-18-bscheme-intake-smoke/bscheme-readiness.json`（§9.3 分層）：external_platform_contracts=passed(6)、coordinator_bscheme_intake=passed(130)、streaming_internal_conversion=passed(5)、callback_outbox=passed（retry/dead-letter/metadata-only/OQ1-pending）、**runtime_image_kit_launcher=`deferred`（沿用 T0 誠實結論，GPU/Kit graphics-vulkan 阻塞，不謊報 passed、不用 host-local Kit 充當 pass）**。PowerShell 被環境拒，`.ps1` 為 CI/PowerShell 可重複工具，本 session evidence 由等效 node/python 檢查產出。`detect_changes` risk low。

## 10. T9 Documentation / spec cleanup（對 merge 後現行 specs 撰寫）

- [x] 10.1 撰寫並套用大型 spec delta：`demo-runtime-readiness-smoke`(MODIFIED)、`runtime-verification-evidence`(MODIFIED)、`worker-rvt-ifc-bridge`/`bim-control-revit-intake-facade`/`worker-artifact-pipeline`(REMOVED as product capability) — 對當時現行 `openspec/specs/` 撰寫，避免 stale/partial delta
- [x] 10.2 改寫 `AGENTS.md` §2–§11 / §10 閉環、`CLAUDE.md`、roadmap 對齊 control-plane/data-plane；移除把 `_worker`/`_bim-control` 當核心閉環的描述
- [x] 10.3 `scripts/render-roadmap-html.py` 重生 roadmap `.html`
- [x] 10.4 四層驗證（type/lint/affected unit/contract、必要時 smoke）綠；`openspec validate --strict` 綠；`git diff --check` 乾淨
- [x] 10.5 merge 後依 §1.6 sync/archive 並同步 roadmap，把過渡語意收斂為正式邊界 — **post-merge gate**：PR #63 merged → PR #64 (`docs(openspec): 歸檔 local-coordinator-ifc-ready-intake-boundary 並 sync specs`) 完成 archive 與 `openspec/specs/local-coordinator-ifc-ready-intake-boundary/spec.md` sync。**Retro-audited 2026-05-21**。

> **T9 done（10.1–10.5，2026-05-18 → 2026-05-21 retro-tick）** — 見 `apply-notes.md` §T9。
> 10.1：5 spec delta 寫入 `specs/`：`worker-rvt-ifc-bridge`/`bim-control-revit-intake-facade`/`worker-artifact-pipeline` = REMOVED（product/core capability，理由＝B 方案刪服務、僅 test fixture 模擬）；`demo-runtime-readiness-smoke`/`runtime-verification-evidence` = MODIFIED（核心 tier 去 `_worker`/`_bim-control`、改 contract stub → coordinator intake / streaming internal / callback outbox / Kit launcher deferred 分層）。`openspec validate --strict` change valid、`--specs --strict` **19 passed / 0 failed**。
> 10.2：`AGENTS.md` §10 閉環 + §11 總結 + §1.A 改寫為 B 方案（external IFC Worker → coordinator intake → streaming internal → metadata-only callback outbox；`_worker`/`_bim-control` 標 **removed from product runtime，非降級**）；`CLAUDE.md` §10 鏡像 + §1.A 同步。
> 10.3：`python scripts/render-roadmap-html.py` 重生 `.html`（193,918 bytes，源自同名 `.md`，md 為 SoT）；roadmap md 加 2026-05-18 Phase B apply 進度註記，**未把驗證狀態標 passed**（依 §1.6：Kit launcher deferred、OQ1/OQ5 pending）。
> 10.4：`git diff --check` 乾淨；coordinator `npm run verify` 綠（tsc + vitest **140**）；repo-root pytest **7**；streaming pytest **6**；`openspec validate --strict`（change valid、specs 19/0）。
> 10.5：依 `AGENTS.md §1.6` 屬 **PR #63 merge 後** 才執行 OpenSpec sync/archive + roadmap 正式收斂（把過渡語意收斂為正式邊界），不在本 rolling PR 範圍。
