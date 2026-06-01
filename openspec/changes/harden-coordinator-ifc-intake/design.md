## 背景

CH-2 收 coordinator(TS)3 風險(#9 / #7 / #19),全 LOW impact,對應 2026-06-01 風險報告 CH-2 分組(coordinator intake 防護 + 死碼)。三項獨立無共享狀態,同一 change 分三組 commit。不碰 Python streaming-server / web-viewer。

## 目標 / 非目標

- 目標:#9 strict 接線(ifcDownloader 核心邏輯已存在,只缺 caller 傳值)、#7 graceful shutdown signal 接線(dispose 本體已 tested,缺 index.ts signal handler)、#19 退役 `_bim-control` 死碼移除(保留 Artifact type / 簽章)。
- 非目標:見 proposal「Non-goals」(不做 queue 持久化、不復原 `_bim-control`、不改 callback outbox、不加 shutdown timer、不引入 dependency、不移除 Artifact type)。

## 關鍵決策（explore open questions 收斂）

- **#9 code default false + compose env + 部署文件**(使用者 2026-06-01 拍板):不改既有 code 預設,避免破壞 demo / local fallback(placeholder 在 demo 是刻意佔位,沒真 IFC 時靠它跑通);compose 加 `IFC_DOWNLOAD_STRICT`(預設 false,且用 `${IFC_DOWNLOAD_STRICT:-false}` 讓 operator 經 env / `--env-file` 覆蓋)+ 註解,部署文件標 production 必設 true。提供 strict 能力但不強制(對比 CH-1 #13 的 hard-fail:#13 是 sandbox security 退化,#9 的 placeholder 是 demo 刻意行為,故較溫和)。
- **#7 L1 只做 signal → dispose**:真持久化(sqlite / Redis)spec 明文另立 change;`dispose()` 本體已實作 + integration-tested,只補 `index.ts` signal handler 接線。shutdown 抽成 `createGracefulShutdown`(順序 dispose → io.close → server.close → exit 0;io 先於 server 避免 Socket.IO keep-alive 讓 server.close callback 永不觸發的死鎖;dispose 包 try/catch 避免 drain 失敗中止整個關閉序列)。不加 shutdown 超時 timer(擴大面積、難穩定測,記 follow-up)。
- **#19 徹底刪 client**(已逐路徑驗證可安全移除):`BIM_CONTROL_API_BASE` 在 B 方案永遠空、測試從不 mock 成功 fetch、`buildArtifactBindings` 走 inputBindings 分支忽略 artifacts。徹底刪反而消除「未來有人重設 env 走死碼」的隱患。MUST 保留 `Artifact` type 與簽章(仍多處用)。

## 控制流 / 權威來源

- #9:strict 決策 source = `config.ifcDownloadStrict`(env `IFC_DOWNLOAD_STRICT`);`ifcDownloader` 內部 strict 邏輯不動,只由 `app` caller 傳 `fallbackOnFetchError = !strict`。
- #7:graceful shutdown source = process `SIGTERM` / `SIGINT` → `index.ts` shutdown → `app.dispose()`(drain queued → `markDroppedOnRestart`);in-flight 不碰。
- #19:`artifact_bindings` source = inputBindings(前端 / POST 帶入)/ session bindings,不再 fetch `_bim-control`。

## 驗證策略

- coordinator:`cd bim-review-coordinator && npm run verify`(= `tsc -p tsconfig.json` + `vitest run`)。tsc 是 #19 型別 gate(約 10 個 test 的 makeApp 清 `bimControlApiBase`);vitest 覆蓋 #9 strict 502 + non-strict fallback + #7 shutdown 順序 + `dropped_on_restart` + sessions 行為不變。
- root 回歸:`.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider`(必走 venv,否則 user-site FastAPI / Starlette 撞版本)。
- `npx openspec validate harden-coordinator-ifc-intake --strict`。
- baseline:apply 前先跑 `npm run verify` 拿綠燈基準,改完同指令比較。
- 三大坑:#9 新測試 MUST 換 http scheme(edge-local scheme 走 placeholder 繞開 fallback);#19 刪 config 欄位後約 10 個 test 的 makeApp 都要清(tsc 是主 gate);#7 真 signal 殺 vitest 難測,shutdown 抽成可注入函式做 unit。

## 已知 follow-up（外部 review defer）

- (Codex P2)strict 對 non-http IFC ref(如 `minio://`)未生效:`downloadIfcToSharedVolume` 對非 http(s) URL 直接回 placeholder,不經 `fallbackOnFetchError`。屬 ifcDownloader 既有行為(non-http 真下載未實作),超出 #9 的「http fetch fallback」scope,defer 至 non-http 真下載 change。
- (Codex P2)graceful shutdown 的 in-flight intake race:SIGTERM 時若 `/api/external/ifc-ready` 已 accept 仍在 download,dispose drain 之後該 request 才 enqueue,可能漏標 `dropped_on_restart`。屬既有 dispose 時機問題(#7 只補 signal 接線、未惡化),完整解需「先停 accept 新 work 再 drain」,涉及 server.close keep-alive 死鎖權衡,defer follow-up。

## 環境限制

- coordinator 驗證走 Node(`npm run verify`);root pytest 走 `.venv\Scripts\python.exe`(避 FastAPI / Starlette 版本撞)。本 change 不觸及 GPU / Kit。
