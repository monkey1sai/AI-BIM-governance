# Tasks

本 change 的驗證場所就是它自己定義的隔離 alt-port stack（coordinator `:8005`／governance `:49103`／viewer `:5180`）。全程不得啟動或連線測試部署區 `:8004`／`:49102`，也不得執行 `scripts/dev/rebuild-test-deploy.ps1`。

## 1. 契約定義與文件（owner：`docs/agents/`）

- [ ] 1.1 在 `docs/agents/product-operability-and-script-contract.md` 新增「隔離 branch stack 驗證」一節：port 配置表、部署區與 Kit 保留集合、offset 規則與實務上限、`start` / `stop` / `status` 指令、stack manifest 欄位、evidence 標示規則，以及「隔離 stack evidence 不得推論 design gate／deploy path／3D runtime」三條禁止句。
- [ ] 1.2 在同檔 §3 Frontend Dual-Gate 的 MUST 清單補一行：未 merge branch 的 runtime evidence 來源必須是隔離 stack，並在 evidence 標明 stack kind；不新增第二份 port 表（引用 1.1 的表）。
- [ ] 1.3 在 `scripts/SCRIPT_CONTRACT.md` 的「Test / Smoke / Dev Scripts」段落登記新 launcher 的角色與呼叫邊界，明確它不是 canonical operator entrypoint、不得取代 `deploy.ps1`。
- [ ] 1.4 檢查根 `AGENTS.md` / `CLAUDE.md` 的 sub-file 表是否已涵蓋本主題（`product / frontend / deploy contract` 列已指向 1.1 所在檔案）；已涵蓋則不新增列，並在 PR body 說明未改 `AGENTS.md` 的理由。

## 2. Launcher（owner：`scripts/dev/`、`scripts/tests/`）

- [ ] 2.1 先寫 failing test `scripts/tests/test-isolated-branch-stack.ps1`：resolved port set 計算（base + offset）、保留集合（`8004`／`49102`／`49101`／`8010`／`5173`／`5174` ∪ Kit `49100`、`49110–49150`）交集非空即拒絕、offset 越界拒絕、負值／非整數 offset 拒絕、`scripts/script-registry.json` 具備 launcher 登記、1.1 的 doc 表格與 launcher 常數一致（漂移即 fail）。
- [ ] 2.2 實作 `scripts/dev/start-isolated-branch-stack.ps1`：`-Action start|stop|status`、`-Offset <int>`；start 依序執行「解析 → 不相交檢查 → port 清理（範圍限 resolved set）→ 啟動 governance → 健康檢查 → 啟動 coordinator → 健康檢查 → 輸出 manifest」；不相交檢查未過即 exit 非零並列出衝突 port 與 owner PID，且不啟動任何服務、不進入清理階段。
- [ ] 2.3 stack manifest 落 `artifacts/e2e/<change-id>/stack-manifest.json`，欄位至少含 `stack_kind`（固定 `isolated_branch_stack`）、`offset`、`ports`、`base_urls`、`head_sha`、`started_at`、`pids`；`stop` 後保留檔案並補 `stopped_at`。
- [ ] 2.4 於 `scripts/script-registry.json` 新增登記；確認未新增任何 root-level `scripts/start-*.ps1`。
- [ ] 2.5 跑 `pwsh -NoProfile -File .\scripts\tests\invoke-powershell-static.ps1` 靜態檢查與 2.1 的測試，全綠。

## 3. Browser E2E 對接（owner：`web-viewer-sample/`）

- [ ] 3.1 先寫 failing tests：require-real helper 在缺前置條件時丟出 hard failure（不得 `test.skip`）、forbidden-port watcher 命中保留集合 port 時使 spec fail、base URL 落入保留集合時 config 解析即 throw。
- [ ] 3.2 新增共用 helper `web-viewer-sample/e2e/support/isolated-stack.ts`：解析 stack manifest 或 env、require-real 判定、forbidden-port request watcher；不改變任何既有 spec 的斷言語意。
- [ ] 3.3 讓 `a4-closeout.spec.ts` 與 `a3-federated-session-chain.spec.ts` 改用 3.2 的 helper，移除各自檔頭手抄的 port 常數與 skip 邏輯；斷言內容維持不變。
- [ ] 3.4 `playwright.config.ts`：coordinator base 改由 helper 統一解析，落入保留集合即 throw；保留既有 `E2E_VIEWER_PORT`／`E2E_DISABLE_WEBSERVER` 行為與 `strictPort` + `reuseExistingServer:false`。
- [ ] 3.5 跑 `npm run typecheck` 與 `npx vitest run`，結果不得低於改動前 baseline（先記錄 baseline 數字）。

## 4. Machine gate（owner：`.github/`、`scripts/tests/`）

- [ ] 4.1 在 `.github/workflows/agent-governance.yml` 新增一步執行 `scripts/tests/test-isolated-branch-stack.ps1`。
- [ ] 4.2 確認 `scripts/verification-manifest.json` / `scripts/verify-all.ps1` 是否需要納入；若不納入，於 PR body 說明理由（避免把 branch-only harness 塞進 operator golden path）。
- [ ] 4.3 對 `scripts/tests/test-agent-governance-check.ps1` 既有 dead-link／行數 gate 重跑，確認 1.1–1.3 的文件改動未破壞既有檢查。

## 5. 首個 consumer 實跑（owner：本 change，唯讀對待 A4 實作）

- [ ] 5.1 記錄啟動前 `:8004`／`:49102` 的 listener 狀態快照；用 2.2 的 launcher 起隔離 stack；記錄啟動後同樣快照，證明部署區未被改動。
- [ ] 5.2 以 require-real 模式對隔離 stack 跑一次既有 A4 browser E2E（`a4-closeout.spec.ts`），證明 harness 能產出 screenshot／trace／console／network 與 observed runtime IDs。
- [ ] 5.3 evidence 落 `artifacts/e2e/isolated-branch-stack-browser-e2e/`：`stack-manifest.json`、evidence manifest、截圖（依 repo 慣例需 `git add -f`）、trace 路徑。
- [ ] 5.4 若 A4 現況在 require-real 模式下未通過，**記為 known gap 並交回 `a4-console-convergence`**；本 change 不修改任何 A4 前後端實作，PR body 誠實標示該紅燈是既有假通過被揭露，而非本 change 造成的回歸。
- [ ] 5.5 停 stack 後再取一次部署區 listener 快照，確認三次快照一致。

## 6. 收尾與誠實揭露

- [ ] 6.1 執行 `npx openspec validate isolated-branch-stack-browser-e2e --strict` 與 `npx openspec validate --all --strict`，輸出貼進 PR body。
- [ ] 6.2 更新 `openspec/lifecycle-ledger.json`（本 change 的 task ledger 與 `subject_commit`），再更新 `docs/plans/NOW.md` 的 projection；順序不得顛倒。
- [ ] 6.3 對 launcher 與 helper 涉及的既有符號跑 `gitnexus impact -d upstream -r AI-BIM-governance`；commit 前跑 `gitnexus detect-changes --scope compare --base-ref main`，HIGH／CRITICAL 於 PR body 揭露；index stale 或 CLI 不可用時依 `docs/agents/gitnexus-usage.md` 走 unavailable gate。
- [ ] 6.4 `git diff --check`、secret scan（`scripts/tests/scan-secret-patterns.ps1`）、`git status` 乾淨；generated cache 與 runtime artifact 不得進 change。
- [ ] 6.5 PR body 填妥 Change Classification 與 AI Coding Governance 表（本 PR 觸及 `docs/plans/` 與 `.github/`），並明確標示 `Full completion claimed`、`stack_kind=isolated_branch_stack`，以及本 change **不**涵蓋 A4 tasks 4.1–4.4 的判讀與修復。
