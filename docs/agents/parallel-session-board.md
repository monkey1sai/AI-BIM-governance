# Parallel Session Board（多終端機／多 CLI 並行感知）

多個 CLI 在同一 repo 開啟 session 時彼此原生不可見。本看板只是一層 best-effort 感知：記錄各 session 的 branch、worktree、任務與最近檔案；它不授權寫入、PR approval、merge 或 process termination。允許多個 writer 並行，但同一 branch 出現第二個 active writer 必須停工；機器隔離靠獨立 worktree、獨立 branch 與明確 touch-set，不以 writer 數量為 blocker。

## 共用位置

- 實體位置：主 checkout 的 `.agents/board/`（gitignored）。
- 所有 linked worktree 都以 `git rev-parse --path-format=absolute --git-common-dir` 的父目錄解析回同一塊看板。
- production queue、cleanup 與 legacy board command 一律使用同一 resolver，避免每個 worktree 各持一把假鎖。Fabric v1 的 `AGENTS_BOARD_DIR` seam 僅供測試的唯讀 `status --json --no-prune` snapshot；它不會 dispatch `register`、`update`、`done`、`hook` 或 `codex-notify`，也不會把 board 資料當作 lock、lease 或 lifecycle authority。

## 明確操作契約

```powershell
node scripts/dev/agents-board.mjs register --agent <claude|codex|agy|grok> --task "一句話任務"
node scripts/dev/agents-board.mjs status
node scripts/dev/agents-board.mjs update --agent <cli> --session <id> --task "新任務"
node scripts/dev/agents-board.mjs done --agent <cli> --session <id>
```

1. 開工先 `register`，保存回傳的 `session=<id>`。
2. 編輯前 `status`，確認沒有同一 branch 的 active writer 或重疊 touch-set。只讀診斷 snapshot 使用 `status --no-prune`。
3. 任務或主要檔案改變時 `update`。
4. 收工 `done`。看板失敗只降低感知，不得當成繞過安全 gate 的理由。

session 記錄位於 `sessions/<agent>--<session>.json`；事件追加到 `events.jsonl`。超過 120 分鐘顯示 stale，ended 24 小時或任意狀態 72 小時後才由明確 board 命令依 retention 清除。

### Fabric v1 projection adapter（非 legacy lifecycle client）

Fabric v1 不呼叫任何 legacy board write：`register`、`update`、`done`、`hook` 與
`codex-notify` 都不是 lease、resume、release 或 recovery authority。Adapter 唯一可使用的
legacy read 是由注入 reader 執行的精確 argv `status --json --no-prune`；任何其他 command
或 flag 一律拒絕。注入 reader 回傳的資料必須先去識別、遞迴 secret-safe 並符合 closed
snapshot shape；缺失、stale、malformed 或 privacy-invalid snapshot 只投影為
`PROJECTION_DEGRADED`，不改變 durable lease、writer cap、scope 或 context evidence。
Timeout 與既有 `HELD_*` lease truth 一律先於 projection source 或 board 健康度；HostInventory
reclaim 與 resume rebind 另須比對 control plane 建構時固定的 prior
issuer/version/source/revocation pin，才可消耗 nonce 或請求 CAS。
所有 Fabric public request 先做 closed outer-shape 與 recursive privacy 檢查；unknown 或
credential-shaped input 不得抵達 reconcile、nonce、CAS、board 或 writer。這些 authority pin
只封存在 factory 的非序列化 internal context，exported helper 不接受 request 提供的 pin。
遞迴檢查以 bounded cycle-safe walker 處理，並拒絕 `env:`／`environment:`、`$env:` 與 `%NAME%`
形式的 raw environment 值。Gate 通過後，adapter 對所有 request metadata 建立自身的
deep-frozen structured clone；每個 injected callback 只接收該 owned snapshot，且其回傳值也必須
先 clone/freeze/validate 才可交給下一個 callback。callback 的 mutation、throw 或未知回傳只會
產生 typed hold/degraded，不得改寫 caller input、改變 durable binding 或觸發後續 port。
Projection 所消費的 durable lease 只可透過 Task3 registry 匯出的
`parseSessionLease` 取得：它先建立 I-JSON owned clone，再套用 Task3 現有 closed state-record
驗證，並 deep-freeze 結果。Task6 不得複製或放寬 lease timestamp、resource、identifier/reference、
reservation、proof、release/audit 或 retention 規則。只有 `ACTIVE`、`SUSPECT`、
`END_REQUESTED`、`RELEASING` 或 `RELEASED` 及其 state-specific 欄位可通過；缺欄、未知欄或
forged terminal record 一律 typed hold，且不寫 projection。每個帶可解析 lease 的 public result
都帶 durable truth tuple：非 RELEASED 為 `occupied:true`、`writer_seat_released:false`、
`resources_retained:true`、`retention_state:ACTIVE`；RELEASED 則為 `occupied:false`、
`writer_seat_released:true`、`resources_retained:true`、`retention_state:RETAINED_FOR_REVIEW`。這讓
capacity consumer 可釋放 writer seat，同時不把 retained resources 變成可刪除或可
resume/reclaim 的 authority；無法解析的 lease 一律 `occupied:true` 並標示 truth unknown。

`createBoardProjection` 的普通 projection 最小注入面只有 `readBoardStatus` 與
`writeProjection`；effect spy 是選用測試觀測，不是 runtime prerequisite。缺少 inventory 或
resume authority pin/port 時，僅該 authority-sensitive operation fail closed，不能阻斷普通
projection。

如需寫 projection，Fabric 只能寫入與 legacy lifecycle 分離的自身 atomic projection
channel；每筆 record 帶 generation，並以 prior `expected_oid` compare-and-swap 寫入，只有
closed `STORED` acknowledgement 才能投影為 ready。record 不帶 callback 或 host/lifecycle
authority。它不會呼叫 cleanup、detached
launcher、process/listener inventory、PID termination、branch/worktree prune、ACL/owner/
sandbox/install/firewall、remote 或 external API。

## 四 CLI 的可驗證邊界

- `AGENTS.md` 是 repo 治理正本；`CLAUDE.md` 是 thin mirror。Codex 直接讀正本，Claude 由 mirror 載入。
- Claude repo hooks 固定停用（`.claude/settings.json` 的 `disableAllHooks: true`）；Claude、AGY、Grok 使用上述明確 board 命令。AGY／Grok 是否自動載入 repo 指令取決於各自外部 launcher，repo 不宣稱或啟用 branch-controlled hook。
- tracked persona 與 skill byte-parity 只涵蓋 manifest 宣告的 Claude／Codex adapter：`.claude/{agents,skills}` 與 `.codex/{agents,skills}`。`.agents/skills`、AGY 與 Grok 的 provider-local persona／skill 設定不是本 repo 的 tracked parity root，不得宣稱四端 byte-equal。
- Codex global `notify` 是 owner 可選的 repo 外設定；repo 不代改。缺少 notify 不影響手動 board 契約。

## 背景 cleanup 的安全界線

`register`、`done`、Claude lifecycle hooks（若由 owner 在 repo 外啟用）與 Codex notify
都會更新看板並背景啟動 `cleanup-orphan-dev-processes.mjs --silent`；它們不再同步 main，也
不觸發 PR queue 或 GitHub mutation。Legacy `update` 只寫 board projection、**不**呼叫
maintenance，但同樣不具有 lease、release、resume 或 process authority。Fabric v1 adapter
不呼叫上述任何 legacy write，包含這個無 maintenance 的 `update`。

cleanup 僅在下列證據同時成立時終止程序：

- exact role／entrypoint 是 coordinator `tsx src/index.ts` 或 repo 內 Kit executable；generic `git.exe` 沒有 durable launch lease，固定 fail closed、不自動終止；
- command／executable 可由 Git worktree metadata 或共用看板定位候選路徑，但只有 NUL-framed `git worktree list --porcelain -z` 對 exact-case 同一路徑明確標記 `prunable` 才提供 destructive authority；大小寫不明或 case-collision 一律 fail closed，board `cwd` 永遠不能單獨授權終止；
- `lstat` 對該路徑回傳精確 `ENOENT`；access denied、I/O error、dangling link 或其他不明狀態一律 fail closed；
- 父程序已死亡、程序超過 minimum age；
- 兩次 Win32 process snapshot 的 PID、PPID、command、executable 與 creation identity 完全一致；
- stop 前重新取得 Git `prunable` metadata 並再次要求精確 `ENOENT`，再查詢同一 creation identity；之後以 Win32 `OpenProcess` 取得 `SafeProcessHandle`，在同一 handle 上用 `GetProcessTimes` 驗證 creation time，並以 `GetFileAttributesW` 只接受 `ERROR_FILE_NOT_FOUND`／`ERROR_PATH_NOT_FOUND` 後才呼叫 `TerminateProcess`，最後 `Dispose`。

任一 ownership、identity 或 snapshot 不明即 fail closed，只記錄 `skipped`。cleanup 最後才執行 `git worktree prune`。Queue lock 使用 Git ref CAS；Windows generation identity 使用 creation timestamp，Linux 使用 boot ID 加 `/proc/<pid>/stat` starttime，避免 executable replace/unlink 改寫 identity。只在 owner PID 已死亡或 creation identity 證明 PID reuse 時回收，活著的 owner 不因時間過久被刪除，無法解析的 lock blob 也不自動刪。

所有 queue／cleanup／board 的 Git child process 都會移除 inherited `GIT_*` environment；repo 選擇只能來自固定 `cwd` 與 exact argument tuple，ambient `GIT_DIR`、`GIT_WORK_TREE` 或 config injection 不得改寫 trust boundary。Queue 的 `gh` read child 另將 repo/GraphQL host 固定為 `github.com`，並移除 inherited `GH_HOST`、`GH_REPO`、`GH_CONFIG_DIR` 與 `XDG_CONFIG_HOME` routing override；credential token 與必要 proxy仍由既有受控環境提供。

## Named PR queue（明確目標、無隱式 approval）

`manage-pr-queue.mjs` 只處理呼叫者指定的一個 PR。生命週期與 Git hooks 不會巡迴所有 open PR，也不會偽造或自動改寫 evidence。

```powershell
node scripts/dev/manage-pr-queue.mjs status --pr <number>
node scripts/dev/manage-pr-queue.mjs run-queue --pr <number>      # 單次只讀觀測，停在 external authority boundary
```

- `auto-fix`、`update-branch`、`approve`、`merge` 與 `install-hooks` 相容命令固定回 `HELD`；exact-head local preflight 由 coordinator 在 helper 外明確執行，repo helper 內沒有 arbitrary-script、GitHub mutation 或 hook 安裝 sink。
- counted approval 必須由 repo 規範指定的獨立 `blip-approve` 路徑完成；native merge 由 coordinator 在 helper 外依 `github-workflow.md` 的固定 reviewer identity/body、source-bound checks、review mode 與 human-critical authority 完整重驗。
- Readiness observation 讀完 checks／threads／approval 後必須重讀同一 PR tuple；head/base/state/review/merge 欄位任一漂移即 `HELD pr_observation_changed`，不得混合兩個 generation 的證據。
- `refs/ai-bim/pr-queue-lock` 指向 immutable lock blob（PID、creation identity、owner token、created-at）；建立、釋放與 stale reclaim 都用 `git update-ref` expected object ID compare-and-swap。任何 `core.hooksPath` 設定或 default `reference-transaction` hook 存在時，ref mutation 在執行前 fail closed，不以 config 或 hook bypass 繞過。exact delete 遇到暫時 ref-file contention 時，只有 fresh ref 仍等於同一 object ID 才作 bounded retry；ref 缺失、讀取失敗或 successor generation 已出現都立即 fail closed。crash 不會留下 hard-link claim，舊 owner 也不能刪 successor generation。
- Repo 不分發或安裝 Git hooks。既有 legacy `post-commit`／`post-merge`／`post-checkout` 若仍指向 clean-main `manage-pr-queue.mjs hook`，其實際行為取決於 clean main 版本；candidate branch 內容在 merge 前不等於 installed behavior。

## 驗證

```powershell
node --test scripts/tests/test-cleanup-orphan-dev-processes.mjs scripts/tests/test-manage-pr-queue.mjs scripts/tests/test-pr-queue-adversarial-and-stress.mjs
pwsh -NoProfile -NonInteractive -File scripts/tests/test-agent-governance-check.ps1
```

測試使用 temp repo／board 與 injected process inventory；Windows exact-handle 行為測試只終止測試本身建立的 disposable child，不掃描後終止其他真實程序，也不 prune 或覆寫真實 repo／hooks。
