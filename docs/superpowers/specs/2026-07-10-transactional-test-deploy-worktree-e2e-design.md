# 交易式測試部署重建與 Worktree 前端 E2E 設計

## 目的

讓 agent 能從 dedicated worktree 安全地重建固定測試部署區 `D:\Users\deploy\AI-bim-geo`，並完成可追溯的前端 E2E；同時保留既有正式驗收口令 `rebuild-test-deploy.ps1 -Build` 的 `origin/main` 語意。

本設計修正的核心問題是：目前 helper 會在目的地原地 reset/clean、只以 `.git` 是否存在判斷 checkout、只信任數字 PID、健康檢查只看 HTTP 2xx，且 Playwright fixture／依賴／證據不足時可能以 `blocked` 結束。這些行為可造成機密環境檔遺失、錯停 PID、舊 runtime 假通過、或 fresh checkout 舊圖假裝成新證據。

## 成功標準

1. `OriginMain` 仍是預設來源，且每次使用 freshly fetched `origin/main`。
2. `CurrentWorktree` 必須明確指定；部署內容精確代表該 worktree 的 `HEAD + tracked diff + non-ignored untracked files`。
3. 重建不在 active checkout 原地遞迴刪除；任何 clone、source materialization、env restore、provenance 驗證失敗都不破壞原部署。
4. 只停止有 deployment identity 證據的 process tree；PID reuse、identity mismatch、停止逾時一律 fail closed。
5. 部署成功必須通過 service-specific readiness 與 Kit readiness，不能以任意 2xx 或 stale PID 代替。
6. Worktree E2E 自動解析 fixture、安裝 locked dependencies、執行真實 `:8004/ui#demo-control` 流程，並產生本次 run 專屬 screenshot、trace、report 與 provenance manifest。
7. 可恢復的 prerequisite 由 runner 自動處理；無法恢復時以 `failed` + evidence + rerun command 結束，不以 `blocked` 當成功或中性結果。

## 非目標

- 不把 worktree 模式設成預設，不讓未合併內容冒充 `origin/main` deployment。
- 不提交 `.env`、IFC、USDC、Playwright browser cache、`node_modules` 或 E2E binary artifacts。
- 不停止只有 port 或 process-name 證據、但無 deployment identity 的 process。
- 不把 external Docker/GPU/Kit failure 偽造成可由程式碼保證消除的狀態。

## 對外命令

### 正式測試部署基準

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

等價於 `-SourceMode OriginMain`。來源 commit 必須由本次 fetch 得到；不得使用 stale remote-tracking ref。

### Worktree 一鍵驗收

```powershell
.\scripts\dev\rebuild-worktree-e2e.ps1 -Build
```

此 convenience wrapper 固定使用：

- `SourceMode = CurrentWorktree`
- `SourceRoot = wrapper 所在 git worktree root`
- fixed deployment path
- strict deploy readiness
- real IFC frontend E2E
- run-specific evidence

底層 `rebuild-test-deploy.ps1` 可公開 `-SourceMode OriginMain|CurrentWorktree` 與 `-SourceRoot`，但 `CurrentWorktree` 必須顯式出現，不能由 dirty state 自動猜測。

## 來源 materialization

### OriginMain

1. 從 caller repo 讀 origin URL。
2. fetch `+refs/heads/main:refs/remotes/origin/main`，保存完整 commit SHA。
3. 在 destination sibling staging directory 建立 standalone clone。
4. detached checkout 該 SHA，驗證 `HEAD == fetched SHA`、origin URL、必要 scripts 存在。

### CurrentWorktree

1. 驗證 `SourceRoot` 是 git worktree top-level，保存 `HEAD` SHA 與 branch。
2. 先建立 standalone staging clone，再從 source repo fetch 該 `HEAD` object；不複製 `.git` worktree pointer。
3. 以 `git diff --binary --full-index HEAD -- .` materialize staged + unstaged tracked changes。
4. 以 `git ls-files --others --exclude-standard -z` 取得 non-ignored untracked files，逐一驗證相對路徑後複製。
5. 明確拒絕 `.env*`、private key、credential、agent/tooling、artifact/cache 等敏感或非 runtime 路徑；部署既有 `.env` 只能由 env preserve transaction 恢復。
6. 產生 source manifest：source mode、source root、branch、HEAD、patch SHA256、untracked path + SHA256、materialized timestamp。不得記錄 secret value。

Worktree source 可以是 dirty，但 manifest 必須讓 reviewer 知道部署的不是單一 commit。若 patch apply 或任一 file hash 驗證失敗，active deployment 保持不變。

## 路徑、鎖與 reparse-point 防護

1. production 路徑仍只允許精確 fixed path；test seam 才可使用 temp path。
2. 每次 run 先取得跨 process exclusive lock。拿不到 lock 時回報 holder／lock path／rerun command，禁止並行 clean/swap。
3. 對 deployment root、parent、staging、rollback、env backup 與所有遞迴移除目標檢查 `ReparsePoint`；遇 junction/symlink 不跟隨、不遞迴刪除，直接 fail closed。
4. staging、rollback、failed directories 必須是 fixed deployment 的同 volume sibling，才能使用 rename swap。
5. 成功後保留上一版 rollback directory 與 provenance；下一次清理前重新驗證它不是 reparse point。不要為了整潔在同一 run 冒險遞迴刪除未知內容。

## 環境檔交易

1. 在任何 checkout mutation 前，把 allowlist 內現存 env files 逐 byte 備份到 active root 外的 run-private directory。
2. manifest 只記 relative path、length、SHA256；禁止輸出 bytes/value。
3. env restore 不依賴對應 `.env.example` 是否存在。
4. 在 staging swap 前 restore，逐檔 re-hash；hash mismatch 阻止 swap。
5. clone/materialization、swap、deploy 或 rollback 失敗時，env backup 仍保留並回傳 path。

## Process identity 與 verified stop

每個 host-native service 的 numeric `.pid` 旁新增 identity sidecar，至少包含：

- service name
- PID
- process creation time
- executable path
- working directory／repo root
- argument fingerprint
- launcher run ID

`Test-AlreadyRunning`、preflight ownership 與 `Stop-HostNativeService` 共用同一 validator。Legacy pidfile 若不能以 command line、executable path、creation time 與 deployment root 補強，就視為 unknown ownership；不得 stop。

停止流程必須 child-first、kill 前重驗 identity、kill 後等待 PID tree 消失並確認 owned ports 釋放。只要 identity mismatch、PID reuse、timeout 或 port 未釋放，保留 pidfile/sidecar 與證據並中止 clean/swap。

## 交易式 swap 與 rollback

```text
lock
  -> external env backup
  -> materialize + validate staging
  -> restore + hash env in staging
  -> verify-stop old deploy-owned services
  -> rename active -> rollback
  -> rename staging -> active
  -> deploy -Build with strict readiness
  -> frontend E2E (worktree lane only)
```

rollback 邊界必須誠實區分：

- 若 `live -> previous` 成功、但 `stage -> live` 在 deploy 尚未執行前失敗，立即把 `previous -> live`；這是可驗證的 filesystem rollback。
- 一旦已呼叫 deploy，Docker、process、port 與 external runtime data 都可能產生 side effect。deploy 或 E2E 失敗時保留 current live、previous recovery path、env backup 與所有 evidence，不自動宣稱 runtime 已 rollback，也不自動把舊 tree 換回 fixed path。
- result 必須回傳 `PreviousPath`、`RecoveryRequired` 與精確 recovery command；任何人工 recovery 仍要重新做 process identity、path/reparse、env hash 與 readiness 驗證。

若 old deployment 本來不存在，pre-deploy rollback 只移走 failed staging，不創造假的舊 runtime。

## Deploy readiness 修正

### Port topology

所有 active endpoints 必須先做全域 numeric-port uniqueness：coordinator、viewer、conversion、governance、primary Kit signal/media、所有 spectator signal/media。跨 TCP/UDP 也拒絕同一 numeric port，因本命令的目標是消除操作設定歧義，不只是最低 OS bind 條件。

### Service-specific identity

- coordinator：`service=bim-review-coordinator` 且 ready/ok。
- governance：`service=governance-service` 且 ready/ok。
- conversion：`service=host-native-conversion-authority`、`authority=bim-streaming-server`、`role=conversion-only`、`status=ok`、`ifc_to_usdc_conversion=true`。
- viewer：HTTP success + known product title/bundle marker。
- Kit：verified PID tree + resolved signaling port owner + current-run readiness log signature。

Phase 5 必須使用 resolved ports並包含 Kit。`docker compose rm`、`pull`、`build`、`up` 的非零 exit 必須立即停止後續 phases並回傳 dedicated log。

## Worktree E2E contract

### Fixture

runner 依序尋找：

1. 指定 `-FixturePath`。
2. primary/main worktree 的 top-level `storage/*.ifc`。
3. 其他已註冊 worktree 的 top-level `storage/*.ifc`。

選到後 copy 到 external runtime storage 的 deterministic test filename，記錄 SHA256。API 只列 top-level IFC 且忽略 symlink，因此不能用 storage junction 假裝 fixture。若全部不存在，run 明確 `failed: fixture_not_found`，列出搜尋 roots 與 rerun command。

### Dependency bootstrap

從 deployed `web-viewer-sample` 執行：

1. 驗證 `package-lock.json`。
2. local `node_modules/.bin/playwright.cmd` 不存在或 lock hash changed 時執行 `npm ci`。
3. 驗證 local `@playwright/test` version；不接受 global Playwright 代替 project dependency。
4. 驗證 Chromium executable；必要下載若失敗，整體為 `failed: playwright_bootstrap_failed`。

### Canonical UI flow

- Frontend route：`http://127.0.0.1:<resolvedCoordinatorPort>/ui#demo-control`（不得只測 deprecated `#/demo-control` alias）
- Main button：`data-testid=ifc-register-btn`
- Fixture：實際 external runtime storage 的 `.ifc`
- Visible success/terminal state：downloaded、real `stream_conv_*` job、lineage IDs、誠實 runtime state；若產品狀態為 `runtime_blocked` 或 `conversion_failed`，E2E 不得將它提升為完整 success。
- Playwright functional spec：`web-viewer-sample/e2e/real-ifc-storage-intake.spec.ts`，worktree gate 必須啟用 strict-ready mode，`runtime_blocked`、`conversion_timeout`、`conversion_failed` 都是 nonzero failure，而不是完整成功。
- Live console shell smoke：`playwright.product-console.config.ts`。
- Conversion lineage：lineage spec 不得以 `test.skip` 換取 exit 0；本 gate 要求 real IFC ready artifact 與 mapping。
- Kit visual：使用同一個 real-IFC-ready session 驗證 first frame、stage matched 與 non-zero video dimensions。若只能跑現有相容 spec，wrapper 必須解析 report 並要求 `skipped=0`；否則整體 `failed: kit_visual_not_observed`。

此命令可宣告「worktree frontend E2E passed」的最低條件是 shell + strict real IFC intake + current-run evidence。只有另具 governance CPU semantic gate 與 Kit WebRTC visual/runtime gate時，才可宣告 full-system E2E complete；兩種結論不可混寫。

### Evidence

每次 run 建立獨立目錄，包含：

- `run-manifest.json`
- Playwright stdout/stderr
- JSON/JUnit/HTML report
- screenshot
- trace.zip
- source manifest copy
- fixture hash
- deploy/rollback logs

manifest 記錄 start/end time、source HEAD/patch hash、deployment HEAD、resolved ports、Playwright exit、test counts、artifact hashes。Gate 必須驗證 artifact 是本 run 建立且 hash 可讀，禁止使用「24 小時內任何 PNG mtime」作通過依據。

## 狀態語意

- `passed`：deploy readiness + canonical frontend E2E assertions + current-run evidence 全部通過。
- `failed`：assertion、bootstrap、fixture resolution、deployment、external runtime 或 rollback 任一失敗；必須附 root cause evidence 與 rerun command。
- `blocked`：不作為這條 agent one-click workflow 的終態。現有 generic smoke schema 可保留 `blocked`，但 wrapper 必須把 prerequisite/runtime blocker正規化成具體 failed category。

## 驗證層級

1. Builder self-check：pure/helper tests、temp destination transaction tests、fake process/port/docker tests。
2. Independent verifier：diff correctness、failure injection、rollback、source provenance、evidence freshness。
3. Adversarial risk reviewer：junction traversal、PID reuse、env loss、concurrent runs、wrong-service 2xx、stale screenshots、unknown process ownership。
4. Machine truth：fixed deployment rebuild、service readiness、真 IFC frontend Playwright + gstack browser screenshot/console/network evidence。
