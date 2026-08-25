# unified-console-runtime-truth — Slice 1 Design（§1 真值綁定＋§5 測試／semantic case 對齊）

**Status**：approved slice。owner 2026-08-25 口令：「執行 unified-console-runtime-truth 第一片 §1 真值綁定（web-viewer-sample 共用 poller＋#home/#pipeline/#runtime 綁十個既有端點）…UI task 一律只憑 181 部署後證據勾選」。

**唯一忠實源**：`openspec/changes/unified-console-runtime-truth/`（`proposal.md`、`design.md`、`tasks.md`、`specs/**`，已於 PR #694 合併，owner 六點裁決寫在 `tasks.md` §0）。本檔只界定切片範圍與執行環境事實，**不新增任何需求**；與 OpenSpec change 衝突時一律以 change 為準。

## 1. Scope（本切片必做）

- `tasks.md` §1 全部：1.1（impact）、1.2（十端點欄位 shape 盤點，不新增端點）、1.3（共用 poller store `useCoordinatorStatusStore`＋`ConsoleDataProvider` 介面）、1.4（`#home`）、1.5（`#pipeline`）、1.6（`#runtime` 真值 OpsPage）、1.7（頂列 GPU chip，移除字面 `82%`）、1.8（假資料 export 退出 production 顯示路徑；D1=P → 移到 test-only）。
- 行為改變後**必須同 PR 更新**的 §5 項目：5.1（`EdgeConsole.sharedstatus.test.tsx` 凍結翻轉為共用 poller 單一 in-flight）、5.2（`a1DockLive.test.tsx` liveBackend 真值取代 fixture）、5.3（`unified.test.tsx` KPI 斷言改 mock API 值＋offline 狀態）、5.4（`web-viewer-sample/e2e/design-system-semantic-cases.ts` 的 fixture 值斷言改為誠實狀態斷言；**case id 一律保留**，不改 `docs/plans/design-system-reference.manifest.json` 的 `required_case_ids`）、5.6（乾淨工作樹跑兩道 required gate）、5.7（`npx tsc --noEmit && npx vitest run`）。
- 設計依據：`design.md` §3（poller、Prov 七值＋`data-state` 四值、十端點對映表）、§4（#home／#pipeline／#runtime／頂列）、§6（測試策略）；requirement 為 `specs/unified-console-runtime-truth/spec.md` 的「預設入口真值」「十端點綁定＋共用 poller」「設計閘相容」三條，及 MODIFIED 的 `unified-governance-console`／`edge-console-operator-frontend` 新 scenario。

## 2. 5.5 rebaseline 的歸屬（不列為 implementer task）

- D1=P 的 golden rebaseline（`node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`，R-A2 雙旗標）只能由 coordinator 在 owner 明示後親自執行並單獨 commit；plan **不得**把它列為 implementer 步驟，implementer 也不得執行任何 `--rebaseline`。
- 因此 P3 完成時 `design-semantic-visual` 的 pixel 比對預期為紅（golden 仍是 fixture 畫面）；semantic case（5.4）本身須以誠實狀態斷言撰寫，使 rebaseline 之後整道 gate 可綠。

## 3. Out of scope（其他切片或 owner）

- §2 控制項／badge、§3 A1／A4、§4 coordinator（slice 2 另開 worktree）、§6 canonical-linux 181 驗收（merge 後 owner inventory）、§7 closeout。
- 不新增端點、不改 `bim-review-coordinator`、不動 lineage 契約、不改 `rejectIfIpNotAllowed`、不開放 `/api/dev/*`、不編輯 `docs/plans/*.dc.html`／`docs/plans/*.md`／`docs/plans/ai-bim-governance.css`（R-A1）、不覆寫 `workspace.a4.default`、不新增生產依賴、不新 HTTP client（沿用 `coordinatorClient`）。
- `openspec/lifecycle-ledger.json`、`docs/plans/NOW.md` 本切片不改（`task_ledger` 維持 6/43，因 UI task 未經 181 不得打勾）。

## 4. 勾選與 ledger 規則（避免 P7 ledger_mismatch 誤判）

- `tasks.md` §1／§5 的 UI 相關 task **不得打勾**；本切片 PR 只在對應 task 下方加一行子彈「本機綠，待 181（slice 1，commit `<sha>`）」。plan 檔（`docs/superpowers/plans/…`）的 task checkbox 則照實勾選。
- 完成真相 = plan task 全部 `task#N:` commit ＋ vitest／tsc 綠 ＋ P4 browser evidence；OpenSpec 勾選留給 181 驗收。

## 5. 執行環境事實（worktree）

- worktree 根：`C:\Repos\active\iot\AI-BIM-governance.worktrees\unified-console-runtime-truth-s1`；branch `codex/openspec/unified-console-runtime-truth-s1`（自 `origin/main` `2ef725a`）。
- 前端指令 cwd 為 `web-viewer-sample`（worktree 內已 `npm ci`）：`npx tsc --noEmit`、`npx vitest run <檔>`、`npm run build:ui`（輸出 `dist-ui`，屬 ignored artifact）。vite build 不跑 tsc，型別必須另跑。
- Playwright E2E：`web-viewer-sample/e2e/`；新 spec 檔名不得以 `design-system-` 為前綴（避免混入設計閘）；真 backend 為本機 coordinator `http://127.0.0.1:8004`（不可達時標 stack_down，不得改打其他 host）。
- Python venv 不在 worktree；如需 pytest 用絕對路徑 `C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe`（本切片預期不需要）。
- GitNexus：本 worktree 於 HEAD 已 `npx gitnexus@1.6.9 analyze --index-only`；每個既有 symbol 修改前 `gitnexus impact <Symbol> -d upstream -r AI-BIM-governance`，HIGH／CRITICAL 先回報；commit 前 `gitnexus detect-changes --scope compare --base-ref main`（linked worktree 看不到 staged 時 fallback `git diff --name-only --cached` 並記 `detectVerdict='fallback'`）。
- 十端點皆已存在於 `bim-review-coordinator/src/app.ts`（`/api/runtime/status` :1363、`/api/conversion/records` :2374、`/api/minio/objects` :2399、`/api/external/minio-watch/status` :2462、`/api/callback-outbox/summary` :3215、`/api/kit/health` :3779、`/api/kit/instances/current` :3785）與 `routes/governanceProxy.ts:223`（`/api/governance/issues`、`/api/governance/rule-runs`）＋`/api/external/ifc-ready`；行號以 `rg -n` 重新定位為準。
- mock 一律於 `coordinatorClient` 層注入（vitest），不打真網路；production 只注入 live store；`data-prov` 只允許 `asbuilt`／`artifact`／`demo`／`p1`／`p15`／`p3`／`p4`；`data-state` ∈ {`live`,`unavailable`,`offline`,`error`}；永不以 0 作佔位；gate 環境（`/api/**` 503 stub）下「最後更新」固定顯示 `—`。
- 假資料 export（`fixtures.ts`：`initialIntake`／`initialConv`／`initialSessions`／`initialOutbox`／`initialIssues`／`alerts`／`services`／`failDefs`／`diffDefs`／`fedMembers`／`stageTree`）移到 test-only 模組；i18n／導覽／style helper 保留；`fixtureNotInProduction.test.ts` 以符號層（import graph）驗證 production 元件不 import 假資料；`npm run build:ui` 後 `dist-ui` 內不得出現 `GPU/Stream 82%`。
