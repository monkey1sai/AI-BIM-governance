# web-viewer-sample Agent Rules

本檔是 `web-viewer-sample/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`web-viewer-sample` 是 Browser Client / WebRTC Viewer / User Interaction Layer，也是分頁「06 操作介面總覽」對應到本 repo 的主要前端驗收面。它負責顯示串流畫面、送出 DataChannel JSON command、與 coordinator 交換 session / presence / stream config，並透過 coordinator governance proxy 呈現 A1–A10 的可操作 Edge Console / Review Room / project / issue / BCF / stage tree 等 UI 狀態。

開發埠口：`127.0.0.1:5173`

## Owns

- browser UI 與 interaction state
- A1–A10 user-facing routes、buttons、visible status、manual verification steps
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

- session / metadata / file URL 查詢一律透過 `bim-review-coordinator`，不直連已刪 runtime 或外部平台。
- governance capability 一律透過 coordinator `/api/governance/*` proxy，不得讓瀏覽器直連 `127.0.0.1:49102`。
- 與 streaming server 的互動限定於 WebRTC video 與 DataChannel JSON command。
- UI cache 只能作為顯示用途；source of truth 在 coordinator、streaming server 或外部公司雲端 control-plane。
- DataChannel schema 或 session API 變更必須同步檢查 `bim-streaming-server`、`bim-review-coordinator` 與 `docs/contracts/`。
- User-facing feature 完成時必須有 route、明確按鈕、default fixture、loading / success / failure / retry、可觀察 ID、Playwright / Chrome E2E evidence；backend-only 完成不接受。

## Before Editing

- 先讀 `README.md`、`src/`、`package.json` 與相關 docs。
- UI/client 改動與 server protocol / deployment 改動分開處理。
- Source 改動需檢查相關 public API、protocol、UI flow 與測試影響。
- Docs-only 改動只需確認文件語意，除非文件改變 public API、protocol 或 operational runbook 行為。

## Verify

目前穩定 gate：

```powershell
npm run verify
```

目前 `npm run verify` 等同：

```powershell
npm run build && npm test && npm run test:struct-log
```

`npm run lint` 可手動使用，但既有 lint baseline 尚未清零，不能當作目前跨 repo hard gate。

workspace 聚合檢查：

```powershell
scripts\verify-all.ps1 -TsOnly
```

## Done Criteria

- 變更維持 browser client 邊界，沒有把 UI 變成 metadata authority、storage、conversion worker 或 Kit runtime。
- 對 user-facing feature，最終回報必須列 Frontend URL、Buttons tested、Fixture used、Expected visible result、E2E command、Screenshot / evidence path。
- 相關 build、lint、E2E 或 smoke check 通過，或清楚說明未跑原因。
- Source 改動完成後檢查等效 diff 範圍。
- 最終回覆列出 changed files、validation、known risks。
