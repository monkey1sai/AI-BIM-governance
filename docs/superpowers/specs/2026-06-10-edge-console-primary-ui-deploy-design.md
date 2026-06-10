# EdgeConsole 作為測試部署主前端 · Design Spec

> 日期：2026-06-10
> 狀態：待使用者審核
> 決策：採用 B 方案。`EdgeConsole` 是 coordinator `/ui` 的主前端；既有 viewer attach 仍由 `/ui/open` 導到 `web-viewer-sample` viewer。

## 1. 背景

目前最新 `main` 已經具備 EdgeConsole 產品殼層：

- `web-viewer-sample/src/console/EdgeConsole.tsx` 提供圖1的深色 `AI · BIM Governance` 操作台。
- `web-viewer-sample/src/main.tsx` 在 `/ui`、`/console` 與指定 hash route 掛載 EdgeConsole。
- `web-viewer-sample/package.json` 提供 `npm run build:ui`，輸出 `web-viewer-sample/dist-ui`。
- `bim-review-coordinator/src/app.ts` 在 `CONSOLE_DIST_DIR/index.html` 存在時，會把 coordinator `/ui` 服務為 React console；否則 fallback 到 `dev-console.html`。

實際測試部署時，`D:\Users\deploy\AI-bim-geo\web-viewer-sample\dist-ui\index.html` 不存在，因為 `dist-ui` 是 ignored build artifact，且測試部署重建會 `git clean -fdx`。因此 `/ui` fallback 成圖2的白色 `Review Coordinator` legacy console。

## 2. 目標

讓測試部署區在只透過既有 canonical path 啟動時：

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

最終由部署 checkout 執行：

```powershell
cd D:\Users\deploy\AI-bim-geo
.\scripts\deploy.ps1 -Build
```

並穩定達成：

- `http://192.168.10.105:8004/ui#/a1` 顯示圖1 EdgeConsole，而不是 fallback `dev-console.html`。
- `/dev-console` 保留圖2 legacy console 作為診斷後援。
- `/ui/open?session=...` 保持既有 server-side redirect，不被 React SPA fallback 吃掉。
- 已存在功能可從 EdgeConsole route 操作或導引驗證：A1、Issue/Rule Center、conversion queue、session/runtime、Kit proxy、真實 IFC demo-control。

## 3. 非目標

- 不在第一個 PR 內把 WebRTC viewport 嵌進 EdgeConsole。viewer 仍由既有 `<App/>` / `Window.tsx` 處理。
- 不把 `web-viewer-sample/dist-ui` commit 進 git。
- 不要求部署者手動在部署區跑 `npm run build:ui`。
- 不用 `-DryRun` 取代測試部署驗證。
- 不用 fake mapping、placeholder USDC 或只有 backend result 宣稱 full-system E2E complete。

## 4. 架構決策

採用 B 方案：EdgeConsole 是產品主入口，部署流程負責產生並服務 React console bundle。

```txt
browser
  -> coordinator :8004 /ui
      -> React EdgeConsole static bundle
      -> same-origin /api/* requests
      -> /ui/open?session=... redirects to viewer :5173/?session=...

browser
  -> coordinator :8004 /dev-console
      -> legacy dev-console.html for diagnostics

browser
  -> viewer :5173/?session=...
      -> existing WebRTC viewer <App/> / Window.tsx
```

### 部署產物來源

第一選擇是 Docker build 內建 EdgeConsole bundle：

- 在 Docker build 階段用 `web-viewer-sample` 的 package lock 安裝依賴並執行 `npm run build:ui`。
- 將輸出的 `dist-ui` 複製到 coordinator image 內固定路徑，例如 `/workspace/console-dist`。
- `compose.host-kit.yml` 設定 `CONSOLE_DIST_DIR=/workspace/console-dist`。
- host bind mount `./web-viewer-sample/dist-ui:/workspace/console-dist:ro` 不應在 host 產物缺失時覆蓋 image 內建 bundle。

此選擇比 host-side build 穩定，因為測試部署 checkout 會清掉 ignored artifact，也不保證有 host `node_modules`。

### 保留後援

- `/dev-console` 永遠保留 legacy `dev-console.html`。
- 若 `CONSOLE_DIST_DIR/index.html` 不存在，coordinator 仍可 fallback，但 deploy verification 必須把這視為 warning 或 failure，而不是成功。

## 5. 現有功能導入

第一階段不重寫功能，只把現有功能放到 EdgeConsole 的可驗收入口。

| Route | 現有功能 | 第一階段要求 |
|---|---|---|
| `#/a1` | A1 五步流程、導向 Issue/Rule Center | 顯示主流程與真實操作入口，不只靜態說明 |
| `#/issues` | rule-run、failed results、issue、Excel、BCF | 保持真實 API 操作與錯誤顯示 |
| `#/demo-control` | 真實 IFC fixture register / conversion / viewer URL | 保留 operator-tool route，作為 A1 進件診斷入口 |
| `#/conv` | ifc-ready queue / conversion status | 使用 coordinator `/api/external/ifc-ready` |
| `#/sessions` | runtime status / sessions | 使用 coordinator `/api/runtime/status` |
| `#/kit` | Kit proxy panel | 經 coordinator `/api/kit/*`，若 `:8010` 不可用須誠實顯示 502 |
| `/ui/open` | viewer handoff | 保持 302 redirect 至 browser-visible viewer URL |

第二階段再把 A1 做成單頁可操作 vertical slice：

```txt
選 IFC / ifc-ready job
  -> register / convert
  -> 建立 review session
  -> 開 viewer
  -> rule-run
  -> 建 issue
  -> 匯出 Excel / BCF
```

## 6. 實作切分

### PR-1：部署主頁收斂

目的：測試部署後 `/ui` 必定是圖1 EdgeConsole。

建議修改面：

- Dockerfile 或 compose 設定：讓 coordinator image 或 web-plane build 產出並服務 `console-dist`。
- `scripts/deploy.ps1`：`-Build` 後驗證 `/ui` 回應含 EdgeConsole marker，例如 `AI · BIM Governance`，並記錄 fallback 狀態。
- `scripts/start-web-plane-docker.ps1`：避免空 bind mount 覆蓋 image 內建 bundle。
- 測試：補一個 deploy/web-plane smoke，確認 `/ui` 與 `/dev-console` 可區分。

驗收：

- `.\scripts\dev\rebuild-test-deploy.ps1 -Build`
- `GET http://192.168.10.105:8004/ui` 含 `AI · BIM Governance`
- `GET http://192.168.10.105:8004/dev-console` 含 `Review Coordinator`
- `GET /ui/open?session=bad` 仍回 400；合法 session 仍 302
- browser 截圖保存 `/ui#/a1`

### PR-2：A1 可操作整合

目的：讓圖1的 A1 頁不是靜態導覽，而是能從前端操作現有功能。

建議修改面：

- `A1GovernanceWorkbenchPage` 整合現有 `RealIfcConsolePage` 或抽出可重用的 hook/component。
- 將 `IssuesRuleCenterPage` 的 rule-run / issue / export 操作用明確步驟導入 A1。
- 顯示 `job_id`、`model_version_id`、`conversion_job_id`、`review_session_id`、`viewer_url`、`rule_run_id`、`issue_ids`。
- 所有 loading、success、failure、retry state 必須可見。

驗收：

- 有 storage IFC 時可從 `/ui#/a1` 跑完整 A1 CPU governance slice。
- 沒有 storage IFC 時誠實顯示 `storage_empty`，不補假資料。
- 3D highlight 仍需 viewer DataChannel / first frame / stage truth，未具備時保持 disabled 或 `not observed`。

## 7. 驗證策略

### 最小驗證

```powershell
cd web-viewer-sample
npm test -- src/console/console.test.tsx src/console/routing.test.ts src/console/OperatorConsole.test.tsx
npm run build:ui
```

### 部署驗證

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

禁止以 `-DryRun` 代替。部署完成後檢查：

- coordinator health：`http://127.0.0.1:8004/health`
- EdgeConsole：`http://192.168.10.105:8004/ui#/a1`
- legacy console：`http://192.168.10.105:8004/dev-console`
- viewer：`http://192.168.10.105:5173`
- conversion：`http://127.0.0.1:49101/health`

### Browser E2E

至少保存以下證據：

- `/ui#/a1` 截圖：圖1主頁。
- `/ui#/demo-control` 截圖：真實 IFC fixture 或 `storage_empty`。
- `/ui#/issues` 截圖：rule-run 操作入口。
- `/ui#/kit` 截圖：若 `kit-manager-api :8010` 未啟動，需顯示 502，不宣稱通過。

## 8. 風險與處理

| 風險 | 處理 |
|---|---|
| Docker image build 時 frontend dependency 下載失敗 | 回報 network/dependency blocker，不使用 stale `dist-ui` |
| host bind mount 空目錄覆蓋 image 內建 bundle | 移除或改條件式 mount，避免空 artifact 造成 fallback |
| `/ui/open` 被 SPA fallback 吃掉 | 保持 Express route 註冊順序：`/ui/open` 在 static / fallback 前 |
| `kit-manager-api :8010` 未啟動造成 `#/kit` 502 | UI 原樣顯示 502；是否納入 deploy 另開需求 |
| storage IFC 不在測試部署 checkout | 顯示 `storage_empty`；若要跑真實 IFC E2E，使用主工作區絕對路徑或 gitignored junction |
| 只看到 port 200 就誤判成功 | deploy/browser 驗證必須檢查 EdgeConsole marker 與截圖 |

## 9. 成功標準

第一階段成功標準：

- 測試部署只透過 `scripts\deploy.ps1 -Build` 起來。
- `/ui` 預設顯示圖1 EdgeConsole。
- `/dev-console` 保留圖2 legacy console。
- `/ui/open` viewer handoff 未回歸。
- PR 有 frontend verification table、deploy path verification table、browser evidence。

第二階段成功標準：

- A1 可以從圖1前端主頁操作現有功能，而不是只導向後端或要求 curl。
- 可看到關鍵 runtime / governance ID。
- 沒有 IFC、governance 離線、Kit Manager 離線、stage truth 未觀察時，都誠實顯示狀態，不補假成功。
