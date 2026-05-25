# Tasks — coordinator-ui-tri-ready-and-queue

## 0. Setup

- [x] 0.1 Create branch `codex/openspec/coordinator-ui-tri-ready-and-queue`
      from latest `main`.
- [x] 0.2 Inspect `bim-review-coordinator/src/public/dev-console.html`
      (1,434 行)既有 step / readiness / `/api/assets` 區。
- [x] 0.3 Create OpenSpec scaffold:proposal / design / tasks / spec delta.

## 1. Failing tests first(vitest)

- [ ] 1.1 在 `tests/dev-console.test.ts` 加 source-level assertion:
      - HTML 含 `data-testid="tri-ready-badges"` / `data-testid="dispatch-queue-section"`
        / `data-testid="legacy-assets-disclaimer"`
      - Step header literal:「① 接收 IFC-ready webhook」/「② 產生本機 USDC 資料包」
        /「③ 啟動 Kit / WebRTC 串流」/「④ 驗證 BIM 語意對照」
      - inline JS 含 `computeFileReady` / `computeRuntimeReady` / `computeSemanticReady`
        functions,引用 `semantic_mapping_fidelity` / `mapping_has_ifc_type` /
        `mapping_has_ifc_name`
      - legacy disclaimer 含字樣「不代表 當前 session model」(或 spec scenario 要求字樣)
- [ ] 1.2 Run `npm test` → FAIL(HTML 還未改)

## 2. Implementation

- [ ] 2.1 修改 `dev-console.html`:
      - 找既有 4 個 step header,改為新 Edge BIM Data Server Console 命名
      - 加 `<div data-testid="tri-ready-badges">` 顯示 File / Runtime / Semantic
      - 加 `<section data-testid="dispatch-queue-section">` 顯示 in-flight + queued
        list + dropped_on_restart hint
      - 在 legacy `/api/assets` 區 加 `<div data-testid="legacy-assets-disclaimer">`
      - inline JS:加 `computeFileReady` / `computeRuntimeReady` /
        `computeSemanticReady`,render 時 inject DOM badge
      - inline JS:dispatch queue render 時 filter jobs by status

## 3. Verify

- [ ] 3.1 `cd bim-review-coordinator && npm test` → all green
- [ ] 3.2 `npm run build`
- [ ] 3.3 `npm run verify`
- [ ] 3.4 `openspec validate coordinator-ui-tri-ready-and-queue --strict`
- [ ] 3.5 `openspec validate --specs --strict`

## 4. Commit / PR

- [ ] 4.1 `git diff --cached --check`
- [ ] 4.2 Commit:`feat(coordinator): /ui 加三段 ready + dispatch queue + step rename
      (coordinator-ui-tri-ready-and-queue)`
- [ ] 4.3 Push branch and open PR with Traditional Chinese title / body.

## 5. Archive (post-merge,depends on C1 + C4 merged)

- [ ] 5.1 Sync local main.
- [ ] 5.2 `openspec archive coordinator-ui-tri-ready-and-queue`.
- [ ] 5.3 Sync delta into `openspec/specs/demo-fast-mvp-orchestration/spec.md`.
- [ ] 5.4 Update roadmap MD + HTML.
- [ ] 5.5 Closeout per `AGENTS.md`.
