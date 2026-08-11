# Tasks

本 change 的驗證場所就是它自己定義的隔離 alt-port stack（coordinator `:8005`／governance `:49103`／viewer `:5180`）。全程不得啟動或連線測試部署區 `:8004`／`:49102`，也不得執行 `scripts/dev/rebuild-test-deploy.ps1`。

## 1. 契約定義與文件（owner：`docs/agents/`）

- [x] 1.1 在 `docs/agents/product-operability-and-script-contract.md` 新增「隔離 branch stack 驗證」一節：port 配置表、部署區與 Kit 保留集合、offset 僅允許整數 `0..4`、backend-only `start` / `stop` / `status`、Playwright-owned viewer lifecycle、process ownership gate、stack manifest 欄位、evidence 標示規則，以及「隔離 stack evidence 不得推論 design gate／deploy path／Kit-WebRTC runtime」三條禁止句。
- [x] 1.2 在同檔 §3 Frontend Dual-Gate 的 MUST 清單補一行：未 merge branch 的 CPU governance／coordinator／browser operability evidence 來源必須是隔離 stack並標明 stack kind；Kit／WebRTC／GPU evidence 另依 host-native 契約取得；不新增第二份 port 表。
- [x] 1.3 在 `scripts/SCRIPT_CONTRACT.md` 的「Test / Smoke / Dev Scripts」段落登記新 launcher 的角色與呼叫邊界，明確它不是 canonical operator entrypoint、不得取代 `deploy.ps1`。
- [x] 1.4 檢查根 `AGENTS.md` / `CLAUDE.md` 的 sub-file 表是否已涵蓋本主題（`product / frontend / deploy contract` 列已指向 1.1 所在檔案）；已涵蓋則不新增列，並在 PR body 說明未改 `AGENTS.md` 的理由。

## 2. Launcher（owner：`scripts/dev/`、`scripts/tests/`）

- [x] 2.1 先寫 failing test `scripts/tests/test-isolated-branch-stack.ps1`：offset `0`／`4` 可解析，`5`／`48`／負值／非整數在 listener/cleanup 前拒絕；resolved port set 與保留集合交集非空即拒絕；未知 listener 不被停止；manifest PID／精確 launcher entrypoint／creation identity 任一不符即 fail closed；缺少或非法 `ChangeId`／`RunId` 拒絕，同 ID manifest collision 不覆寫；registry 與 doc 常數一致。
- [x] 2.2 實作 `scripts/dev/start-isolated-branch-stack.ps1`：`-Action start|stop|status -ChangeId <slug> -RunId <run-id> -Offset <int>`；三個 action 以同一 ID 定位唯一 manifest，只管理 governance/coordinator backend，依序執行「驗證 ID 與 0..4 → 解析與不相交檢查 → atomic 取得 run+offset reservation → reservation 內重驗 manifest collision/listener → 啟動 governance／health → 啟動 coordinator／health → manifest」。未知 listener或任何前置檢查未過皆不停止 process、不啟動服務；launcher 不管理 viewer。
- [x] 2.3 stack manifest 落 `artifacts/e2e/<change-id>/<run-id>/stack-manifest.json`，欄位至少含 `stack_kind`、`change_id`、`run_id`、`offset`、`ports`、`base_urls`、`head_sha`、`started_at`、`backend_ready`、`lifecycle_owners`，以及每個 backend 的 `pid`／精確 `entrypoint`／`creation_identity`；start 不覆寫既有 manifest。startup rollback 不完整時寫 recovery manifest 並保留 reservation；`stop` 原子保存 per-process 結果、可重試已自行退出且 port free 的 backend，完成後補 `stopped_at` 並釋放 recovery reservation。
- [x] 2.4 於 `scripts/script-registry.json` 新增登記；確認未新增任何 root-level `scripts/start-*.ps1`。
- [x] 2.5 跑 `pwsh -NoProfile -File .\scripts\tests\invoke-powershell-static.ps1` 靜態檢查與 2.1 的測試，全綠。
- [x] 2.6 Review hardening：launcher 直接執行先在固定安全 root 建 logger，再以 `StructLog.psm1` 記錄 schema-valid、phase=`closed` 的 terminal `script_run` lifecycle；safe-segment rejection 也要記錄，但 raw segment 不進入 log path/data。governance DB 與 coordinator session/event/outbox/ledger/IFC-ready store/storage 全部綁定 `artifacts/e2e/<change>/<run>/state/`，`STORAGE_ROOT`／host view／runtime root 同指 per-run storage，child env 明示覆寫 inherited deployment mutable paths。RED：缺 lifecycle helper；GREEN：success/failure/rejected-input canonical-schema assertions 與 `pwsh -NoProfile -NonInteractive -File scripts/tests/test-isolated-branch-stack.ps1` 通過。

## 3. Browser E2E 對接（owner：`web-viewer-sample/`）

- [x] 3.1 先寫 failing tests：require-real 缺 `E2E_STACK_MANIFEST`／其他前置條件時 hard fail；manifest path 在 worktree artifacts/e2e 外、path/content ID 不符或 `head_sha != HEAD` 時 config throw；forbidden-port watcher 命中保留集合時 fail；manifest coordinator base／viewer port 與對應 env 不一致時（含另一合法 offset）在 webServer/spec 前 throw。
- [x] 3.2 新增共用 helper `web-viewer-sample/e2e/support/isolated-stack.ts`：驗證必填 `E2E_STACK_MANIFEST` 的 worktree 路徑、change/run ID 與 HEAD identity，再由 manifest 解析 coordinator base 與 viewer port；env 只作相同值 compatibility assertion，不得 override；另提供 require-real 與 forbidden-port watcher。
- [x] 3.3 讓 `a4-closeout.spec.ts` 與 `a3-federated-session-chain.spec.ts` 改用 3.2 的 helper，移除各自檔頭手抄的 port 常數與 legacy runtime-availability skip；一般非 evidence discovery 可靜態略過 require-real specs，但 `E2E_REQUIRE_REAL=1` 下缺 manifest／fixture 仍 hard fail。斷言內容維持不變。
- [x] 3.4 `playwright.config.ts`：manifest coordinator base 與 resolved viewer port 都是 authority；`E2E_COORDINATOR_BASE_URL`／`E2E_VIEWER_PORT` 只可與 manifest 相同、不得覆寫，任何 mismatch 或保留集合命中即 throw。viewer lifecycle 僅由 Playwright `webServer` 管理；保留 `strictPort` + `reuseExistingServer:false`，require-real evidence 禁止 `E2E_DISABLE_WEBSERVER=1`，因外部 viewer 缺可驗證 build identity 時必須 fail closed。
- [x] 3.5 跑 `npm run typecheck` 與 `npx vitest run`，結果不得低於改動前 baseline（先記錄 baseline 數字）。
- [x] 3.6 先寫 failing test（RED）：3.2 的 helper 與 evidence manifest 必須揭露 `VITE_VIEWER_HARNESS` build flag 與 `?harness=1` query flag；harness run 不得被標為 coordinator review socket／authority ack 真實控制面證據。
- [x] 3.7 實作 3.6 的 harness 標示與 evidence eligibility 判定，再重跑該測試至 GREEN，並跑 `npm run typecheck`、受影響 Vitest 與適用 browser E2E；保留 RED／GREEN 指令及結果。P4 require-real Chromium 已於 `p4-final-20260730-115300` 執行；它在缺少 downloaded IFC-ready job 的既有 A4 前置條件 fail closed，該 product gap 仍由 5.2／5.3 記錄。
- [x] 3.8 Review hardening：require-real global setup 在 health 後以 manifest PID/command line/creation identity 重驗 governance/coordinator，resolved listener 必須位於逐節帶 creation identity、拒絕 PID-reuse chronology 且 snapshot 前重驗的 process lineage；reserved-port guard 同時監看 HTTP request/WebSocket 並安全忽略非 network URL；A4 success 保留 table-only、complete-table、signed-proof unavailable 與 issue-disabled assertions。RED：Vitest 43 項中 3 項失敗，另真 `pwsh` snapshot test 證明原 trailing argv 固定失敗；GREEN：targeted Vitest 44/44（含真 `pwsh`/CIM/listener）與 `npm run typecheck` 通過。

## 4. Machine gate（owner：`.github/`、`scripts/tests/`）

- [x] 4.1 在 `.github/workflows/agent-governance.yml` 新增一步執行 `scripts/tests/test-isolated-branch-stack.ps1`。
- [x] 4.2 確認 `scripts/verification-manifest.json` / `scripts/verify-all.ps1` 是否需要納入；若不納入，於 PR body 說明理由（避免把 branch-only harness 塞進 operator golden path）。
- [x] 4.3 對 `scripts/tests/test-agent-governance-check.ps1` 既有 dead-link／行數 gate 重跑，確認 1.1–1.3 的文件改動未破壞既有檢查。2026-08-11 於 HEAD `7929d74`（== origin/main，含 1.1–1.3 文件改動與 #488 skill-digest 系列）實跑 `pwsh -NoProfile -File scripts/tests/test-agent-governance-check.ps1`：45 pass／0 fail（含 AGENTS.md／CLAUDE.md 行數與 dead-link 斷言），前置 `test-agent-skills-sync` 11 pass／0 fail，最終輸出 `[test-agent-governance-check] all assertions passed`。註：此前同指令在本機出現的 agent-skill content drift 紅燈經診斷為 stale checkout 的 EOL 殘留（`.gitattributes` eol=lf 規則落地前 checkout 的工作樹檔案未被 re-smudge；index 兩側 blob 一致、main CI 同 HEAD 綠），以 `git cat-file blob` 重寫受影響工作樹檔案後即綠，非 repo 內容 drift、與 1.1–1.3 無關。

## 5. 首個 consumer 實跑（owner：本 change，唯讀對待 A4 實作）

- [x] 5.1 記錄啟動前 `:8004`／`:49102` 的 listener 狀態快照；用 2.2 的 launcher 起隔離 stack；記錄啟動後同樣快照，證明部署區未被改動。
- [ ] 5.2 以 require-real 模式對隔離 stack 跑一次既有 A4 browser E2E（`a4-closeout.spec.ts`），證明 harness 能產出 screenshot／trace／console／network 與 observed runtime IDs。
- [ ] 5.3 evidence 落 `artifacts/e2e/isolated-branch-stack-browser-e2e/<run-id>/`：`stack-manifest.json`、evidence manifest、截圖（依 repo 慣例需 `git add -f`）、trace 路徑；PR body 記錄精確 run ID。
- [x] 5.4 若 A4 現況在 require-real 模式下未通過，**記為 known gap 並交回 `a4-console-convergence`**；本 change 不修改任何 A4 前後端實作，PR body 誠實標示該紅燈是既有假通過被揭露，而非本 change 造成的回歸。fresh P5 run `p5-20260730-163713`（manifest head `eed43c8a17274a573121fc604fa61aae0f408f29`）再次由 6 個 Chromium cases 證實相同缺口：`no downloaded IFC-ready job is available`；該 run 未產生成功 evidence manifest、PNG screenshot 或 observed runtime ID，只產生失敗 `trace.zip`、video 與 error-context Markdown，因此 5.2／5.3 仍不得勾選。
- [x] 5.5 停 stack 後再取一次部署區 listener 快照，確認三次快照一致。

## 6. 收尾與誠實揭露

- [x] 6.1 執行 `npx openspec validate isolated-branch-stack-browser-e2e --strict` 與 `npx openspec validate --all --strict`，輸出貼進 PR body。
- [x] 6.2 第二輪 review repair 完成後，更新 `openspec/lifecycle-ledger.json`（本 change 的 task ledger 與 `subject_commit`）→ 再更新 `docs/plans/NOW.md` 的 projection → 再確認 `scripts/tests/test-ai-coding-metrics.mjs` 的 `active-change-wip` 期望值仍與 ledger 一致。三步順序不得顛倒。
- [x] 6.3 對 launcher 與 helper 涉及的既有符號跑 `gitnexus impact -d upstream -r AI-BIM-governance`；commit 前重跑 `gitnexus detect-changes --scope compare --base-ref main`。本輪 index stale at `8b34c8e` 且 FTS load-only unavailable，依 `docs/agents/gitnexus-usage.md` 走 unavailable gate並保留 raw-import/targeted-test reviewer sign-off，不宣稱 impact pass。
- [x] 6.4 第二輪 review repair 後，依 `scripts/SCRIPT_CONTRACT.md` 重跑 `.\scripts\deploy.ps1 -DryRun`（只作 operator-path 回歸，不是 deploy evidence）、`git diff --check`、secret scan 與 `git status`；generated cache 與非 evidence runtime artifact 不得進 change。
- [x] 6.5 第二輪 review repair 與最新 CI 完成後，更新 PR body 的 Change Classification、AI Coding Governance、known gaps 與最新 head/evidence run。PR body 已綁定 `a6bf2a75b315b17a01c5ac536ee8b0f9540980f2`、P4 run `p4-final-20260730-115300`，並記錄 current CI `30513445687` 的可執行 gates 通過與 external required-merge blocker。
- [x] 6.6 PR body 據實描述 design gate 歷史時間線與最新 job；不得以歷史 success 宣稱 current status，並以最新 diff 佐證未觸及 design manifest／baseline／R-A1 正本。current design job `90778536788` 通過且狀態仍為 `mixed`；`origin/main...HEAD` 未含 design authority path。
- [x] 6.7 PR body 以**摘要＋連結**指向 `proposal.md` 的相鄰缺口、對抗驗證與 A1–A10 記錄，明示其不構成本 change requirement。U 狀態須依提案現況誠實列示：U-1／U-3／U-4／U-5／U-6／U-11 pending；U-2／U-8／U-9 closed；U-7／U-10 partial；U-12 已併入 U-6。上述均不在本 PR 內實作。
