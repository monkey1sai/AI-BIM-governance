# Tasks — frontend-coordinator-env

## 1. 查證全站 / 部署正規 coordinator base env 名

- [x] 1.1 grep 全 repo 確認 `governanceClient.ts` 實際讀 `VITE_COORDINATOR_BASE`（非正規，僅此一處）。
- [x] 1.2 grep 確認正規名 `VITE_COORDINATOR_API_BASE` 被 `config/env.ts`（viewer coordinator base 來源）、`compose.host-kit.yml` / `compose.runtime-manager.yml`（映像注入）、`scripts/deploy.ps1`（經 `WEB_VIEWER_COORDINATOR_API_BASE` 設定）使用。
- [x] 1.3 確認 `web-viewer-sample/` 無 `.env*` 實檔覆寫、README 無此 env；Vite 值由 compose build-arg 注入。

## 2. 修 governanceClient 改讀正規名（保留舊名相容）

- [x] 2.1 `governanceClient.ts` `COORD_BASE` 改為 `VITE_COORDINATOR_API_BASE ?? VITE_COORDINATOR_BASE ?? "http://127.0.0.1:8004"`（正規名優先）。
- [x] 2.2 確認預設值與 `config/env.ts:64` 一致（`http://127.0.0.1:8004`）。
- [x] 2.3 確認 `pages.tsx` 僅透過 `governanceClient.*` 方法使用（含 `bcfExportUrl` / `exportUrl` 內含 `COORD_BASE`），不直接讀 `COORD_BASE`，故單點修正即覆蓋 A1/A2/A3 + Issue + BCF。

## 3. 驗證

- [x] 3.1 `cd web-viewer-sample && npm install`。
- [x] 3.2 `npx tsc --noEmit` → 0 errors。
- [x] 3.3 `npm run test`（vitest）→ 全綠。
- [x] 3.4 `npm run build`（vite）→ 成功。
- [x] 3.5 grep 證據：修後 `governanceClient` 與 `config/env.ts` 用同一正規名 `VITE_COORDINATOR_API_BASE`。
- [x] 3.6 `npx openspec validate frontend-coordinator-env --strict` → 通過。
- [x] 3.7 `git add -A && git diff --cached --check`（node_modules 不入 stage）。
