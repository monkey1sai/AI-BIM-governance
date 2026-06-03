# Design — frontend-coordinator-env

## Context

Edge Console（`web-viewer-sample/src/console/`）與 viewer（`Window.tsx` / `AppStream.tsx`）共用同一前端 Vite 專案。viewer 經 `src/config/env.ts` 的 `reviewEnv.coordinatorApiBase` 取得 coordinator base，來源是 env `VITE_COORDINATOR_API_BASE`（+ `?coordinatorApiBase=` query 信任清單）。部署鏈（`scripts/deploy.ps1` 經 `WEB_VIEWER_COORDINATOR_API_BASE` → compose `VITE_COORDINATOR_API_BASE` build-arg）一律設定這個正規名。

治理 client `governanceClient.ts` 卻自行讀 `VITE_COORDINATOR_BASE`（缺 `_API`），是全 repo 唯一讀此名處，且無任何部署設定它 → 非預設 coordinator 部署下，治理 client 讀不到值、fallback 寫死預設，A1/A2/A3 操作全失效。

## Goals / Non-Goals

- Goals：把 `governanceClient` 的 coordinator base 來源對齊全站／部署正規 env 名 `VITE_COORDINATOR_API_BASE`，使治理 client 與 viewer 同源；保留舊名相容；預設值不變。
- Non-Goals：不改後端 / coordinator proxy 路徑、不引入依賴、不改 viewer 行為、不擴充 query-param 信任解析到 console client（維持最小修）。

## Decisions

### D1：改讀正規名 `VITE_COORDINATOR_API_BASE`，舊名降為 fallback（正規名優先）

採 `env?.VITE_COORDINATOR_API_BASE ?? env?.VITE_COORDINATOR_BASE ?? "http://127.0.0.1:8004"`。

- 正規名優先：部署只設正規名即生效，修掉 HIGH bug。
- 保留舊名為 fallback：若有（理論上的）舊環境僅設舊名，仍可運作，零回歸風險（向後相容）。
- 預設 `http://127.0.0.1:8004` 與 `config/env.ts:64` 完全一致，本機 / 未注入時行為不變。
- `import.meta.env` 以既有的 `(import.meta as { env?: Record<string, string> }).env` 安全存取模式抽出區域 `env` 後連續 `??`，型別與既有寫法一致（避免引入新型別風險、不依賴 vite client 型別宣告）。

### D2：單點修正即覆蓋 A1/A2/A3 + Issue + BCF

`COORD_BASE` 是模組內唯一 base 常數，`governanceClient` 物件所有方法（`createRuleRun` / `getRuleRun` / `getResults` / `exportUrl` / `createDiff` / `getDiff` / `diffIssueImpact` / `federated-sets/*` / issues / `bcfExportUrl`）與 `base` 欄位皆內部讀它；`pages.tsx` 只呼叫 `governanceClient.*`，不直接觸 `COORD_BASE`。故改 `COORD_BASE` 來源一處，A1/A2/A3 全部 client 與直連下載 URL（`exportUrl` / `bcfExportUrl`）一致受惠。GitNexus upstream impact = 0（LOW risk），確認無外部 reader。

### D3：不改 viewer / 不動 proxy 邊界

僅換 base 來源的 env 名；瀏覽器仍只打 coordinator `:8004` 的 `/api/governance/*`（邊界 B1 不變），不直連 governance-service `:49102`。後端未連線時仍由 coordinator 回 502、前端誠實顯示（既有行為，不在本 change 改動）。

## Risks / Trade-offs

- 風險：極低。純前端 env 名修正，0 upstream impact，預設值不變，舊名相容。
- Trade-off：保留舊名 fallback 略增一個 `??`，但換得向後相容與零回歸，符合「最小可回復」原則。
