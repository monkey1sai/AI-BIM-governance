# _bim-control Agent Rules

本檔是 `_bim-control/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`_bim-control` 是本地開發用 Fake BIM Data Authority。它只負責 project、model version、artifact、issue、annotation、review result、element mapping metadata。

服務埠口：`127.0.0.1:8001`

## Owns

- project / model version metadata
- artifact metadata 與 artifact status
- issue / annotation / review result metadata
- element mapping 的 metadata 與關聯關係

## Does Not Own

- IFC / RVT / DWG / USD / USDC file body
- WebRTC、DataChannel、GPU runtime、Omniverse Kit
- review session lifecycle 與多人 presence / broadcast
- browser UI

## Required Boundaries

- 大型檔案本體一律屬於 `_s3_storage`，本 repo 只保存 URL、storage key、format、version 關聯。
- 轉檔完成/失敗狀態可由 `_conversion-service` 透過 API 回寫，但 `_conversion-service` 不可直接改本 repo 的資料檔。
- UI 或 viewer 不應直連本服務；正式操作路徑應由 `bim-review-coordinator` 對外協調。
- 不得引入 Omniverse / `pxr` / `omni.*` dependency。

## Before Editing

- 先讀 `README.md`、`app/`、`tests/` 與相關 API fixture。
- 若 API schema、response shape、fixture 欄位變更，必須同步檢查 `bim-review-coordinator`、`_conversion-service` 與根目錄 `docs/contracts/` 的依賴。
- Docs-only 改動不需要 GitNexus symbol impact；source symbol 改動才需要依根目錄 GitNexus 規則做 impact analysis。

## Verify

```powershell
python -m pytest tests -q
```

或於 workspace 根目錄跑：

```powershell
scripts\verify-all.ps1 -PyOnly
```

## Done Criteria

- 行為與 `_bim-control` 的 data authority 邊界一致。
- 相關測試通過，或清楚說明未跑原因。
- 最終回覆列出 changed files、validation、known risks。
