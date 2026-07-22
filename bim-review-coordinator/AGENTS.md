# bim-review-coordinator Agent Rules

本檔是 `bim-review-coordinator/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`bim-review-coordinator` 是外部 IFC-ready intake、metadata-only callback outbox 與 Session / Presence Control Plane。它負責建立 review session、協調 viewer 與 streaming server 的連線資訊、廣播 presence 等基本 session 事件，並保存最小 local shadow metadata。它也是 review-session runtime mutation 的 narrow policy authority：驗證 current primary lease，並保存 bounded stage-binding authorization / confirmation shadow；實際 GPU state 與 mutation execution 仍屬 streaming server。

服務埠口：`127.0.0.1:8004`（含 Socket.IO）

> **退役狀態（2026-05-21，change `remove-conflict-review-from-fast-mvp`）**：`highlightRequest` / `selectionUpdate` / `annotationCreate` 等 collaboration Socket.IO event handlers 已自本 service 移除（`src/socket/reviewNamespace.ts`）；`getReviewIssues` / `createAnnotation` / `/api/model-versions/:id/review-bootstrap` 也已刪。`/api/review-sessions/:id/events` 與 `/lifecycle-events` 仍保留；lifecycle endpoint 排除 collaboration event 的 wording 保留作 archive compatibility（舊 event log 仍可能含這些 type）——不要把這些已刪 handler 當 regression 加回來。

## Owns

- review session state
- stream config 對 viewer 的發放
- user presence（`joinSession` / `leaveSession` / `heartbeat` / `presenceUpdated`）
- authenticated viewer lease、runtime mutator allow/deny decision
- bounded `pending -> executing -> active|failed` stage-binding transaction與active/last-good confirmation shadow
- 外部 IFC-ready service auth / idempotency / local conversion job binding
- streaming conversion result → metadata-only callback outbox
- browser-facing governance proxy（`/api/governance/*` → `governance-service :49102`）
- user-facing frontend flow 所需的 session / status / identifier bridge

## Does Not Own

- project / artifact / issue metadata authority
- IFC / USD / USDC file body
- USD stage loading、viewport rendering、camera/material/runtime operation
- browser UI

## Required Boundaries

- `web-viewer-sample` 的 session / metadata / stream config 查詢應走本服務，不直連已刪 runtime。
- 瀏覽器不得直連 internal loopback service；governance API 必須經本服務 proxy，缺席時誠實回 502 / visible failure state。
- 本服務只協調 session / presence、intake、callback outbox與narrow runtime mutation policy；generic event log 僅是 append-only compatibility archive，不取代 governance-service 或外部公司雲端 control-plane 成為 issue / annotation authority。
- Stage-binding `active` / `last-good` 只代表Kit回報後的control-plane confirmation evidence；本服務不得因此載入stage、執行USD/viewport mutation或宣稱掌握即時GPU truth。
- 不得引入 Omniverse / `pxr` / `omni.*` dependency。
- 不得直接控制 Kit viewport、camera、material；runtime operation 屬於 `bim-streaming-server`。
- 不直接保存大型模型檔案 byte。**例外 carve-out（2026-05-21，change `fast-ifc-link-demo-loop`）**：`POST /api/external/ifc-ready` 同步階段允許把外部 IFC 下載到本地 shared volume（`storage/ifc-cache/<ifc_ready_job_id>/source.ifc`）作 dispatch 前臨時通道（實作 `src/services/ifcDownloader.ts`）；coordinator 不因此成為 IFC bytes 權威。production 應設 `IFC_DOWNLOAD_STRICT=true` / `fallbackOnFetchError=false` 強制真實下載。
- User-facing flow 需要本服務參與時，API done 不等於 feature done；必須同步確認 `web-viewer-sample` 有可操作 route / button / E2E evidence。

權威歸屬速查：

| 行為 | 此 repo 角色 |
|---|---|
| review session state / presence broadcast / stream config / external IFC-ready intake / cloud callback outbox | **owner** |
| generic session event log | compatibility archive only；不代表 live broadcast 或資料權威 |
| runtime mutator policy / stage-binding confirmation shadow | **owner**；只做allow/deny與bounded evidence，不執行GPU mutation |
| project / artifact metadata | reference only（owner 在外部公司雲端 control-plane） |
| file / conversion body | 不擁有（owner 在 `bim-streaming-server` / 外部 artifact store） |
| 3D runtime state | 不擁有；actual state owner 在 `bim-streaming-server`，本服務只保存其confirmation shadow |

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
- 若改動支援 user-facing flow，必須回報前端驗收入口或清楚標示「後端切片，尚未可從前端驗收」。
- 相關測試通過，或清楚說明未跑原因。
- 最終回覆列出 changed files、validation、known risks。
