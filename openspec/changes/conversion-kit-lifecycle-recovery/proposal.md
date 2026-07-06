## Why

測試部署區暴露三個同源問題：

1. `GET /api/conversions` 可列出 `status=succeeded` / `ready=true` 的 job，但對應 `model.usdc` artifact URL 實際回 `404 Not Found`。這讓 conversion authority 的「ready」與可被 Kit 開啟的檔案真相分裂。
2. terminal `conversion_status=failed` 的 ifc-ready job 不能用現有 `/api/conversion/jobs/:id/retry` 重新轉檔；該 retry 只支援 `dispatch_failed` / `dropped_on_restart`，不支援已派工後 converter 失敗。
3. coordinator `kit_instance_bindings.status="ready"` 是 local_fixed metadata allocation，不是 Kit/GPU 機隊實際 `openStageRequest` 成功；目前 UI 容易把「已產生 USDC URL / 已建 session」誤讀成「已掛在 Kit 上」。

這些問題會讓 `#conv`、`#sessions`、`#instances` 與 `/ui/open?session=` 對同一個模型生命週期給出不同真相，違反 docs/plans 的 GPU 鐵律：`1 GPU = 1 Kit instance = 1 stream`、換 GPU 必須 terminate + recreate、conversion readiness 不等於 WebRTC/Kit readiness。

## What Changes

- 新增 capability `conversion-kit-lifecycle-recovery`，定義跨服務 recovery contract：
  - conversion result 在對外宣告 ready 前，必須驗證 `model.usdc`、mapping、metadata 等必要 artifact 可由 authority 實際讀取/serve。
  - 若 persisted job JSON 指向缺檔 artifact，list/detail/result 必須回報 non-ready anomaly，而不是繼續宣稱 ready。
  - terminal converter failure 的 recovery action 是重新進件 / re-trigger（保留 idempotency 與新 correlation），不是 dispatch retry。
  - coordinator 建立 review session 時，必須區分 `kit_binding_status` / `stage_open_status` / `viewer_first_frame_status`。
  - 真正的 Kit open 必須透過 kit-manager / streaming control path 送 `openStageRequest` 或等效 DataChannel command；metadata binding 不可單獨宣告 stage 已掛載。

## Impact

- Owns:
  - `bim-streaming-server`: conversion artifact truth、job/result API、artifact serving truth。
  - `bim-review-coordinator`: ifc-ready recovery action、session/runtime status honesty、Kit open lifecycle handoff。
  - `services/kit-manager-api`: Kit open/close lifecycle contract 與 command result。
- Non-goals:
  - 不重建 deployment checkout，不 kill live `kit.exe` / `python.exe`。
  - 不新增 GPU fleet scheduler 或多 GPU 實體 capacity。
  - 不宣告 full-system E2E complete；真實 Kit/WebRTC visual evidence 仍需部署重建與 gstack/Playwright 證據。
  - 不覆蓋既有 active change `minio-trigger-lifecycle-backend`；本 change 將 terminal converter failure 的 recovery 行為建模為新的跨服務 capability。

## Boundaries

- 外部公司雲端仍只接 metadata-only callback，不接 `.usdc` 大檔或 subprocess log contents。
- 外部 IFC Worker 仍只呼叫 coordinator `POST /api/external/ifc-ready`；不可直接打 streaming conversion authority。
- coordinator 不直接開 USD stage；Kit/GPU stage open 必須由 streaming/kit-manager runtime plane 執行。
- browser UI 不分配 GPU；它只能呈現 lifecycle truth 與觸發已授權的 operator action。
