## 啟動 / 重建 backend stack 前置:host-native port preflight(防 deploy Read-Host 卡死)

**預設鐵則**:跑 `.\scripts\deploy.ps1` 或 `.\scripts\dev\rebuild-test-deploy.ps1 -Build` **之前**,指揮官(主對話)
MUST 先從主工作區 root 執行第一個存在的 helper。無參數與 `-DetectOnly` 都是 read-only；不得預設停止任何程序。兩份
helper 內容必須維持一致(user 級路徑不存在,勿引用):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\spec-to-done\ensure-host-native-ports-free.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .codex\skills\spec-to-done\ensure-host-native-ports-free.ps1
```

**測試部署區真實驗證授權(放寬但限縮)**:只有明確執行 spec-to-done、目前 spec 的 PR 已 merge 且 commit 可由 freshly
fetched `origin/main` 取得時，才可在 P7 真實驗證前對第一個存在的 helper 執行 explicit stop 模式，接著走唯一 rebuild 入口:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\spec-to-done\ensure-host-native-ports-free.ps1 `
  -StopOwnedRuntime -DeploymentRoot 'D:\Users\deploy\AI-bim-geo'
# 若只有 Codex copy 存在，使用同參數呼叫 .codex\skills\spec-to-done\ensure-host-native-ports-free.ps1
# 只有 exit 0 才可繼續
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

- **停止條件**:conversion port 只接受 deployment venv Python、精確 conversion launcher lineage；Kit / spectator ports 只接受
  Kit executable、精確 port argument、extension root 與 streaming launcher lineage。pidfile 必須是目前 listener 的 ancestor，
  只能作 lineage 佐證，不能單獨授權。creation identity 在完整雙快照、每次 stop 前與取得 handle 後都必須一致；同一 port
  的全部 owners 先分類，任何一個未通過即不做 initial partial cleanup，回 `test_deploy_process_unproven` HELD。這個精確
  lineage 也容納 Kit build 的 Packman symlink，不把任意 reparse path 當 ownership。禁止其他 root / worktree / caller topology。
- **為什麼**:Kit 無 live reload / migration。殘留 runtime 會讓 `deploy.ps1` Phase 3 對非互動 stdin 啟動 `Read-Host`,並持有
  `storage/*.usd(c)` 鎖。explicit stop 只用已取得且重驗一致的 exact process handle 停止 canonical deployment listener；
  不用 PID-only tree kill。docker plane 仍由 `deploy.ps1` idempotent 處理。
- **退出碼處置**:`0` = port 全 FREE。`1` = busy / ownership unproven / identity changed / timeout；`2` = 非 canonical root、
  topology/參數不合法或無法可靠檢查 port。任何
  nonzero 都回報 port + PID + process name + ownership kind 並 **HELD**,不可硬跑 deploy。helper 不輸出完整 command line。
- **誠實限制**:rebuild 固定驗證 freshly fetched `origin/main`,不得拿未 merge branch 宣稱已在部署區驗證。`.venv WRONG_VERSION`
  等非 port prompt 不在本 helper 範圍。explicit stop 會一次讀取 canonical deployment 的 `.env.web-plane.host-kit`（或
  tracked `.example` fallback）形成 immutable hash + topology snapshot；不讀 caller process environment，caller port/count
  override 一律拒絕，且每次 stop 前重驗 source hash。
- **長時執行紀律(2026-07-28 cross-service 教訓)**:runtime attempt / deploy / rebuild 類長 runner 禁止經短 timeout 的
  shell 工具呼叫直跑;必須背景執行,以其持久化 log/artifact 輪詢判定結果。外層工具 timeout 強殺不是 runtime pass/fail
  證據——該 attempt 一律誠實作廢、記入 state,不得改寫成 success。
