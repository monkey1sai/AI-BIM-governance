# PR #398 測試部署區風險驗證

日期：2026-07-24（Asia/Taipei）

範圍：PR #398 `feat(a4): persist session-bound search issues`

subject commit：`64cadb06c8eba6400aecb8f75125dd2f7df2e1b7`

驗證角色：Terra deployment verifier（唯讀）＋ coordinator 獨立複核

## 結論

PR #398 的 owner-service backend 行為已在 deployment checkout 內以真 HTTP、真 IFC parser、真 proof registry 與隔離 SQLite 完成驗證：搜尋 `200`、Issue 建立 `201`、同請求 replay `200`、Issue/evidence 各持久化一筆，且回應不洩漏 raw proof。

但不能宣稱 canonical production flow 或 full deployment complete：

- `rebuild-test-deploy.ps1 -Build` 仍會在 Phase 2 因 Windows PowerShell child 繼承 PowerShell 7 `PSModulePath` 而無法解析 `Get-FileHash`，兩次皆 exit `2`。
- 只清理 child process 的 `PSModulePath` 後，同一份 deployment checkout、同一條 inner `deploy.ps1 -Build` 可完整通過；這是 causal diagnostic，不是 canonical helper pass。
- canonical env 的 A4 internal token 與 proof signing key皆未配置，coordinator 也只有 local-dev lab identity；mounted `8004` route 因此正確 fail closed，沒有 live `201`。
- aggregate `verify-all` 與 coordinator full suite 會讀 canonical helper 刻意移除的 `docs/`、`.claude/`、root `tests/contracts/`，所以不是綠燈；PR #398 的 targeted tests則通過。

| 項目 | 本輪判定 | 證據摘要 |
|---|---|---|
| Canonical rebuild | **未通過** | 兩次皆 Phase 2 `Get-FileHash` failure，exit `2` |
| Deploy implementation under clean child module path | **通過，但僅 causal diagnostic** | design assets count=`10`；governance/conversion/Kit/kit-manager/coordinator/viewer deploy-time checks通過 |
| A4 owner-service search → Issue persistence | **通過** | live isolated authority：search `200`、create `201`、replay `200`、DB=`1 Issue + 1 evidence` |
| Mounted coordinator mutation | **安全拒絕，未達 production 201** | no auth=`401`；local-dev identity=`503 a4_issue_authority_unavailable`；零 governance write |
| PR #398 targeted tests | **通過** | coordinator `7 passed`；governance `120 passed, 1 skipped` |
| Aggregate verification | **未通過** | `verify-all`: `101 passed, 12 failed`；失敗皆引用 deployment contract 已移除的 docs/tooling path |
| Ruff 工具不可用 | **已否定，但仍有 baseline finding** | PATH 有 `ruff 0.15.21`；PR changed Python files僅一個base-known F401 |
| Browser/design/Kit feature gate | **對本 backend slice不適用** | 無 production frontend diff；不能外推為 full-system E2E |
| Full completion | **no** | canonical helper、authentic identity/lease與aggregate gate仍有缺口 |

## Canonical test-deploy execution

從以下 evidence worktree 執行 repo 規定的唯一命令：

```text
C:\Repos\active\iot\AI-BIM-governance.worktrees\pr398-test-deploy-risk-evidence
```

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

兩輪結果：

| Field | First run | Reproduction run |
|---|---|---|
| Helper lifecycle run id | `run_20260724_030812_28a15f` | `run_20260724_034107_8af09f` |
| Result | exit `2` | exit `2` |
| Failed phase | Phase 2 design assets | Phase 2 design assets |
| Fetched/deployed commit | `64cadb06c8eba6400aecb8f75125dd2f7df2e1b7` | same |
| Previous checkout retained | `D:\Users\deploy\.AI-bim-geo.rebuild-previous-2a15cd44740041e5b56eee608db6a150` | `D:\Users\deploy\.AI-bim-geo.rebuild-previous-fb5ff3e77b994470bc7bdff313cc18fc` |
| PID stopped by verifier | none | none |

第二輪 lifecycle 在 `2026-07-24T11:41:07.855+08:00` 啟用 staged checkout，於 `11:43:07.391+08:00` 記錄 failure。Deployment checkout `HEAD` 與 `origin/main` 均為 subject commit。Helper 依 contract 移除 agent/tooling、root `docs/`、`openspec/` 等內容並保留 local env files，所以該 checkout 的大量 tracked deletion 是預期 deployment state，不能用 clean worktree 當成功條件。

### Failure card 與 root cause

兩輪共同 symptom：

```text
design assets staging failed: The term 'Get-FileHash' is not recognized as
the name of a cmdlet, function, script file, or operable program.

Status: FAILED (exit 2, Phase 2 (design assets))
```

Failing call path：

```text
rebuild-test-deploy.ps1
  -> Invoke-TestDeployScript (powershell.exe -NoProfile)
  -> deploy.ps1
  -> Sync-DeploymentDesignAssets
  -> Get-DeploymentDesignAssetHash
  -> Get-FileHash
```

已驗證的 causal evidence：

1. `pwsh 7.5.4` 與 standalone `powershell.exe 5.1.26100.6899 -NoProfile` 都能解析 `Get-FileHash`。
2. Standalone PS5 child dot-source `design-assets.ps1` 後可 hash 實際 staged PNG，`Assert-DeploymentDesignAssetsPrestaged` 回 `Mode=prestaged`、`Count=10`。
3. Failing child 繼承的 `PSModulePath` 把 `Documents\PowerShell\Modules`、`Program Files\PowerShell\Modules`、PowerShell 7 modules排在 WindowsPowerShell module paths之前；可用 module同時含 `Microsoft.PowerShell.Utility 7.0.0.0` 與 `3.1.0.0`。
4. 只在 child process 清理成 Windows PowerShell module roots後，同一 `deploy.ps1 -Build` exit `0`。沒有修改 repo source、env file或 secret。

因此 root cause定位為：**跨 edition `PSModulePath` 汙染了 helper → Windows PowerShell child 的 command-resolution boundary**。最小 durable fix應在 `Invoke-TestDeployScript` child boundary正規化 module path，而不是更換 hash演算法或把 `lab_unverified` 改成 `verified`。

本 branch未修改 shared deploy script。GitNexus對該 PowerShell helper/file回 `UNKNOWN`（index找不到 target）；依 Lane G規則，shared deploy-flow修正需另行 sign-off、regression test與重新跑 canonical helper。

## Clean-module-path causal deploy

診斷只對 child process 設定 Windows PowerShell module roots，再從 deployment checkout 執行：

```powershell
.\scripts\deploy.ps1 -Build
```

結果為 exit `0`，elapsed `3m 37s`。Deploy-time evidence：

- design assets prestaged count=`10`
- governance `49102/health`=`200`
- conversion `49101/health`=`200`
- Kit `49100 LISTEN + app ready`
- kit-manager-api `8010/health`=`200`
- coordinator `8004/health`=`200`
- viewer `5173`=`200`
- coordinator UI asset=`200`
- coordinator governance files tree=`200`

這證明 deploy implementation在乾淨 child module resolution下可工作；它不把 canonical helper的 exit `2`改寫成 pass。

後續 snapshot顯示 coordinator、viewer、governance與kit-manager仍健康，Kit/spectator ports仍有 listener；conversion `49101` 已無 listener。故 deploy-time readiness通過，但 conversion長時間存活未通過，需獨立診斷。

## PR #398 live Issue verification

### 1. Canonical mounted route：fail closed 且零寫入

Target route：

```text
POST http://127.0.0.1:8004/api/governance/issues/from-a4-search/for-session/{session_id}
```

以合法-shaped Issue draft執行兩個無 bypass probe：

| Probe | HTTP | error_code |
|---|---:|---|
| no auth | `401` | `a4_authentication_required` |
| process-generated local-dev carrier | `503` | `a4_issue_authority_unavailable` |

Canonical deployment的 env key-only audit（不輸出值）確認：

- `A4_INTERNAL_CONTEXT_TOKEN`：未配置非空值
- `A4_PROOF_ACTIVE_KID`：未配置
- `A4_PROOF_ACTIVE_KEY`：未配置
- user auth provider：`local-dev`

Canonical governance internal search另以非機密 probe token實測回 `503 a4_internal_context_unavailable`，與 env audit一致。

`storage/governance.db` 在 probe前後都沒有 `issues` 或 `a4_issue_evidence` table，證明 mounted reject沒有 upstream persistence side effect。這是預期的 security posture，不是 production success path。

### 2. Isolated live owner-service authority：201、replay與 persistence

為避免修改既有 `.env`，從相同 deployment checkout啟動一次性的 host-native governance process：

- bind：`127.0.0.1:49202`
- source：`D:\Users\deploy\AI-bim-geo\governance-service`
- DB：獨立 `scripts\.run\pr398-a4-live-20260724121731_5f1cbe67.db`
- credentials：process-only random test token/signing key，未寫檔、未輸出
- fixture：主工作區 local `storage\e2e-a1\demo\tiny.ifc`（688 bytes）
- query：deterministic `IfcDoor`

Observed flow：

| Step | Result |
|---|---|
| `GET /health` | `200` |
| `POST /api/internal/a4/search/model` | `200`，1 row，`proof_eligible=true`，`issue_eligible=true` |
| selected row | IFC GUID `1aPLZA3Rz8sQ5wH9NVtkZs`，mapping not observed |
| `POST /api/internal/a4/issues/from-search` | `201`，Issue `iss_46dde731ecea`，`source_type=a4_search`，`replayed=false` |
| create response proof check | raw `evidence_proof` absent |
| exact replay | `200`，same Issue ID，`replayed=true` |
| generic `GET /api/issues` | A4 visible count=`0`（session-authorized lifecycle尚未提供） |
| direct isolated DB | `a4_search Issue=1`，`a4_issue_evidence=1` |

Shadow process PID `43908`由本輪啟動並已停止；isolated DB與無 secret的uvicorn request logs保留在 deployment `.run` 作 external evidence。這一輪驗證 governance owner API的真正 persistence/replay contract，但不替代 coordinator authentic principal/lease的 production E2E。

## Tests and aggregate gates

### Targeted gates

| Command | Cwd/runtime | Result |
|---|---|---|
| `npm run build` | deployed coordinator container | pass |
| `vitest run tests/governance-issue-from-a4-session.test.ts` | deployed coordinator container | `7 passed` |
| `pytest test_a4_issues.py test_search_model.py test_search_handoff.py test_search_handoff_api.py` | deployment checkout governance source, Python 3.12 | `120 passed, 1 skipped` |

Governance targeted run另有 5 個 Pydantic deprecation warnings與 1 個 pytest-asyncio configuration warning；不是 assertion failure。

### Aggregate gates（不可標 pass）

`scripts\verify-all.ps1` 一開始因 deployment root `.venv`沒有 pytest/jsonschema而無法 collection；在**只修改 deployment venv package、不改 tracked source/env**後重跑，結果：

```text
101 passed, 12 failed
```

12 個 failure皆引用 canonical helper刻意移除的 path，例如：

- `docs/contracts/structured-log-env-allowlist.md`
- `docs/contracts/streaming-datachannel-events.md`
- `.claude/workflows/routing.json`
- `.claude/workflows/std-*.js`

部署容器的 `npm run verify` 也呈現同類問題：TypeScript build通過，full Vitest失敗包含缺少 `/workspace/tests/contracts/*.json`，另有受 production MinIO/Kit env影響、原本假設「未配置」的測試。沒有為了讓 suite變綠而把 pruned docs/tooling複製回 deployment。

因此目前有一個獨立 contract mismatch：canonical deployment pruning contract與 unscoped aggregate verifier不相容。它不推翻 PR #398 targeted pass，也不能被忽略成 full pass。

## Ruff、browser、design與Kit applicability

- `ruff --version`=`0.15.21`。PR changed 12 個 Python files只有 `governance-service/issues/api.py:13` 的 F401；同一 finding在 base content也存在。其餘 11 檔通過。
- Repo的 CI、deploy、`verify-all`與 governance requirements沒有 Ruff gate/config；deployment venv缺 Ruff不是既定 release failure。
- Machine design scope：`status=not_applicable`、`frontend_product=false`、`visual_required=false`、`required_screen_ids=[]`、`unknown_paths=[]`。
- Pinned design reference integrity：13 screens、26 golden files pass；這不是 pixel comparison。
- PR #398沒有 `web-viewer-sample` production route/button/fixture diff。Browser semantic、pixel fidelity、Kit WebRTC first-frame/stage/DataChannel不屬於此 backend slice的 feature-specific gate，也沒有被本報告宣稱 pass。

## External evidence inventory

External logs/DB沒有 commit進 git；以下 digest不含 secret values。

| File | Bytes | SHA-256 |
|---|---:|---|
| first canonical `rebuild-test-deploy.deploy.stdout.log` snapshot | 11468 | `3a4277e1fb642c811cad1399131f68abb24d4804da1210f8e924211f3e9731e1` |
| second canonical `rebuild-test-deploy.deploy.stdout.log` | 11071 | `1b8433d381392351f276074aaa894b6af1f6fafe5083f0daf3a67155c02b42df` |
| second canonical `rebuild-test-deploy.deploy.stderr.log` | 169 | `c148800c94c5ba86578f8562eadd3301604d59135c44a18a7d62eca32ee4246c` |
| `logs\scripts\2026-07-24\scripts-run_20260724_034107_8af09f.jsonl` | 1269 | `c5508c50a95941ae0b6663bb8641d0e3f58a3a529d4d933d5f06de352a29043f` |
| `pr398-a4-live-20260724121731_5f1cbe67.db` | 65536 | `02bb24ebf7f8730ffa9e153e6d4dde192664210b84cfc5f9ab921fac05047a5c` |
| isolated live stdout log | 385 | `ed5423560feb6cf41b80c12bf00b3a7b6399523502fb55279c739750bb91b9a1` |
| isolated live stderr log | 203 | `70d9f08585225a0025543ce3c3ef9dd0c3615b6fbf58c2af85586ff0b102b1c4` |

Clean-module-path deploy logs仍由已啟動的 runtime children繼承 file handle，因此本輪沒有宣稱穩定 digest；其可讀內容記錄 deploy-time checks與 exit `0`。

## PR machine truth

| Field | Value |
|---|---|
| Frontend route | none in PR scope |
| Main button(s) tested | not applicable |
| Fixture used | `storage\e2e-a1\demo\tiny.ifc`（local ignored input） |
| Backend API called | internal search + internal Issue create；mounted coordinator Issue route |
| Runtime action / ID | Issue `iss_46dde731ecea` in isolated test DB |
| Visible success state | not applicable；backend-only slice |
| E2E command | process-only isolated authority script documented by observed HTTP ledger above |
| Screenshot / trace | none；uvicorn request log + SQLite digest retained externally |
| Design gate status | `not_applicable`; reference integrity separately passed |
| Design screen(s) | none |
| Reference-missing route(s) | none in changed frontend scope |
| Full completion claimed | `no` |
| Design reference manifest | unchanged |
| Visual fidelity result/comparison/artifacts | not applicable / not run |
| Known gaps | canonical helper, authentic identity/lease, A4 secrets, aggregate verifier, conversion long-lived health |

## Verified facts / Inferences / Unverified risks / Next actions

### Verified facts

- Deployment checkout使用正確的 PR #398 merge commit。
- Canonical helper的 Phase 2 failure可重現；clean WindowsPowerShell-only module path使同一 inner deploy通過。
- PR #398 targeted tests通過，owner-service live Issue persistence與 replay通過。
- Mounted coordinator route對 no-auth/local-dev caller fail closed且零寫入。
- Canonical A4 token/proof key未配置；mounted production `201`目前不可成立。
- Aggregate verifier與 canonical pruning contract不相容；full test gate不是綠燈。

### Inferences

- Shared deploy helper在 child boundary正規化 `PSModulePath`是目前最小、最接近 root cause的 durable fix；仍需 regression test與 canonical rerun裁決。
- Conversion `49101`在 deploy-time ready後退出屬另一個 lifecycle問題，不能由 PR #398 targeted evidence推論原因。

### Unverified risks

- 修正後的 canonical `rebuild-test-deploy.ps1 -Build` exit `0`（尚未實作修正）。
- Authentic shared SSO principal、verified primary lease、active stage/model/mapping的 mounted end-to-end `201`。
- Conversion service為何在 deploy-time ready後失去 listener。
- Browser confirmation UI、Kit first-frame/stage/DataChannel與current pixel artifacts；對本 backend slice不適用，但 full-system claim仍缺。

### Next actions

1. 以獨立 Lane G change修正 `Invoke-TestDeployScript`的 cross-edition `PSModulePath` boundary，加 Windows PowerShell child regression test，再跑原 canonical command。
2. 定義 deployment-safe aggregate suite，或調整 verifier讓已被 contract移除的 docs/tooling checks不進 deployment run；不得反向破壞 pruning contract。
3. 由真正 authority owner配置 A4 internal/proof secrets並提供 authentic SSO/lease verification；之後才可用真 session/stage/mapping重跑 mounted `201`。不得把 `lab_unverified`直接改成 `verified`。
4. 另行診斷 conversion `49101`的 post-readiness exit，保留目前 coordinator/governance runtime。
