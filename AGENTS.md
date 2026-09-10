# AGENTS.md
## 0. 文件目的
本文件是 `AI-BIM-governance/` workspace 的 **agent 入口** — 定義 agent 行為對齊與 repo 邊界的 source of truth。為了控制每次 session 啟動的 context 預算，細節已 lazy-load 到 `docs/agents/*.md` sub-files。
衝突解析優先序：使用者最新明確指令 > 本文件（AGENTS.md） > `CLAUDE.md` > installed skills / generated wiki / generated skills。不要把「agent 指令優先序」和「runtime/product 行為真相」混在一起；後者見 §3。

## 0.0 Lean Governance & Subtraction Directive（元治理減法方針）
為避免「元治理反噬」與流程摩擦力過大導致開發停滯，全體 Agent 一律遵守減法原則：
1. **廢除 3-PR Demote/Reapprove 儀式**：禁止將 UI 變更拆成 3 個 PR，畫面改動與 Design Baseline 更新**一律在單一 PR 內同時交付**。
2. **凍結元治理工具自我修復循環**：禁止主動開立 Fixpoint rebuild、Classifier repair、Ledger reconciliation 等純治理工具 PR。非阻塞告警改為 Warning，不阻擋業務代碼交付。
3. **前端驗收以 Functional & Semantic E2E 為主**：著重於 Playwright 語意與功能驗收，放寬 1% 嚴苛 Pixel Diff 硬阻斷。
4. **並行 Writer 隔離原則**：repo 不以 writer 數量為 blocker；多個 writer 只可在各自獨立 sibling worktree、獨立 branch 與明確無重疊 touch-set 中並行，每個 task／branch 仍限單一 writer。同一 branch、同一 worktree 或 touch-set 重疊／未知一律停工排隊；`.agents/board` 只做感知，不具 lease／approval／merge authority；`direct_stack` 與 autonomous delivery 未有 canonical activation record 前保持 HELD。
5. **主工作區絕對乾淨與強制 Worktree 隔離（全體 Agent 永久鐵律）**：
   - **主工作區**永遠保持 `main == origin/main` 且無 dirty files；任何受版控檔案或 code 變更**一律在獨立 Worktree（`AI-BIM-governance.worktrees/<name>`）實作**。
   - 所有 Task 必須取得與變更相符的實測證據；docs/config/Skill 治理變更跑對應驗證，user-facing route/workflow 變更另須 **browser E2E 語意驗證（Codex App in-app browser）**；Kit/WebRTC 仍須真實 first-frame、Stage、DataChannel 與 ACK 證據；無實證數據絕不宣稱完成。全體 Agent（Codex、Claude、AGY、Grok）一體嚴格遵守。

## 0.1 Agent 工作方式
### AI Coding Governance Lanes

日常任務預設走 Lane F 或 Lane B；Superpowers 與 `spec-to-done` 是 opt-in，不是一般實作主線。不得只因任務「非平凡」、文字含「完成」、或 changed path 位於 code/tests 就升級 Lane S。

| Lane | 適用範圍 | 執行與驗證 |
|---|---|---|
| **F — Fast Fix** | 單一 service、約 1–3 檔、小 bug/docs/tests/timeout/logging/error handling；不改 contract、user workflow、security/deploy/migration/Kit/WebRTC | single coordinator；無 Superpowers/spec/plan/subagent；所有 tracked 修改使用獨立 sibling worktree；targeted tests；不自動 push/PR/merge；不強制 GitNexus impact |
| **B — Bounded Change** | 單一 service 內清楚且有限的功能；不改 architecture/public API/schema/security/deploy | single coordinator + 3–5 項 inline checklist；最多一個 debugger 或完成後一個 read-only reviewer；禁止 parallel writers；affected tests；對 task/主要 entry symbol 跑一次 GitNexus impact |
| **G — Governed Change** | 跨 ≥2 services、public API/event/DB schema、user-facing route/workflow、Kit/WebRTC/GPU、deploy/auth/permission/migration/destructive script、architecture boundary、GitNexus HIGH/CRITICAL | dedicated branch/worktree；簡潔 plan；GitNexus impact + detect_changes；按風險 reviewer/debugger/security_auditor；integration tests；user-facing browser E2E；PR local preflight |
| **S — Spec-to-Done** | 使用者明確輸入 `spec-to-done`、明確要求完整 Superpowers，或指定已核准 spec 並要求自主推進至 merged PR | 保留完整 P0/P1/P3/P4/P5/P6/P7；只能明確啟動，不得由模型自行升級 |
只有工作可安全平行、需要獨立風險檢查，或符合 Lane G/S 條件時才派 worker。coordinator 擁有所有寫入與最終決策；F 不派 subagent，B 禁止多個 writer 並行。多終端機／多 CLI（Claude Code、Codex、Grok）並行 session 以 gitignored `.agents/board/` 看板互相感知——所有 CLI 都明確執行開工 `node scripts/dev/agents-board.mjs register --agent <cli>`、動工前 `status`、收工 `done`；repo 不分發自動 command hooks。看板僅提供感知，不取代 Lane 隔離規則，契約見 `docs/agents/parallel-session-board.md`。

### Superpowers invocation policy
預設為 repo-native lean mode。Superpowers 重流程 skill 採 explicit-only；task complexity 不等於使用者授權，且單一 skill 不得自動串接下一階段。詳細 routing 見 `docs/agents/superpowers-invocation-policy.md`。

### Karpathy-style 工作守則
- Lane B/G/S 先列出假設、成功標準、最小改動面；若需求或 repo 邊界不清楚，先查 local source of truth，仍有重大分歧才釐清。
- 先判定 F/B/G/S；只有 G/S 或獨立風險檢查有實質價值時才 dispatch worker。最終回覆區分 verified facts / inferences / unverified risks。
- 優先採用能解決當前問題的最簡單方案；不要新增未要求的抽象、設定層、擴充點或 production dependency。
- 只修改與任務直接相關的檔案與程式碼；不要順手重構、格式化、刪除註解或清理不理解的既有內容。
- 每個實作切片都要能被驗證；完成時回報改動檔案、驗證指令、未跑測試原因與已知風險。
完整 task complexity tiers、reasoning effort routing、worker output contract、reviewer perspectives 與 evidence labels 見 `docs/agents/advanced-agent-reasoning-contract.md`。

### 產品定位與完成標準
- Windows worktree 使用 `scripts/dev/new-governed-worktree.ps1`，不得裸 fetch/add 取代。
- 需求入口是 `docs/plans/docs-plans-README.md`；code + tests 證明現況。前端修改先讀設計 §04、§08 R1–R4，保留 coordinator-only API 與凍結的後端邊界。
- Frontend、runtime、部署／重建或建立 worktree 前，必讀 `docs/agents/task-acceptance-and-isolation.md` 與適用的 `docs/agents/product-operability-and-script-contract.md`。canonical Linux deployment、owner-controlled inventory、ownership-gated process stop 與 Windows governed worktree helper 的完整命令／停點都在其中，不得自行替換。
- 真實 IFC viewer 驗收保留 fixture provenance、MinIO source identity、active session、first frame、正確 Stage、DataChannel、ACK；CPU pass、health、靜態 UI 不代表真實 3D。Frontend Functional & Semantic E2E、design fidelity 與 runtime evidence 分別取證。
- User-facing 回報列 route / button / fixture / 真 API / observed runtime ID / visible state / E2E / screenshot/trace / design gate / known gaps；無當輪證據不宣稱完成。不得 commit IFC 或大型 USDC。

### Secrets / `.env` 存取
- 允許：讀取 `.env`、讀寫 `.env.example`、由 `.env.example` 複製出 `.env`。
- 不允許：修改既有 `.env` 的實際機密值。
- Evidence 規則：agent 可為本機驗證載入 `.env`，但不得在回覆、log 摘要或 PR body echo 任何值；`.env` / `.env.example` 差異檢查預設只列 key 名稱與缺漏，不列值。
- 此 carve-out 僅覆蓋全域「不得修改環境檔」規則中關於本 repo `.env.example` 讀寫、`.env` 讀取與複製的部分；其餘 secrets / credentials / private keys 規則不變。
---
## 1. Workspace 範圍（一句話）
| Owning service | Boundary |
|---|---|
| `bim-review-coordinator` (:8004) | 唯一對外 IFC-ready intake、session/control 與 governance proxy |
| `bim-streaming-server` (49100/49101) | internal IFC→USDC authority、Kit/WebRTC runtime |
| `governance-service` (:49102 loopback) | A1/A2/A3 rules、diff、federation、issue/BCF |
| `web-viewer-sample` (:5173) | browser client；REST/Socket.IO 到 coordinator，WebRTC/DataChannel 到 Kit |
| `apps/kit-manager-web` / `services/kit-manager-api` (:8010) | operator UI、Kit fleet ops/telemetry |

公司雲端 `bim-control` 與客戶 IFC Worker 是外部服務；本 repo 不 mirror 或啟動。`tests/fakes` / `tests/contracts` 是 test-only doubles，`_worker` / `_bim-control` 已退役。改碼前定位 owning service、entrypoint、tests 與部署邊界。

完整 folder schema、§1.A 架構決策、§9–§11（Optional Mock Services / 最重要閉環 / 總結）見 `docs/agents/repo-boundary-detail.md`；per-repo 角色與禁止跨界規則（原 §3、§8）見 `docs/agents/repo-boundaries-per-service.md`；資料流 / 通訊 / source of truth（原 §4–§7）見 `docs/agents/repo-data-flow-and-ownership.md`。

歷史 `_worker` / `_bim-control` 退役脈絡見 `docs/agents/history-and-archive.md`。

---

## 2. Sub-files（lazy-load，何時讀哪份）
| 何時需要 | 讀這份 |
|---|---|
| 跨 sub-repo 決策、workspace 總覽、B 方案架構決策、最重要閉環 | `docs/agents/repo-boundary-detail.md` |
| 查個別 repo（coordinator/streaming/viewer/governance/kit-manager）角色、負責與不負責清單、禁止跨界規則 | `docs/agents/repo-boundaries-per-service.md` |
| 查資料類型與歸屬、核心資料流 mermaid、通訊方式邊界、Source of Truth 原則 | `docs/agents/repo-data-flow-and-ownership.md` |
| Frontend/runtime 驗收、部署重建、process ownership、Windows worktree 入口 | `docs/agents/task-acceptance-and-isolation.md` |
| Skill discovery 第三入口整合、main ignored 副本備份／隔離／還原 | `docs/agents/skill-discovery-migration.md` |
| 查 A1–A10 產品定位、frontend-operable done、真實 IFC E2E、script/deploy contract | `docs/agents/product-operability-and-script-contract.md` |
| 使用 `gh` CLI／處理 GitHub 認證、開 PR、處理 GitHub Actions、branch closeout | `docs/agents/github-workflow.md` |
| 修改 code symbol（function/class/method）、跑 impact analysis、commit 前 detect_changes | `docs/agents/gitnexus-usage.md` |
| 跑 sub-repo 驗證（pytest / npm test / build / Cloud VM 啟動） | `docs/agents/sub-repo-verify-commands.md` |
| 非平凡 / 高風險任務分級、worker dispatch、evidence labels、reviewer perspectives | `docs/agents/advanced-agent-reasoning-contract.md` |
| 判定是否可啟動 Superpowers、skill explicit-only、禁止自動串接、subagent 預算 | `docs/agents/superpowers-invocation-policy.md` |
| 看舊 PR / 退役服務 / 歷史 spec、quality/security gates，或 AI coding telemetry、privacy 與四週品質指標 | `docs/agents/history-and-archive.md`、`docs/agents/quality-security-gates.md`、`docs/agents/ai-coding-metrics.md` |
| 查需求入口、服務邊界、route IA、API 契約、時序、資料模型、實作分期、AI Coding 交付守則 | `docs/plans/docs-plans-README.md`（入口）→ `AI-BIM 前後端設計文件.dc.html` §01–§08 |
| 需要依任務種類／難度選擇 Codex workflow、subagents、模型 lane，或使用 `use agents` / `subagents` / `swarm` 開發 `docs/plans` 需求 | `docs/agents/codex-loop-workflows.md` |
| 多終端機／多 CLI 並行 session 看板（明確 register/status/done、選用 Codex notify）、指揮官模式（commander session）與跨 session 傳訊邊界 | `docs/agents/parallel-session-board.md` |
| 查 Parallel Delivery Fabric 的隔離、admission、evidence、promotion 與 activation 邊界 | `docs/agents/parallel-delivery-fabric.md` |
| PR 變更對象包含驗證機制本身（deploy path / evidence harness / gate script）、bootstrap ledger 欠帳 | `docs/agents/self-referential-bootstrap.md` |
| PR review finding disposition、convergence 八 state、bounded retry、base-sync 四例外與計數、`verify-all -BaseRef/-Tier` 本機 preflight | `docs/agents/pr-convergence-agent.md`（正本 `docs/plans/agent-hooks-ci-convergence-redesign.md`）|
| 要改任何 required status check 的名稱、把 job 改成 matrix / reusable workflow、或動 branch protection | `docs/agents/required-check-change-runbook.md` |
| 新增／修改 repo 治理規則（機器可讀 artifact 的結構規則、rule ratchet、PINNED 承重規則） | `docs/agents/agent-governance-policy.md` |
| 查 domain vocabulary、GitHub issue workflow 或 triage labels | `docs/agents/domain.md`、`docs/agents/issue-tracker.md`、`docs/agents/triage-labels.md` |

新增 sub-file 時：先在 `docs/agents/` 建檔，再更新本表；`AGENTS.md` 是唯一 sub-file index，`CLAUDE.md` 透過 `@AGENTS.md` 匯入，不另行同步 index。本文件行數預算 ≤ 250 行（目標 ≤ 200）；CLAUDE.md ≤ 130 行（目標 ≤ 100）。預算規範見 spec `agent-doc-context-budget`。
---
## 3. 探索輔助與 Source of Truth
Agent instruction priority 見 §0；以下是不同用途的 runtime/product 行為真相優先序。`docs/plans/` 描述目標需求與驗收語意；與 source/tests 不一致時標成 implementation gap，不得用 docs 宣稱 runtime 已完成。

Runtime/product 行為真相優先順序：
```txt
1. 程式碼實作
2. 可執行 tests / contracts 文件
3. docs/plans 設計與規格文件（目標行為 / 驗收語意）
4. AGENTS 邊界定義（本文件 + docs/agents/*.md sub-files）
5. generated wiki / generated skills / old evidence（若存在）
```

沒有 generated wiki；Lane F 直接查 source，B/G/S 陌生 code 可用 GitNexus CLI query/context。codebase-memory 僅為已授權範圍的 advisory 第二意見；UNKNOWN、圖譜衝突或 stale 時回原始碼裁決，不能取代 required risk gate。
---
## 4. GitNexus 入口

### 驗證與回報

先跑受影響範圍的 typecheck、lint、unit/integration checks，再依 `docs/agents/sub-repo-verify-commands.md` 擴大驗證。回報必須分開列出 verified facts、inferences、unverified risks 與 next actions；未跑的測試與原因不得省略。


本 repo 由 GitNexus 索引。Lane F 不強制 impact；Lane B 對 task/主要 entry symbol 跑一次 batch impact，只有實際改 code symbol/flow 時才在完成前跑 detect_changes；Lane G/S 對 shared/exported symbol 改前跑 impact、commit 前跑 detect_changes。HIGH 必須明確回報補強策略；CRITICAL 必須取得 sign-off。若 stale/unavailable/linked-worktree diff 失真，依 `docs/agents/gitnexus-usage.md` 揭露，不得自行發明 pass。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence (CLI-only)

Grok / Claude / Codex 依上方 Lane 範圍使用 reviewed GitNexus 1.6.9 shell CLI；不得啟動 MCP／setup 或依賴 gitnexus resources。不要把過時的索引統計當 current evidence。

- 適用 code-symbol gate 時，在本 worktree 驗證 exact-path index 與 indexed commit == HEAD；impact HIGH 必須說明補強，CRITICAL 仍需 sign-off。
- 只有已授權的 required stale/missing gate 可執行 `npx gitnexus@1.6.9 analyze --index-only`。不得自動改全域安裝、使用 embeddings 或改另一 checkout。
- CLI 語法、Skill 路由與 unknown/fallback 契約見 `docs/agents/gitnexus-usage.md`；缺證據須揭露，不可自稱 pass。
<!-- gitnexus:end -->
