> **Priority: P0 — 目前最高優先治理項目**
>
> **Owner assumption（可推翻）**：允許一次性的 owner-controlled provisioning、settings cutover 與 live attestation；它只建立外部 machine trust root，不是未來逐 PR 的 approval。若 owner 不接受此一次性 bootstrap，本 capability 必須永久維持 `HELD`，不得自我授權。

## Why

目前交付鏈把每個 PR 的完成綁在人類 CODEOWNER exact-head approval，且 `merge`、canonical Linux 測試部署與 post-deploy 驗證仍是分離事件；使用者真正關心的是可運作的 Linux 交付結果，而不是逐一操作 GitHub review。現在需要把每 PR 人工審批替換成不可由 candidate branch 控制的 machine trust root，並把 `DELIVERED` 收斂為已 merge commit 在 canonical Linux 測試目標上的真實部署結果。

## What Changes

- **BREAKING**：`main` 不再要求每個 PR 取得 human／CODEOWNER approving review；CODEOWNERS 可保留為 ownership 文件，但不得再作 merge authority。
- 引入 repo 外、agent-inaccessible、base-pinned 的 machine trust root；它只接受 exact repository／PR／base SHA／head SHA，驗證 deterministic gates、完整 changed paths、risk-proportional 三層交叉對抗 verdict、required checks、conversation state 與 immutable candidate evidence，再由短效單 repo GitHub App credential 執行 exact-head merge。
- 禁止 candidate branch 修改或執行自己的 merge adjudicator；self-referential mechanism change 由 immutable external checker、獨立 machine authorization lane 與 merge 後 fixpoint 處理。trust root unavailable 時結果只能是 `HELD`，不得退回較弱自我驗證或要求逐 PR 人工 approval。
- merge 成功後才允許由 trusted deployment host 針對 freshly fetched `origin/main` 執行 canonical Linux `rebuild-test-deploy.ps1 -Build`，使用 owner-controlled repo-external inventory；`origin/main` 與 deployed commit 必須 byte-for-byte等於該 delivery 的 merge commit。未 merge branch、額外 main commit、stale `origin/main`、local Windows target 與 production 均不得成為本 capability 的 `DELIVERED` 證據。
- 新增 machine-readable terminal delivery record；對使用者公開的 `terminal_class` 只有 `DELIVERED|FAILED|HELD`，細節使用 closed `reason_code`。只有 exact merged commit、Linux build、service health、適用的 API／integration／browser／Kit runtime gates與 artifact readback 全部通過才可輸出 `DELIVERED`。merge 成功但部署或驗證失敗必須輸出 `FAILED`／`HELD`，保留 last-known-good commit／runtime identity紀錄並開啟新的 repair cycle；v1不保證舊runtime仍持續運行或自動rollback，不得竄改已完成 merge 的事實。
- External verdict、artifact與merge authorization必須攜帶可驗證issuer／key／policy provenance、expiry、nonce與content digest；unknown／expired／revoked signer、未驗證artifact ACL、runner egress或output budget漂移一律 `HELD`。
- `spec-to-done` 仍為 explicit-only；Lane F/B/G 的日常開發不因此自動升級 Lane S。自動交付 authority 與 agent workflow lane 分離。
- 一次性 bootstrap 必須先建立並驗證 external trust root、required check source binding、短效 credential 與 canonical Linux deployment runner，最後才把 branch protection 的 required approving review count 調為 0；未完成正負 attestation 前不得宣稱 autonomous delivery 已啟用。

## Capabilities

### New Capabilities

- `autonomous-linux-delivery`：定義從 exact-head machine adjudication、merge、fresh `origin/main` canonical Linux rebuild、post-deploy verification 到 terminal delivery record 的完整閉環。

### Modified Capabilities

- `ai-coding-governance`：以 external machine trust root、source-pinned required checks與 exact-head merge取代 required human／CODEOWNER approval，並定義一次性 bootstrap 與 fail-closed activation。
- `pull-request-review-agent`：從「只提供 evidence、不得取代 human approval」改為 machine merge gate 的受約束輸入；deterministic evidence 與三層交叉對抗 verdict 必須綁定 immutable base/head tuple，仍不得持有 merge credential。
- `test-deploy-rebuild-workflow`：將 canonical target 正規化為 owner inventory解析的 Linux 目標，並新增 merge 後自動 dispatch、commit identity、post-deploy gates與 terminal result 語意。

## Impact

- **Owning folders**：`.github/workflows/`、`agent-contracts/`、`scripts/{dev,lib,tests}/`、`scripts/verification-manifest.json`、`openspec/`、`docs/agents/`；GitHub branch protection／GitHub App／protected runner／private inventory 是 repo 外 provisioning，不由 candidate PR 或 agent credential管理。
- **External systems**：GitHub server-authoritative PR/check/protection state、單 repo GitHub App、owner-controlled trusted executor、canonical Linux test deployment target。
- **Breaking governance boundary**：移除 required human review 是明示的 policy change；approval bot／固定 User service account 不再是主路徑，也不得冒充 human review或 merge authority。
- **Data／event contracts**：新增 exact-head adjudication packet、machine verdict、merge observation與 terminal delivery record；不得包含 token、private inventory、raw environment value或 topology secret。
- **Runtime boundary**：產品 service ownership與 API 不變；部署 transport只重建已 merge `origin/main`，不鏡像外部 company cloud或 IFC Worker，也不改 production。
- **Self-referential boundary**：此 change 本身會修改 merge／verification／deploy mechanism surface，實作 PR 必須走既有 bootstrap ledger與 merge後 fixpoint；本 proposal 不構成 live設定、merge或部署授權。
- **Non-goals**：不建立 production CD、不自動輪替 credential、不由transport停止／signal／restart canonical Linux owner runtime、不提供 admin bypass／force-push／`--admin` merge、不讓模型或 candidate code直接取得 merge／deployment secrets。
