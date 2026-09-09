# P0 — intake

## 觸發與 args(主對話填;workflow 不自取)

使用者句型:「用 spec-to-done 跑 `docs/superpowers/specs/<檔>.md`,user-facing」。主對話補齊:

```
specPath     spec 絕對路徑(必填;不存在 → 停,要路徑)
slug         spec 檔名去掉日期前綴與 -design 後綴(例 2026-06-15-demo-feature-design.md → demo-feature)
dateStamp    今天 YYYY-MM-DD(主對話算;workflow 內禁時鐘/亂數 API)
branch       feat/<slug>(或 fix/ chore/;絕不在 main 開發)
userFacing   spec 是否含使用者可操作介面(看 spec;不確定當 true)
worktreeRoot worktree 的「絕對路徑」(P0 建立後填;std-*.js 都用它串路徑,不可相對)
executionMode `full`(預設)或 `evidence-closeout`;不得在 resume 時切換
changePath   `evidence-closeout` 必填:已核准 OpenSpec change 的絕對路徑
closeoutTaskIds `evidence-closeout` 必填:明確且不重複的 task IDs(禁 wildcard/整個 change)
fabricBindingPath Fabric-managed 必填:canonical binding packet 絕對路徑；standalone 必須省略
fabricPlanPath Fabric-managed 必填:目前 exact Fabric plan JSON 絕對路徑
fabricLeasePath Fabric-managed 必填:目前 exact ACTIVE/SUSPECT lease JSON 絕對路徑
fabricProviderSessionPath Fabric-managed 必填:目前 exact provider-session JSON 絕對路徑
expectedStatePath Fabric-managed 必填:binding-derived durable state 絕對路徑
```

每個新 run 固定同一組上限，跨 phase / retry / resume 累計，不得重設：

```
maxAgentCalls=40; maxP5VerifierBatches=2; maxP5Rounds=2; maxEvidenceAttempts=2
```
## P0 指揮官開場(主對話親自做)

1. 先判定 state profile：五個 Fabric args 必須全有或全無。全有時先以
   `scripts/lib/spec-to-done-fabric-binding.mjs` 的 `validateSpecToDoneFabricBinding` 驗 exact packet/current
   sources，並確認 `expectedStatePath`、branch、worktree、HEAD、slug/binding ID；任一漂移即 HELD，禁止
   fallback standalone。全無才走 legacy standalone。
2. `executionMode=full`:讀 spec 全文;自檢 placeholder / 內部矛盾 / scope 歧義 → **spec 矛盾 = HELD**(spec 是唯一忠實源,agent 不得擅自補)。
   `executionMode=evidence-closeout`:只在已核准 OpenSpec proposal/spec 明載 production / contract 已落地，且
   `closeoutTaskIds` 每一項都只需 evidence、docs 或該 change 的 task ledger 時成立。P0 逐 ID 做 scope lock；
   任一項仍需 production source、UI、public contract、dependency/config 變更，或語意不明，一律
   `HELD@P0 reason=scope_drift`，不得退回 full mode 自動擴張。`userFacing` 沿用 change 真實分類，不得為跳過 P4 改成 false。
3. 偵測隔離:`git rev-parse --git-dir` ≠ `--git-common-dir` → 已在 linked worktree,直接用(絕不疊加)。Fabric-managed 必須逐字使用 binding 的 branch/worktree，不得自行建立、沿用或切換；standalone 在主 checkout 時依 `docs/agents/github-workflow.md` 建立 repo-sibling worktree，禁止落在 repo 內 `.worktrees/`／`.claude/worktrees/`。
   - worktree 不帶 ignored/local artifact(storage/ 真 IFC、node_modules、.venv)— 讀主工作區絕對路徑或 worktree 內 `npm install`。
4. TodoWrite 建 P1–P7，Fabric-managed 同時記錄 binding ID／allowed paths，並記錄目前 `git rev-parse HEAD` 與四個固定上限。每次 native subagent / 等價 workflow
   只記實際 `codex:<session-or-agent-id>`，不得以 `native-*` 描述標籤代替。每個 phase 結束先累加計數，再寫 state(見 Resume)。
