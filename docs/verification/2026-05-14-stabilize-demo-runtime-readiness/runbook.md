# Single-Kit demo runtime — manual runbook

對應 OpenSpec change：`stabilize-demo-runtime-readiness`
對應 spec：`openspec/changes/stabilize-demo-runtime-readiness/specs/demo-runtime-readiness-smoke/spec.md`
對應自動化：`scripts/run-single-kit-demo.ps1`

這份 runbook 補足 `scripts/run-single-kit-demo.ps1` 無法自動化的步驟。Kit GPU runtime 需要 interactive desktop session，且 workspace 的 in-app 瀏覽器自動化政策仍然受限，所以最終的 viewport 觀察 + screenshot capture 必須由人類執行。

## B 方案補充：RVT intake → IFC bridge → streaming conversion

`architecture-rework-2026-05-14` 之後，這份 runbook 的人工驗證要把舊的 `_worker` IFC→USDC evidence 與新的 B 方案 readiness 分開看：

```txt
_bim-control RVT intake
→ _worker RVT→IFC bridge
→ bim-streaming-server IFC→USDC conversion authority
→ bim-review-coordinator session / artifact binding
→ web-viewer-sample openStageRequest(stage_composition)
→ bim-streaming-server Kit stage load / WebRTC render
```

B 方案的通過條件：

- `_bim-control` 只保存 RVT source artifact metadata 與 `rvt_uploaded` event；如果沒有 RVT bytes 或 signed reference，必須回報 `blocked`，不可偽造上傳成功。
- `_worker` 只負責 RVT→IFC bridge 與 `ifc_ready` handoff；它不能在新 flow 中宣告 `model.usdc` ready。
- `bim-streaming-server` 才是 IFC→USDC conversion authority；只有它的 conversion result 可以把 `model.usdc`、`element_mapping.json`、`entity_index.json`、`metadata.json` 宣告為 ready。
- `bim-review-coordinator` 只保存 conversion metadata、primary/secondary ordering、viewport sharing state；它不執行轉檔。
- `web-viewer-sample` 只能在 `stream_config.model.status == "ready"` 時送出 `openStageRequest`，且要帶 `stage_composition` 給 Kit runtime。

`scripts/smoke-review-session.ps1` 目前仍可用來記錄歷史 `_worker` conversion evidence，但它會另外輸出 B 方案 tiers：

| Tier | 預期判讀 |
|---|---|
| `rvt_intake` | 沒有送 RVT intake 時是 `not_observed`，不是 passed |
| `rvt_to_ifc_bridge` | 沒有跑 RVT→IFC bridge 時是 `not_observed`，不是 passed |
| `streaming_conversion_job` | 只有 `conversion_authority="bim-streaming-server"` 時才可 passed |
| `mapping_quality` | 必須來自 streaming-owned conversion result |
| `usd_stage_composition` | 必須有 primary artifact；secondary layer 失敗不可掩蓋 primary 結果 |
| `single_kit_multi_viewer` | 需要 primary + spectator browser evidence，沒有 evidence 時維持 deferred / not_observed |

如果只有 `worker_conversion=passed`，那代表舊的 worker conversion fixture 可用；它不能被提升成 B 方案 `streaming_conversion_job=passed`。

## Prerequisites

1. Workspace 已 `git checkout` 到 `codex/openspec/stabilize-demo-runtime-readiness-impl`（或之後的 implementation branch）。
2. `bim-streaming-server` 已 build：`_build/windows-x86_64/release/ezplus.bim_review_stream_streaming.kit.bat` 必須存在。
3. `WORKER_DEV_STORAGE_ROOT` 對應的資料夾下放有至少一個 parseable `.ifc`（建議使用 spec 引用的 89 MB 樣本）。

如果有任何一項缺失，`scripts/run-single-kit-demo.ps1` 會自動把 single_kit_render tier 標為 `blocked` 並列出 next command；先處理 blocker 再繼續。

## Happy-path

### 1. 啟動 worker / `_bim-control` / coordinator / viewer

```powershell
cd C:\Repos\active\iot\AI-BIM-governance
scripts\start-all.ps1 -SkipStreaming
```

`-SkipStreaming` 把 Kit 留到下一步手動跑；其他服務的 health probe 必須通過。

### 2. 跑 orchestration helper

```powershell
scripts\run-single-kit-demo.ps1
```

預期輸出（重點）：

- `worker_conversion=passed`，含 `conversion_job_id` 與 `usdc_url`；這是歷史 compatibility evidence，不是 B 方案 streaming conversion pass
- `rvt_intake=not_observed`，除非本次手動送過 `_bim-control` RVT intake
- `rvt_to_ifc_bridge=not_observed`，除非本次手動跑過 `_worker` RVT→IFC bridge
- `streaming_conversion_job=not_observed` 或 `blocked`，除非本次 stream config 真的帶有 `conversion_authority="bim-streaming-server"`
- `mapping_quality=not_observed` 或 `blocked`，除非 mapping evidence 來自 streaming-owned conversion result
- `usd_stage_composition=passed` 只有在 `stream_config.stage_composition.primary_artifact_id` 存在時成立
- `coordinator_session_lifecycle=passed`，且 `stream_config.model.url` 等於 `worker_conversion` 的 `usdc_url`
- `kit_launcher_preflight=passed`
- `kit_webrtc_readiness=blocked`（因為 Kit 尚未啟動）
- `single_kit_render=blocked`（缺 Kit signaling endpoint）
- `dedicated_multi_kit_routing=deferred`
- evidence JSON 寫到 `docs/verification/2026-05-14-stabilize-demo-runtime-readiness/run-single-kit-demo-evidence.json`

如果 conversion 還沒做完、需要更長 timeout，加上 `-ConversionTimeoutSeconds 900`。
如果想換 fixture，加上 `-DevSourceId <source_id>`。

### 3. 啟動 Kit（手動）

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
scripts\start-streaming-server.ps1 -SkipAutoLoad
```

`-SkipAutoLoad` 是強制的；Kit 不應該透過命令列拿到 worker URL。Viewer 會用 DataChannel 的 `openStageRequest` 帶 `stream_config.model.url` 給 Kit。

### 4. 開瀏覽器，等 viewport 出來

開啟 step 2 輸出的 viewer URL（形如 `http://127.0.0.1:5173/?sessionId=review_session_XXXX`）。等 viewer 自動發出 `openStageRequest` 並等 Kit 回 `openedStageResult` 後，3D viewport 會出現。

### 5. 擷取 viewport screenshot

把 viewer + viewport 的截圖存到本目錄下，命名為 `single-kit-render-<sessionId>.png`。

### 6. 補完 single_kit_render evidence

打開 `docs/verification/2026-05-14-stabilize-demo-runtime-readiness/run-single-kit-demo-evidence.json`，在 `single_kit_render` tier 上修改：

```jsonc
{
  "tier": "single_kit_render",
  "status": "passed",                 // 從 blocked / not_observed 改成 passed
  "owner": "web-viewer-sample",
  "ids": {
    "viewer_url": "http://127.0.0.1:5173/?sessionId=review_session_XXXX",
    "session_id": "review_session_XXXX",
    "kit_endpoint": "127.0.0.1:49100",
    "stage_load_result": "ok"
  },
  "detail": {
    "manual_or_automated": "manual",
    "screenshot_path": "docs/verification/2026-05-14-stabilize-demo-runtime-readiness/single-kit-render-review_session_XXXX.png",
    "video": { "width": 1280, "height": 720 }   // 從 browser dev tools 量到的實際 video element 尺寸
  }
}
```

所有欄位都必須填，spec 已定義為 `single_kit_render=passed` 的硬條件：

- `viewer_url`
- `session_id` 或 `review_request_id`
- `kit_endpoint`
- `video.width` / `video.height` 必須是非零數值
- `stage_load_result`（DataChannel `openedStageResult` 的 outcome 字串）
- `screenshot_path`（指向本目錄下的實際檔案）
- `manual_or_automated`（手動填 `"manual"`）

## 不允許的捷徑

- ❌ 用 viewer route HTTP 200 證明 single_kit_render
- ❌ 用 Socket.IO smoke 通過證明 WebRTC video
- ❌ 把 `dedicated_multi_kit_routing` 改成 `passed`（multi-Kit invariant：本 workspace 只有 1 個 Kit endpoint）
- ❌ 在 production build 用 viewer 卡片去拉 `_worker` `/api/conversions/{job}/result`

## 重跑與失敗排查

- Worker conversion failed → 看 `_worker` log，必要時把 `ConversionTimeoutSeconds` 提高。
- Kit launcher 啟動失敗 → `nvidia-smi` 要可用；如果不在 interactive desktop session，會直接 fail。
- Viewer 黑畫面 → 確認 DataChannel `openStageRequest` 已送出，且 Kit 有回 `openedStageResult`；若沒有，看 viewer console 的 socket / DataChannel log。
- coordinator `stream_config.model.url` 與 worker `usdc_url` 不匹配 → helper 會直接 `failed`，重跑前確認 fixture 沒被換掉。

## 與 reference docs 的關係

- `CLAUDE.md` §5.2 描述 Streaming Flow；本 runbook 是其手動驗證版本。
- `openspec/specs/session-first-review-viewer` 描述 viewer 必須先取得 session 才能 stream；run-single-kit-demo.ps1 維持此 invariant。
- `openspec/changes/optimize-worker-non-renderable-materialization`（已封存）描述 `materialization_strategy=sidecar` / `sidecar_carrier_count` 等欄位的來源；本 runbook 的 single_kit_render 必須對應該轉檔產物。
