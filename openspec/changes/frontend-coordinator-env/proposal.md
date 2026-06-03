## Why

對抗複驗在 Edge Console 前端強確認一個 HIGH 部署 finding：A1/A2/A3 治理 client（`web-viewer-sample/src/console/governanceClient.ts`）讀的 coordinator base env 名是**非正規的 `VITE_COORDINATOR_BASE`**，而全站其餘處與部署鏈用的正規名是 **`VITE_COORDINATOR_API_BASE`**。

證據（grep 全 repo）：

- 正規名 `VITE_COORDINATOR_API_BASE`（全站 / 部署權威）：
  - `src/config/env.ts:64`（`envCoordinatorApiBase`，是 viewer AppStream / Window 經 `reviewEnv.coordinatorApiBase` 的 coordinator base 來源）。
  - `compose.host-kit.yml:37`、`compose.runtime-manager.yml:54`（build-time 注入 viewer 映像）。
  - `scripts/deploy.ps1:571`（經 `WEB_VIEWER_COORDINATOR_API_BASE` 設定此值至部署 env）。
- 非正規名 `VITE_COORDINATOR_BASE`：**全 repo 僅 `governanceClient.ts:4` 一處**讀取，無任何部署腳本 / compose / env 設定它。

後果：當部署把 `VITE_COORDINATOR_API_BASE` 指向非預設 coordinator（如 LAN / 公開主機）時，console 的 A1（rule-run）/ A2（diff）/ A3（federation）+ Issue / BCF client 讀不到該值，靜默 fallback 到寫死預設 `http://127.0.0.1:8004` → 對非預設 coordinator 的治理操作全部打到錯誤位址而失效（瀏覽器端通常表現為連線失敗 / CORS）。viewer 本體（AppStream / Window）因走 `env.ts` 的正規名仍正常，故同一頁面內 viewer 連得上、治理 client 連不上，行為不一致且難察覺。

## What Changes

- `governanceClient.ts` 的 `COORD_BASE` 改讀全站正規名 `VITE_COORDINATOR_API_BASE`；保留舊名 `VITE_COORDINATOR_BASE` 為相容 fallback（**正規名優先**），預設值維持 `http://127.0.0.1:8004`，與 `config/env.ts` 一致。
- 解析順序：`VITE_COORDINATOR_API_BASE ?? VITE_COORDINATOR_BASE ?? "http://127.0.0.1:8004"`，確保 console A1/A2/A3 client 的 coordinator base 來源與 viewer（AppStream / Window）一致。

純前端 env 名修正；**無新增生產依賴**、不改後端、不改 API / data shape、不改既有 viewer 行為、不改 coordinator proxy 路徑（`/api/governance/*` 不動）。

## Capabilities

### Modified Capabilities

- `edge-console-operator-frontend`：新增「console A1/A2/A3 client SHALL 用與全站／部署一致的 coordinator base env 名（`VITE_COORDINATOR_API_BASE`）」要求，使治理 client 的 coordinator base 來源與 viewer 一致，並涵蓋舊名相容 fallback。

### New Capabilities

- None.

## Impact

- Owner repo / folder：`web-viewer-sample/src/console/governanceClient.ts`（唯一 code 變更）。
- API / data shape：無變更（coordinator `/api/governance/*` proxy 契約不動；governance-service 契約不動）。
- Runtime boundary：不變（瀏覽器仍只打 coordinator `:8004` proxy，不直連 `:49102`；僅修正 base 來源的 env 名，使其讀得到部署設定值）。
- 相容性：舊名 `VITE_COORDINATOR_BASE` 仍被接受為 fallback，既有任何（理論上）設舊名的環境不受影響；正規名存在時優先採用。
