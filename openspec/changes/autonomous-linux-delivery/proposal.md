> **Priority: P0 — 目前最高優先治理項目**
>
> **Status: active**
>
> **Owner assumption（可推翻）**：允許一次性的 owner-controlled provisioning、settings cutover 與 live attestation；它只建立外部 machine trust root，不是未來逐 PR 的 approval。若 owner 不接受此一次性 bootstrap，本 capability 必須永久維持 `HELD`，不得自我授權。

## Why

目前交付鏈把每個 PR 的完成綁在人類 CODEOWNER exact-head approval；每次 finding repair 又會改變 head、使 approval／check／review 重新開始，造成長時間循環。使用者真正關心的是可運作的 Linux 交付結果，而不是逐一操作 GitHub review。現在需要把每 PR 人工審批替換成不可由 candidate branch 控制的 machine trust root，以 Draft-first、finding 批次修復、最多兩輪 exact-head review 與 head freeze 收斂 merge，並把 `DELIVERED` 定義為已 merge commit 在 canonical Linux 測試目標上的真實部署結果。

## What Changes

- **BREAKING**：`main` 不再要求每個 PR 取得 human／CODEOWNER approving review；CODEOWNERS 可保留為 ownership 文件，但不得再作 merge authority。
- PR finalization 採 Draft-first：ready 後凍結 candidate head，第一輪完整收集 findings 並至多推送一個批次修復 head；第二輪仍有 blocker 即 fail closed 為 `HELD`，不得無界修補／重審。第一輪無blocker或批次修復後第二輪通過source-pinned gate時，privileged finalizer必須在同一single-use lease內立即執行compare-and-swap merge，不再等待approval vote。
- CI／review findings 新增 closed disposition layer，由 merge queue agent 同時扮演 Review Disposition Agent：每個 finding 都必須以 exact-head evidence 裁決為 `ACCEPTED`、`FIX_REQUIRED`、`FALSE_POSITIVE`、`DEFERRED` 或 `ESCALATE`（舊值 `FIX`／`REJECT`／`ACCEPT_RISK`／`DEFER` 正規化），並在 thread 留下含隱藏 machine-readable metadata（finding_id／head_sha／agent_run_id／sender／webhook_event_id／disposition／evidence fingerprint）的 structured reply；完整 tuple 去重、marker loop guard 與 mutation 前後 exact-head reread 防止重複處理與自我觸發。`Resolve conversation` 表示裁決已完成，不表示一律修改 code。Confirmed in-scope blocker 必須 `FIX_REQUIRED`（repair head＋regression＋independent re-review）或 `ESCALATE`，`FALSE_POSITIVE` 必須有反證，`ACCEPTED` 只適用已在 head 處理或 policy 明定的 non-blocking risk，`DEFERRED` 必須 out-of-scope 且綁定 follow-up Issue，security／ACL／architecture／schema migration／deployment／production／credentials 類 finding 必須 `ESCALATE` 而不得 autonomous-merge。任何 agent assertion 都不能單獨滿足 merge gate。Source-pinned machine gate 只能在 disposition convergence 與 zero unresolved threads 之後、以該 head 最新 CheckRun 發布 success。
- 多PR batch的merge precedence由獨立唯讀subagent根據exact heads、ancestry、dependency與overlap evidence輸出machine-verifiable plan；human不得覆寫order。Plan必須標記predecessor與 `SKIP_SUBSUMED`，但不授予merge authority；每次merge後下一PR仍須在新base重新收斂與取得exact-head lease。
- 引入 repo 外、agent-inaccessible、base-pinned 的 machine trust root；它只接受 exact repository／PR／base SHA／head SHA，驗證 deterministic gates、完整 changed paths、risk-proportional 三層交叉對抗 verdict、required checks、conversation state 與 immutable candidate evidence，再由短效單 repo GitHub App credential 執行 exact-head merge。
- 禁止 candidate branch 修改或執行自己的 merge adjudicator；self-referential mechanism change 由 immutable external checker、獨立 machine authorization lane 與 merge 後 fixpoint 處理。trust root unavailable 時結果只能是 `HELD`，不得退回較弱自我驗證或要求逐 PR 人工 approval。
- merge 成功後才允許 trusted deployment authority 對該 merge commit 建立一次 immutable artifact，驗證 provenance 後以 owner-controlled repo-external inventory 唯一解析 canonical Linux 測試目標；pre-deploy、canary、promotion、post-deploy 與 rollback 全程只能消費同一 content digest。現有 `rebuild-test-deploy.ps1 -Build` → target-side `deploy.ps1 -Build` 仍是 operator execution boundary，但在 external artifact store、runner、credential broker 與 artifact-to-runtime readback 尚未完成 owner provisioning 前，repo workflow 只能輸出 `PROVISIONING_REQUIRED → HELD`，不得把 contract simulation 冒充 live deployment。
- 新增 machine-readable Linux Continuous Deployment state machine 與 terminal delivery record。成功路徑固定為 `TRUSTED_MERGED → BUILD_IMMUTABLE_ARTIFACT → VERIFY_ARTIFACT_PROVENANCE → RESOLVE_DEPLOYMENT_TARGET → PRE_DEPLOY_CHECK → DEPLOY_CANARY → VERIFY_HEALTH_SMOKE_E2E → PROMOTE → POST_DEPLOY_VERIFY → ACTIVATED → TERMINAL_DELIVERY_ATTESTATION`；canary、promotion或post-deploy failure必須先走 `ROLLBACK_TO_PINNED_KNOWN_GOOD_ARTIFACT → VERIFY_ROLLBACK → ROLLED_BACK`，若 pinned artifact／provenance／target／credential／rollback evidence任一不可證明則唯一為 `HELD`。對使用者公開的 outer `terminal_class` 仍只有 `DELIVERED|FAILED|HELD`；成功 activation 映射 `DELIVERED`，已驗證 rollback 映射 `FAILED` 並保留原始 merge／attempt，rollback 未驗證則映射 `HELD`。不得 reset／force-push main、重建舊 source假裝 rollback，或竄改已完成 merge 的事實。
- External verdict、artifact與merge authorization必須攜帶可驗證issuer／key／policy provenance、expiry、nonce與content digest；unknown／expired／revoked signer、未驗證artifact ACL、runner egress或output budget漂移一律 `HELD`。
- `spec-to-done` 仍為 explicit-only；Lane F/B/G 的日常開發不因此自動升級 Lane S。自動交付 authority 與 agent workflow lane 分離。
- 一次性 bootstrap 必須先建立並驗證 external trust root、required check source binding、短效 credential 與 canonical Linux deployment runner，最後才把 branch protection 的 required approving review count 調為 0、`require_code_owner_reviews=false`、`require_last_push_approval=false`；未完成正負 attestation 前不得宣稱 autonomous delivery 已啟用。Required App CheckRun 只有 actual `success` 可解鎖，`HELD`／incomplete／drift 不得以 `neutral` 或 `skipped` 滿足 required check。

## Capabilities

### New Capabilities

- `autonomous-linux-delivery`：定義從 exact-head machine adjudication、merge、fresh `origin/main` canonical Linux rebuild、post-deploy verification 到 terminal delivery record 的完整閉環。

### Modified Capabilities

- `ai-coding-governance`：以 external machine trust root、source-pinned required checks與 exact-head merge取代 required human／CODEOWNER approval，並定義一次性 bootstrap 與 fail-closed activation。
- `pull-request-review-agent`：從「只提供 evidence、不得取代 human approval」改為 machine merge gate 的受約束輸入；deterministic evidence 與三層交叉對抗 verdict 必須綁定 immutable base/head tuple，仍不得持有 merge credential。
- `test-deploy-rebuild-workflow`：將 canonical target 正規化為 owner inventory解析的 Linux 目標，並新增 merge 後自動 dispatch、commit identity、post-deploy gates與 terminal result 語意。

## Impact

- **Owning folders**：`.github/workflows/`、`agent-contracts/`、`scripts/{dev,lib,tests}/`、`scripts/verification-manifest.json`、`openspec/`、`docs/agents/`、`.claude/skills/`、`.codex/skills/`、`agent-skills-manifest.json`；GitHub branch protection／GitHub App／protected runner／private inventory 是 repo 外 provisioning，不由 candidate PR 或 agent credential管理。
- **External systems**：GitHub server-authoritative PR/check/protection state、單 repo GitHub App、owner-controlled trusted executor、canonical Linux test deployment target。
- **Breaking governance boundary**：移除 required human review 是明示的 policy change；approval bot／固定 User service account 不再是主路徑，也不得冒充 human review或 merge authority。
- **Skill migration**：repo-local `autonomous-pr-queue` 成為 named-PR finalization 主入口並實作兩輪收斂契約；`blip-approve` 降為 `LEGACY_GUARDED` rollback compatibility，不得在 `AUTONOMOUS_ACTIVE` 成為預設或必要 sub-skill。Claude／Codex mirrors與manifest必須同步；user-level安裝另走 main landing 後的 global maintenance，不由本 proposal 假定已啟用。
- **Data／event contracts**：新增 exact-head adjudication packet、machine verdict、merge observation與 terminal delivery record；不得包含 token、private inventory、raw environment value或 topology secret。
- **Runtime boundary**：產品 service ownership與 API 不變；部署 transport只重建已 merge `origin/main`，不鏡像外部 company cloud或 IFC Worker，也不改 production。
- **Self-referential boundary**：此 change 本身會修改 merge／verification／deploy mechanism surface，實作 PR 必須走既有 bootstrap ledger與 merge後 fixpoint；本 proposal 不構成 live設定、merge或部署授權。
- **Legacy migration**：activation 前已開啟的 PR（包含 PR #727）依舊gate完成，不得用 candidate spec 自行移除 protection；新 finalization path 只在 implementation 已由 `main` 提供且 external attestation／canary／closure 全部通過後啟用。
- **Non-goals**：不建立 production CD、不自動輪替 credential、不由transport停止／signal／restart canonical Linux owner runtime、不提供 admin bypass／force-push／`--admin` merge、不讓模型或 candidate code直接取得 merge／deployment secrets。
