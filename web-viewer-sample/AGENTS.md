# web-viewer-sample Agent Rules

本檔是 `web-viewer-sample/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`web-viewer-sample` 是 Browser Client / WebRTC Viewer / User Interaction Layer。它負責顯示串流畫面、送出 DataChannel JSON command、與 coordinator 交換 session / collaboration state，並呈現 project / issue / annotation / stage tree 等 UI 狀態。

開發埠口：`127.0.0.1:5173`

## Owns

- browser UI 與 interaction state
- client-side WebRTC connection handling
- DataChannel JSON command 的 client-side 發送與結果呈現
- viewer 與 `bim-review-coordinator` 的 REST / Socket.IO integration
- display-only cache / UI state

## Does Not Own

- Kit server lifecycle、GPU allocation、WebRTC server runtime
- project / artifact / issue / annotation metadata authority
- IFC / USD conversion
- file body storage
- long-term review data persistence

## Required Boundaries

- metadata / file URL 查詢一律透過 `bim-review-coordinator`，不直連 `_bim-control` 或 `_s3_storage`。
- 與 streaming server 的互動限定於 WebRTC video 與 DataChannel JSON command。
- UI cache 只能作為顯示用途；source of truth 仍在 `_bim-control` 或 coordinator。
- DataChannel schema 或 session API 變更必須同步檢查 `bim-streaming-server`、`bim-review-coordinator` 與 `docs/contracts/`。

## Before Editing

- 先讀 `README.md`、`src/`、`package.json` 與相關 docs。
- UI/client 改動與 server protocol / deployment 改動分開處理。
- Source symbol 改動必須依根目錄 GitNexus 規則先做 impact analysis；HIGH / CRITICAL impact 先停下回報。
- Docs-only 改動不需要 GitNexus symbol impact，除非文件改變 public API、protocol 或 operational runbook 行為。

## Verify

目前穩定 gate：

```powershell
npm run verify
```

目前 `npm run verify` 等同：

```powershell
npm run build
```

`npm run lint` 可手動使用，但既有 lint baseline 尚未清零，不能當作目前跨 repo hard gate。

workspace 聚合檢查：

```powershell
scripts\verify-all.ps1 -TsOnly
```

## Done Criteria

- 變更維持 browser client 邊界，沒有把 UI 變成 metadata authority、storage、conversion worker 或 Kit runtime。
- 相關 build、lint 或 smoke check 通過，或清楚說明未跑原因。
- Source symbol 改動完成後檢查 GitNexus detect changes 或等效 diff 範圍。
- 最終回覆列出 changed files、validation、known risks。
