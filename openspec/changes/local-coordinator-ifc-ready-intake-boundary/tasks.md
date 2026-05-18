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

- [ ] 3.1 刪除 `_worker/`、`_bim-control/` 服務目錄（先建立 T8 的 tests/fakes 確保驗證能力不中斷後再刪）
- [ ] 3.2 移除 `compose.*` / `scripts/*`（start-all/stop-all/health/smoke）對兩者的預設與可選依賴
- [ ] 3.3 移除 health / smoke / readiness 對兩者的依賴
- [ ] 3.4 改用 `tests/fakes/external_ifc_worker_client`、`tests/fakes/cloud_bim_control_api`、`tests/contracts/*.json` 模擬外部 API（非 runtime profile）
- [ ] 3.5 修改前對受影響 symbol 跑 GitNexus impact analysis；HIGH/CRITICAL 先回報

## 4. T3 Coordinator external intake

- [ ] 4.1 `bim-review-coordinator` 新增 `POST /api/external/ifc-ready`（payload schema 對齊 `tests/contracts/ifc_ready_payload.json`）
- [ ] 4.2 實作 `AuthProvider`/`AuthModule` 介面 + `intranet-dev` provider（IP allowlist + secret/HMAC + correlation_id + idempotency_key + tenant/project/external_model_version_id）
- [ ] 4.3 idempotency（依 `idempotency_key`/`correlation_id`）+ local conversion job state + `external_model_version_id` binding
- [ ] 4.4 呼叫 `bim-streaming-server` internal conversion API
- [ ] 4.5 單元/契約測試：unauthorized / duplicate / missing-ifc / 正常路徑

## 5. T4 Streaming internal conversion API

- [ ] 5.1 `bim-streaming-server` 收斂為 internal-only：接受 coordinator internal conversion request，移除對外 ifc-ready 入口
- [ ] 5.2 保留 IFC→USDC / element_mapping / manifest 既有轉檔核心（不重寫）
- [ ] 5.3 契約測試：coordinator→streaming internal request → conversion_job_id/status/result

## 6. T5 Callback to company cloud

- [ ] 6.1 實作 `conversion_result_ready` / `conversion_failed` callback（metadata-only，禁傳 `.usdc` 本體）
- [ ] 6.2 實作 `callback_outbox` + retry policy + dead-letter state + callback evidence log
- [ ] 6.3 契約測試：cloud 不可達→outbox 保留重試、retry 耗盡→dead-letter、callback_status 與 conversion 成功分離
- [ ] 6.4 **阻塞項**：真實對接公司雲端 endpoint/auth 待 OQ1 確認（未確認前以 `tests/contracts/conversion_result_callback.json` 凍結契約，real endpoint 標 pending）

## 7. T6 Local artifact shadow metadata

- [ ] 7.1 定義並實作最小 shadow metadata 欄位集（tenant_id/project_id/external_model_version_id/external_conversion_task_id/correlation_id/source_ifc_ref/source_ifc_etag/conversion_job_id/artifact_manifest_ref/callback_url/callback_status/last_callback_attempt_at）
- [ ] 7.2 artifact_manifest 產出與 `external_model_version_id` binding；不 mirror 公司 MySQL
- [ ] 7.3 測試：control-plane metadata 不在本地被重新宣告權威；data-plane availability 本地可答

## 8. T7 Local web view integration

- [ ] 8.1 `bim-review-coordinator` 提供 local web view session / artifact resolution 入口
- [ ] 8.2 預留使用者 SSO flow（現階段用可替換 auth provider；不做死 EZPLUS SSO）
- [ ] 8.3 **阻塞項**：local web view ↔ 公司 SSO 銜接待 OQ5 確認

## 9. T8 Readiness / smoke / evidence rewrite

- [ ] 9.1 default smoke 不依賴 `_worker`/`_bim-control`
- [ ] 9.2 新 smoke 用 contract stub 呼叫 coordinator intake，驗 conversion + callback outbox + Kit launcher evidence
- [ ] 9.3 evidence 分層加入 Kit launcher / callback outbox；GPU/Kit 阻塞標 deferred 不謊報

## 10. T9 Documentation / spec cleanup（對 merge 後現行 specs 撰寫）

- [ ] 10.1 撰寫並套用大型 spec delta：`demo-runtime-readiness-smoke`(MODIFIED)、`runtime-verification-evidence`(MODIFIED)、`worker-rvt-ifc-bridge`/`bim-control-revit-intake-facade`/`worker-artifact-pipeline`(REMOVED as product capability) — 對當時現行 `openspec/specs/` 撰寫，避免 stale/partial delta
- [ ] 10.2 改寫 `AGENTS.md` §2–§11 / §10 閉環、`CLAUDE.md`、roadmap 對齊 control-plane/data-plane；移除把 `_worker`/`_bim-control` 當核心閉環的描述
- [ ] 10.3 `scripts/render-roadmap-html.py` 重生 roadmap `.html`
- [ ] 10.4 四層驗證（type/lint/affected unit/contract、必要時 smoke）綠；`openspec validate --strict` 綠；`git diff --check` 乾淨
- [ ] 10.5 merge 後依 §1.6 sync/archive 並同步 roadmap，把過渡語意收斂為正式邊界
