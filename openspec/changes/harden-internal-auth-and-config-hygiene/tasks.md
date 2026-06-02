# Tasks — harden-internal-auth-and-config-hygiene

## 1. #2 host-native conversion token（test + comment，不改機制）

- [ ] 1.1 `conversion_authority.py` GET handler 群（list/{id}/result、`/artifacts/{job_id}/{filename}`）加 comment：loopback 邊界 + 「非 loopback 時應考慮保護 GET/artifacts」（零邏輯改動）
- [ ] 1.2 `tests/test_host_native_conversion_service.py` 補 403（帶錯 token）case 對齊 authority layer
- [ ] 1.3 新增 `test_host_native_load_config_reads_token_from_env`（`STREAMING_CONVERSION_INTERNAL_TOKEN=abc`→`'abc'`、空字串→None）
- [ ] 1.4 補「預設 None（不設 token）→ POST 不帶 header 仍 202」demo-不破 regression test
- [ ] 1.5 `pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py` 全綠

## 2. #6 coordinator internal middleware（comment + test，不改機制）

- [ ] 2.1 `app.ts:761-764` comment 改：`future change` → 白名單刻意開放理由（viewer-log: log ingest 可用性 / structLog/health: 監控探活）；L764 行內 `Intentionally unauth`
- [ ] 2.2 新增 `tests/app/internalAuth.test.ts`（5 cases：非白名單無 token→401、`x-internal-token`→非401、`Bearer`→非401、`/viewer-log` 無 token→非401、`/structLog/health` 無 token→200；`createCoordinatorApp` overrides 設 `internalApiAuthToken`）

## 3. #23 env fallback warning + missing throw（deploy.ps1 + check，不碰 start-web-plane-docker.ps1）

- [ ] 3.1 `deploy.ps1` `Resolve-HybridEnvFile`（或 env 解析 L444-445）fallback 到 `.example` 後加 `Write-Warning`；連 `.example` 都不存在 `throw 'env_file_missing'`
- [ ] 3.2 `check-web-plane-docker.ps1` `Resolve-HybridEnvFile` 同處理
- [ ] 3.3 新增 fallback-warning / missing-throw test（`3>&1` 捕捉 warning stream）；`test-deploy-dryrun.ps1` 既有正常路徑 0 regression

## 4. #26 kit-manager-api CORS 可設定

- [ ] 4.1 `settings.py` `Settings` 加 `cors_origins: list[str]` + `_parse_cors_origins(raw)`（空→`['*']`，逗號分隔）；`from_env` 讀 `KIT_MANAGER_CORS_ORIGINS`
- [ ] 4.2 `main.py` `allow_origins` 改用 `settings.cors_origins`（不動 methods/headers）
- [ ] 4.3 新增 `tests/test_settings_cors.py`（未設→`['*']`、`'a,b'`→兩元素）

## 5. #29 evidence 搬到 archive sibling（移出本 change → 獨立 historical-correction PR）

- [ ] 5.1 **defer**：`openspec/AGENTS.md` L30「MUST NOT 修改 archive 內任何檔案；歷史 correction 需獨立 PR」（Codex P1）。evidence 搬移不可混在本 feature change，移出；另開獨立 historical-correction PR 處理 2 個 untracked evidence → archive sibling（`documentation-source-of-truth` 規範由該獨立 PR 滿足）。本 change 不碰 `archive/`。

## 6. #36 退役 event 過濾固化

- [ ] 6.1 新增 `tests/services/eventLogFilter.test.ts`（`listLifecycle` 排除 collaboration type、`list` 全量仍含）
- [ ] 6.2 `appendEventSchema` 附近 comment 說明刻意 passthrough（archive compatibility）

## 7. OpenSpec spec delta 與驗證

- [ ] 7.1 `specs/host-native-conversion-authority-service/spec.md` MODIFY「exposes internal API」（加 GET-over-loopback + token-unset demo scenario — #2）
- [ ] 7.2 `specs/one-click-deploy-hybrid/spec.md` MODIFY「Mode C hybrid 一鍵部屬入口」（加 deploy.ps1 env fallback warning + missing-example throw scenario — #23）
- [ ] 7.3 `openspec validate harden-internal-auth-and-config-hygiene --strict`
- [ ] 7.4 baseline 對照全綠（streaming pytest / coordinator verify / kit-manager pytest / deploy dryrun）；root pytest 回歸；`git diff --cached --check`；GitNexus `detect_changes`
