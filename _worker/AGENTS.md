# _worker Agent Rules

本檔是 `_worker/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`_worker` 是本地開發用 file + conversion facade。它對外承擔 artifact intake、conversion job、object layout、derived file URL 與 conversion lineage。

服務埠口：`127.0.0.1:8005`

## Owns

- IFC / RVT / DWG source artifact intake
- source / derived / index / mapping file body 的 worker-facing object layout
- conversion job lifecycle 與 conversion lineage
- conversion result metadata callback payload
- dev `storage/` IFC source listing and selected-source conversion trigger

## Does Not Own

- project / model / issue / annotation / review intent metadata authority
- review session lifecycle
- Omniverse viewport runtime、WebRTC、DataChannel
- browser UI

## Required Boundaries

- `_worker` 只回報 artifact metadata、URL、mapping URL、lineage；不成為 `_bim-control` 的 BIM metadata authority。
- 目前 runtime 由 `_worker` 直接承接檔案與轉檔邊界；不要重新依賴 8002 / 8003 legacy services。
- 不得管理 user auth、GPU capacity、Kit instance lifecycle 或多人協作事件。

## Before Editing

- 先讀 `README.md`、`app/`、`tests/` 與根目錄 `docs/contracts/worker-api.md`。
- API schema 或 object layout 變更時，同步檢查 `_bim-control`、`bim-review-coordinator` 與 `web-viewer-sample`。

## Verify

```powershell
python -m pytest tests -q
```

## Done Criteria

- 變更沒有把 worker 變成 metadata authority、session coordinator、Kit runtime 或 UI。
- 相關測試通過，或清楚說明未跑原因。
- 最終回覆列出 changed files、validation、known risks。
