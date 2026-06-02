# harden-internal-auth-and-config-hygiene

## Why

L4（2026-06-01 風險報告需業務/資料拍板那批）經 2026-06-02 brainstorming 拆三類，本 change 收 **第 1 類（可設定防禦 #2 #6 #23 #26）+ 第 2 類（repo 治理 #29 #36）共 6 項**（design doc：`docs/superpowers/specs/2026-06-02-harden-internal-auth-and-config-hygiene-design.md`）。

explore 讀 code 後確認一個關鍵事實：**#2 與 #6 的防禦機制都已完整存在**——#2 `conversion_authority.py:98-104`（`X-Internal-Conversion-Token` 缺→401/錯→403/對→放行，預設 None 跳過，host-native spec 已有「Internal token is enforced when configured」scenario）；#6 `app.ts:766-776` + `isInternalRequestAuthorized`（非白名單 `/api/internal/*` 驗 `x-internal-token`/`Bearer`，失敗→401）。design doc「現況」欄本就寫機制已在，「做法」欄措辭把「預設 off」誤讀成「機制缺失」。因此本輪真實工作 = **固化既有行為（補可觀測 test）+ 加可設定收緊旋鈕（#26 CORS）+ 加註解 + env fallback 防誤配置（#23）**，全程**不改任何既有 production 預設行為**，複用 CH-2 strict pattern（機制 + 預設寬鬆不破 demo + 部署環境變數收緊 + 文件）。

## What Changes

- **#2 [High]**（token enforce 已存在）：對 GET 類 endpoint（list/{id}/result、`/artifacts/{job_id}/{filename}`）**不加 token**（使用者拍板：loopback-only binding 已是邊界），只在 GET handler 附近加 comment 說明「若 `STREAMING_CONVERSION_HOST` 設非 loopback 應考慮保護 GET/artifacts」；補 test 固化（host-native layer 補 403、`STREAMING_CONVERSION_INTERNAL_TOKEN` 讀取的 `or None` 語義、預設 None→POST 不帶 header 仍 202 的 demo-不破 regression）。**不新增 enforcement、不改 env var 名**。
- **#6 [High]**（internal middleware 已存在）：`/viewer-log`+`/structLog/health` 維持 unauth（使用者拍板刻意開放），改 `app.ts:761-764` comment（`future change` → 白名單刻意開放理由 + 行內 `Intentionally unauth`）；新增 `internalAuth.test.ts`（5 cases：非白名單無 token→401、`x-internal-token`/`Bearer`→非401、`/viewer-log` 無 token→非401、`/structLog/health` 無 token→200，用 `createCoordinatorApp` overrides 設 token 可控）。**不新增機制、不對白名單加 token**。
- **#23 [M]**：`deploy.ps1`（Mode C 一鍵入口）+ `check-web-plane-docker.ps1`（diagnostic）的 `Resolve-HybridEnvFile` fallback 到 `.example` 後加 `Write-Warning`（dev/demo only）；**連 `.example` 都不存在時 `throw`**（使用者拍板：明確失敗優於帶空 env 誤配置拓樸）。**不改 `start-web-plane-docker.ps1`**（受 `one-click-deploy-hybrid` spec「既有 startup 入口 0 行改動」保護——其獨立跑的 fallback 警告列 follow-up，需另開 change MODIFY 該 spec）。
- **#26 [M]**：`kit-manager-api` `settings.py` 加 `cors_origins` 欄位 + `_parse_cors_origins`（空→`['*']` dev 不破，逗號分隔收緊）；`main.py` `allow_origins` 改用 `settings.cors_origins`；新增 env `KIT_MANAGER_CORS_ORIGINS`。不動 `allow_methods`/`allow_headers`、不碰 state in-memory。
- **#29 [L]（移出本 change，defer 到獨立 PR）**：原計畫把 2 個 untracked evidence 搬到 archive sibling，但 `openspec/AGENTS.md` 規定 `archive/` immutable、改 archive 內檔案需**獨立 historical-correction PR**（Codex review 指出，feature change 不得混改 archive）。故 evidence 搬移**移出本 change**，另開獨立 historical-correction PR 處理（`documentation-source-of-truth` 的 evidence-to-archive 規範透過該獨立 PR 滿足）。
- **#36 [L]**：新增 `eventLogFilter.test.ts` 固化退役 collaboration event 過濾（`listLifecycle` 排除 highlightRequest/selectionUpdate/annotationCreate、`list` 全量仍含）+ `appendEventSchema` 附近 comment。**不在 REST `POST /events` 層封鎖**退役 type（archive compatibility 刻意保留）。

## Impact

- **Affected specs**：`host-native-conversion-authority-service`（MODIFY「exposes internal API」，加 GET-over-loopback + token-unset demo scenario — #2）；`one-click-deploy-hybrid`（MODIFY「Mode C hybrid 一鍵部屬入口」，加 deploy.ps1 env fallback warning + missing-example throw scenario — #23）。
- **Affected code**：`bim-streaming-server`（#2 comment+test）、`bim-review-coordinator`（#6 comment+test、#36 test+comment）、`services/kit-manager-api`（#26 settings+main+test）、`scripts/deploy.ps1`+`check-web-plane-docker.ps1`（#23）、`compose.runtime-manager.yml`（#26 CORS env 接線）。（#29 evidence 搬移移出本 change，走獨立 historical-correction PR。）
- **不改動**：任何既有 production 預設行為（#2 預設 None、#6 白名單 unauth、#26 預設 `*`）；`start-web-plane-docker.ps1`（spec 保護）；對外 contract；不新增 production dependency。#34/#21/#33 不納入（另議）。
