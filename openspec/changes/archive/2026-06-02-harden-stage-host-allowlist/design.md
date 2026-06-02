## 背景

CH-3 收 3 風險(#12 stage hosts 設定化 / #24 移除 8005 死碼 / #14 SYSTEM_DESIGN 對齊),全 LOW impact,對應 2026-06-01 風險報告 CH-3 分組(stage host 設定化 + 文件對齊)。#12 / #24 改同一組 stage allowed-hosts symbol(必須同 PR),#14 是同主題文件權威對齊。整個 change 為 tasks-only(無 spec delta)。

## 目標 / 非目標

- 目標:#12 stage allowed-hosts 設定化 + 空值告警(去除靜默 fallback)、#24 移除三處退役 8005 死碼、#14 SYSTEM_DESIGN 改 as-built。
- 非目標:見 proposal Non-goals(不改 stage 載入核心 / 不重命名 env / 不實作前瞻設計 / 不刪 sizing 數字 / 不引入 dependency)。

## 關鍵決策（explore open questions 收斂,全 auto default）

- #12 default 清單 = 只含 `127.0.0.1:49101` / `localhost:49101`(8005 退役由 #24 刪、`$PublicHost:49101` deploy 動態追加)。
- #12 env 名維持 `BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS`(三處 + README + audit 已一致,改名擴大 blast radius 無收益)。
- #12 ps1 加 `-AllowedStageHosts` param(operator 手動跑 start-streaming-server.ps1 需 first-class CLI 入口,對齊 `$SignalPort`)。
- #24 100% 可安全移除(全 repo 8005 非註解功能引用只剩三處 fallback、測試零依賴);test fixture URL 8005 同步改 49101 消除認知混淆。
- #14 §3 / §9 sizing 保留加註(roadmap §9 引用),不刪不降級;只改 SYSTEM_DESIGN.md(不動 workflow / roadmap,那些走 documentation-source-of-truth spec)。
- 三風險合併單一 change(#12 / #24 改同組 symbol 必須同 PR,#14 同主題;blast radius 皆 LOW)。

## 控制流 / 權威來源

- #12 / #24:stage allowed-hosts source = `BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS` env(deploy.ps1 / start-streaming-server.ps1 / stage_loading.py 三處讀);空值 fallback = 內建 localhost-only default(只含 49101);host 強制檢查 `_ensure_allowed_http_stage_url` 邏輯不動。
- #14:SYSTEM_DESIGN.md 從「前瞻 target」改為「as-built + [DEFERRED] 前瞻」,as-built source = start-streaming-server.ps1 + host_native_conversion_service.py 實際實作。

## 驗證策略

- L1 pytest:`.venv\Scripts\python.exe -m pytest bim-streaming-server/tests/test_stage_loading_stage_composition.py -q`(#12 env-driven / 空值 fallback 不含 8005 兩 case)+ root pytest `tests` 回歸。
- L2 PowerShell:`pwsh -File bim-streaming-server/scripts/tests/test-stage-loading-contract.ps1`(token 掃描)+ `pwsh -File scripts/tests/test-deploy-dryrun.ps1`(#24 主回歸:allowedStageHosts 不含 8005、含 127.0.0.1:49101)。
- L2 ps1 param smoke(無單元框架,手動):`start-streaming-server.ps1 -PreflightOnly` / `-AllowedStageHosts 192.168.1.1:49101 -PreflightOnly`。
- L4 `npx openspec validate harden-stage-host-allowlist --strict`(tasks-only)。
- L5 文件 verify(無自動 checker):PR 描述列 SYSTEM_DESIGN.md / README.md 修改 path + 同步來源。
- baseline:apply 前先跑上述 pytest + dryrun 拿綠燈基準,改完同指令比較。
- commit 前:`git diff --cached --check` + `gitnexus_detect_changes`(stage_loading.py;ps1 / deploy.ps1 不在 index,靠 git diff 人工核)。

## 環境限制

- PowerShell symbol(`Resolve-AllowedStageHosts` / ps1 param)不在 GitNexus index(只索引 .py),靠純 PowerShell dot-source 測試框架(`scripts/tests/test-helpers.ps1`,非 Pester)+ `test-deploy-dryrun.ps1` 覆蓋。
- pytest 走 root `.venv\Scripts\python.exe`(stub `install_stage_loading_stubs` 已備 `carb.log_warn` no-op,新 test 不需改 stub)。
- 本 change 不觸及 GPU / Kit runtime。
