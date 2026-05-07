# bim-review-coordinator Agent Rules

本檔是 `bim-review-coordinator/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`bim-review-coordinator` 是 Session / Collaboration Control Plane。它負責建立 review session、協調 viewer 與 streaming server 的連線資訊、廣播多人協作事件，並對外代理 BIM metadata / worker object URL 查詢。

服務埠口：`127.0.0.1:8004`

## Owns

- review session state
- stream config 對 viewer 的發放
- user presence / selection / issue focus / annotation event broadcast
- viewer 對 `_bim-control` 與 `_worker` artifact binding / object URL 的查詢路由

## Does Not Own

- project / artifact / issue metadata authority
- IFC / USD / USDC file body
- USD stage loading、viewport rendering、camera/material/runtime operation
- browser UI

## Required Boundaries

- `web-viewer-sample` 的 metadata / file URL 查詢應走本服務，不直連 `_bim-control` 或 `_worker`。
- 本服務只協調 session 與 collaboration，不取代 `_bim-control` 成為長期 review metadata authority。
- 不得引入 Omniverse / `pxr` / `omni.*` dependency。
- 不得直接控制 Kit viewport、camera、material；runtime operation 屬於 `bim-streaming-server`。

## Before Editing

- 先讀 `README.md`、`src/`、`tests/`、`package.json` 與相關 contract。
- API 或 Socket.IO event schema 變更必須同步檢查 `web-viewer-sample`、`_bim-control`、`_worker` 與 `docs/contracts/`。
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
