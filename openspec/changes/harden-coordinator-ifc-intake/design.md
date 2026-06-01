## Context

CH-2 收 coordinator(TS)3 風險(#9 / #7 / #19),全 LOW impact,對應 2026-06-01 風險報告 CH-2 分組(coordinator intake 防護 + 死碼)。三項獨立無共享狀態,同一 change 分三組 commit。不碰 Python streaming-server / web-viewer。

## Goals / Non-Goals

- Goals:#9 strict 接線(ifcDownloader 核心邏輯已存在,只缺 caller 傳值)、#7 graceful shutdown signal 接線(dispose 本體已 tested,缺 index.ts signal handler)、#19 退役 `_bim-control` 死碼移除(保留 Artifact type / 簽章)。
- Non-Goals:見 proposal Non-goals(不做 queue 持久化、不復原 `_bim-control`、不改 callback outbox、不加 shutdown timer、不引入 dependency、不移除 Artifact type)。

## Key Decisions（explore open questions 收斂）

- **#9 code default false + compose env + 部署文件**(使用者 2026-06-01 拍板):不改既有 code 預設,避免破壞 demo / local fallback(placeholder 在 demo 是刻意佔位,沒真 IFC 時靠它跑通);compose 加 `IFC_DOWNLOAD_STRICT`(預設 false)+ 註解,部署文件標 production 必設 true。提供 strict 能力但不強制(對比 CH-1 #13 的 hard-fail:#13 是 sandbox security 退化,#9 的 placeholder 是 demo 刻意行為,故較溫和)。
- **#7 L1 只做 signal → dispose**:真持久化(sqlite / Redis)spec 明文另立 change;`dispose()` 本體已實作 + integration-tested,只補 `index.ts` signal handler 接線。不加 shutdown 超時 timer(擴大面積、難穩定測,in-flight 單 slot 秒級完成,記 follow-up)。
- **#19 徹底刪 client**(已逐路徑驗證可安全移除):`BIM_CONTROL_API_BASE` 在 B 方案永遠空、測試從不 mock 成功 fetch、`buildArtifactBindings` 走 inputBindings 分支忽略 artifacts。徹底刪反而消除「未來有人重設 env 走死碼」的隱患。MUST 保留 `Artifact` type 與簽章(仍多處用)。

## Control flow / Source of truth

- #9:strict 決策 source = `config.ifcDownloadStrict`(env `IFC_DOWNLOAD_STRICT`);`ifcDownloader` 內部 strict 邏輯不動,只由 `app` caller 傳 `fallbackOnFetchError = !strict`。
- #7:graceful shutdown source = process `SIGTERM` / `SIGINT` → `index.ts` shutdown → `app.dispose()`(drain queued → `markDroppedOnRestart`);in-flight 不碰。
- #19:`artifact_bindings` source = inputBindings(前端 / POST 帶入)/ session bindings,不再 fetch `_bim-control`。

## Validation Strategy

- coordinator:`cd bim-review-coordinator && npm run verify`(= `tsc -p tsconfig.json` + `vitest run`)。tsc 是 #19 型別 gate(約 10 個 test 的 makeApp 清 `bimControlApiBase`);vitest 覆蓋 #9 strict 502 + #7 `dropped_on_restart` + sessions 行為不變。
- root 回歸:`.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider`(必走 venv,否則 user-site FastAPI / Starlette 撞版本)。
- `npx openspec validate harden-coordinator-ifc-intake --strict`。
- baseline:apply 前先跑 `npm run verify` 拿綠燈基準,改完同指令比較。
- 三大坑:#9 新測試 MUST 換 http scheme(edge-local scheme 走 placeholder 繞開 fallback);#19 刪 config 欄位後約 10 個 test 的 makeApp 都要清(tsc 是主 gate);#7 真 signal 殺 vitest 難測,建議抽 shutdown 成可注入 deps 函式做 unit。

## 環境限制

- coordinator 驗證走 Node(`npm run verify`);root pytest 走 `.venv\Scripts\python.exe`(避 FastAPI / Starlette 版本撞)。本 change 不觸及 GPU / Kit。
