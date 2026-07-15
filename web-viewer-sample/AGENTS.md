# web-viewer-sample Agent Rules

本檔是 `web-viewer-sample/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`web-viewer-sample` 是 Browser Client / WebRTC Viewer / User Interaction Layer。production 2D UX／IA／visual state 以唯讀 `C:\Repos\design\desigin-system` 的 repo-pinned manifest/baselines 為標準；它同時負責顯示 Kit 串流、送出 DataChannel JSON command、與 coordinator 交換 session / presence / stream config，並透過 governance proxy 呈現 A1–A10 UI。

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
- User-facing feature 完成時必須同時有：(a) approved screen/state 在 Windows runner 的 Chromium DPR1 兩 viewport pixel≤1%＋CI Playwright semantic 100%；(b) route、明確按鈕、default fixture、loading/success/failure/retry、可觀察 ID 與 functional Playwright/Chrome evidence。shared EdgeConsole 依 manifest 為 `mixed` 時必須跑全部 screens、揭露 missing routes且 full=no；兩閘互不代替，live WebRTC/GPU frame 不作 design pixel golden。

## Before Editing

- 先讀 `README.md`、`src/`、`package.json`、`docs/plans/AI-BIM 前後端設計文件.dc.html` §04（後端凍結面）/§08 R1–R4 與 design reference manifest。
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

Frontend visual lane（affected screen IDs 與 semantic evidence 必須先備妥）：

```powershell
npm run test:visual:design-system
```

產出的 `artifacts/e2e/design-system-visual-result.json` 是 current-checkout CI output，必須再由 root validator 重算 subject commit、manifest/hash、兩 viewport與 artifact hashes；不得讀 PR／外部 semantic JSON。`reference_missing` 不算 pass，但可走誠實 partial、full=no。

workspace 聚合檢查：

```powershell
scripts\verify-all.ps1 -TsOnly
```

## Done Criteria

- 變更維持 browser client 邊界，沒有把 UI 變成 metadata authority、storage、conversion worker 或 Kit runtime。
- 對 user-facing feature，最終回報必須列 route/buttons/fixture/API/runtime ID/visible states/functional evidence，以及 design screen/manifest/visual result/comparison/reference-current-diff artifacts；涉及 Kit 再列 first-frame/stage/DataChannel ack。
- 相關 build、lint、E2E 或 smoke check 通過，或清楚說明未跑原因。
- Source 改動完成後檢查等效 diff 範圍。
- 最終回覆列出 changed files、validation、known risks。
