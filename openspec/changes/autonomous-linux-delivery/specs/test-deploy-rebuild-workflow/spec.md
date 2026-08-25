## ADDED Requirements

### Requirement: Canonical Linux rebuild SHALL perform post-deploy verification for the exact delivered commit

成功執行 `scripts\deploy.ps1 -Build` 後，workflow SHALL 驗證deployment checkout、fresh `origin/main`與observed runtime commit都完全等於delivery transaction的exact merge commit，並依changed paths與verification manifest執行service health、適用API／integration、Kit／WebRTC first-frame／stage／DataChannel及artifact readback。Windows protected runner SHALL另以Chromium DPR1固定viewport完成適用pre-merge design gate，並在post-deploy透過owner-approved跨網段通道對相同non-secret Linux target ID執行browser operability。單一runner／service可讀、部分artifact存在或deploy exit 0 SHALL NOT單獨構成 `DELIVERED`；任一required gate失敗 SHALL回傳 `FAILED/MERGED_NOT_DELIVERED`，runner／network／authority缺失或不可判定 SHALL回傳 `HELD/DEPLOYMENT_BLOCKED`。

#### Scenario: Build與所有適用post-deploy gates通過

- **GIVEN**canonical Linux target已從freshly fetched `origin/main`完成build
- **WHEN**commit identity、service health與適用runtime verification plan全部通過
- **THEN**workflow SHALL產生綁定merge commit與deployed commit的passing delivery evidence
- **AND**required Windows browser evidence亦通過後，caller MAY將attempt標為 `DELIVERED/DELIVERY_VERIFIED`

#### Scenario: Build成功但runtime gate失敗

- **WHEN**`scripts\deploy.ps1 -Build` exit code為0，但任一required health、API、integration、browser、Kit runtime或artifact readback失敗或不可判定
- **THEN**workflow SHALL回傳non-success delivery conclusion
- **AND**caller SHALL NOT將attempt標為 `DELIVERED`
- **AND**result SHALL指出failed／held gate與redacted evidence reference

#### Scenario: Windows browser runner無法連到canonical Linux target

- **WHEN**適用的Windows protected runner、DPR／viewport、fixture、owner-approved跨網段path或non-secret target identity無法驗證
- **THEN**attempt SHALL以 `HELD/DEPLOYMENT_BLOCKED`結案
- **AND**Linux build／health success SHALL NOT替代browser evidence

### Requirement: Rebuild result SHALL be idempotent, attributable and secret-safe

Workflow SHALL在per-repository single-flight delivery lock內執行，並以delivery／attempt IDs、PR、base/head、完全相等的merge／fetched `origin/main`／deployed commits、non-secret target ID、Linux／Windows runner IDs、command ID、timestamps、attestation issuer／key ID與artifact digests建立可歸因record。對同一input與已成功deployed commit的重複request MAY安全read back既有evidence，但 SHALL NOT重寫failure event、合併不同PR歸因或繞過required verification；retry SHALL建立linked attempt。GitHub／對話可見輸出 SHALL NOT包含repo-external inventory、credential、raw env、host、user、internal path或private topology。

#### Scenario: 相同delivery request被重送

- **GIVEN**相同delivery ID、merge commit、target descriptor與verification plan已有完整passing record
- **WHEN**dispatcher收到重複request
- **THEN**workflow MAY驗證runtime與artifact仍符合後回傳相同attributed result
- **AND**它 SHALL NOT建立第二個不相干delivery lineage或跳過readback

#### Scenario: Result含private topology或secret-like value

- **WHEN**deploy log、inventory或runtime output含credential、raw env、host、user、path或private topology
- **THEN**publisher SHALL redact或拒絕該輸出
- **AND**sanitized record SHALL只保留non-secret target ID、result與owner-controlled artifact reference
- **AND**redaction無法驗證時 SHALL NOT輸出 `DELIVERED`

## MODIFIED Requirements

### Requirement: 測試部署區重建 SHALL 只使用 fixed deployment checkout 與 fresh origin/main

測試部署區重建流程 SHALL 由attested transport bundle內的 `scripts\dev\rebuild-test-deploy.ps1 -Build -InventoryPath '<repo-external target.local.json>'` 觸發。流程 SHALL 從registry與owner-controlled repo-external inventory唯一解析 `role=canonical_test_deploy` 的Linux target及其fixed owner-controlled deployment checkout，並在任何reset／rebuild前freshly fetch `origin` with `+refs/heads/main:refs/remotes/origin/main`。Credential-bearing broker SHALL只建立target-scoped opaque lease；candidate runtime不得取得raw inventory、SSH material或broker environment。Transport SHALL NOT上傳、下載、覆寫或在output揭露private inventory。若target缺失／歧義、不是Linux、ownership無法證明、fresh commit不完全等於expected merge commit或fetch失敗，流程 MUST fail fast並回報sanitized blocker；流程 SHALL NOT使用ancestor包含、stale `origin/main`、`local-windows`、目前worktree、任意替代路徑或sub-repo啟動命令。

#### Scenario: fetch 成功後 deployment checkout reset 到 origin/main

- **GIVEN**repo-external inventory解析出唯一canonical Linux target與owner-controlled deployment checkout
- **WHEN**操作者或trusted dispatcher要求測試部署區重建且 `origin/main` fetch成功
- **THEN**deployment checkout SHALL收斂到freshly fetched `origin/main`
- **AND**流程 SHALL在reset前回報local changes的sanitized摘要與ownership evidence
- **AND**流程 SHALL證明fresh origin/main commit完全等於expected delivery merge commit
- **AND**流程 SHALL NOT從目前development worktree直接啟動服務

#### Scenario: fetch 失敗時停止且不部署 stale code

- **WHEN**canonical target缺失／歧義、target不是Linux、checkout ownership不可證明，或 `origin/main` fetch因network、auth或remote error失敗
- **THEN**流程 MUST停止並回報sanitized blocker
- **AND**流程 SHALL NOT reset到既有stale tracking ref
- **AND**流程 SHALL NOT執行 `scripts\deploy.ps1`
- **AND**流程 SHALL NOT改用 `local-windows`、目前worktree或替代target
- **AND**因authenticated target command尚未啟動，caller SHALL以 `HELD/DEPLOYMENT_BLOCKED`結案

### Requirement: 測試部署區 SHALL 移除 agent/tooling 與非 runtime 文件目錄

Canonical Linux deployment checkout reset／clean後，流程 SHALL移除所有層級 `AGENTS.md`／`CLAUDE.md`，以及root `.codex/`、`.agents/`、`.agent/`、`.claude/`、`.cursor/`、`.windsurf/`、`.github/skills/`、`.github/prompts/`、`docs/`、`openspec/`、`patches/`。流程 SHALL保留 `.github/workflows/` 與production runtime必要檔案，例如 `scripts\deploy.ps1`、services、tests、compose files及inventory明定但不受source transport管理的owner-controlled assets。清理 SHALL限定於已解析、已驗證ownership的deployment checkout，不得操作inventory或其他host path。

#### Scenario: 清理後 deployment checkout 不含 agent/planning artifact

- **WHEN**已驗證ownership的canonical Linux deployment checkout含有 `AGENTS.md`、`CLAUDE.md`、`.codex/`、`.agents/`、`.claude/`、`.github/skills/`、`.github/prompts/`、`docs/`、`openspec/`、`patches/`
- **THEN**流程 SHALL移除上述source-controlled檔案與目錄
- **AND**`.github/workflows/` SHALL仍存在
- **AND**`scripts\deploy.ps1`與required production assets SHALL仍存在，否則流程 MUST fail before deploy
- **AND**repo-external inventory與owner-controlled transport assets SHALL NOT被刪除或覆寫

#### Scenario: Cleanup target ownership無法證明

- **WHEN**resolved cleanup path不在inventory綁定的deployment root內，或雙快照ownership evidence不一致
- **THEN**流程 SHALL在任何recursive cleanup前停止
- **AND**流程 SHALL回報target-scoped blocker而不列出private topology
- **AND**caller SHALL以 `HELD/DEPLOYMENT_BLOCKED`結案

### Requirement: 測試部署區重建 SHALL 只透過 deploy.ps1 -Build 拉起環境

清理完成後，流程 SHALL先執行不改變runtime state的read-only port／process blocker preflight，再從inventory解析且已驗證ownership的canonical Linux deployment checkout執行 `scripts\deploy.ps1 -Build`，並在owner-controlled artifact store記錄non-secret target ID、fresh origin/main commit、expected delivery commit、removed artifact count、deploy exit code與deploy log reference。流程 MUST NOT支援或使用 `-DryRun`、`-Force`或替代command取代 `-Build`。只有command已在authenticated exact target啟動後回傳非0，wrapper才 SHALL以同一exit code失敗並映射為 `FAILED/MERGED_NOT_DELIVERED`；command啟動前的authority／target／runner unavailable或read-only blocker映射為 `HELD/DEPLOYMENT_BLOCKED`。

#### Scenario: deploy.ps1 -Build 成功時回報部署結果

- **WHEN**canonical Linux deployment checkout清理完成且 `scripts\deploy.ps1 -Build` exit code為0
- **THEN**wrapper SHALL exit 0
- **AND**wrapper SHALL回報non-secret target ID、fresh origin/main commit、expected delivery commit、removed artifact count、deploy exit code與redacted log reference
- **AND**caller SHALL繼續執行post-deploy verification，而非僅以exit 0宣告 `DELIVERED`

#### Scenario: deploy.ps1 -Build 失敗時傳遞 exit code

- **WHEN**`scripts\deploy.ps1 -Build` exit code非0
- **THEN**wrapper SHALL回傳相同exit code
- **AND**wrapper SHALL回報redacted deploy log reference與failure context
- **AND**wrapper SHALL NOT改用 `-DryRun`、`-Force`或其他替代command
- **AND**caller SHALL將attempt結案為 `FAILED/MERGED_NOT_DELIVERED`

#### Scenario: host-native runtime blocker 只允許停止必要 blocking process

- **WHEN**啟動 `deploy.ps1 -Build` 前的read-only preflight發現必要port上已有blocking process
- **THEN**transport SHALL記錄non-secret port、process identity digest與blocker evidence
- **AND**transport SHALL NOT停止、signal、restart或取代canonical Linux上的任何process
- **AND**transport SHALL NOT啟動 `deploy.ps1 -Build`
- **AND**caller SHALL以 `HELD/DEPLOYMENT_BLOCKED`結案，等待owner在本automation之外處理runtime
- **AND**後續重試 SHALL建立new attempt並重跑同一條target-scoped `-Build`，不得改用 `-Force`／`-DryRun`

#### Scenario: Command啟動後在Phase 3回傳nonzero

- **WHEN**read-only preflight通過，且 `deploy.ps1 -Build` 已在authenticated exact target啟動後於Phase 3回傳nonzero
- **THEN**wrapper SHALL傳遞相同exit code與redacted failure evidence
- **AND**caller SHALL以 `FAILED/MERGED_NOT_DELIVERED`結案
- **AND**transport SHALL NOT把它重新分類為preflight `HELD`
