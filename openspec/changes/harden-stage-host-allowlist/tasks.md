## 1. OpenSpec artifacts（tasks-only，無 spec delta）

- [ ] 1.1 proposal / design / tasks 定稿(#12 / #24 / #14 皆 tasks-only,不改 spec 定義的外部行為,無 spec delta)
- [ ] 1.2 `npx openspec validate harden-stage-host-allowlist --strict` 通過

## 2. #12 stage allowed-hosts 設定化 + 空值 warn

- [ ] 2.1 apply 前 `gitnexus_impact` on `_http_stage_allowed_hosts`(確認 LOW)
- [ ] 2.2 `start-streaming-server.ps1` 加 `[string] $AllowedStageHosts = ''` param(L31 `$PreflightOnly` 前);改 L281-283 三分支(param 非空 → env 已設沿用 → 否則 `Write-Warning` + default)
- [ ] 2.3 `stage_loading.py` 的 `_http_stage_allowed_hosts()` 空值分支加 `carb.log_warn`(env 未設、用 localhost-only 預設、coordinator 非 localhost 請設 env)
- [ ] 2.4 pytest `test_stage_loading_stage_composition.py` 加 `test_allowed_hosts_uses_env_var`(env=192.168.1.1:49101 → set 只含該值)+ `test_allowed_hosts_empty_env_falls_back`(清空 env → 含 127.0.0.1:49101 不含 8005);setUp/tearDown 還原 `os.environ`

## 3. #24 移除三處 8005 死碼

- [ ] 3.1 `scripts/deploy.ps1` 的 `Resolve-AllowedStageHosts` default 陣列刪 8005(留 `127.0.0.1:{ConversionPort}` / `localhost:{ConversionPort}`)
- [ ] 3.2 `stage_loading.py` 的 `_DEFAULT_HTTP_STAGE_ALLOWED_HOSTS` 改 `('127.0.0.1:49101','localhost:49101')`
- [ ] 3.3 `start-streaming-server.ps1` default 字串改 `127.0.0.1:49101,localhost:49101`
- [ ] 3.4 `bim-streaming-server/README.md` L215-220 範例移除 8005、改述 retired `_worker` host 已從預設清單清除
- [ ] 3.5 `test_stage_loading_stage_composition.py` L97/L102 fixture URL 8005 改 49101(消除認知混淆)
- [ ] 3.6 `scripts/tests/test-deploy-dryrun.ps1` 加乾淨-env regression(比照 Test 9:`allowedStageHosts -notmatch '8005'` 且 `-match '127\.0\.0\.1:49101'`)

## 4. #14 SYSTEM_DESIGN.md 改寫 as-built

- [ ] 4.1 新增 As-built architecture 段(單進程 Kit runtime + GPU preflight + 獨立 49101 FastAPI conversion authority,無 supervisor tier)
- [ ] 4.2 §5/§6/§7/§8/§9/§11/§13 前瞻內容逐段標 `[DEFERRED]` + 補實際 as-built 描述(camelCase DataChannel commands、in-process SHA-256 cache、carb structured log、capacity=1 + spectator view-only)
- [ ] 4.3 §3/§9 target sizing 數字保留 + 加「target capacity 模型、as-built 尚未實作 slot 強制」註記(roadmap §9 引用,不刪以免斷引用鏈)

## 5. Verify + PR

- [ ] 5.1 四層驗證(pytest + root pytest 回歸 + test-deploy-dryrun + test-stage-loading-contract),與 apply 前 baseline 比對
- [ ] 5.2 `gitnexus_detect_changes`(stage_loading.py)+ `git diff --cached --check`(ps1 / deploy.ps1 不在 index 靠 git diff 人工核)
- [ ] 5.3 commit → push → 開 implementation PR(繁中標題 / 說明)
