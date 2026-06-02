# Design — tidy-repo-scripts-tests-hygiene

## Context

CH-5 的 8 風險全屬 repo / config / test 衛生，observable behavior 面窄，fix 多為純加固 / 註解 / ignore / 文件。5 份 sonnet explore 報告經 codebase 實證（line number、git-tracked 狀態、spec 歸屬皆核對）：唯一具 demo 影響的真風險是 **#22**（strict-mode 下 build 失敗繞過 Final Summary）；其餘 7 項低風險且現況多已被既有防線覆蓋。收斂為一次最小可回復 diff。

## Goals / Non-Goals

**Goals**：用最小加固 + 註解 + ignore + 文件收斂 8 個衛生風險，把 #22 的「失敗時吃掉診斷摘要」失效模式關閉；其餘固化既有結構安全性 / 關閉 noise 來源 / 統一文件權威。

**Non-Goals**（explore 實證後明確不做）：

- **#22 不拆檔模組化** deploy.ps1：需重做 dot-source 與 `$script:` 可見性、全 `.ps1` 測試重跑，風險遠大於衛生收益；deploy.ps1 若持續膨脹另立專門 refactor change。
- **#22 不改 `$ErrorActionPreference='Continue'`**（L42）：刻意設計，保護 docker native cmd stderr 不被 promote 成 terminating error。
- **#22 不加 Phase 2 true-run mock 測試**（repo.bat/docker 不存在情境）：比加初始化複雜，另立 change。
- **#25 不改 32 數值本身**（使用者已拍板維持 32，只抽常數）。
- **#30 嚴禁「修正」`OutputNamne` 拼錯**：`[Alias("OutputNamne")]` 是刻意向後相容 alias（設計文件 + test 雙重佐證），移除 / 改名都 breaking，且 PowerShell 不允許 alias 與 param 同名。
- **#20 不改 race 邏輯 / 不加鎖 / 不加新測試**：Node 單執行緒 event loop 下 `set → enqueue` 無 await 為結構安全，僅加 INVARIANT 註解。多 instance / cluster 部署下 in-memory 狀態的真正持久化另屬 spec 明文獨立 change。
- **#39 不碰 production urlopen**（`kit_gateway.py:26`、`stage_loading.py:308`）；不移除 `# noqa: S310`（S310 告警正確，noqa 只是沉默工具，改為加 host 白名單實質防護）。
- **#31 不物理刪除既有 `.etl`**（binary trace 保留供診斷，純本地 untracked）；只補 root `.gitignore` 關閉風險。
- **#40 不刪舊草稿、不動 archive**（immutable）；只加 superseded 標記。
- 全 8 風險不做 production 行為改動、不新增 production dependency、不改 startup 入口。

## Decisions

1. **#22 局部 fail-safe（scope XS）**：三個踩雷點各在 `try` 之前加一行 fallback 初始化——L750 前 `$kitBuildExit = -1`、L881 前 `$buildExit = -1`、L841 前 `$runningIds = @()`。常規 happy path 因 `$RunDir` 已於 L61-63 建好、Phase 1 已 hard-fail 擋掉缺 docker，三點本不會踩，屬結構性脆弱；但失敗冷啟動正是最需要 Final Summary 的時刻，fallback 讓 strict-mode 不 terminating crash。

2. **#25 single-source 常數**：param block 後加 `$script:MaxSpectatorCount = 32`；L305 guard 與 error message（內插 `$($script:MaxSpectatorCount)`）+ L477 `-Max` 共用。修一處即全一致。

3. **#31 defence-in-depth gitignore**：`git ls-files "*.etl"` 為空、`bim-streaming-server/.gitignore:41 *.etl` 已覆蓋全子樹；root `.gitignore` 補 `bim-streaming-server/*.etl` 是「防未來有人移除 sub-repo gitignore」的雙保險，零行為風險。

4. **#37 只移 fakes 的 sys.path**：新增 `tests/conftest.py`（pytest 自動載入，集中 `TESTS_ROOT` 並一次 `sys.path.insert`），刪 `test_contracts_and_fakes.py:15-16`。structured-log 三測試的 `importlib.util` + `REPO_ROOT` 4 層 `.parent` 計算**保留原樣**，避免測試隱性依賴 conftest 路徑增耦合（集中是可選 nice-to-have，本輪不做）。

5. **#39 host 白名單（使用者選 localhost 家族）**：scheme 驗證後加 `_ALLOWED_HOSTS = frozenset({"localhost","127.0.0.1","::1","host.docker.internal"})` + `if parsed.hostname not in _ALLOWED_HOSTS: raise ValueError(...)`；同步加 1 個 `http://evil.example.com/` host-reject test。test fixture 預設 pytest 路徑下 `post_ifc_ready` 只被 reject-scheme 案例呼叫（傳 `file:///` 被拒），不發網路請求。

6. **#20 INVARIANT 註解（comment-only）**：`pendingDispatchEvents.set(jobId,...)` 緊接 `conversionDispatchQueue.enqueue(jobId)` 兩行同步無 await；dispatcher closure `get→delete→!pending` fail-safe。Node 單執行緒下 set 必先於 worker 取用，非真 race；set 前加 INVARIANT 註解固化「set MUST 同步先於 enqueue、中間嚴禁插入 await」，防未來重構誤插 await 引入真 race。

7. **#30 / #40 文件性加固**：#30 在 `[Alias("OutputNamne")]` 加 comment 防後人誤改；#40 在舊草稿頂部加 superseded blockquote 指向 archive 權威，保留歷史脈絡。

## Risks / Trade-offs

- **#22 fallback `-1` 會讓失敗路徑印 exit `-1`**：這正是要的——非零退出 + 走到 Final Summary 的 FAILED 分支，比 strict-mode crash（無摘要）好。
- **#37 新 conftest.py 改變 pytest 載入**：以 baseline 對照（apply 前後同跑 `pytest tests` 須同綠、無新 ImportError）為驗收。
- **#39 host 白名單可能擋掉未來合法 LAN smoke**：使用者已選 localhost-only；若 T3 smoke 要打 LAN worker 再放寬（已記為 open question 結論）。

## Verification

baseline（動手前）→ apply 後同尺再比：

- TS：`cd bim-review-coordinator && npm run verify`（#20 comment-only，build+test 須維持綠）。
- Python：`.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider`（#37 無 ImportError、#39 含新 host-reject）。
- PowerShell：`pwsh scripts/tests/test-deploy-dryrun.ps1`（#22 #25 0 regression、`-DryRun` 仍產 deploy-audit）；`bim-streaming-server/scripts/tests/test-convert-ifc-to-usdc.ps1`（#30 alias 映射同一 OutputPath）。
- #31：`git check-ignore -v bim-streaming-server\<...>.etl` 命中新行、`git ls-files "*.etl"` 仍空。
- #40：docs-only，PR 描述列路徑 + 權威來源即 pass。
- `openspec validate tidy-repo-scripts-tests-hygiene --strict`；GitNexus `detect_changes`（注意 .ps1/.gitignore/docs 非 indexed symbol；只 `pendingDispatchEvents` 為 indexed Const，comment-only impact nil）。

## Rollout

單一 PR；merge 後 archive 並同步 roadmap §1.6。`.etl` 物理刪除與舊草稿是否刪除留 PR 時定（預設不刪）。
