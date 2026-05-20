## Why

Phase B 已把對外 IFC-ready intake 收斂到 `bim-review-coordinator`，也把 IFC to USDC 權威定義在 `bim-streaming-server`；但目前缺一個可在本機 host 直接啟動、可被 coordinator 呼叫、綁定 `127.0.0.1:49101` 的 conversion authority service。這讓 B 方案仍停在 contract/API-only 層，無法穩定產生 streaming-owned `conversion_job_id`、USDC/mapping result、quality metrics 與 callback outbox evidence。

## What Changes

- 新增 host-native conversion authority service：在 `bim-streaming-server` 邊界內提供可獨立啟動的 HTTP adapter，預設監聽 `127.0.0.1:49101`，對應 `STREAMING_CONVERSION_API_BASE=http://127.0.0.1:49101`。
- 服務包住既有 conversion authority store / converter adapter，提供 `POST /api/conversions/ifc-to-usdc`、`GET /api/conversions/{conversion_job_id}`、`GET /api/conversions/{conversion_job_id}/result` 與 `GET /health`。
- coordinator 在 `POST /api/external/ifc-ready` 後呼叫 host-native service，保存 streaming-owned `conversion_job_id`；轉檔完成後用現有 internal conversion-result / callback outbox 流程產生 metadata-only callback。
- demo/dev proxy 與 smoke 增加 `host_native_conversion_authority` tier；conversion pass 與 `single_kit_render`、WebRTC `49100`、browser visual proof 分開判定。
- viewer E2E 驗收必須保留 `web-viewer-sample/src/Window.tsx` 的 ready gate：只有 `stream_config.model.status == "ready"` 且 lifecycle 未 blocked 時才送 `openStageRequest`。
- 更新文件與驗證命令，說明 Windows host-native 啟動方式、Git Bash 執行 `.bat` 的限制、GPU/Kit rendering 與 conversion service 的邊界差異。

## Capabilities

### New Capabilities

- `host-native-conversion-authority-service`: 定義 `bim-streaming-server` 擁有的 host-native HTTP conversion authority service、port `49101`、converter adapter、job/result API、health/readiness 與本機啟動契約。

### Modified Capabilities

- `streaming-ifc-usdc-conversion-authority`: 要求 streaming-owned conversion authority 能以獨立 host-native service 形式提供 internal API，且 heavy conversion 不阻塞 Kit/WebRTC runtime。
- `conversion-webhook-lifecycle`: 要求 coordinator intake 後派工到 `STREAMING_CONVERSION_API_BASE`，並在 result 可用時保留 correlation/idempotency 與 callback outbox 分離語意。
- `demo-runtime-readiness-smoke`: 新增 host-native conversion authority readiness tier，避免把 conversion API pass 升等成 WebRTC/rendering pass。
- `runtime-verification-evidence`: 新增 host-native conversion service evidence 欄位，記錄 port、job id、artifact refs、quality metrics、callback outbox 與未觀察的 render tiers。

## Impact

- **Owning repo / folder**：主要在 `bim-streaming-server/` 新增 host-native service entrypoint / adapter / tests；`bim-review-coordinator/` 更新 conversion dispatch/result loop 或 dev proxy 接線；`web-viewer-sample/` 只做 E2E ready-gate 驗證或必要的狀態顯示修正；`tests/` 與 `docs/` 補 smoke/evidence/runbook。
- **API / runtime boundary**：新增本機 internal conversion service `127.0.0.1:49101`；保留 `bim-review-coordinator` 作唯一外部 `POST /api/external/ifc-ready` 入口；`bim-streaming-server` 仍不接外部 IFC-ready webhook。
- **資料結構 / event**：沿用 `conversion_job_id`、`correlation_id`、`idempotency_key`、streaming-owned artifact refs、quality metrics 與 metadata-only callback payload；不得新增 `.usdc` 大檔上傳到公司雲端的語意。
- **Dependencies**：優先使用 repo 既有 Python/FastAPI/uvicorn 與 Node 測試工具；若 implementation 需要新增 production dependency，必須先在 apply 階段說明原因。
- **Non-goals**：不重建 `_worker` / `_bim-control`，不把 host-native conversion service 當成 Docker Kit runtime 或 GPU rendering 的替代 pass，不解 OQ1 公司雲端真實 callback endpoint/auth，不解 OQ5 SSO，不實作 dedicated multi-Kit scheduler。
- **Validation dependency**：完整 browser E2E 需基於 PR #69 的 `@nvidia/omniverse-webrtc-streaming-library ^5.6.0` 修正；本 branch 已從包含 #69 的 `origin/main` 建立。
