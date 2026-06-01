## Why

CH-2 收 `bim-review-coordinator`(TS)的 3 個誠實性 / 清理風險,全 LOW impact、無新 production dependency。三處「看似成功實則沒做對」:

1.（#9）IFC `fallbackOnFetchError` strict 接線缺口:`app.ts` 呼叫 `downloadIfcToSharedVolume` 不傳 `fallbackOnFetchError`,`ifcDownloader.ts` 預設 `true` 永遠 non-strict;`CoordinatorConfig` 無 `ifcDownloadStrict`、`loadConfig` 不讀 `IFC_DOWNLOAD_STRICT`;兩 compose 皆無此 env。production 因此永遠走 fallback placeholder(抓不到 IFC 仍回 ok),違反 CLAUDE.md carve-out「production 應設 strict」。
2.（#7）`ConversionDispatchQueue` graceful dispose 未接線:`dispose()`(drain queue + markDroppedOnRestart)已實作且 integration-tested,但 `index.ts` 不 destructure 它、也無 `process.on("SIGTERM"/"SIGINT")` handler。真實 signal 下 Node 立即 exit,dispose 從不被呼叫,queued jobs 靜默遺失未標 `dropped_on_restart`,違反 `project-risks-mitigation` 的 `RISK-IN-MEMORY-QUEUE-PERSISTENCE`(graceful shutdown MUST drain + mark)。
3.（#19）`safeArtifacts(BimControlClient,...)` 退役死碼:`BimControlClient` 封裝已退役的 `_bim-control`,`BIM_CONTROL_API_BASE` 在 B 方案永遠空字串,`safeArtifacts` catch 後恆回空陣列,卻仍掛在 POST review-sessions 與 GET stream-config 兩個 hot-path handler。

## What Changes

Owner = `bim-review-coordinator`;不碰 streaming-server / web-viewer / callback outbox。

- **#9 IFC strict 接線**:`config.ts` 的 `CoordinatorConfig` 加 `ifcDownloadStrict: boolean`,`loadConfig` 用既有 `parseBooleanEnv` 讀 `IFC_DOWNLOAD_STRICT`（**code default false**,不破壞既有 demo/local fallback）;`app.ts` 的 `downloadIfcToSharedVolume` 呼叫加 `fallbackOnFetchError: !config.ifcDownloadStrict`;兩 compose coordinator env 加 `IFC_DOWNLOAD_STRICT`(預設 false)+ 註解標 production 必設 true。strict 下 HTTP non-2xx 回 502 + `download_status=failed` 不靜默 placeholder。(使用者 2026-06-01 拍板:code default false + compose env + 部署文件指引,不強制改 code default。)
- **#7 graceful dispose 接線**:`index.ts` destructure `dispose` 與 `io`,定義 `shutdown`(dispose → `server.close` → `io.close` → `process.exit(0)`),註冊 `process.on("SIGTERM")` / `process.on("SIGINT")`。`dispose()` 本體不動(已 tested);in-flight job 刻意跑完(drain 只 splice queued array)。
- **#19 死碼移除**:`app.ts` 移除 `BimControlClient` import 與建構;POST review-sessions 的 `safeArtifacts` 改回空陣列常量保留下游簽章;GET stream-config handler 改回 sync 傳空陣列;刪 `safeArtifacts`;`config.ts` 刪 `bimControlApiBase` 欄位與讀取;刪 `bimControlClient.ts`。**MUST 保留 `Artifact` type 與 `buildArtifactBindings` / `buildStreamConfig` 的 `artifacts` 簽章**(仍 7+ 處使用)。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `local-coordinator-ifc-ready-intake-boundary`:ADD 1 requirement(IFC-ready download 在 explicit strict mode 下對 non-2xx 回 502 不靜默 placeholder)。
- `project-risks-mitigation`:ADD 1 requirement(graceful shutdown 由 SIGTERM/SIGINT 觸發 dispose drain,補實作 `RISK-IN-MEMORY-QUEUE-PERSISTENCE` 的 graceful shutdown 接線)。
- #19 死碼移除為 tasks-only,不改外部可觀察行為,無 spec delta。

## Impact

- Owner repo / folder:
  - `bim-review-coordinator/src/{config,app,index}.ts`、`bim-review-coordinator/src/services/ifcDownloader.ts`(不改內部 strict 邏輯,只接線 caller)
  - `bim-review-coordinator/src/services/bimControlClient.ts`(刪除;apply 時以 Glob 確認確切路徑)
  - `bim-review-coordinator/tests/*`(約 10 個 makeApp helper 清 `bimControlApiBase`)
  - `compose.runtime-manager.yml`、`compose.host-kit.yml`(coordinator env 加 `IFC_DOWNLOAD_STRICT`)
  - `openspec/changes/harden-coordinator-ifc-intake/`
- Runtime boundary:純 coordinator 內部。對外 API / Socket.IO contract 不變(#9 只多一個 502 觸發條件,屬既有 contract 內;#7 / #19 無對外行為變更)。
- API:`POST /api/external/ifc-ready` 在 strict 下對 non-2xx IFC fetch 回 502 + `download_status=failed`(既有 contract 內,additive 觸發條件)。
- Data:無 schema 變更。
- Dependencies:無新增 production dependency(移除 `BimControlClient` 死碼)。
- Runtime 行為變更(operator 需注意):`IFC_DOWNLOAD_STRICT` code default false(不破壞既有 demo/local);production 透過 compose env + 部署文件設 true。
- Non-goals:
  - 不做 `ConversionDispatchQueue` 持久化(sqlite / Redis / RabbitMQ),spec 明文另立獨立 change。
  - 不復原 `_bim-control` discovery / artifact fetch(B 方案退役,artifact 由前端 `artifact_bindings` 帶入)。
  - 不改 callback outbox(enqueue / retry / dead_letter)邏輯。
  - 不引入新 production dependency。
  - 不改 `ifcDownloader` 內部 strict 邏輯(已完整),只接線 caller。
  - 不移除 `Artifact` / `ArtifactBinding` type,也不移除 `buildArtifactBindings` / `buildStreamConfig` 的 `artifacts` 簽章。
  - 不改 in-flight job 行為(drain 只碰 queued array)。
  - 不改對外 API / Socket.IO contract schema。
  - #7 不加 shutdown 超時強制 exit timer(follow-up)。
