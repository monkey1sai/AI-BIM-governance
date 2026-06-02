# Design — harden-internal-auth-and-config-hygiene

## Context

L4 第一批 6 項（#2 #6 #23 #26 #29 #36），brainstorming 收斂（design doc 已 approve）。explore 讀 code 的**關鍵發現**：design doc 把 #2/#6 寫成「加 token 機制」，但 **機制都已完整存在**（#2 `conversion_authority.py:98-104`；#6 `app.ts:766-776` + `isInternalRequestAuthorized:1521-1531`）；design「現況」欄本就寫機制在，「做法」欄措辭把「預設 off」誤讀成「缺失」。真實工作 = **固化既有行為 + 補可觀測 test + 加收緊旋鈕 + 文件**，零既有預設行為改動。三個安全項對應既有/新增 env：#2 `STREAMING_CONVERSION_INTERNAL_TOKEN`（既有，預設 None=off）；#6 `INTERNAL_API_AUTH_TOKEN`（既有，預設 `dev-internal-token`，白名單刻意 unauth）；#26 `KIT_MANAGER_CORS_ORIGINS`（新增，預設 `['*']`）。

## Goals / Non-Goals

**Goals**：把既有半成品防禦補上可觀測 test 與部署收緊旋鈕；env fallback 防誤配置；evidence 歸位；退役 event 過濾固化。

**Non-Goals**：

- 不改任何既有 production 預設行為：#2 預設 None（無 token 驗證）、#6 兩白名單維持 unauth、#26 CORS 預設 `['*']`。
- 不對 #6 兩條白名單（`/viewer-log`、`/structLog/health`）加 token——使用者拍板刻意 unauth（log ingest 不因 auth 丟記錄、health 給監控探活）。
- 不為 #2 新增 enforcement 機制（已存在）、不改 env var 名（沿用 `STREAMING_CONVERSION_INTERNAL_TOKEN`）；GET 類不加 token（使用者拍板：loopback binding 是邊界）。
- 不為 #6 新增 internal auth 機制（已存在）、不改 `INTERNAL_API_AUTH_TOKEN`。
- **不改 `start-web-plane-docker.ps1`**——受 `one-click-deploy-hybrid` spec「既有 startup 入口 0 行改動」（L20）保護；其獨立 fallback 警告需另開 change MODIFY 該 spec，列 follow-up。
- #26 不碰 state in-memory（restart 即丟屬既有設計）、不動 `allow_methods`/`allow_headers`。
- #36 不在 REST `POST /events` 層封鎖退役 collaboration type（archive compatibility 刻意保留）、不加 Socket.IO socket-level 封鎖。
- #29 不搬 already-tracked 輔助檔（helper `.md`、verify `.py`、`runbook.md`），只搬 untracked evidence JSON。
- #34（branch git 清理，merge 後另給清單）、#21（multi-instance race）、#33（537 .md 治理）不納入。
- 不新增 production dependency。

## Decisions

1. **#2（test + comment，不改機制）**：`conversion_authority.py:98-104` token enforce 已完整。GET handler 群加 comment 說明「非 loopback binding 時應考慮保護 GET/artifacts」（零邏輯改動）。補 test：host-native layer 補 403（帶錯 token）對齊 authority layer、`test_host_native_load_config_reads_token_from_env`（`STREAMING_CONVERSION_INTERNAL_TOKEN=abc`→`'abc'`、空字串→None 的 `or None` 語義）、明確補「預設 None→POST 不帶 header 仍 202」demo-不破 regression。

2. **#6（comment + test，不改機制）**：改 `app.ts:761-764` comment（`Production hardening is a future change` → 白名單刻意開放理由）+ L764 行內 `Intentionally unauth`。新增 `tests/app/internalAuth.test.ts`（5 cases，`createCoordinatorApp` overrides 設 `internalApiAuthToken` 使 token 可控不依賴預設字串），走既有 `viewerLogIntake.test.ts` 同 pattern。

3. **#23（deploy.ps1 + check，不碰 start-web-plane-docker.ps1）**：`Resolve-HybridEnvFile` fallback 到 `.example` 後加 `Write-Warning`（dev/demo only 提示）；**連 `.example` 都不存在時 `throw 'env_file_missing'`**（使用者拍板：明確失敗優於帶空 env 誤配置 `PUBLIC_HOST`/`STORAGE_ROOT` 拓樸）。只改 `deploy.ps1`（Mode C 一鍵入口，CH-3/CH-5 已改過）+ `check-web-plane-docker.ps1`（diagnostic）。coordinator `dotenv.config()` no-op 維持現狀（全 config 有 code 預設值，刻意；只在此註記待確認）。

4. **#26（可設定 CORS）**：`settings.py` `Settings` 加 `cors_origins: list[str]` + `_parse_cors_origins(raw)`（`raw.strip()` 空→`['*']` dev 不破，否則逗號分隔）；`main.py` `allow_origins` 改用 `settings.cors_origins`；env `KIT_MANAGER_CORS_ORIGINS`。`from_env()` 沿用既有 `os.getenv` 模式。

5. **#29（移出本 change，defer 到獨立 historical-correction PR）**：原計畫搬 untracked evidence 到 archive sibling，但 `openspec/AGENTS.md` L30 規定改 `archive/` 內檔案需獨立 historical-correction PR（不可混在 feature change；Codex P1 指出）。故 #29 移出本 change，另開獨立 PR 處理 evidence 搬移。`documentation-source-of-truth` 的 evidence-to-archive 規範透過該獨立 PR 滿足。

6. **#36（test + comment）**：`tests/services/eventLogFilter.test.ts`（Case1 append highlightRequest/selectionUpdate/annotationCreate/sessionCreated 後 `listLifecycle` 只回 sessionCreated；Case2 `list` 全量仍含 3 collaboration type）；`appendEventSchema` 附近 comment 說明刻意 passthrough（archive compatibility）。

## Risks / Trade-offs

- **#23 throw 改變 deploy 行為**：連 `.example` 都無時從「帶空 env 啟動」變「明確失敗」——使用者已拍板（誤配置拓樸比明確失敗更糟）；baseline dryrun 對照確認既有正常路徑（有 `.env` 或有 `.example`）不受影響。
- **#23 未覆蓋 start-web-plane-docker.ps1**：spec 保護，獨立跑時 fallback 仍靜默；列 follow-up。
- **#2 GET 不保護**：loopback binding 下安全；若部署 bind 非 loopback，GET/artifacts 暴露——comment 已提示，列 follow-up。

## Verification（baseline 對照）

- bim-streaming-server（#2）：`.venv\Scripts\python.exe -m pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py -p no:cacheprovider`。
- bim-review-coordinator（#6+#36）：`npm run verify`（build+test，新增 internalAuth + eventLogFilter test）。
- services/kit-manager-api（#26）：`.venv\Scripts\python.exe -m pytest services/kit-manager-api/tests`。
- #23：`pwsh scripts/tests/test-deploy-dryrun.ps1` 0 regression + 新增 fallback-warning/missing-throw test（`3>&1` 捕捉 warning）。
- #29：搬移後 `git status` 兩 untracked 消失、archive sibling 下 tracked。
- root pytest 回歸；`openspec validate --strict`；GitNexus `detect_changes`。

## Rollout

單一 PR；merge 後 archive + roadmap §1.6 + design doc 標 superseded 指向 archive。`start-web-plane-docker.ps1` fallback 警告、#2 GET 保護列 follow-up。
