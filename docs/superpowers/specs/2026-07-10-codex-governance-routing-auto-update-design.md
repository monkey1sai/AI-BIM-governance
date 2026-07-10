# Codex 治理、角色路由與無人值守更新設計

日期：2026-07-10
狀態：使用者已核准設計方向，待書面 spec review
範圍：Windows global Codex 設定與 `AI-BIM-governance` repo-local overlay

## 1. 背景

使用者要求依既有 Codex 使用習慣，整合並優化：

- global 與 repo-local `AGENTS.md` 治理；
- `config.toml`、profiles、custom agents、model 與 reasoning effort；
- 依 task tier 與風險自動派發角色的 workflow；
- Codex CLI、plugins 與 allowlisted skills 的無人值守自動更新；
- 備份、驗證、rollback 與可追溯報告。

使用者已明確核准以下高風險邊界：

1. CLI、plugins、skills 可由排程無人值守套用更新。
2. Skills 僅限 OpenAI，或已由 foreground onboarding 寫入 allowlist 且候選版本鎖定 exact SHA 的 marketplace／第三方來源；installed 不等於 trusted。
3. 來源不明、無法 pin、hash 不符、或新增 setup/install script、hook、MCP、connector、open-world/destructive tool、permissions 擴張時，停止該候選並產生告警，不自動放寬邊界。

## 2. 已驗證現況

本設計以 2026-07-10 的 live machine state 為基準：

- Codex CLI 為 `0.144.1`，`codex doctor --summary` 可載入真實 `C:\Users\IOT\.codex` config、auth 與 MCP。
- Global default 為 `gpt-5.6-sol`；盤點期間使用者／外部 UI 將 effort 從 `ultra` 改為 `high`，本設計保留目前的 `high`。
- 本機 model catalog 顯示：
  - `gpt-5.6-sol`：`low, medium, high, xhigh, max, ultra`
  - `gpt-5.6-terra`：`low, medium, high, xhigh, max, ultra`
  - `gpt-5.6-luna`：`low, medium, high, xhigh, max`
- 四個 inline `[profiles.*]` 已不相容目前 CLI；`codex --profile dev mcp list` 明確要求改成 `$CODEX_HOME/dev.config.toml` 類獨立 profile files。
- `desktop.git-always-force-push = true` 與 global AGENTS 的保守 Git 規則衝突。
- `default_permissions` 與 `sandbox_mode`／`[sandbox_workspace_write]` 混用，另有 legacy `:project_roots` 與 `"none"` permission tokens。
- Global SessionStart hook 會注入 codebase-memory-first 指令，與本 repo 的 GitNexus-first 規則衝突。
- Global custom agents 均為 read-only，但仍固定在 GPT-5.5。
- `agents.max_threads = 16` 高於官方預設 `6`；`max_depth = 1` 合理。
- 現有 `Update-CodexPrioritySkills.ps1` 直接追蹤 moving `main`、下載 branch ZIP、覆寫 live skills、執行上游 gstack setup 與 npm install，沒有完整 dry-run、transaction、lock、health gate 或全批次 rollback。
- 現在沒有啟用中的 Codex／skill／plugin Windows 自動更新排程。
- `.codex/skills`、`.agents/skills`、lock/state 與 sync script 已漂移，不能直接把現有 inventory 當成可信更新 manifest。
- Repo root `AGENTS.md` 與 `CLAUDE.md` 的既有未提交差異只有 GitNexus 自動統計更新；main 上另有使用者 `.env.example` 變更，實作不得覆蓋。

## 3. 設計目標

1. Global 只保存跨 repo 通用治理；repo-local 只保存 AI-BIM 產品、服務、部署與驗收 overlay。
2. Exact model slug 與 effort 只存在於 global profile／custom-agent config，不在 repo skills 或多份 Markdown 重複硬編。
3. Task tier、role dispatch、worker scope、evidence contract 與 stopping rule 有單一通用真相來源。
4. 小任務維持 single-agent；高風險任務得到獨立 verifier／risk reviewer，而不讓所有任務自動 fan-out。
5. CLI、plugin、skill 更新均使用 deterministic updater，不由 unattended model 自主判斷或執行任意下載程式。
6. 每個更新單位可獨立 stage、驗證、commit state 或 rollback；crash 後可恢復。
7. 不修改 secrets、不輸出 token 值、不自動擴張 filesystem、network、hook trust 或 tool approval。
8. 不新增 production dependency。

## 4. Non-goals

- 不清理歷史 rollout/session 檔案；該容量問題另案處理。
- 不自動登入、登出、重建 auth 或 MCP credentials。
- 不自動接受新 hook hash、MCP、connector、destructive/open-world capability。
- 不把 machine-level updater 或個人 skill inventory 寫進 AI-BIM production runtime。
- 不在本設計階段修改 global config、建立 Scheduled Task 或套用更新。

## 5. Source-of-truth 分層

### 5.1 Global

| 檔案 | 唯一職責 |
|---|---|
| `C:\Users\IOT\.codex\AGENTS.md` | 短版 shared core：語言、安全、task contract、證據、dispatch trigger、self-maintenance lazy-load index |
| `C:\Users\IOT\.codex\docs\agents\task-routing.md` | 通用 task tier、workflow mode、role dispatch 與 output contract |
| `C:\Users\IOT\.codex\docs\agents\maintenance.md` | Global config／CLI／plugin／skill 更新、rollback 與驗證契約 |
| `C:\Users\IOT\.codex\config.toml` | Default model、permissions、features、MCP、plugin、agent concurrency |
| `C:\Users\IOT\.codex\<profile>.config.toml` | 可選 session lane，不再使用 inline `[profiles.*]` |
| `C:\Users\IOT\.codex\agents\*.toml` | Custom role、model、effort、permissions 與 role-specific instructions |
| `C:\Users\IOT\.codex\skills\codex-governance-maintenance\` | 維護 workflow 的觸發與操作契約；實作前須依 writing-skills 做 RED/GREEN/REFACTOR |
| `C:\Users\IOT\.codex\bin\Invoke-CodexGovernanceMaintenance.ps1` | Deterministic Audit／Stage／Apply／Rollback engine |
| `C:\Users\IOT\.codex\maintenance\sources.allowlist.json` | Foreground-only trust root：source identity、允許的 distribution/path/capability baseline |
| `C:\Users\IOT\.codex\maintenance\sources.allowlist.sha256` | Foreground-only allowlist seal；排程只讀並交叉驗證 owner/ACL/hash |
| `C:\Users\IOT\.codex\maintenance\candidates\` | Scheduled Audit 產生的 immutable exact-version/SHA/hash candidates |
| `C:\Users\IOT\.codex\maintenance\applied-state.json` | Scheduled Apply 可寫的 current applied state |
| `C:\Users\IOT\.codex\maintenance\journal\` | Transaction/crash-recovery journal |

Global `AGENTS.md` 目標控制在約 120-160 physical lines。詳細流程 lazy-load，不在每個 session 重複注入。

既有 `C:\Users\IOT\.claude\docs\agents\loop-workflows-core.md` 只保留工具無關的 workflow mode 定義；`C:\Users\IOT\.claude\docs\agents\codex-loop-workflows.md` 縮成 compatibility pointer，指向新的 Codex routing source，不再重複 Codex trigger、角色或 model lane。

### 5.2 Repo-local AI-BIM overlay

| 檔案 | 保留內容 |
|---|---|
| `AGENTS.md` | 需求效力序、service boundaries、GitNexus-first、frontend-operable done、IFC fixture、deploy/PID、worktree、PR/CI 契約 |
| `CLAUDE.md` | Claude adapter 與 lazy-load index，不重複通用 task/effort/worker 規則 |
| `docs/agents/advanced-agent-reasoning-contract.md` | AI-BIM high-risk overlay 與 reviewer composition，不重複 global task tiers |
| `docs/agents/codex-loop-workflows.md` | AI-BIM task 類型映射到 global roles 與 repo-specific verification gates |
| `.codex/config.toml` | 本 repo 必要的 trusted project permissions/network overlay，不設定 model/effort |
| `.codex/skills/spec-to-done/SKILL.md` | Repo workflow adapter；移除過期 exact GPT slugs，改引用 role/capability lane |

目標行數：root `AGENTS.md` 150-180、`CLAUDE.md` 40-70、advanced overlay 40-70、Codex workflow overlay 50-90。

## 6. Global config migration

### 6.1 Safety and schema

- 將 `desktop.git-always-force-push` 設為 `false`。
- 將 compatibility alias `guardian_subagent` 遷移為 canonical `auto_review`。
- Permissions 僅保留 `default_permissions` 路徑，不再與 `sandbox_mode`／`[sandbox_workspace_write]` 混用。
- 將 `:project_roots` 改為 `:workspace_roots`。
- 將 permission value `"none"` 改為 `"deny"`。
- 保留 Windows elevated sandbox 作為 sandbox implementation，不等同 `danger-full-access`。
- 移除 current CLI 已標記 removed 的 feature overrides；不啟用新的 experimental feature。
- 移除 global codebase-memory SessionStart echo hook與 global AGENTS 內自動生成的 project-specific block；保留 MCP registration。
- `agents.max_threads = 6`、`agents.max_depth = 1`。

### 6.2 Profiles

移除 legacy inline `[profiles.*]`，建立：

| Profile file | Model | Effort | Permissions |
|---|---|---|---|
| `fast-fix.config.toml` | `gpt-5.6-terra` | `low` | `safe-workspace` |
| `dev.config.toml` | `gpt-5.6-sol` | `high` | `safe-workspace` |
| `deep-review.config.toml` | `gpt-5.6-sol` | `max` | `:read-only` |
| `net-install.config.toml` | `gpt-5.6-terra` | `medium` | `network-install` |

Default coordinator 保留 `gpt-5.6-sol` + `high`。`ultra` 不作 default/profile baseline，避免 automatic task delegation 與治理層顯式 dispatch 重複。

## 7. Role 與 workflow routing

### 7.1 Custom agents

| Role | Model | Effort | Default access |
|---|---|---|---|
| `explorer` | `gpt-5.6-terra` | `medium` | read-only |
| `debugger` | `gpt-5.6-sol` | `high` | read-only |
| `reviewer` | `gpt-5.6-sol` | `high` | read-only |
| `security_auditor` | `gpt-5.6-sol` | `max` | read-only |

四個 custom-agent TOML 使用 `default_permissions = ":read-only"`，並省略 `sandbox_mode`，避免從 parent 繼承 `default_permissions` 後又混入第二套 sandbox selector。

Built-in `worker` 可作 bounded implementation worker，但只在 coordinator 給定互斥檔案 scope 時寫入。Custom reviewers 不寫 tracked files。

### 7.2 Task routing table

| Task shape | Mode | Roles |
|---|---|---|
| Trivial／Simple | single coordinator | none |
| Source、docs、config、call-path discovery | classify-and-act | `explorer` when extraction is material |
| 一般 Non-trivial implementation | bounded execution + verification | coordinator／worker，完成後 `reviewer` |
| Bug、test failure、runtime incident | loop-until-done，最多 3 輪 | `debugger` -> coordinator fix -> `reviewer` |
| PR、architecture、E2E readiness | fan-out-and-synthesize | `explorer` + `reviewer`；runtime failure 時加 `debugger` |
| Auth、permissions、deploy、migration、destructive action | adversarial verification | `security_auditor` + `reviewer` |
| 開放式候選設計 | generate-and-filter／tournament | 2-4 個互斥 lens，coordinator 決策 |

每個 worker 必須回傳 `Scope`、`Evidence`、`Finding`、`Uncertainty`、`Risk`、`Next step`。高風險不可逆動作仍需使用者確認；無人值守更新只限本 spec 的 deterministic maintenance engine。

只有 `task-routing.md` 擁有通用 dispatch trigger table。Global `AGENTS.md` 只保存 lazy-load trigger；repo overlays 只能增加 role composition 或 verification gate，不得重述或收窄通用派發條件。Built-in `worker` 繼承 invoking profile 的 model/effort；需要不同 lane 時必須使用具名 custom role。Repo governance lint 必須拒絕 local Markdown/skills 新增 exact GPT slug。

### 7.3 AI-BIM overlay

- 跨 service/source-of-truth discovery：`explorer`。
- Kit/WebRTC/runtime incident：`debugger` + `reviewer`。
- Auth、deploy、permissions、destructive scripts：`security_auditor` + `reviewer`。
- PR、E2E、user-facing done：`reviewer`，並套用 frontend route/button/fixture/screenshot/trace evidence contract。
- 小型單檔或純 docs lookup：single-agent。
- GitNexus 是本 repo code change 的 impact/detect_changes authority；codebase-memory 僅 advisory。分歧時讀原始碼。

## 8. 無人值守 maintenance architecture

### 8.1 Components

```text
Windows Scheduled Task
  -> Invoke-CodexGovernanceMaintenance.ps1
     -> exclusive lock
     -> source manifest + prior state
     -> Audit candidate
     -> Stage exact artifact
     -> Validate provenance/capabilities/content
     -> Snapshot current unit
     -> Atomic Apply
     -> Health gates
        -> Commit state/report
        -> or Rollback + verify rollback + stop
```

Updater 是 deterministic PowerShell。它不呼叫 unattended model 決定是否信任來源，也不執行第三方下載內容中的 setup/install scripts。Official Codex CLI package 只允許 candidate manifest 中已存在於 accepted baseline 的 package lifecycle；新增或變更 lifecycle script 仍是 stop condition。

Scheduled Task 必須以絕對路徑啟動 `pwsh.exe -NoProfile -NonInteractive`，固定 `CODEX_HOME`、npm/node/codex executable path、working directory、Windows user SID 與 logon type。啟動時逐項驗證這些值，不得依賴互動 shell profile 或 ambient `PATH` 猜測目標 installation。

### 8.2 Schedule

建立兩個 current-user、least-privilege Scheduled Tasks：

| Task | Schedule | Action |
|---|---|---|
| `CodexGovernance-Audit` | 每日 02:30 Asia/Taipei | 唯讀 discover、pin candidate、stage metadata、產報告 |
| `CodexGovernance-Apply` | 每週日 03:30 Asia/Taipei | 套用最近 24 小時內通過 Audit 的 exact candidates |

共同設定：錯過排程則下次登入補跑；同時只允許一個 instance；最大 runtime 60 分鐘；網路不可用時記錄 failure 並等待下次排程；不使用最高權限執行。

### 8.3 Trust root and mutable state

人工 trust root 與排程可寫 state 必須分離：

| Artifact | Writer | Content |
|---|---|---|
| `sources.allowlist.json` | 只允許 foreground onboarding | stable id、kind、allowlisted registry/repository/path、tracked ref policy、machine-declared capability baseline、validator IDs、dependency cohort、CLI compatibility range |
| `sources.allowlist.sha256` | 只允許 foreground onboarding | Canonical allowlist bytes 的 SHA256 seal |
| `candidates/<run-id>.json` | Scheduled Audit | exact version/SHA、registry integrity/archive SHA256、staged tree hash、capability diff、candidate age |
| `applied-state.json` | Scheduled Apply | current applied version/SHA/hash、last success/rollback timestamp |
| `journal/<transaction-id>.json` | Scheduled Apply | phase、snapshot、cohort、error/rollback state |

`sources.allowlist.json` 是人工維護的 trust root，Scheduled Task 永遠唯讀。Apply 啟動時必須驗證 allowlist 的 absolute path、owner SID、ACL 與 foreground onboarding 記錄的 SHA256；任一不符即 fail closed。Updater 不得把 installed marketplace/plugin/skill 自動加入 allowlist。

Source-specific validator 只能用 updater 內建 allowlist 的 validator ID，不允許 JSON manifest 注入任意 command。排程可以把 allowlisted moving ref 解析成新的 exact SHA，但 Apply 只能使用 Audit 已鎖定、未超過 24 小時並通過驗證的 SHA artifact。

### 8.4 Transaction state machine

```text
discovered -> pinned -> staged -> validated -> snapshotted
-> applying -> verifying -> committed
                  |            |
                  +-> failed <-+
                         -> rolling_back -> rolled_back -> stopped
```

Journal 在每個 phase 前後 atomic write。下一輪若看到 `applying`、`verifying` 或 `rolling_back` 未完成，先恢復上一 snapshot，不開始新更新。

Manifest 必須定義 dependency cohort 與 CLI compatibility range。所有同 cohort candidates 先在同一 temporary `CODEX_HOME` 預驗證，再進入 live transaction：

1. Codex CLI exact version。
2. 單一 marketplace/plugin distribution。
3. 單一 skill source repo/SHA。

任一 cohort member 失敗時 rollback 整個 cohort並停止整批。只有 manifest 明確宣告為 independent，且已在 temporary `CODEX_HOME` 驗證與目前 CLI/plugin/skill 組合相容的 transaction，才可保留先前 commit。

## 9. 各類更新策略

### 9.1 CLI

- Audit 比較 installed version 與 official npm registry candidate，保存 exact version 與 integrity。
- Apply 前保存 root package、完整 platform optional dependency closure、npm shims、binary 與安裝前 tree hash；新舊兩套 closure 都必須在 local cache／staging，可離線 rollback。
- 先在 disposable npm prefix 完成新版本真實 install、health check、舊版本 rollback rehearsal與 tree-hash verification；任何一步失敗都不碰 live prefix。
- Live Apply 前列舉 executable path 位於 target npm package tree 的 active processes；只要仍有 Codex/Node process使用 target tree，就 defer candidate，不進入 `applying`，也不終止使用者 session。
- 套用後先驗證 `codex --version` 與 strict config health；失敗則還原舊 exact version。
- 不把 `latest` 字串直接寫入 applied state。

### 9.2 Plugin marketplaces/plugins

- Git marketplace candidate 解析成 exact commit SHA。Apply 不得呼叫 moving-ref `plugin marketplace upgrade`。
- 先在 temporary `CODEX_HOME` 以 `plugin marketplace add --ref <full-commit-SHA>` 建 staged snapshot，驗證 resolved HEAD 等於鎖定 SHA，再以已驗證 cache/config transaction 套用。
- 若 current CLI 無法 deterministic rebind 或 rollback 該 marketplace/plugin，candidate 必須 stop，不得降級成 branch refresh。
- 比較 plugin manifest、skills、hooks、MCP servers、apps/connectors 與 tool approval metadata。
- Machine-declared capability 未擴張且 source/cohort gates 通過的內容更新可自動套用；新增 hook/MCP/connector、destructive/open-world tool 或 permission expansion 立即停止。
- Hook hash 變更不自動 trust。
- Marketplace refresh 與 plugin enable 是不同 gate；更新不得自動啟用原本 disabled plugin。

### 9.3 Skills

- 先重建可信 inventory；同名但來源不明、local fork 或 duplicate name 不進 auto-apply allowlist。
- 從 exact commit SHA 下載／checkout staged tree，驗證 archive SHA256 與 content tree hash。
- 驗證 `SKILL.md` frontmatter、name collision、symlink/junction escape、script inventory、license/provenance 與 intentional local diffs。
- 新下載的 setup/install scripts 絕不由 updater 執行。
- Stop gate 只能保證 machine-declared capability 未擴張，不能判定任意自然語言或程式語意。Allowlisted、text/reference-only skill 的 exact-SHA 內容更新依使用者核准的 residual-risk policy 自動套用；任何 executable script/code 內容變更若沒有可驗證的 signed capability manifest，必須停在 staged 狀態。
- Apply 使用 sibling staging + rename/atomic swap；每個 skill source 有獨立 backup。
- Plugin-managed/system skills 由其 distribution 更新，不再另外複製成同名 standalone skill。

## 10. Stop conditions

以下任一條件使該 candidate 失敗、rollback current transaction，並停止整批：

- source 不在 allowlist、exact version/SHA 無法解析或 artifact/hash 不符；
- archive path traversal、symlink/junction escape 或來源子路徑不存在；
- 新增或擴張 machine-declared setup/install script、hook、MCP、connector、destructive/open-world tool；
- filesystem/network/approval/secret access 邊界擴張；
- TOML、JSON、YAML、agent、plugin 或 skill schema 驗證失敗；
- duplicate skill/agent name 或來源 collision；
- Codex doctor 新增 fail，或 warning 數／類型比 baseline 惡化；
- MCP、profile、plugin 或 feature health gate 退步；
- rollback package/snapshot 不完整；
- transaction journal 或 exclusive lock 狀態不一致。

既有 stale rollout warning 可作 accepted baseline，但不得新增 warning 類型或增加 fail count。

## 11. Backup、rollback 與 retention

- 第一次 global edit 前，依 self-maintenance protocol 建 `.bak-<timestamp>`。
- 每次 Apply 建 immutable snapshot，包含：
  - `AGENTS.md`、`config.toml`、profile files；
  - agents、rules、hooks 與 maintenance manifest/state；
  - 被更新的 skill/plugin metadata 與 content；
  - 舊 CLI root package、platform dependency closure、npm shims、binary、tree hash 與 staged rollback artifacts。
- 預設 rollback current dependency cohort；只有 manifest 宣告且已驗證為 independent 的前一 transaction 可保留。
- 保留最近 5 個完整 snapshot，且至少 30 天；若 snapshot 是唯一可用 rollback，不得由 retention job 刪除。
- Rollback 完成後重新跑相同 health gates；rollback 也失敗時寫 critical report並停用 Apply task，保留 Audit。

## 12. Verification gates

### 12.1 Global config/runtime

- TOML parse 與 current schema validation。
- `codex --strict-config doctor --summary`。
- `codex mcp list`。
- `codex features list`，不得保留 removed feature overrides。
- `codex plugin list` 與 marketplace inventory。
- `codex --profile fast-fix mcp list`。
- `codex --profile dev mcp list`。
- `codex --profile deep-review mcp list`。
- `codex --profile net-install mcp list`。
- Custom-agent TOML schema、model availability、supported effort 與 read-only guard。
- Repo/global routing lint：只有 `task-routing.md` 可定義通用 dispatch table；repo Markdown/skills 不得含 exact GPT slug。

### 12.2 Maintenance engine

- 使用 temporary fake `CODEX_HOME` 與 fake native commands 測試，不碰 live home。
- 覆蓋 happy path、hash mismatch、new capability、partial apply、process crash、active Codex process defer、dependency-cohort rollback、rollback success、rollback failure、stale candidate、allowlist ACL/hash mismatch、lock contention。
- CLI 測試必須在 disposable prefix 完成 full dependency closure 的 install/rollback rehearsal；不得只 mock npm output後宣稱 rollback 可用。
- 不依賴新增 Pester module；使用 repo／PowerShell 現有 assertion pattern。
- Skill authoring遵守 writing-skills：先用沒有新 skill 的 fresh-agent pressure scenario 取得 RED，再寫最小 skill，最後重跑 GREEN／REFACTOR。

### 12.3 Repo-local governance

- `scripts/tests/test-agent-governance-check.ps1` baseline 與 after 使用同一命令。
- Context budget／sub-file index／AGENTS-CLAUDE 集合檢查。
- `spec-to-done` skill scenario/eval。
- `git diff --check`。
- GitNexus `detect_changes`；docs/skill governance diff 必須符合 repo AI Coding Governance evidence contract。

Unattended path 不執行會把 private repo instructions 送往外部 model 的 smoke prompt。Model/session 行為另由 foreground、明確核准的測試驗證。

## 13. Reports and observability

每次 Audit／Apply 產生 JSON machine report 與 Markdown summary，存放於：

```text
C:\Users\IOT\.codex\maintenance\reports\YYYY-MM-DDTHH-mm-ssZ\
```

報告包含候選版本、exact SHA/hash、diff summary、capability diff、每個 gate、套用／跳過／rollback 結果、舊新版本與下一步。不得包含 secret values。

`last-run.json` 提供下一次 Codex self-maintenance session 快速判斷；失敗不得只寫 log 後回傳成功。Apply 失敗使用 non-zero exit code，Scheduled Task 保留失敗狀態。

## 14. Implementation slices

為避免同時改太多層而難以定位回歸，實作依序分成：

1. Global safety/config cleanup與 profile migration。
2. Custom agent model/effort routing。
3. Global AGENTS 與 lazy-loaded routing/maintenance docs slimming。
4. Repo-local AGENTS/CLAUDE/agent docs overlay slimming。
5. `spec-to-done` exact model slug removal與 skill eval。
6. Maintenance manifest + deterministic engine + fake-home tests。
7. Foreground trust-root onboarding、allowlist ACL/hash seal、CLI/plugin/skill dependency-cohort rehearsal。
8. Scheduled Task registration、missed-run／lock／rollback test。
9. Final doctor/profile/MCP/plugin/feature/repo governance gates。

每個 slice 都先備份、跑 baseline、只保留比 baseline 更好的結果；失敗即 rollback，不把多個假設混在同一輪。

## 15. Acceptance criteria

### 15.1 Mandatory enablement gates

以下條件必須全部通過，才能註冊或啟用 `CodexGovernance-Apply`：

- Global 與 repo-local governance 無相反的 subagent trigger、tool priority 或 Git safety 規則。
- Global config 使用 current canonical schema，force push 關閉，無 removed feature override。
- 四個 profile 均能由 CLI 載入。
- Default 與四個 custom roles 使用本設計的 GPT-5.6 model/effort lanes。
- `max_threads = 6`、`max_depth = 1`，小任務不 fan-out，高風險任務有獨立 verifier/risk reviewer。
- Repo AGENTS/CLAUDE 低於硬行數預算並接近目標，保留所有 AI-BIM product/deploy/E2E boundaries。
- CLI、allowlisted plugins 與 allowlisted skills 可由排程完成 exact candidate 的 unattended transaction。
- 未知來源、hash mismatch 或 machine-declared capability expansion 會停止並告警，不會套用。
- 人工 allowlist 與 mutable candidate/applied/journal state 已分檔，allowlist owner/ACL/hash mismatch 會 fail closed。
- CLI full dependency closure 已在 disposable prefix 完成 install/rollback rehearsal，active Codex process 會 defer live update。
- Plugin exact-pin algorithm 能 deterministic rebind/rollback；不能成立的 distribution 不進 auto-apply allowlist。
- Dependency cohort 能整組預驗證與 rollback；只有明確驗證為 independent 的 transaction 可保留。
- 每類 failure injection 都能 rollback；rollback 失敗會停用 Apply 而非繼續。
- 所有 global/repo verification gates 通過。

### 15.2 Fail-safe tests

Error card、rollback evidence、Apply 自動停用與 Audit 保留，只能證明 fail-safe 行為有效，不得替代任何 mandatory config、profile、provenance、transaction、rollback 或 Scheduled Task gate。

## 16. 主要風險

- CLI 自身更新可能改變 config schema；以 strict-config、profile gates與舊版 package rollback控制。
- Marketplace/skill 上游 compromise 仍可能提供語意惡意但未擴張 machine-declared capability 的純文字指令；deterministic updater不能證明任意文字或程式語意安全。Allowlist、exact SHA、text/reference-only 限制與 executable-code stop gate 可降低但不能完全消除此風險。
- 無人值守 updater 以使用者權限執行，任何 updater bug 都可能影響 global Codex home；以 fake-home tests、path containment、atomic swap、exclusive lock與snapshot控制。
- Global docs slimming 若移除必要 trigger，可能使角色不派發；以 task scenario matrix與 fresh-agent tests驗證。
- Repo-local auto-ship 規則過廣可能讓一般 coding request 自動 commit/push/merge；實作時必須縮到明確 `spec-to-done`／`ship-item` 或最新使用者明確要求。

## 17. 決策摘要

採用「交易式分批更新」而非整套 A/B home 或原地覆寫。Global high-quality coordinator 保留 `gpt-5.6-sol/high`，角色與 profiles 依工作性質降到 Terra/low-medium 或升到 Sol/max。通用治理收斂到 global，AI-BIM repo 只保留必要 overlay。排程可無人值守更新 CLI、plugins、skills，但 trust expansion 永遠是 stop condition，不能用自動化繞過。
