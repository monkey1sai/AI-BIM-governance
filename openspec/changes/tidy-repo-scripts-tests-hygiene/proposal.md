# tidy-repo-scripts-tests-hygiene

## Why

2026-06-01 風險報告 CH-5 分組收 8 個 **repo / scripts / tests 衛生風險**（#22 #25 #31 #37 #39 #20 #30 #40）。explore 經 codebase 實證後判定：性質皆為「衛生清理」，observable behavior 面窄，**唯一真風險是 #22**——`scripts/deploy.ps1` 在 `Set-StrictMode -Version Latest` 下，build / probe 失敗路徑會讓 `$kitBuildExit` / `$buildExit` / `$runningIds` 未賦值就被讀取，觸發 `VariableNotDefined` terminating error 直接 crash，**繞過 Print-FinalSummary**——這正是 demo 冷啟動失敗時最需要診斷摘要的時刻卻吃掉它。其餘 7 項現況多已被既有防線覆蓋（#31 `.etl` 已被 sub-repo `.gitignore` 覆蓋、#20 race 在 Node 單執行緒下結構安全、#30 alias 是刻意向後相容設計），屬結構性脆弱點 / noise / 文件權威，以最小可回復 diff 一次收斂。

本 change 不做任何 production 行為改動、不新增 dependency、不改 startup 入口。

## What Changes

- **#22**（deploy.ps1 strict-mode crash）：build / probe 失敗路徑加三行 fail-safe 初始化（`$kitBuildExit = -1`、`$buildExit = -1`、`$runningIds = @()`），確保失敗時仍走到 Print-FinalSummary 非零退出，不因未初始化變數 crash。**不拆檔**。
- **#25**（spectator port 上限硬寫 32 兩處）：抽 `$script:MaxSpectatorCount = 32` 單一 source，guard（L305）與 clamp（L477 `-Max`）共用。只抽常數、**不改值**（維持 32，使用者拍板）。
- **#31**（`*-NvStreamer.etl` 落 repo 根 noise）：root `.gitignore` 補 `bim-streaming-server/*.etl`（defence-in-depth；已被 sub-repo `.gitignore` 覆蓋，git 層零風險）。不物理刪除既有 `.etl`（binary trace 保留供診斷）。
- **#37**（跨 sub-repo import sys.path 脆性）：新增 `tests/conftest.py` 集中 `TESTS_ROOT` / `REPO_ROOT` + 一次 `sys.path.insert`；刪 `tests/test_contracts_and_fakes.py:15-16` 的 per-file `sys.path.insert`。
- **#39**（fake worker urlopen 缺 host 白名單）：`tests/fakes/external_ifc_worker_client.py` 在既有 scheme 驗證後加 `_ALLOWED_HOSTS`（localhost / 127.0.0.1 / ::1 / host.docker.internal）host 驗證 + 1 個 host-reject test case；`# noqa: S310` 改註明「host validated above」。**test fixture only**，不碰 production urlopen。
- **#30**（`OutputNamne` alias）：`convert-ifc-to-usdc.ps1:6` 加說明 comment「刻意保留的 typo alias，向後相容，勿改」。**嚴禁修正拼錯**（移除會 breaking）。
- **#20**（ifc_ready map/queue 雙寫）：判定 Node 單執行緒下 `set` 必先於 worker 取用、**非真 race**；`bim-review-coordinator/src/app.ts` set 前加 INVARIANT 註解固化「set MUST 同步先於 enqueue、中間禁 await」，防未來重構誤插 await。**不改邏輯、不加鎖**。
- **#40**（設計權威多源）：`docs/superpowers/specs/2026-05-26-one-click-deploy-design.md`（brainstorming 草稿）頂部加 superseded 指標，指向 `openspec/changes/archive/2026-05-27-add-one-click-deploy-hybrid/`（正式權威）。不刪草稿、不動 archive。

## Impact

- **Affected specs**：`one-click-deploy-hybrid`（MODIFY「Final Summary 可診斷性」，加 build/probe 失敗仍達 Final Summary 的 scenario — #22）；`documentation-source-of-truth`（ADD「Superseded design drafts SHALL point to the authoritative archive」requirement — #40）。
- **Affected code/files**：`scripts/deploy.ps1`（#22 #25）、`.gitignore`（#31）、`tests/conftest.py`（新增）+ `tests/test_contracts_and_fakes.py`（#37）、`tests/fakes/external_ifc_worker_client.py`（#39）、`bim-streaming-server/scripts/convert-ifc-to-usdc.ps1`（#30）、`bim-review-coordinator/src/app.ts`（#20 comment-only）、`docs/superpowers/specs/2026-05-26-one-click-deploy-design.md`（#40）。
- **不改動**：任何 production runtime 行為、startup 入口、對外 contract；不新增 dependency；不拆 deploy.ps1；不改 `$ErrorActionPreference`；不改 32 數值；不移除 `# noqa: S310`；不修 `OutputNamne` 拼錯。
