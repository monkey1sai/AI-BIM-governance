## 1. Docker web-plane 設定

- [x] 1.1 新增 hybrid compose override（例如 `compose.host-kit.yml`），只覆蓋 `coordinator` / `viewer` 的 host-native Kit 連線設定，不啟用 `streaming-server` GPU profile。
- [x] 1.2 新增或更新 non-secret `.env` example，提供 `HOST_CONVERSION_API_BASE`、browser-visible `KIT_SIGNALING_HOST` / `KIT_SIGNALING_PORT`、`WEB_VIEWER_URL` 等 hybrid defaults。
- [x] 1.3 確認 coordinator container 的 `STREAMING_CONVERSION_API_BASE` / `CONVERSION_API_BASE` 指向 host-native `49101`，且不依賴 Docker service hostname `streaming-server`。
- [x] 1.4 確認 coordinator 回傳給 viewer/browser 的 Kit endpoint 使用 browser-visible host，不使用 container-local `127.0.0.1` 或 Docker-only service name。
- [x] 1.5 確認 Docker/hybrid mode 下 coordinator 明確 bind `0.0.0.0:8004`，host-local direct dev 未設定 `HOST` 時仍維持 loopback default。
- [x] 1.6 文件化 host-native conversion artifact env：`STREAMING_CONVERSION_ARTIFACTS_ROOT`、`STREAMING_CONVERSION_JOBS_DIR`、`STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL`。
- [x] 1.7 文件化 OS-specific host bridge profiles：Windows Docker Desktop、Linux `host-gateway`、以及 explicit host address。
- [x] 1.8 明確標註 `0.0.0.0:8004` 只屬 LAN/single-machine exposure；public Internet / cross-company exposure 需另開 edge-security change。

## 2. 啟動與健康檢查腳本

- [x] 2.1 新增 `scripts/start-web-plane-docker.ps1` 或等價 helper，包裝 base compose + hybrid override，只啟動 `coordinator` 與 `viewer`。
- [x] 2.2 新增 `scripts/check-web-plane-docker.ps1` 或等價 helper，檢查 host 可連 `8004/health`、`5173`、coordinator container 可連 `${STREAMING_CONVERSION_API_BASE}/health`。
- [x] 2.3 在 check helper 中加入 host/browser-visible `49100` probe；若 Kit 未啟動，結果應標為 blocked/not observed，而不是宣稱 Docker GPU Kit passed。
- [x] 2.4 確保 scripts 不輸出 `.env` secret values，只輸出 endpoint name、status、next command。
- [x] 2.5 在 check helper 中輸出 active host bridge profile，並在 `49101` 不可達時區分 DNS/route/bind-host/firewall 類 blocker。
- [x] 2.6 在有 succeeded conversion result 時，檢查 `model.usdc`、`element_mapping.json`、`metadata.json` refs 是否可由預期 runtime/host perspective fetch。

## 3. 文件與 runbook

- [x] 3.1 更新 `docs/demo/fast-mvp-demo-recap.md` 或新增 `docs/runbooks/` 文件，說明 Docker web-plane + host-native NVIDIA runtime 的啟動順序。
- [x] 3.2 在文件中清楚區分 container-to-host URL（例如 `host.docker.internal:49101`）與 browser-visible Kit endpoint（例如 `127.0.0.1:49100`）。
- [x] 3.3 文件需明確標註 hybrid pass 不等於 `runtime-manager-docker-kit-mvp` GPU-container pass，也不得升格 `runtime_image_kit_launcher`。
- [x] 3.4 文件需保留 B 方案邊界：不啟 `_worker` / `_bim-control` product runtime，不接真實外部平台。
- [x] 3.5 文件需說明轉檔完成後輸出位置：source IFC fixture 在 `storage/`，derived outputs 在 host-native conversion artifacts root 的 `<conversion_job_id>/` 目錄。
- [x] 3.6 文件需說明檔案管理：coordinator 只保存 `usdc_ref` / `element_mapping_ref` / `manifest_ref`，cloud callback metadata-only，不複製 `.usdc` 本體，demo artifacts cleanup 由 operator 明確執行。
- [x] 3.7 文件需提供 Windows Docker Desktop 與 Linux Docker Engine 的 host bridge matrix，包含 `host.docker.internal`、`host-gateway`、explicit host address、bind host 與 firewall 注意事項。
- [x] 3.8 文件需說明 `STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL` 必須對 artifact consumer 可見；本機 loopback 只適用 single-machine consumer。

## 4. 驗證

- [x] 4.1 執行 `openspec validate docker-web-plane-host-native-kit --strict` 並修正所有 OpenSpec 格式問題。
- [x] 4.2 執行 base compose + hybrid override 的 `docker compose config`，確認 YAML 與 service selection 正確。
- [x] 4.3 Build/start `coordinator` 與 `viewer` containers，驗證 `GET http://127.0.0.1:8004/health` 與 `GET http://127.0.0.1:5173`。
- [x] 4.4 在 coordinator container 內驗證 `${STREAMING_CONVERSION_API_BASE}/health` 可達 host-native conversion authority；若 host service 未啟動，檢查結果需給出明確 blocker 與 next command。
- [x] 4.5 驗證 host/browser-visible `49100` probe 行為；若 Kit 未啟動，紀錄 blocked/not observed，不宣稱 streaming/browser render passed。
- [x] 4.6 視改動面執行最小 service checks：`cd bim-review-coordinator && npm run build`、`cd web-viewer-sample && npm run build`；若未跑，需在 handoff 說明原因。
- [x] 4.7 驗證成功轉檔或 fake converter result 時，`GET /api/conversions/<job>/result` 回傳的 artifact refs 指向 `<public_artifacts_url>/<conversion_job_id>/...`，且 coordinator ingestion 只保存 metadata refs。
- [x] 4.8 驗證 check output 將 artifact ref reachability 獨立列為 `runtime_visible_artifact_refs`，而不是混在 conversion succeeded 裡。

## 5. Review 準備度

- [x] 5.1 檢查 diff 不包含 `.env` secret values、large BIM artifacts、`storage/*.ifc` 或 unintended generated files。
- [x] 5.2 若實作修改任何 code symbol，在修改前依 AGENTS/GitNexus 規則做 impact analysis；commit 前執行 GitNexus detect changes 或說明無 production symbol 改動。
- [x] 5.3 更新 final handoff：列出 changed files、validation commands、blocked tiers、known risks。
