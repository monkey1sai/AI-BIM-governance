# _s3_storage Agent Rules

本檔是 `_s3_storage/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`_s3_storage` 是本地開發用 Fake Object Storage。它只負責檔案本體、static URL、byte-level upload/download。

服務埠口：`127.0.0.1:8002`

## Owns

- IFC / RVT / DWG 原始檔 file body
- USD / USDC 衍生檔 file body
- `element_mapping.json` file body
- fake report / snapshot / attachment file body

## Does Not Own

- project / model version / artifact business relationship
- issue / annotation / review metadata 語意
- session lifecycle、presence、collaboration broadcast
- Omniverse runtime、WebRTC、DataChannel
- IFC / USD semantic parsing

## Required Boundaries

- 本 repo 只處理 storage key、file bytes、static URL；不要保存 project business logic。
- metadata 的權威在 `_bim-control`；本 repo 不決定哪個 artifact 屬於哪個 model version。
- conversion output 可以寫入本 repo，但轉檔流程與 artifact status 不屬於本 repo。
- 不得引入 Omniverse / `pxr` / `omni.*` dependency。

## Before Editing

- 先讀 `README.md`、`app/`、`tests/` 與 static file fixture。
- 若 upload/download path、URL format、storage key 規則變更，必須同步檢查 `_bim-control`、`_conversion-service` 與 `bim-streaming-server` 的依賴。
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

- 變更不把 storage 變成 metadata authority。
- 相關測試通過，或清楚說明未跑原因。
- 最終回覆列出 changed files、validation、known risks。
