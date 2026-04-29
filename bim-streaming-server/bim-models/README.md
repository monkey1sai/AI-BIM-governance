# bim-models/

USD 模型存放目錄，供 `ezplus.bim_review_stream_streaming.kit` 透過 `--/app/auto_load_usd=...` 或 `openStageRequest` event 載入。

## 規則

- 本目錄內**只放 USD（`.usd` / `.usda` / `.usdc` / `.usdz`）**
- USD 檔本身**不入版控**（由 repo root `.gitignore` 排除整個 `/bim-models/*`，僅例外保留 `.gitkeep` 與 `README.md`）
- 跨機 / 團隊共享請走 Nucleus 或外部物件儲存，不要 commit USD

## 從 IFC 取得 USD

依 [`docs/plan-bim-ifc-usd-streaming-2026-04-27.md`](../docs/plan-bim-ifc-usd-streaming-2026-04-27.md) 流程：使用 USD Composer + CAD Importer 將 `.ifc` 轉為 `.usd` / `.usdc`，輸出至本目錄。

## 載入 server

於 repo root 執行：

```powershell
.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window --/app/auto_load_usd=C:/Repos/active/iot/AI-BIM-governance/bim-streaming-server/bim-models/<file>.usd
```

詳見 [`docs/plan-bim-ifc-usd-streaming-2026-04-27.md`](../docs/plan-bim-ifc-usd-streaming-2026-04-27.md)。
