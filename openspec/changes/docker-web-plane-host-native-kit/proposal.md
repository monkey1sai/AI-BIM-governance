## Why

Fast MVP demo 已確認 `bim-review-coordinator` (`8004`) 與 `web-viewer-sample` (`5173`) 不需要 NVIDIA GPU，適合用 Docker Compose 固化成可重複的 web plane；但 `bim-streaming-server` 的 Kit/WebRTC (`49100` / `47998`) 與 host-native conversion authority (`49101`) 仍依賴當下 Windows 作業系統、NVIDIA driver、Kit launcher 與 PowerShell/.bat converter path，不應在本 change 嘗試塞進 Docker。

目前 `compose.runtime-manager.yml` 已可 build coordinator/viewer container，但 coordinator 預設把 conversion API 指到 Docker GPU profile 的 `streaming-server:49101`。這會讓「只容器化 8004/5173、NVIDIA 留 host」的單機可部署流程缺少正式規格與可驗證 runbook。

## What Changes

- 新增一個 hybrid deployment capability，定義 **Docker Web Plane + Host-native NVIDIA Runtime**：
  - Docker Compose 啟動 `bim-review-coordinator` 與 `web-viewer-sample`
  - Windows host-native 啟動 `bim-streaming-server` Kit/WebRTC (`49100` / `47998`)
  - Windows host-native 啟動 conversion authority API (`49101`)
  - coordinator container 透過 `host.docker.internal:49101` 呼叫 host-native conversion API
  - browser-facing stream config 仍回傳 `127.0.0.1:49100` / `127.0.0.1:47998` 或部署者指定的 host address，因為 viewer 是使用者瀏覽器在 host/network 端連 Kit
- 新增/調整 Docker Compose override 與啟動檢查腳本，讓 operator 可只啟 containerized `8004` / `5173`，不啟 Docker GPU profile。
- 更新 fast MVP / runbook 文件，將此 hybrid path 寫成 fast MVP 後的單機標準流程。
- 明確保留 `runtime-manager-docker-kit-mvp` 的 evidence rule：host-native Kit 不得被拿來宣稱 Docker GPU Kit pass；此 change 的 pass target 是 hybrid single-machine deployment readiness，不是 Linux Kit GPU container readiness。

Non-goals:

- 不把 NVIDIA Kit/WebRTC 或 IFC→USDC PowerShell converter 放進 Docker。
- 不修改 `runtime-manager-docker-kit-mvp` 中「Kit SHALL run in a GPU container」的 MVP pass contract。
- 不接真實外部公司雲端 `_bim-control` 或真實外部 IFC Worker；B 方案仍由 coordinator intake、tests/fakes 與 callback outbox 表達。
- 不新增 production dependency。
- 不升格 roadmap/runtime evidence 中的 `runtime_image_kit_launcher`、`single_kit_render` 或 Docker GPU profile 狀態。

## Capabilities

### New Capabilities

- `docker-web-plane-host-native-kit`: 定義單機 hybrid deployment 契約，讓 Docker 負責 coordinator/viewer web plane，host OS 負責 NVIDIA Kit/WebRTC 與 conversion authority，並提供跨平台可驗證啟動與健康檢查標準。

### Modified Capabilities

- `demo-fast-mvp-orchestration`: 增加 fast MVP 後的 hybrid Docker web-plane path，與既有 host-only fast demo path 並列；要求 runbook 清楚分辨 Docker web-plane readiness 與 Docker GPU Kit readiness。

## Impact

- Owner repo/folder:
  - `compose.runtime-manager.yml` / new compose override: Docker web plane deployment wiring
  - `scripts/`: hybrid start/check helper scripts
  - `docs/runbooks/` or `docs/demo/`: operator-facing runbook
  - `openspec/changes/docker-web-plane-host-native-kit/`: proposal/design/tasks/spec delta
- Affected services:
  - `bim-review-coordinator`: container environment must point conversion API to host-native `49101` and return browser-visible Kit endpoint values.
  - `web-viewer-sample`: container/dev environment must call browser-visible coordinator URL and keep Kit signaling host browser-visible.
  - `bim-streaming-server`: host-native runtime remains out of Docker and is validated through existing `49100` / `47998` / `49101` probes.
- API / event contracts:
  - No new public API paths.
  - Existing `STREAMING_CONVERSION_API_BASE` remains the coordinator-to-conversion bridge.
  - Existing review session stream config remains the browser-to-Kit bridge.
- Data / storage:
  - No new durable data model.
  - Existing mounted `storage/` remains the local artifact/IFC fixture boundary.
- Validation:
  - Compose config/build for `coordinator` + `viewer`.
  - `GET http://127.0.0.1:8004/health` returns ok.
  - `GET http://127.0.0.1:5173` returns 2xx.
  - From the coordinator container, `GET http://host.docker.internal:49101/health` reaches host-native conversion authority.
  - From host/browser perspective, `127.0.0.1:49100` is reachable when Kit is running.
