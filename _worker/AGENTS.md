# _worker Agent Rules

本檔是 `_worker/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`_worker` 是 B 方案中的 artifact intake + RVT→IFC bridge。它對外承擔 source artifact intake、RVT→IFC export job、IFC handoff event、object layout 與 RVT→IFC lineage。

舊版 IFC→USDC conversion endpoints 目前只能視為 historical / migration compatibility；新 review flow 不得把 `_worker` 當成 IFC→USDC conversion authority，也不得由 `_worker` 宣告 `model.usdc` ready。

服務埠口：`127.0.0.1:8005`

## Owns

- IFC / RVT / DWG source artifact intake
- RVT→IFC export queue / fake fixture mode / blocked evidence
- `rvt_uploaded` input event 與 `ifc_ready` handoff payload
- source RVT artifact → derived IFC artifact lineage
- source / bridge artifact file body 的 worker-facing object layout
- dev `storage/` IFC source listing and selected-source conversion trigger

## Does Not Own

- project / model / issue / annotation / review intent metadata authority
- review session lifecycle
- Omniverse viewport runtime、WebRTC、DataChannel
- IFC→USDC conversion authority under B 方案
- `model.usdc` readiness for the new review flow
- browser UI

## Required Boundaries

- `_worker` 只回報 artifact metadata、IFC URL/reference、lineage 與 handoff event；不成為 `_bim-control` 的 BIM metadata authority。
- 目前 runtime 由 `_worker` 直接承接檔案與轉檔邊界；不要重新依賴 8002 / 8003 legacy services。
- B 方案下 IFC→USDC conversion job status、USDC URL、mapping quality 與 ready result 由 `bim-streaming-server` 負責。
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
