## 1. Docker web-plane configuration

- [ ] 1.1 新增 hybrid compose override（例如 `compose.host-kit.yml`），只覆蓋 `coordinator` / `viewer` 的 host-native Kit 連線設定，不啟用 `streaming-server` GPU profile。
- [ ] 1.2 新增或更新 non-secret `.env` example，提供 `HOST_CONVERSION_API_BASE`、browser-visible `KIT_SIGNALING_HOST` / `KIT_SIGNALING_PORT`、`WEB_VIEWER_URL` 等 hybrid defaults。
- [ ] 1.3 確認 coordinator container 的 `STREAMING_CONVERSION_API_BASE` / `CONVERSION_API_BASE` 指向 host-native `49101`，且不依賴 Docker service hostname `streaming-server`。
- [ ] 1.4 確認 coordinator 回傳給 viewer/browser 的 Kit endpoint 使用 browser-visible host，不使用 container-local `127.0.0.1` 或 Docker-only service name。

## 2. Startup and health-check scripts

- [ ] 2.1 新增 `scripts/start-web-plane-docker.ps1` 或等價 helper，包裝 base compose + hybrid override，只啟動 `coordinator` 與 `viewer`。
- [ ] 2.2 新增 `scripts/check-web-plane-docker.ps1` 或等價 helper，檢查 host 可連 `8004/health`、`5173`、coordinator container 可連 `${STREAMING_CONVERSION_API_BASE}/health`。
- [ ] 2.3 在 check helper 中加入 host/browser-visible `49100` probe；若 Kit 未啟動，結果應標為 blocked/not observed，而不是宣稱 Docker GPU Kit passed。
- [ ] 2.4 確保 scripts 不輸出 `.env` secret values，只輸出 endpoint name、status、next command。

## 3. Documentation and runbook

- [ ] 3.1 更新 `docs/demo/fast-mvp-demo-recap.md` 或新增 `docs/runbooks/` 文件，說明 Docker web-plane + host-native NVIDIA runtime 的啟動順序。
- [ ] 3.2 在文件中清楚區分 container-to-host URL（例如 `host.docker.internal:49101`）與 browser-visible Kit endpoint（例如 `127.0.0.1:49100`）。
- [ ] 3.3 文件需明確標註 hybrid pass 不等於 `runtime-manager-docker-kit-mvp` GPU-container pass，也不得升格 `runtime_image_kit_launcher`。
- [ ] 3.4 文件需保留 B 方案邊界：不啟 `_worker` / `_bim-control` product runtime，不接真實外部平台。

## 4. Validation

- [ ] 4.1 執行 `openspec validate docker-web-plane-host-native-kit --strict` 並修正所有 OpenSpec 格式問題。
- [ ] 4.2 執行 base compose + hybrid override 的 `docker compose config`，確認 YAML 與 service selection 正確。
- [ ] 4.3 Build/start `coordinator` 與 `viewer` containers，驗證 `GET http://127.0.0.1:8004/health` 與 `GET http://127.0.0.1:5173`。
- [ ] 4.4 在 coordinator container 內驗證 `${STREAMING_CONVERSION_API_BASE}/health` 可達 host-native conversion authority；若 host service 未啟動，檢查結果需給出明確 blocker 與 next command。
- [ ] 4.5 驗證 host/browser-visible `49100` probe 行為；若 Kit 未啟動，紀錄 blocked/not observed，不宣稱 streaming/browser render passed。
- [ ] 4.6 視改動面執行最小 service checks：`cd bim-review-coordinator && npm run build`、`cd web-viewer-sample && npm run build`；若未跑，需在 handoff 說明原因。

## 5. Review readiness

- [ ] 5.1 檢查 diff 不包含 `.env` secret values、large BIM artifacts、`storage/*.ifc` 或 unintended generated files。
- [ ] 5.2 若實作修改任何 code symbol，在修改前依 AGENTS/GitNexus 規則做 impact analysis；commit 前執行 GitNexus detect changes 或說明無 production symbol 改動。
- [ ] 5.3 更新 final handoff：列出 changed files、validation commands、blocked tiers、known risks。
