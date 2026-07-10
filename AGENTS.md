# AGENTS.md

## 0. 文件目的

本文件是 `AI-BIM-governance/` workspace 的 **agent 入口** — 定義 agent 行為對齊與 repo 邊界的 source of truth。為了控制每次 session 啟動的 context 預算，細節已 lazy-load 到 `docs/agents/*.md` sub-files（見下方 index）。

衝突解析優先序：使用者最新明確指令 > 本文件（AGENTS.md） > `CLAUDE.md` > installed skills / generated wiki / generated skills。`docs/agents/*.md` sub-files 是本文件的 lazy-load 細節，不另成優先序層級。不要把「agent 指令優先序」和「runtime/product 行為真相」混在一起；後者見 §3。

---

## 0.1 Agent 工作方式

### Karpathy-style 工作守則

- 非平凡任務先列出假設、成功標準、最小改動面；若需求或 repo 邊界不清楚，先釐清再實作。
- 非平凡 / 高風險任務必須先做 task tier 判斷、worker dispatch 或明確說明不派 worker 的理由，並在最終回覆區分 verified facts / inferences / unverified risks。
- 優先採用能解決當前問題的最簡單方案；不要新增未要求的抽象、設定層、擴充點或 production dependency。
- 只修改與任務直接相關的檔案與程式碼；不要順手重構、格式化、刪除註解或清理不理解的既有內容。
- 每個實作切片都要能被驗證；完成時回報改動檔案、驗證指令、未跑測試原因與已知風險。

完整 task complexity tiers、reasoning effort routing、worker output contract、reviewer perspectives 與 evidence labels 見 `docs/agents/advanced-agent-reasoning-contract.md`。

### 產品定位與完成標準

- Repo 功能需求以 `docs/plans/docs-plans-README.md` §1 效力順序為準：`互動實作規格與標準對齊.md`（行為合約、22 條正典路由 A.1.1，最高效力）> `開發軌跡與執行計畫.md` > `設計規格.md` + 可點擊原型 `prototype.html`；A1–A10 建成狀態以 `design-system-對齊矩陣.md` §4.4 為唯一裁決源。
- 前端相關改動動工前必讀 `docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md` §1 後端凍結面契約（前端只打 coordinator `:8004`、proxy 路徑 byte-identical、禁改 governance `app.py`、coordinator `governanceProxy.ts`、streaming `conversion_authority.py` 等清單）。
- 主系統架構以 `https://bim-docs.jackshappybot.com/` 分頁「01 系統架構」的「BIM 模型管理平台 — 系統架構」為準：採雲端與客戶落地端分離，外部公司雲端是 control-plane，客戶落地端是 IFC / Kit / MCP runtime data-plane。
- `https://bim-docs.jackshappybot.com/` 分頁「05 BIM治理與模型檢核」中的 A1–A10 是本 repo 的 10 大主要開發項目；分頁「06 操作介面總覽」是使用者操作介面、按鈕、進度與可驗收流程的 UX 參考。
- 凡是 user-facing capability，不得以「後端 / API / 測試完成」宣告 done。完成標準必須是：使用者可從前端 route 操作，點明確按鈕，使用預設 fixture，看到 loading / success / failure / retry 與關鍵 runtime ID，並有 Playwright / Chrome E2E 截圖或 trace 證據。
- 最終回報 user-facing work 時必須列出並對齊 PR machine truth：Frontend route、Main button(s) tested、Fixture used、Visible success state、E2E command、Screenshot / trace、Known gaps；Frontend URL、Backend API called、Runtime action 可加列但不得取代前述 labels。
- 真實 IFC semantic viewer E2E 的核心輸入為主工作區 local `storage/` 內 IFC；new worktree 不會自動帶這些 ignored/local artifact，測試應讀主工作區絕對路徑或用 gitignored junction/symlink，不得把 IFC 或大型 `model.usdc` commit 進 repo。
- 不得宣告 full-system E2E complete，除非同時具備 governance CPU semantic E2E 與 Kit WebRTC visual/runtime E2E 證據。
- 當使用者要求「請測試部署區重建」或同義口令時，agent MUST 執行 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`；該 helper 會用 freshly fetched `origin/main` 重建 deployment checkout `D:\Users\deploy\AI-bim-geo`、排除 agent/tooling 檔案與 root `docs/`、`openspec/`、`patches/`，並從部署區執行 `.\scripts\deploy.ps1 -Build`。禁止使用 `-DryRun`、禁止使用 stale `origin/main`、禁止改用當前 worktree 或 sub-repo 啟動命令。
- 已授權但限縮：若 `deploy.ps1 -Build` 的 Phase 3 被外部 host-native runtime blocker（如 `kit.exe` / conversion `python.exe` 佔用 49100/49101 或 spectator ports）阻擋，agent 只能停止可由部署區 pidfile 或 command line / executable path 證明屬於 `D:\Users\deploy\AI-bim-geo` 的 PID tree，並記錄 port / PID / process name / ownership evidence 後重跑同一條 `-Build`。若只有 port/process-name 證據，先向使用者確認；不得改用 `-Force` / `-DryRun` 或停止無關非 runtime process。

完整 A1–A10 對應、frontend operability rule、真實 IFC E2E evidence contract 與 script contract 見 `docs/agents/product-operability-and-script-contract.md`。

### Secrets / `.env` 存取

- 允許：讀取 `.env`、讀寫 `.env.example`、由 `.env.example` 複製出 `.env`。
- 不允許：修改既有 `.env` 的實際機密值。
- Evidence 規則：agent 可為本機驗證載入 `.env`，但不得在回覆、log 摘要或 PR body echo 任何值；`.env` / `.env.example` 差異檢查預設只列 key 名稱與缺漏，不列值。
- 此 carve-out 僅覆蓋全域「不得修改環境檔」規則中關於本 repo `.env.example` 讀寫、`.env` 讀取與複製的部分；其餘 secrets / credentials / private keys 規則不變。


---

## 1. Workspace 範圍（一句話）

```txt
AI-BIM-governance/
├── bim-review-coordinator/   # 唯一對外 IFC-ready intake + Session / Control Plane（:8004）
├── bim-streaming-server/     # Internal IFC→USDC authority + Kit Runtime（49100/49101）
├── governance-service/       # A1/A2/A3 governance authority（:49102 loopback）
├── web-viewer-sample/        # Browser client（:5173）
├── apps/kit-manager-web/     # Kit Manager operator UI
├── services/kit-manager-api/ # Kit Manager API（:8010）
├── scripts/                  # deploy / verify / script contract
└── tests/{contracts,fakes}/  # 外部平台 contract + test-only fakes
```

```mermaid
flowchart LR
    EDGE["[外部] 客戶落地端 IFC Worker"]
    CLOUD["[外部] 公司雲端 bim-control"]
    CO[bim-review-coordinator]
    KIT[bim-streaming-server]
    GOV["governance-service（:49102 loopback）"]
    WV[web-viewer-sample]
    KM["kit-manager web + api（:8010）"]

    EDGE -->|POST /api/external/ifc-ready| CO
    CO -->|internal conversion request| KIT
    CO -->|/api/governance/* proxy| GOV
    CO -->|metadata-only callback outbox| CLOUD
    WV -->|REST + Socket.IO| CO
    WV -->|WebRTC + DataChannel| KIT
    KM -->|Kit fleet ops / telemetry| KIT
```

一句話定位：

```txt
[外部] 公司雲端 bim-control = control-plane 權威（本 repo 不 mirror）
[外部] 客戶落地端 IFC Worker = 外部 IFC 產出者（本 repo 不啟動）
bim-review-coordinator = 唯一對外 IFC-ready intake + Session / 協作控制中心
bim-streaming-server   = internal-only IFC→USDC conversion + Omniverse Kit / WebRTC runtime
governance-service     = A1 rule-run / A2 diff / A3 federation / issue / BCF loopback authority
web-viewer-sample      = Browser client / user interaction layer
apps + services        = operator-facing Kit Manager UI / API
tests/fakes + tests/contracts = 外部平台 test-only doubles，非 runtime profile
_worker / _bim-control = 已自 repo 刪除（2026-05-18 B 方案落地），僅 tests/fakes 模擬
```

完整 folder schema、§1.A 架構決策、§9–§11（Optional Mock Services / 最重要閉環 / 總結）見 `docs/agents/repo-boundary-detail.md`；per-repo 角色與禁止跨界規則（原 §3、§8）見 `docs/agents/repo-boundaries-per-service.md`；資料流 / 通訊 / source of truth（原 §4–§7）見 `docs/agents/repo-data-flow-and-ownership.md`。

歷史 `_worker` / `_bim-control` 退役脈絡見 `docs/agents/history-and-archive.md`。

---

## 2. Sub-files（lazy-load，何時讀哪份）

| 何時需要 | 讀這份 |
|---|---|
| 跨 sub-repo 決策、workspace 總覽、B 方案架構決策、最重要閉環 | `docs/agents/repo-boundary-detail.md` |
| 查個別 repo（coordinator/streaming/viewer/governance/kit-manager）角色、負責與不負責清單、禁止跨界規則 | `docs/agents/repo-boundaries-per-service.md` |
| 查資料類型與歸屬、核心資料流 mermaid、通訊方式邊界、Source of Truth 原則 | `docs/agents/repo-data-flow-and-ownership.md` |
| 查 A1–A10 產品定位、frontend-operable done、真實 IFC E2E、script/deploy contract | `docs/agents/product-operability-and-script-contract.md` |
| 開 PR / 處理 GitHub Actions / branch closeout | `docs/agents/github-workflow.md` |
| 修改 code symbol（function/class/method）、跑 impact analysis、commit 前 detect_changes | `docs/agents/gitnexus-usage.md` |
| 跑 sub-repo 驗證（pytest / npm test / build / Cloud VM 啟動） | `docs/agents/sub-repo-verify-commands.md` |
| 非平凡 / 高風險任務分級、worker dispatch、evidence labels、reviewer perspectives | `docs/agents/advanced-agent-reasoning-contract.md` |
| 看舊 PR、了解退役服務與歷史 spec 脈絡 | `docs/agents/history-and-archive.md` |
| 查需求效力序、正典路由 A.1.1、A1–A10 建成裁決（§4.4）、後端凍結契約（§1） | `docs/plans/docs-plans-README.md`（跳板）→ 各 plans 檔 |
| 需要依任務種類／難度選擇 Codex workflow、subagents、模型 lane，或使用 `use agents` / `subagents` / `swarm` 開發 `docs/plans` 需求 | `docs/agents/codex-loop-workflows.md` |

新增 sub-file 時：先在 `docs/agents/` 建檔，再同步更新本表與 `CLAUDE.md` index（兩份主檔的 sub-file 集合必須一致）。本文件行數預算 ≤ 250 行（目標 ≤ 200）；CLAUDE.md ≤ 130 行（目標 ≤ 100）。預算規範見 spec `agent-doc-context-budget`。

---

## 3. 探索輔助與 Source of Truth

本 repo 有兩條不同優先序，禁止混用：

- **Agent instruction priority**：使用者最新明確指令 > 本文件（含已載入的 `docs/agents/*.md` lazy-load 細節）> `CLAUDE.md` > installed skills / generated artifacts。
- **Runtime/product behavior truth**：程式碼實作與可執行測試 / contracts 描述目前行為；`docs/plans/` 描述目標需求與驗收語意；兩者不一致時不得用 docs 宣稱 runtime 已完成，必須標成 implementation gap。

Runtime/product 行為真相優先順序：

```txt
1. 程式碼實作
2. 可執行 tests / contracts 文件
3. docs/plans current decision ledger 與需求規格（目標行為 / 驗收語意）
4. AGENTS 邊界定義（本文件 + docs/agents/*.md sub-files）
5. generated wiki / generated skills / old evidence（若存在）
```

目前 checkout **沒有** generated wiki 產物（`docs/wiki/` 不存在；graphify corpus 已於 2026-06-10 移除）。分析 code / 陌生模組探索預設先用 GitNexus MCP（`query` / `context`，永遠查活圖譜）；`codebase-memory-mcp`（`search_graph` / `get_code_snippet` / `trace_path`）只能作為並列第二意見、加速定位後的 GitNexus 交叉確認，或 GitNexus UNKNOWN / crash / unavailable 時的 advisory fallback，不得取代 GitNexus-first discovery。兩者查無結果或有疑義時仍以 GitNexus 為準——**修改 code symbol 前的 `impact` 與 commit 前的 `detect_changes` 仍只由 GitNexus 判定**（見下方 §4）。**此「衝突時以 GitNexus 為準」不限 spec-to-done 內部流程，任何 session（含一般互動對話）都適用**：兩圖譜對同一 symbol 給出不同答案時，MUST 用 grep/Read 核對原始碼再下結論，不得逕自採信單邊「exact」標籤（2026-07-03 實測：GitNexus 曾對 `deriveIntakeFromKey` 假陰漏報全部 caller，已修；codebase-memory 對 `tick`/`run`/`init` 這類常見命名，曾把不同檔案的區域閉包誤併成同一節點、生出不存在的 CALLS 邊——兩者皆非 100% 準）。不得在 README、PR 或驗收報告把不存在的 wiki 寫成現有入口。任何導覽產物與實作不一致時，一律以實作為準。

---

## 4. GitNexus 入口

### 驗證與回報

先跑受影響範圍的 typecheck、lint、unit/integration checks，再依 `docs/agents/sub-repo-verify-commands.md` 擴大驗證。回報必須分開列出 verified facts、inferences、unverified risks 與 next actions；未跑的測試與原因不得省略。

前端驗收紀錄至少包含 route、button、fixture、API、runtime ID、visible state、E2E command、screenshot/trace 與 known gaps。

本 repo 由 GitNexus 索引。修改 code symbol 前 MUST 跑 `impact`；commit 前 MUST 跑 `detect_changes`；HIGH / CRITICAL risk 先回報再繼續。若 GitNexus stale / unavailable / linked-worktree staged diff 失真，照 `docs/agents/gitnexus-usage.md` 的 unavailable gate 處理，不得自行發明 bypass。

規範本文（Always Do / Never Do / Resources / CLI 表）以下方 `<!-- gitnexus:start -->` 自動維護區塊為準（`analyze` 時自動更新）；stale 重建與 LadybugDB crash 復原程序見 `docs/agents/gitnexus-usage.md`。  <!-- gitnexus:start --> # GitNexus — Code Intelligence  This project is indexed by GitNexus as **AI-BIM-governance** (17817 symbols, 28581 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.  > Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).  ## Always Do  - **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user. - **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`. - **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits. - When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance. - When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`. - For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).  ## Never Do  - NEVER edit a function, class, or method without first running `impact` on it. - NEVER ignore HIGH or CRITICAL risk warnings from impact analysis. - NEVER rename symbols with find-and-replace — use `rename` which understands the call graph. - NEVER commit changes without running `detect_changes()` to check affected scope.  ## Resources  | Resource | Use for | |----------|---------| | `gitnexus://repo/AI-BIM-governance/context` | Codebase overview, check index freshness | | `gitnexus://repo/AI-BIM-governance/clusters` | All functional areas | | `gitnexus://repo/AI-BIM-governance/processes` | All execution flows | | `gitnexus://repo/AI-BIM-governance/process/{name}` | Step-by-step execution trace |  ## CLI  | Task | Read this skill file | |------|---------------------| | Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` | | Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` | | Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` | | Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` | | Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` | | Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |  <!-- gitnexus:end -->
