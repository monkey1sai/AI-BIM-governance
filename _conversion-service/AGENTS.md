# _conversion-service Agent Rules

本檔是 `_conversion-service/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`_conversion-service` 是本地開發用 Conversion Worker API。它負責接收轉檔 job，從 `_s3_storage` 讀 IFC，產出 USDC 與 element mapping，再回寫 storage 與 `_bim-control` artifact status。

服務埠口：`127.0.0.1:8003`

## Owns

- conversion job lifecycle
- IFC to USDC 的 mock / local conversion workflow
- `element_mapping.json` 產生流程
- conversion failure / retry / status transition 的 worker-side 行為

## Does Not Own

- project / model / artifact metadata authority
- `_s3_storage` 的 file body authority
- review session lifecycle
- Omniverse viewport runtime、WebRTC、DataChannel
- browser UI

## Required Boundaries

- 讀原始檔與寫產物一律透過 `_s3_storage`。
- artifact status 只透過 `_bim-control` API 回寫，不直接改 `_bim-control` data files。
- 轉檔結果若包含 IFC GUID to USD prim path mapping，檔案本體寫 storage，關聯 metadata 回 `_bim-control`。
- 不得啟動 Kit server、控制 GPU、或直接送 DataChannel command。

## Before Editing

- 先讀 `README.md`、`app/`、`tests/`、`data/` fixture 與相關 contract。
- 若 job schema、status enum、mapping format、storage URL 規則變更，必須同步檢查 `_bim-control`、`_s3_storage`、`bim-review-coordinator` 與 `docs/contracts/`。
- Source 改動需檢查相關 API、fixture 與測試影響；docs-only 改動只需確認文件語意。

## Verify

```powershell
python -m pytest tests -q
```

或於 workspace 根目錄跑：

```powershell
scripts\verify-all.ps1 -PyOnly
```

## Done Criteria

- 轉檔流程沒有越權成為 metadata 或 file storage authority。
- 相關測試通過，或清楚說明未跑原因。
- 最終回覆列出 changed files、validation、known risks。
