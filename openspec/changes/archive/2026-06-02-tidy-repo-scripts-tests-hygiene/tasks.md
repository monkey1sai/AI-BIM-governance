# Tasks — tidy-repo-scripts-tests-hygiene

## 1. #22 deploy.ps1 strict-mode fail-safe（Medium）

- [ ] 1.1 `scripts/deploy.ps1` L750（`& .\repo.bat build` try 之前）加 `$kitBuildExit = -1`
- [ ] 1.2 L881（docker build try 之前）加 `$buildExit = -1`
- [ ] 1.3 L841（`docker @psProbe` 之前）加 `$runningIds = @()`
- [ ] 1.4 `pwsh scripts/tests/test-deploy-dryrun.ps1` 0 regression、`-DryRun` 仍產 deploy-audit

## 2. #25 spectator port 上限抽常數（Small，維持 32）

- [ ] 2.1 param block 後加 `$script:MaxSpectatorCount = 32`
- [ ] 2.2 L305 guard 改 `$Count -gt $script:MaxSpectatorCount` + error message 內插；L477 改 `-Max $script:MaxSpectatorCount`
- [ ] 2.3 `& scripts\deploy.ps1 -SpectatorCount 33 -DryRun` 應 throw、`-SpectatorCount 32 -DryRun` 邊界通過

## 3. #31 .etl gitignore（Small）

- [ ] 3.1 root `.gitignore` 補 `bim-streaming-server/*.etl`（加註解：NvStreamer writes to cwd）
- [ ] 3.2 `git check-ignore -v` 命中新行；`git ls-files "*.etl"` 仍空（不物理刪 .etl）

## 4. #37 跨 sub-repo import conftest（Small）

- [ ] 4.1 新增 `tests/conftest.py`：`TESTS_ROOT` / `REPO_ROOT` + 一次 `if str(TESTS_ROOT) not in sys.path: sys.path.insert(0, ...)`
- [ ] 4.2 刪 `tests/test_contracts_and_fakes.py:15-16`（ROOT 若需算 contracts 路徑改 `TESTS_ROOT.parent`）
- [ ] 4.3 `pytest tests -p no:cacheprovider -v` 全綠、無 ImportError

## 5. #39 fake worker host 白名單（Small，localhost 家族）

- [ ] 5.1 `tests/fakes/external_ifc_worker_client.py` scheme 驗證後加 `_ALLOWED_HOSTS = frozenset({"localhost","127.0.0.1","::1","host.docker.internal"})` + `if parsed.hostname not in _ALLOWED_HOSTS: raise ValueError(...)`；noqa 改 `# noqa: S310  # test fixture; host validated above`
- [ ] 5.2 `tests/test_contracts_and_fakes.py` 加 host-reject 案例（`http://evil.example.com/`）
- [ ] 5.3 `pytest tests/test_contracts_and_fakes.py -k "rejects"` scheme + host reject 全 pass

## 6. #30 / #20 / #40 文件性加固（XS）

- [ ] 6.1 `bim-streaming-server/scripts/convert-ifc-to-usdc.ps1:6` `[Alias("OutputNamne")]` 加 comment「刻意保留 typo alias，向後相容，勿改」；`test-convert-ifc-to-usdc.ps1` alias 映射仍綠
- [ ] 6.2 `bim-review-coordinator/src/app.ts` `pendingDispatchEvents.set` 前加 INVARIANT 註解（set MUST 同步先於 enqueue、中間禁 await）；`npm run verify` 綠
- [ ] 6.3 `docs/superpowers/specs/2026-05-26-one-click-deploy-design.md` 頂部加 superseded blockquote 指向 `openspec/changes/archive/2026-05-27-add-one-click-deploy-hybrid/`

## 7. OpenSpec spec delta 與驗證

- [ ] 7.1 `specs/one-click-deploy-hybrid/spec.md` MODIFY「Final Summary 可診斷性」加 scenario（build/probe 失敗仍達 Print-FinalSummary、不得 strict-mode crash — #22）
- [ ] 7.2 `specs/documentation-source-of-truth/spec.md` ADD「Superseded design drafts SHALL point to the authoritative archive」requirement（#40）
- [ ] 7.3 `openspec validate tidy-repo-scripts-tests-hygiene --strict` 通過
- [ ] 7.4 baseline 對照全綠（TS verify / Python pytest / PowerShell dryrun + convert）；`git diff --cached --check`；GitNexus `detect_changes` 確認 scope 未外溢
