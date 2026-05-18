# bim-review-coordinator Agent Rules

本檔是 `bim-review-coordinator/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`bim-review-coordinator` 是外部 IFC-ready intake、metadata-only callback outbox 與 Session / Collaboration Control Plane。它負責建立 review session、協調 viewer 與 streaming server 的連線資訊、廣播多人協作事件，並保存最小 local shadow metadata。

服務埠口：`127.0.0.1:8004`

## Owns

- review session state
- stream config 對 viewer 的發放
- user presence / selection / issue focus / annotation event broadcast
- 外部 IFC-ready service auth / idempotency / local conversion job binding
- streaming conversion result → metadata-only callback outbox

## Does Not Own

- project / artifact / issue metadata authority
- IFC / USD / USDC file body
- USD stage loading、viewport rendering、camera/material/runtime operation
- browser UI

## Required Boundaries

- `web-viewer-sample` 的 session / metadata / stream config 查詢應走本服務，不直連已刪 runtime。
- 本服務只協調 session、collaboration、intake 與 callback outbox，不取代外部公司雲端 control-plane 成為長期 metadata authority。
- 不得引入 Omniverse / `pxr` / `omni.*` dependency。
- 不得直接控制 Kit viewport、camera、material；runtime operation 屬於 `bim-streaming-server`。

## Before Editing

- 先讀 `README.md`、`src/`、`tests/`、`package.json` 與相關 contract。
- API 或 Socket.IO event schema 變更必須同步檢查 `web-viewer-sample`、`bim-streaming-server`、`tests/contracts/` 與 `docs/contracts/`。
- Source 改動需檢查相關 API、event contract 與測試影響；docs-only 改動只需確認文件語意。

## Verify

```powershell
npm run verify
```

等同：

```powershell
npm run build
npm test
```

或於 workspace 根目錄跑：

```powershell
scripts\verify-all.ps1 -TsOnly
```

## Done Criteria

- 變更沒有把 coordinator 變成 UI、file store、metadata authority 或 3D runtime。
- 相關測試通過，或清楚說明未跑原因。
- 最終回覆列出 changed files、validation、known risks。
