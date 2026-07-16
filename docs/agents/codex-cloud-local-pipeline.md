> Loaded lazily by `AGENTS.md` / `CLAUDE.md`.
>
> 何時讀本檔：從 GitHub Issue 派送 Codex Cloud task、建立或審查 Cloud PR、本地 self-hosted runner 驗證候選版本，或合併後部署時。

# Codex Cloud → Local Ephemeral Validation Pipeline

## 目的與不變條件

本流程把開發與真實環境驗證分成兩個信任平面：Codex Cloud 在每張 task 的隔離 container 中修改程式並產生 PR；本地 agent 只驗證已核准的同 repo PR 候選版本；部署 agent 只從受保護的 `main` 重建。GitHub 是跨平面的 machine truth，不存在預先建立或長駐的 A–E worktree。

| 名稱 | 定義 | 不是什麼 |
|---|---|---|
| Profile A | Contract / Governance / schemas / OpenSpec | 固定 slot、資料夾或只能執行一張 task 的 worker |
| Profile B | Runtime / Backend / Kit / WebRTC / infra | 固定 slot、GPU lease 或本地 runtime workspace |
| Profile C | Viewer / Frontend / Playwright | 固定 slot、瀏覽器 instance 或本地 E2E workspace |
| Local Verification | 核准後才建立、驗完即刪的 PR workspace | 開發 slot 或 production deployment checkout |
| Deployment | 合併後從 protected `main` 重建 | PR worktree 的延伸或候選版本驗證 |

A/B/C 可同時被多張 cloud task 選用；它們只決定 agent 能力、規則與預設檢查。實際 container 由 Codex Cloud 每次 task 動態配置。並行額度由 workflow concurrency 控制，不由固定目錄數控制。

## GitHub machine truth 與交接契約

| GitHub object | 權威內容 |
|---|---|
| Issue | 需求、dependency、Cloud base SHA、預期 touch set、驗證 profile 與部署需求 |
| Codex task | 雲端執行 ID / URL 與執行紀錄 |
| Branch / PR | 候選程式碼、Cloud handoff 與 review 對話 |
| Check run | 核准 merge SHA 的本地驗證結果 |
| Artifact | trace、screenshot、test report、runtime log 與資源 ownership evidence |
| Deployment | protected `main` commit 的部署與 health evidence |

PR 必須保留下列逐字、單行 `key: value` 欄位；parser 以欄位名為穩定介面，作者不得改名或以表格取代：

```text
Cloud task ID / URL:
Issue:
Cloud base SHA:
Expected touch set:
Local validation profile:
Local-only checks outstanding:
Deployment requirement:
```

`Cloud base SHA` 使用 task 起始時 checkout 的完整 commit SHA，且在本地核准時必須等於當下受保護 PR base SHA；若 `main` 已前進就先刷新 cloud task / PR，不得跨 base 混用證據。`Expected touch set` 使用 repo-relative path / glob；`Issue` 使用 `#<number>` 或同 repo URL。`Local validation profile` 只能是受信 allowlist 中的 `contracts`、`integration`、`browser-e2e`、`kit-runtime` 或 `full`；舊名稱 `full-system` 無效，一律正規化為 `full`。`Local-only checks outstanding` 必須列出 Cloud 無法真實執行的檢查或 `none`；`Deployment requirement` 只能表達合併後是否需要部署，不授權候選版本部署。

## 唯一生命週期

正常路徑只使用下列狀態，拼字與順序不得自行擴充：

```text
agent:ready
    ↓
cloud:running
    ↓
cloud:completed
    ↓
pr:draft
    ↓
local-verify:approved
    ↓
local:validating
    ↓
local:verified
    ↓
merge:queued
    ↓
merged
    ↓
deploy:approved
    ↓
deploying
    ↓
deployed
```

本地驗證失敗只使用 `local:failed`：finding 回到原 PR，由同一 cloud task follow-up 或新修正 task 更新 PR，再重新取得核准與觸發驗證。若候選 SHA 在核准後改變，該核准立即失效，PR 留在 `pr:draft`，不得進入 `local:validating`。不要為 lease、cleanup、retry、cancel 或 evidence upload 發明 lifecycle state；這些是 run metadata。

## Cloud 開發與 PR handoff

1. Dispatcher 依 issue touch set 選 Profile A、B 或 C；不搜尋、不建立 `slot-a` / `slot-b` / `slot-c`。
2. 每個 task 由 Codex Cloud 建立隔離 container，checkout issue 所記錄的 `Cloud base SHA`，並把 task ID / URL 回寫 PR handoff。
3. Cloud Agent 可跑不需要本地 IFC、GPU、Kit host runtime 或本機服務的檢查；無法執行者逐項寫入 `Local-only checks outstanding`，不得宣稱已驗證。
4. Cloud Agent 不持有本地或部署 secrets、不部署、不操作本地 runner，也不把大型 IFC / USDC、`.env` 或 runtime artifacts commit 到 repo。
5. PR 的 actual changed paths 若超出 `Expected touch set`，在本地核准前必須由維護者審查並更新 issue / PR machine truth。

## 核准與 self-hosted runner 信任邊界

本地執行必須同時滿足以下條件，任一不符即 fail closed：

- PR 是 same-repo PR：`head.repo.full_name == github.repository`；fork PR 永不進 self-hosted runner。
- `local-verify:approved` 由 `maintain` / `admin` 維護者授予，而且核准紀錄同時綁定當下完整、不可變的 PR merge SHA 與 PR handoff body SHA-256。只綁 branch name、head SHA、label 是否存在或可變的 merge ref 都不夠。
- 開始驗證前重新解析當前 PR merge SHA 與 body digest，必須與 approved 值完全相同；base/head 更新或 PR body 編輯會自動移除核准並建立失敗 check，之後需要重新核准。
- orchestration controller、profile resolver、command allowlist 與 cleanup 邏輯一律 checkout 自受保護的 default branch，不從候選 worktree、Issue body、PR body 或 artifact 載入。
- Issue / PR 只能選 allowlisted profile，不得提供 shell command、script path、arguments、environment expression 或任意 Compose project name。
- 候選程式碼不取得任何 secret（包含 deployment credentials），不得寫入 canonical deployment checkout，也不得呼叫 deployment procedure。

候選程式碼本身仍會作為測試對象執行，因此 validation 必須使用一次一 job、完成後銷毀的 `ai-bim-local-validation-ephemeral` VM；deployment 使用獨立 `ai-bim-local-deploy` runner。兩者必須是不同 OS account（最好是不同 VM / host）、ACL、workspace、tool cache 與網路邊界。validation account 不得讀取 deployment secrets 或寫入 `D:\Users\deploy\AI-bim-geo`；真 IFC storage 必須以 OS ACL / read-only mount 強制唯讀，不能只靠環境變數約定。Check/comment 的 write token 只在 GitHub-hosted authorize/publish job 使用，不進候選碼執行過的 self-hosted job。禁止在同一台 Windows VM、同一 OS account 或同一可互相讀寫的 filesystem 上同時執行兩張不同 PR；non-runtime cap 2 必須由兩台互相隔離的 disposable VM 實現。若 provisioner 不能保證這項隔離，runner pool cap 必須降為 1，否則不同候選碼可互改 worktree。

Repository 必須先完成一次性設定：protected `main` ruleset 要求 `local-agent-validation` check、禁止 direct push / force-push 並取消一般 bypass；建立 protected environments `local-validation` 與 `local-test-deploy`，後者要求 deployment reviewer；設定 `AI_BIM_AGENT_WORKSPACE_ROOT`、`AI_BIM_TRUSTED_CONTROLLER_ROOT`、`AI_BIM_VALIDATION_GIT_REPO`（必填），以及 `AI_BIM_VALIDATION_STORAGE_ROOT`、`AI_BIM_REAL_RUNTIME_HARNESS`（`kit-runtime` / `full` 必填）；runner labels 必須精確映射到上述兩個隔離 pool。workflow 的 body/SHA 再檢查與 stale invalidation 是 merge gate 的一部分，不得只看某次 workflow 顯示綠色就手動 bypass ruleset。

### 可信主機的三個隔離根

本地 validation host 必須由 validation job 之外的受信 provisioner 準備下列 repository variables。三者不得互相包含，也不得位於 candidate workspace、deployment checkout 或 validation account 可任意改 ACL 的父目錄。

| Variable | 主機契約 |
|---|---|
| `AI_BIM_TRUSTED_CONTROLLER_ROOT` | 指向 controller snapshots 的父目錄；每個 approved Cloud base SHA 對應一個 `<root>\<base-sha>\` 密封 snapshot |
| `AI_BIM_VALIDATION_GIT_REPO` | 獨立、可變的 candidate Git mirror；只負責 fetch PR merge ref、Git metadata 與 detached worktree，不提供 controller / allowlist |
| `AI_BIM_REAL_RUNTIME_HARNESS` | 指向受保護、專用且完整封存的 real-runtime broker bundle 內 launcher；只接受固定參數契約並代表 validation job 協調真 IFC、Kit、GPU 與 WebRTC |

`AI_BIM_TRUSTED_CONTROLLER_ROOT` 不是讓 workflow 再做一次 `actions/checkout` 的位置。受信 provisioner 必須從 protected default branch 為每個 base SHA 建立具有獨立 `.git` directory 的乾淨 standalone、detached、`HEAD == base SHA` snapshot，完成 hash / ownership 驗證後密封；validation identity 只能 traverse、read、execute，不能 fetch、reset、建立檔案、寫入、append、rename、delete 或替換 snapshot。缺少該 SHA、dirty checkout、HEAD 不符、任一 trusted file 可寫或 snapshot 在 job 開始後變動，都必須 fail closed。舊 snapshot 只能由 provisioner 依 retention policy 回收，不得由 validation job 清除。

Windows ACL 必須由不同的 owner 設定並同時移除 validation account 的 `WRITE_DAC`、`WRITE_OWNER` 與 take-ownership 能力；該帳號不得是 Administrators 成員，也不得持有或啟用 `SeTakeOwnershipPrivilege`（Take ownership of files or other objects）。只用 `ReadOnly` file attribute、在 Python 中做 write probe、或 deny `FILE_WRITE_DATA`，都不能取代這項 host provisioning gate，因為能改 ACL / 取得 ownership 的帳號仍可改寫 controller、allowlist 或 broker。

`AI_BIM_VALIDATION_GIT_REPO` 必須是 provisioner 為這台 disposable VM 建立、validation account 可寫的獨立 mirror，且不得位於 `AI_BIM_TRUSTED_CONTROLLER_ROOT` 之下。所有 candidate fetch、`refs/pull/<pr>/merge` 解析、worktree registration / prune 都在此 mirror 執行；任何 command、profile、parser 或 cleanup code仍只能從密封 controller snapshot 讀取。mirror 與其 Git config / hooks 必須隨 VM 一起銷毀，不得跨不同 PR 或不同 disposable VM 重用；否則前一張候選碼可污染 worktree metadata、filter 或 hook。把可信 controller 本身當 mutable Git repo，或讓 candidate mirror 反向覆蓋 controller files，都是 hard failure。

`AI_BIM_REAL_RUNTIME_HARNESS` 是 broker 入口，不是 candidate 可編輯的測試腳本。launcher 必須位於只包含其完整 module / config / binary dependency 的專用 bundle；controller 會遞迴拒絕 link / junction、探測每個目錄與檔案的有效寫入權限，並在驗證前後重算全樹 SHA-256 manifest。launcher、現有 sibling module / config 與所有父目錄由不同 account 擁有；validation identity 只有 read / execute，沒有 write、delete、`WRITE_DAC`、`WRITE_OWNER` 或 take-ownership。把 launcher 放在含有 validation-writable 既有 module 的大工具目錄會 fail closed。broker 必須拒絕任意 command / script path / environment injection，只接受 allowlist 已定義的 broker run ID、candidate worktree、完整 candidate SHA、logical fixture identity、image、port 與 evidence destination；它自行驗證 run ownership、取得 runtime lock，並以受控 service identity 啟動真實 Kit / WebRTC 資源。

### Candidate process containment 與 teardown

Validation runner account 必須是無本機管理權、無 deployment path / secrets、無 controller ownership 能力的低權限身份。所有由 candidate worktree 啟動的 child / grandchild process 必須進入 Windows Job Object，啟用 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 且禁止 breakaway；controller 結束、timeout、取消或 crash 時關閉 Job handle，確保整棵 process tree 被終止。若 Kit、Docker、GPU runtime 或測試框架無法保證不逃離 Job Object，就必須改用每 job 一台 disposable VM，並在釋放 capacity lease、重新註冊 runner 或接受下一張 PR 前完成 VM teardown。只停止 parent PID 或重啟 Actions runner service 不算 cleanup。

### 真 IFC → Kit / WebRTC broker evidence JSON

`kit-runtime` 與 `full` 必須由 broker 產生至少符合下列契約的 `real-runtime-evidence.json`；Cloud log、mock fixture、單張未綁 SHA screenshot 或 candidate 自行產生的 JSON 都不能替代：

```json
{
  "schema_version": "ai-bim-real-runtime-evidence/v1",
  "status": "passed",
  "candidate_sha": "0123456789abcdef0123456789abcdef01234567",
  "broker_run_id": "pr-251-run-9832-attempt-1",
  "fixture": {
    "kind": "real-ifc",
    "fixture_id": "logical-redacted-id",
    "sha256": "64-lowercase-hex"
  },
  "ifc_to_usd_succeeded": true,
  "usd_artifact_sha256": "64-lowercase-hex",
  "kit_runtime_id": "host-runtime-id",
  "first_frame_observed": true,
  "stage_id": "observed-stage-id",
  "datachannel_ack_observed": true,
  "cleanup_succeeded": true,
  "artifacts": [
    {"name": "webrtc-first-frame.png", "sha256": "64-lowercase-hex"},
    {"name": "datachannel-transcript.json", "sha256": "64-lowercase-hex"}
  ]
}
```

`status` 只有在完整 candidate SHA 相符、真 IFC identity / hash 已觀測、IFC→USD 成功、Kit runtime ID 存在、WebRTC first frame、stage 與 DataChannel ack 均由 broker 觀測，而且 cleanup 成功時才能是 `passed`。JSON 不得洩漏實體 IFC path、secret 或 credential；所有引用產物必須以 SHA-256 綁定。

broker 必須先把 JSON、converter / Kit logs、first-frame、trace、DataChannel transcript 與 cleanup record 寫入 `{evidence_dir}/broker-sealed/` 對應的 broker-owned run directory，完成 hash manifest 後再封存成 validation account 只讀。controller 會對 manifest 所列的 first-frame 與 DataChannel artifact 實際讀檔重算 SHA-256，不接受只有 64-hex 字串或不存在的產物。封存目錄與檔案必須禁止 validation identity write / append / rename / delete、`WRITE_DAC`、`WRITE_OWNER` 與 take-ownership；artifact uploader只能讀取。一般 validation-writable evidence folder 中未綁 broker-sealed manifest 的副本只能作診斷，不能讓 required check 成功。

## 每次驗證的唯一 detached worktree

每次 run 使用 `PR number + GitHub run ID + attempt` 產生唯一 workspace：

```text
D:\agent-runs\AI-BIM-governance\pr-<pr>\run-<run>-attempt-<attempt>\
```

PR number 與 attempt 必須為正整數；run ID 必須為 GitHub 產生的安全識別字。所有同 host runner service 必須共用 repository variable `AI_BIM_AGENT_WORKSPACE_ROOT=D:\agent-runs\AI-BIM-governance`；缺值即 fail closed，禁止以各 runner 私有的 `$RUNNER_TEMP` 代替 host-global lock / ledger root。此 root 必須位於同一台 validation host 的本機 NTFS volume，不能使用 SMB/NFS 或其他不保證 Windows byte-range lock 語意的共享檔案系統；lock files 必須由 validation account 建立並以 ACL 禁止其他帳號刪除或替換。controller 以每個 capacity slot 的 OS file lock 持有 lease；process crash / hard kill 由 kernel 自動釋放 lock，下一個 holder 會覆寫殘留 owner metadata，不依賴 PID probe、TTL 或 heartbeat。這不代表 child process 已被終止：runner orchestrator 必須先銷毀該次 VM（或以 Windows Job Object 實作 kill-on-close）才可讓同一 host 接受新 job，禁止只重啟 Actions runner service 後重用可能仍有 Kit/GPU process 的機器。fetch 後以 approved merge SHA 建立 detached worktree：

```powershell
$workspace = Join-Path $RunRoot "pr-$PrNumber\run-$RunId-attempt-$Attempt"
git -C $CandidateGitRepo fetch origin --prune
git -C $CandidateGitRepo worktree add --detach $workspace $ApprovedMergeSha
```

不得 checkout candidate branch、可變 tag 或未綁定核准的 ref。Docker Compose namespace 同樣由可信 controller 以 PR / run / attempt 派生，不接受 Issue / PR 輸入。成功、失敗或取消都必須在 `finally` 上傳可用 evidence、移除該 worktree 並執行 `git worktree prune`；不得把 workspace 保留成 A/B/C/D/E slot。

## 驗證 profiles 與並行上限

profile 到 command 的映射只存在 protected default branch 的 repo-reviewed `scripts/agent/validation-profiles.json`；Issue / PR 不得覆寫。名稱與用途如下：

| Profile | 目的 | Local concurrency cap |
|---|---|---:|
| `contracts` | contracts / schema / static governance | 2（與其他 non-runtime 共用） |
| `integration` | CPU service integration | 2（與其他 non-runtime 共用） |
| `browser-e2e` | 不占用 Kit 固定 port / GPU 的 browser flow | 1（同時占用 non-runtime 配額） |
| `kit-runtime` | Kit / WebRTC / GPU / fixed-port runtime evidence | 1 |
| `full` | integration、browser 與 live runtime 的保守完整驗證 | 執行期間同時占用 browser / non-runtime / runtime lock；不得繞過任一 cap |
| deployment | 合併後正式重建 | 1 |

隔離 runner fleet 同時最多 2 個 non-runtime validation、1 個 browser E2E、1 個 runtime validation；單一 disposable VM 同時只能承載一張 PR，且全 repo 同時最多 1 個 deployment。`full` 是唯一完整系統 profile 名稱；不得使用 `full-system` 建立第二組 concurrency group。controller 的本機 NTFS lease 只防止同一可信 run 內的資源碰撞，不是惡意 PR 之間的 security boundary；跨 VM 的總 cap 由 autoscaler / runner group 數量實現。等待 capacity 不代表建立常駐 workspace，controller 應在資源可用後才 hydrate / start expensive runtime。

## 合併與部署

只有 approved merge SHA 的 required local check 成功，PR 才能進 `merge:queued`。`local:verified` 證明的是該候選 merge SHA；任何 PR 更新都使該證據失效。合併後的 deployment 是另一個權限域：

1. 確認事件來自 same repo、ref 是受保護的 `main`，且 commit 已存在於 freshly fetched `origin/main`。
2. 取得 GitHub protected environment 的 `deploy:approved`；deployment concurrency cap 為 1。
3. 只在本地主工作區執行 canonical procedure：

   ```powershell
   .\scripts\dev\rebuild-test-deploy.ps1 -Build
   ```

4. workflow 把 environment-approved SHA 以 `ExpectedMainSha` 傳給 canonical procedure；procedure 在 deployment lock 內再次 fresh-fetch 並確認完全相等後才 reset / cutover。禁止改用 PR worktree、候選 merge SHA、Cloud branch、`-DryRun`、`-Force` 或 sub-repo 啟動命令。
5. health check 與 deployment evidence 綁定實際 deployed `main` SHA；完成後才進入 `deployed`。

候選 validation job 永遠沒有 deployment secrets 或 production write 權限；deployment agent 永遠不信任 PR body 的命令、artifact 內的 controller，或 PR worktree 內的部署腳本。`AI_BIM_TRUSTED_CONTROLLER_ROOT`、`AI_BIM_VALIDATION_GIT_REPO` 與 runtime broker 產物也都不是 deployment source；deployment identity 必須重新 fresh-fetch protected `main`，驗證 `ExpectedMainSha` 完全等於 fresh `origin/main`，再執行 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`。

## 最低 evidence 與稽核欄位

每次 local check 至少記錄：repository、PR number、GitHub run ID / attempt、approved merge SHA、實際 detached `HEAD`、profile、trusted controller SHA、allowlist SHA、started / completed time、result、commands 的 allowlist key、artifact links、cleanup result。runtime 另記錄 fixture identity（不得含機密或 commit 大檔）、ports、GPU / process ownership、first-frame / stage / DataChannel evidence。deployment 另記錄 fresh `origin/main` SHA、protected-environment approval、canonical command、health result 與 deployed SHA。

禁止把 secret value、`.env` 內容或本機敏感路徑寫進 log / artifact / PR。evidence 不完整時標為未驗證；不得用 Cloud test、CI 綠燈、單張 screenshot 或先前 SHA 的結果替代本次核准 merge SHA 的本地證據。

`scripts/tests/stress_ephemeral_validation.py` 是 controller lifecycle 的合成壓測：它只證明 detached worktree 建立／清理、lease capacity、duplicate delivery、scope rejection、kill recovery、secret canary 與 Git integrity。它以 `--test-mode` 和合成 validator 執行，不能證明 Windows NTFS ACL、disposable VM teardown、Docker / GPU / Kit / WebRTC、broker-sealed evidence、GitHub event authorization 或 protected-main deployment；這些必須在正式 Windows runner 與受保護環境另行取得 evidence。
