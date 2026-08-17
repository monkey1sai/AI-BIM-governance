> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md（§0.1 AI Coding Governance Lanes）。
>
> Document type: runbook。這是 agent 操作指引，不建立 runtime/product behavior；後者以程式碼與可執行 tests/contracts 為準。
>
> 何時讀本檔：開 PR、處理 GitHub Actions failure、PR merge 後本地分支收斂時。

# GitHub Workflow（Lane-aware git 段）

Lane F/B 不使用 Superpowers，也不自動 push、開 PR 或 merge。當使用者明確要求 ship，或工作進入 Lane G/S 時，git 段固定 `branch → PR → Actions → merge`；不得直接在 `main` 開發。

| 工具 | 正確定位 |
|---|---|
| **Superpowers** | Lane S 的完整 spec-to-done；Lane G 可按需使用單一 planning/verification skill，但不是預設 |
| **GitNexus** | Lane B/G/S 的 code impact 與 scope intelligence；F 不強制 |
| **Browser E2E** | user-facing 變更的可見行為證據，可用 Playwright / gstack / supported browser engine |
| **Design fidelity** | 以 tracked design manifest/baselines 驗 screen/state；Windows runner 的 Chromium DPR1 兩 viewport pixel≤1%＋semantic 100% |
| **PR local preflight** | PR 前 affected-only machine gate，不是每次 local edit 的循環 |
| **Matt Pocock skills** | optional issue / triage 輔助 |

禁止（anti-patterns）：

- ❌ 因任務「非平凡」就把 F/B 升級成完整 Superpowers lifecycle。
- ❌ 用任何 planning/review skill 宣告 UI 完成而不跑 browser E2E。
- ❌ 用 browser E2E 取代 design diff，或用 design screenshot pass 取代真 API/runtime E2E。
- ❌ 用 GitNexus 當產品設計依據（2D 設計來自 approved pinned design reference，行為來自 TARGET/contracts，非 call graph）。
- ❌ 用 browser tool 改 backend symbol 而跳過 Lane G/S 的 GitNexus gate。

## `gh` CLI 認證與 sandbox 網路錯誤分流

`gh` 的安裝、credential 儲存與命令執行邊界是三件不同的事。同一個 Windows 使用者下，Codex、Claude、Grok 通常共用系統 credential store 中的 `gh` 登入；不得把 token 當成需要為每個 AI 重複安裝的元件。不同 AI、terminal、sandbox、container 或長駐 process 仍可能繼承不同的 PATH、Windows identity、`GH_CONFIG_DIR` 或環境變數，因此認證檢查必須在**實際執行 GitHub 命令的同一個 process boundary**內完成。

在重新安裝 `gh`、執行 `gh auth login/logout` 或 rotation 前，先跑最小唯讀 preflight：

```powershell
Get-Command gh -All
gh --version
gh auth status --active --hostname github.com
gh api user --jq .login
```

不得執行或記錄 `gh auth token`、`gh auth status --show-token`，也不得回印 token、proxy URL、CA bundle 內容或其他 secret。需要檢查 override 時，只回報下列變數名稱在 process / user / machine 層是否存在，不得顯示值：`GH_TOKEN`、`GITHUB_TOKEN`、`GH_ENTERPRISE_TOKEN`、`GITHUB_ENTERPRISE_TOKEN`、`GH_HOST`、`GH_CONFIG_DIR`、`XDG_CONFIG_HOME`。其中 `GH_TOKEN` / `GITHUB_TOKEN` 會優先於 credential store；launcher 變更後必須重啟長駐 AI process，避免沿用 stale environment。

錯誤必須依下表分流，不得只看 `gh auth status` 的 exit code 或 `token invalid` 摘要：

| 觀察結果 | 分類與下一步 |
|---|---|
| 找不到 `gh` 或解析到非預期路徑 | PATH / installation 問題；先確認唯一預期的 executable，不得先重建 token |
| `x509`、certificate、proxy、DNS、timeout、connection failure | TLS / network / sandbox 問題；以相同唯讀 API probe 在 owner-approved sandbox 外邊界交叉確認，或修正受管 proxy / CA trust |
| sandbox 內失敗、sandbox 外 `gh api user` 成功 | credential 有效；固定核准的執行邊界，不得 logout、login、reinstall 或 rotation |
| sandbox 外仍為 HTTP `401 Bad credentials` | 才可判定 credential 失效，依 owner-approved browser flow 重新登入 |
| HTTP `403` / `404` | account、repo permission、token scope 或 organization SSO 問題；不得用更廣的 classic PAT 猜測修復 |
| `git` 成功但 `gh pr` / `gh api` 失敗 | 分開檢查 Git SSH/HTTPS transport 與 GitHub API OAuth；一方成功不代表另一方有效 |

`gh auth status` 會向 GitHub 驗證 credential；在某些受限網路邊界，TLS / proxy 失敗可能被上層摘要或 agent 誤報成 token invalid。結論必須以原始 API / transport error 與 sandbox 外對照為準；只有 owner-approved 非 sandbox probe 也得到 HTTP 401，才允許宣稱 token 失效。

禁止以降低安全性繞過問題：不得設定 `GIT_SSL_NO_VERIFY=1`、停用 TLS、安裝來源不明的 root CA、使用 `--insecure-storage`、plaintext `credential.helper store`、把 PAT 寫入 remote URL / command line / log，或要求使用者在對話中貼 token。若可信 proxy / CA 尚未配置，狀態必須標為 `HELD: TLS trust unresolved`，改用核准的 sandbox 外 `gh` 執行邊界或交由 owner 修正信任鏈。

## 開分支前

- 從最新 `main` 建立功能 branch（例：`feat/<slug>`、`fix/<slug>`、`chore/<slug>`）；Lane G/S 或 checkout 不乾淨時用 dedicated worktree。
- Lane F：無 plan/spec/subagent，targeted test；checkout 乾淨時不強制 worktree。
- Lane B：只列 3–5 項 inline checklist，不建立 detailed plan；對 task/主要 entry symbol 跑一次 GitNexus impact。
- Lane G：簡潔 implementation plan + risk-scoped reviewer；Lane S 才使用完整 `writing-plans` / `subagent-driven-development` / spec-to-done。

## PR 與 merge

- 開 PR 前跑 affected validation 並回報結果；Lane B 只在 code symbol/flow 變更時跑 detect_changes，Lane G/S commit 前必跑。PR 由 GitHub Actions 做遠端確認，但不得把 Actions 當第一輪錯誤發現工具。
- **Local PR preflight 是硬 gate**：凡 GitHub workflow 可在本機等效檢查，必須先本機跑到綠再 push / watch CI；跳過本機 preflight 導致 PR 等待或重跑，視為嚴重開發時間浪費。最低要求：

  ```powershell
  .\scripts\dev\check-pr-local-preflight.ps1 -PrNumber <pr-number>
  ```

  此 wrapper 會讀指定 PR 的 `baseRefOid/headRefOid`、要求 local `HEAD` 精確等於 PR head，再用該組 SHA 的 merge-base changed paths 執行 `scripts/tests/check-pr-body-evidence.ps1`，接著在 repo-local `.tmp` 下跑 `scripts/pr-review-agent.ps1`（含 affected sub-repo verify，例如 viewer/coordinator/streaming/scripts）。若只是在診斷 GitHub 上既有 PR body gate，可暫用 `-ChangedPathsSource remote -SkipReviewAgent -SkipViewerVerify`；正式 push / CI watch 前不得跳過受影響的本機等效測試。
- **PR CI local-first policy**：PR 事件不得無差別重跑本機可重現的 heavy service checks。`.github/workflows/ci.yml` 先跑 `changed path classifier`，只有受影響的 service-level jobs（coordinator / viewer / governance-service / kit-manager / root contracts / compose / static / secret scan）才跑遠端確認；未受影響的 required job 以 job-level `if` skip，保留 check 名稱且避免 workflow-level path skip pending。CI 監聽 `pull_request.edited` 只為捕捉 base retarget；body/title-only edit 會讓 classifier 的重步驟與所有 downstream jobs skip，並使用獨立 `metadata-only` concurrency group，不能取消仍在跑的 exact-head `verification`；只有 base edit 才以新的 `base.sha...head.sha` 重建 verification plan。`.github/workflows/pr-review-agent.yml` 的 `PR Metadata Contract` 是 `pull_request_target` base-owned diagnostic，不得列為 required／merge authority；它不 checkout 或執行 head code、不保留 raw body、不安裝 sub-repo deps、不重跑 local review agent，也不聚合 artifacts。base capability incomplete 時 fail closed，改由 exact-head CODEOWNER／外部 gate 裁決。本機 `check-pr-local-preflight.ps1` 仍是 push 前的 PR review agent 與 affected sub-repo verification 硬 gate。
- **Governance base audit 與外部信任根**：`.github/workflows/governance-trust-root.yml` 使用 `pull_request_target`，workflow 定義來自 default branch，並在任何 checkout 前 fail closed 拒絕非 default-branch PR base；通過後只執行該 immutable base SHA 的 `scripts/dev/check_governance_trust_root.py`。candidate checkout 只作為 inert data 讀取，禁止載入或執行 candidate 的 script、action、hook、dependency 或 module。checker 比對 base/candidate governance policy 與 architecture baselines，並使用 GitHub server 提供的 exact head/review/permission facts，防止同一個 PR 修改 checker 或 baseline 後自行宣稱通過。[GitHub event 文件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target)明定 `pull_request_target` 的 `GITHUB_SHA` 是 default-branch commit，而[required-check 文件](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#required-check-needs-to-succeed-against-the-latest-commit-sha)要求 check 通過 latest PR head；因此這個 repo workflow **只能是 diagnostic，不得把 `Governance Base Audit / governance-base-audit` 設為 required 或宣稱 merge authority 已生效**。真正的 merge trust root 必須由 distinct、agent-inaccessible GitHub App（或組織層 external required workflow）在 head SHA 執行同一 base-owned checker並發布可由 branch protection 綁定 expected source 的 check；App 上線前固定 CODEOWNER exact-head approval 仍是外部信任根。
- 每個 PR body 必填 `Change lane: F | B | G | S`、`Behavior contract changed: yes | no`、`Requirement source: issue | docs/plans | superpowers spec | existing contract | not applicable`。behavior=yes 或 Lane G/S 時不得填 not applicable；behavior=no 不得只因 changed path 缺 spec 而 blocker。新增或刪除 route/API/schema 等 contract signal，或 deploy/security/Kit runtime/cross-service 等 Governed trigger，不得自報 F/B 規避 Lane G。
- User-facing change 的 PR 描述必須包含 Frontend Verification table；machine-required labels 以 `scripts/tests/check-pr-body-evidence.ps1` 為準。除 route/button/fixture/真 backend/runtime ID/visible state/browser evidence 外，還必須填 `Design gate status`、`Design screen(s)`、`Reference-missing route(s) / surface(s)`、`Full completion claimed`、manifest 與 visual result/comparison/artifacts。scope 由 base/head manifest 聯集推導，PR 不得自選 screen；`mixed`／`partial_reference_missing` 一律 full=no。semantic/pixel只接受 CI `design-semantic-visual` output，functional/runtime 只接受 `functional-runtime-conv` output；兩者仍是完成證據，但不再由額外 artifact aggregation status 決定 merge authority。
- Runtime / Docker / Kit / viewer / env / port 相關 PR 描述必須包含 Deploy Path Verification table；若未更新 `scripts/deploy.ps1`，必須明確說明已驗證或不適用。
- 改動治理面檔案的 PR 描述必須包含 **AI Coding Governance** table，7 個必填 label：`Linked issue`、`Requirement source`、`CODEOWNERS / owner review`、`GitNexus evidence`、`Browser E2E evidence`、`Agent workflow changed?`、`Required checks expected`。machine labels 由 `check-pr-body-evidence.ps1` 逐字比對，值不得為占位。
- `PR Metadata Contract` 會在 `pull_request.edited` 重驗 body；CI 同樣接收 edited event，但只有 `changes.base` 存在時才執行 classifier 重步驟並以新 base 重跑受影響 jobs，body/title-only edit 只留下 skipped jobs，不重跑 heavy CI。因此 PR body-only 修正流程是：更新 PR body → 等待新的 `PR Metadata Contract` edited run → 本機 `check-pr-local-preflight.ps1` 跑綠；不得期待 heavy CI 重跑，也不得用 `gh run rerun` 的舊 payload或 `--allow-empty` commit假刷新證據。若 code/head 有變，則由 `synchronize` 重新產生完整受影響 CI 與 trust-root evidence。
- 完成標準、frontend-operable rule 與誠實鐵律（無 backend 處 UI 標 `DEMO DATA` / `NOT BUILT` / `not observed`，不得只接 mock）見 `AGENTS.md` §0.1 與 `product-operability-and-script-contract.md`。

## `main` 衛生

- 若發現已在 `main` 產生未提交變更，先切到對應功能 branch，再繼續工作或整理 PR。
- 本地 `main` 只作為 `origin/main` 的乾淨追蹤分支；不得在 `main` 保留本地-only commit、累積功能開發、或用 merge/pull 解 PR squash/merge 後的 ahead/behind 分岔。
- PR merge 後的本地收斂必須先 `git fetch origin --prune`，確認工作區乾淨後讓本地 `main` 指向 `origin/main`；若 `main...origin/main` 顯示 ahead/behind，先確認 ahead 內容已被 PR merge commit 吸收，再對齊 `origin/main`，不要手動解同內容衝突。

---

## PR merge 後的 branch closeout

PR merge 不代表 Git branch 已自動收斂。當 agent 完成 / 協助完成 PR merge、或使用者詢問「分支是否收斂」時，必須把 branch closeout 視為同一事件流程的收尾，不應要求使用者靠記憶手動執行。

Closeout 必須先做只讀盤點：

```powershell
git switch main
git fetch origin --prune
git status --short --branch
git branch -vv --no-abbrev
git branch --no-merged origin/main
git branch -r --no-merged origin/main
```

判斷規則：

- 對於 PR 已 `MERGED`、upstream 已 `gone`、或已被後續 PR 明確 superseded 的 local branch，agent 可以在回報理由後清理 local branch。
- 對於遠端 branch，必須先用 `gh pr list --state all` 或等價方式確認 PR 狀態與 head ref；只有已 merge 或已明確 superseded 的 branch 才可建議刪除。
- `revert-*`、release、hotfix、或語意上代表回滾決策的 branch 不得自動刪除；必須先向使用者說明保留/刪除影響並取得明確同意。
- 若 `git branch --no-merged origin/main` 因 squash merge 或 replacement PR 仍列出舊 branch，不能只用 ancestry 判斷；必須交叉比對 PR 狀態、`mergedAt`、`closedAt` 與 branch diff。

清理指令範本：

```powershell
git worktree remove <worktree-path>
git worktree prune
git branch -D <local-branch>
git push origin --delete <remote-branch>
git fetch origin --prune
```

若該 branch 曾以 worktree 方式開發，`git worktree remove` 必須排在 `git branch -D` 之前；沒有先移除 worktree 就刪 branch 會留下失聯的 worktree 目錄與 `.git/worktrees/` 殘留紀錄。

完成後必須回報：刪除哪些 local / remote branch、哪些刻意保留及原因、`main` 是否已對齊 `origin/main`、`git branch --no-merged origin/main` 與 `git branch -r --no-merged origin/main` 的剩餘結果。

---

## Worktree 生命週期

Lane G/S、修 PR、checkout 不乾淨或並行工作時必須使用 dedicated worktree。Lane F/B 在已確認 checkout 乾淨且使用者未要求隔離時可直接使用 task branch。需要 gitignored fixtures（例如 `storage/` 真實 IFC）時，優先在 worktree 建 junction / symlink。

### Baseline 契約（2026-07-30 使用者裁決納入治理）

當使用者要求「以 origin main 為 baseline 建立隔離區執行」或同義口令時，agent MUST：

1. **先 `git fetch origin --prune`**，再以 `origin/main` 開 worktree：`git worktree add -b <type>/<slug> <sibling-path> origin/main`。
2. **禁止**以 local `main`、目前 checkout、其他 feature branch 或 **stale `origin/main`** 當 baseline（與 §「測試部署區重建」對 stale `origin/main` 的禁令同一理由：本機 ref 可能落後數個 merge，據此開工會把別人已合併的修正當成未完成而重做，或在過期樹上取得無效證據）。
3. **開工前實證 baseline**：`git rev-parse HEAD` 必須等於 `git rev-parse origin/main`，且 `git status --porcelain` 為空。兩者任一不成立即停工回報，不得「先做再說」。
4. **收工後依 Closeout 順序移除 worktree**，不得留下失聯目錄。

此契約對所有 Lane 生效（含 F/B）：使用者明確要求隔離時，Lane F/B 的「可直接切 branch」豁免不適用。

### 位置與命名

- **權威位置**：repo 的 **sibling 目錄**，例如 `C:\Repos\active\iot\AI-BIM-governance.worktrees\<branch-slug>`（與 repo 同層、repo 外）。
- **禁用位置**：`.claude/worktrees/` 已被 gitignore，且已有紀錄顯示會被並行 git automation 中途清空（見 `enterworktree-cleaned-by-concurrent-git.md`），`git clean -fdx` 也會把它整個掃掉；不得當作 worktree 的正式落腳點。**repo 內的 `.worktrees/` 同屬禁用**：`.gitignore` 已忽略該路徑，因此暴露於同一個 `git clean -fdx` 風險（2026-07-30 實際踩到並就地更正）。
- **命名**：branch 用 `feat|fix|chore|docs/<slug>`；worktree 目錄名對齊同一個 `<slug>`（不重複前綴）。
- **工具存取**：sibling 位置在 repo 之外，隔離區內的檔案工具（Read/Write/Edit/Grep）可能尚未授權該目錄。應在開工前一次性取得該 sibling 目錄的存取授權，而不是退回用 shell here-string 編輯關鍵檔案。

### 何時可直接切 branch

- **用 worktree**：Lane G/S、修 PR、checkout 不乾淨、並行工作、或隔離 E2E stack。
- **可直接切 branch**：Lane F/B 且工作區乾淨，或使用者明確要求在目前 checkout 操作；不得混入既有 dirty files。

### Closeout

PR merge 後，若該 branch 曾以 worktree 開發，收斂順序為：

```powershell
git worktree remove <worktree-path>
git worktree prune
git fetch origin --prune
git branch -D <local-branch>
```

worktree closeout 是 branch closeout 的前置步驟，不是獨立可省略的動作；上節「PR merge 後的 branch closeout」判斷規則（MERGED / superseded / 保留 revert-* 等）同樣適用於 worktree 對應的 branch。

### 與部署區（D 軸）的分工

開發／驗證主線固定為：

```txt
main checkout 或 sibling worktree 開發 → branch → PR → CI 綠 → merge 進 origin/main
                                                              → 只有 merge 後的 origin/main 才會重建到 owner-resolved target
```

- 未 merge 的 branch **不得**拿部署區當驗證場所：`.\scripts\dev\rebuild-test-deploy.ps1 -Build -InventoryPath '<repo-external target.local.json>'` 預設選 canonical Linux descriptor，並每次強制從 freshly fetched `origin/main` 重建 owner-resolved checkout；它不會、也不應該讀未 merge 的 worktree 或 branch 內容。`local-windows` 只在明確傳入 `-TargetId local-windows` 時作 on-demand verification。
- merge 前需要 browser E2E 證據時，用「隔離 alt-port branch stack」（本 checkout 或 sibling worktree + coordinator `:8005` / governance `:49103`），對照 `docs/agents/product-operability-and-script-contract.md` 的 script contract，不要為了搶先驗證去動部署區的 golden path。

---

## Per-item ship-cycle 自動化（ship-item workflow）

Lane F/B 不自動啟動 ship-cycle。只有使用者明確要求 ship，或 Lane S 的已核准 spec 授權自主推進時，才使用 `.claude/workflows/ship-item.md`（commit→push→PR→local preflight→CI watch→buffered merge→closeout）。Lane G 預設停在 PR ready；是否 merge 仍依使用者授權與 branch protection。完整 gate、reviewer buffer、finding fix 與 human-approval contract 以 `ship-item.md` 為準。

本 repo 採 single-owner、dual-identity merge governance：同一位人類持有 owner 與固定 reviewer 兩個 GitHub 帳號，但 branch protection 保留 approving reviews=1 並強制 code-owner review。Base branch `.github/CODEOWNERS` 將全路徑唯一指定給 `monkey1sai-blip`；PR 作者不得自批，GitHub App 也不得成為 approver。該帳號的 immutable user ID 為 `311287868`、type=`User`、association=`COLLABORATOR`；trusted executor 在 preparation 與 merge 前複驗 live permission/role 都精確為 `write`，並額外要求 review body 與 `commit_id` 精確綁定 repo、PR、base SHA、head SHA。

repo 內已持久化 `scripts/agent-tooling/blip-approve/` broker source package：App producer 只具 `COMMENT`／`REQUEST_CHANGES`，固定 User broker 才能產生 counted `APPROVE`；source 存在不等於已安裝、已啟用或已授權。外部 verifier、ProgramData runtime、credential 與 token health 尚未在本 repo source PR 內完成，因此 activation 與任何 live review mutation 維持 `HELD`，目前 operational path 仍是 reviewer UI。counted-review broker 不提供 current-turn provenance，也不取代下述 tuple-bound elevated authorization。

elevated path 使用 `merge-elevated` action；caller-controlled `elevatedAuthorization` 永遠不構成人類授權。repo-side executor／broker contract 位於 `.github/workflows/trusted-elevated-merge.yml`、`scripts/{dev,lib}/trusted-host-merge*.mjs` 與 `agent-contracts/trusted-host-merge*`，由 protected environment 的唯一 reviewer approval 綁定 repo/PR/base/head/runId/activationMode/provider/nonce/expiry，之後才釋出單 repo短效 GitHub App token。Hosted environment、App、secrets 與 variables 是 repo 外 provisioning；repo machine state=`requires_live_attestation` 時，只允許 protected variables 綁定 exact tuple 的 `attesting_negative`／`attesting_positive`，且 workflow input、assertion與 external mode 必須逐字相同，其餘一律 `trusted_elevated_authorization_unavailable`。negative mode 永不到達 merge sink；positive live merge 通過且 closure PR 把 repo state 與 external mode 都改為 `active`、清除 tuple digest 前，不得把 repository implementation 說成 live automation。

Canonical body/action/apex 是 coordinator 額外稽核；GitHub 伺服器層的人類 identity gate 來自 CODEOWNERS，不將 body 誤報為 GitHub 原生會驗證。Agent／GitHub App／bot 不得直接提交、修改或 dismiss 該 review；只有另行安裝、啟用且對 named PR 逐次授權的固定 User broker 可提交同一 exact-tuple review，也不得以 commit status/check 冒充 human approval。Branch protection 保留 dismiss stale reviews、conversation resolution、strict non-empty且 App-ID-pinned required checks、enforce-admins、90 秒 reviewer buffer、完整 protection/ruleset snapshot、immutable-SHA diff、tool-free Claude/Codex apex、final evidence re-read、exact-head REST merge 與禁用 `--admin`；任一 protection/comment/review/reviewer permission/head/base 漂移即 HELD。canonical 格式、provision checklist、bootstrap、trusted authorization boundary 與殘餘 credential trust boundary見 `.claude/workflows/ship-item.md`。
