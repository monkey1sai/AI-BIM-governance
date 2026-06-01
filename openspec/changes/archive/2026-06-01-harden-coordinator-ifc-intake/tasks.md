## 1. OpenSpec artifacts

- [x] 1.1 proposal / design / tasks + spec delta(`local-coordinator-ifc-ready-intake-boundary` ADD 1、`project-risks-mitigation` ADD 1;#19 tasks-only)
- [x] 1.2 `npx openspec validate harden-coordinator-ifc-intake --strict` 通過

## 2. #9 IFC strict 接線

- [x] 2.1 apply 前 `gitnexus_impact` on `loadConfig` / `CoordinatorConfig` / `downloadIfcToSharedVolume` / `createCoordinatorApp`
- [x] 2.2 `config.ts` 加 `CoordinatorConfig.ifcDownloadStrict` + `loadConfig` 用 `parseBooleanEnv` 讀 `IFC_DOWNLOAD_STRICT`(default false)
- [x] 2.3 `app.ts` 的 `downloadIfcToSharedVolume` 呼叫加 `fallbackOnFetchError: !config.ifcDownloadStrict`
- [x] 2.4 `compose.runtime-manager.yml` + `compose.host-kit.yml` coordinator env 加 `IFC_DOWNLOAD_STRICT`(預設 false + production 註解)
- [x] 2.5 測試:`config.test.ts` strict env;`external-ifc-ready.test.ts` strict=true + **http scheme** + `fetchImpl` 失敗 → 502 + `download_status=failed` + 未 dispatch

## 3. #7 graceful dispose 接線

- [x] 3.1 apply 前 `gitnexus_impact` on `createCoordinatorApp`(dispose)/ `index.ts`
- [x] 3.2 `index.ts` destructure `dispose` + `io`,定義 `shutdown`(dispose → `server.close` → `io.close` → `process.exit(0)`),註冊 `process.on("SIGTERM")` / `process.on("SIGINT")`
- [x] 3.3（建議）抽 `shutdown` 成可注入 deps 函式 + unit 斷言 dispose / server / io 被呼叫且 exit 0;否則記 signal path 手動驗
- [x] 3.4 `conversion-dispatch-queue.test.ts` 的 dispose → `dropped_on_restart` 維持綠

## 4. #19 退役死碼移除

- [x] 4.1 apply 前 `gitnexus_impact` on `safeArtifacts` / `BimControlClient` / `createCoordinatorApp`;Glob 確認 `bimControlClient.ts` 確切路徑
- [x] 4.2 `app.ts` 移 `BimControlClient` import + 建構;POST review-sessions `safeArtifacts` → 空陣列常量;GET stream-config handler 改 sync 傳空陣列;刪 `safeArtifacts`
- [x] 4.3 `config.ts` 刪 `bimControlApiBase` 欄位 + 讀取;刪 `bimControlClient.ts`;**保留 `Artifact` type 與簽章**
- [x] 4.4 清約 10 個 test file 的 makeApp 內 `bimControlApiBase` 行(tsc gate 驗無漏)

## 5. Verify + PR

- [x] 5.1 coordinator `npm run verify`(tsc + vitest)+ root pytest 回歸,與 apply 前 baseline 比對
- [x] 5.2 `gitnexus_detect_changes` 確認 scope;`git diff --cached --check`
- [x] 5.3 commit → push → 開 implementation PR(繁中標題 / 說明)
