# PR #398 測試部署區風險驗證

日期：2026-07-24（Asia/Taipei）

範圍：PR #398 `feat(a4): persist session-bound search issues`

subject commit：`64cadb06c8eba6400aecb8f75125dd2f7df2e1b7`

驗證角色：Terra deployment verifier（唯讀）＋ coordinator 獨立複核

## 結論

測試部署區已重建到正確的 `origin/main` commit，但 canonical deploy 在 Phase 2 design-assets staging 失敗，exit code 為 `2`。因此本次不能宣稱 deployment、`verify-all`、A4 live flow、browser runtime 或 Kit/WebRTC 通過。

原 closeout 中的兩組 residual risk 經本輪重分類如下：

| 項目 | 本輪判定 | 證據摘要 |
|---|---|---|
| Ruff 工具不可用 | **已否定，但仍有 baseline lint finding** | PATH 有 `ruff 0.15.21`；PR changed Python files 只有一個 base 已存在的 F401，其餘 11 檔通過 |
| Ruff 是 release/deploy gate | **否** | CI、deploy、`verify-all` 與 governance requirements 都沒有 Ruff gate/config |
| Browser feature E2E | **對本 PR 不適用** | PR 沒有 `web-viewer-sample` 或 production frontend route/button/fixture 變更 |
| Design pixel fidelity | **對本 PR 不適用** | machine change-scope=`not_applicable`、`visual_required=false`；pinned reference integrity 另行通過，但不是 pixel result |
| Kit/WebRTC first-frame | **本 PR 無 feature-specific 適用面；deployment smoke 未觀察** | deploy 未啟動 runtime；無 first-frame、stage truth 或 DataChannel ack |
| A4 live production flow | **仍未驗證** | mounted lease capability 仍為 `lab_unverified`；success path 需要 authentic session/lease/stage/model/mapping/proof |
| Full completion | **no** | canonical deploy 未完成，且 production A4 success path 仍不可操作 |

## Canonical test-deploy execution

從以下 worktree 執行：

```text
C:\Repos\active\iot\AI-BIM-governance.worktrees\pr398-test-deploy-risk-evidence
```

精確命令：

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

執行結果：

| Field | Observed |
|---|---|
| Started | `2026-07-24T11:07:48.1374597+08:00` |
| Finished | `2026-07-24T11:10:58.6567564+08:00` |
| Exit code | `2` |
| Helper lifecycle run id | `run_20260724_030812_28a15f` |
| Helper origin-main commit | `64cadb06c8eba6400aecb8f75125dd2f7df2e1b7` |
| Deployment checkout HEAD | `64cadb06c8eba6400aecb8f75125dd2f7df2e1b7` |
| Deployment path | `D:\Users\deploy\AI-bim-geo` |
| Previous checkout retained | `D:\Users\deploy\.AI-bim-geo.rebuild-previous-2a15cd44740041e5b56eee608db6a150` |
| Process stopped by verifier | none |

Helper 依 contract 移除 deployment checkout 的 agent/tooling docs 並保留 local env files，因此 deployment checkout 的工作樹不以 clean status 作成功判準；commit identity 以 `HEAD`／`origin/main` 驗證。

Helper lifecycle log確認 previous checkout已保留作 recovery；該目錄目前存在、具standalone `.git`與`scripts/deploy.ps1`。本輪未嘗試restore，也未刪除任何previous checkout。

### External log inventory

Logs 未複製進 git；下列 digest 固定本次觀察到的內容，且未在本文件輸出 secret/env values。

| File | Bytes | SHA-256 |
|---|---:|---|
| `D:\Users\deploy\AI-bim-geo\scripts\.run\deploy.log` | 3266 | `765f457fee7c5c30ba9ddc403e25fedda6fe21ce785ee59013150f117f61ecb1` |
| `D:\Users\deploy\AI-bim-geo\scripts\.run\rebuild-test-deploy.deploy.stdout.log` | 11468 | `3a4277e1fb642c811cad1399131f68abb24d4804da1210f8e924211f3e9731e1` |
| `D:\Users\deploy\AI-bim-geo\scripts\.run\rebuild-test-deploy.deploy.stderr.log` | 169 | `c148800c94c5ba86578f8562eadd3301604d59135c44a18a7d62eca32ee4246c` |
| `D:\Users\deploy\AI-bim-geo\scripts\.run\deploy-audit.json` | 12541 | `f8f91d6e66aec63e0fffad73ac4f27dab2fe01d3bc74f756934bc705c9a6e63a` |
| `logs\scripts\2026-07-24\scripts-run_20260724_030812_28a15f.jsonl`（evidence worktree） | 1269 | `0a944ad4eba0a2897b3adcb0d9e6ecdb644d1327108c95fc5ef8ec1db5bc0f12` |

## Deployment failure card

### Symptom

`deploy.ps1 -Build` 在 Phase 2 結束：

```text
design assets staging failed: The term 'Get-FileHash' is not recognized as
the name of a cmdlet, function, script file, or operable program.

Status: FAILED (exit 2, Phase 2 (design assets))
```

### Context

- OS/shell：Windows；helper 由 PowerShell 執行，child deploy 使用 `powershell.exe -NoProfile`。
- Deploy mode：hybrid web-plane Docker + host-native Kit。
- Failing call path：`scripts/deploy.ps1` → `Sync-DeploymentDesignAssets` → `Get-DeploymentDesignAssetHash` → `Get-FileHash`。
- Deploy preflight 回報 coordinator/viewer/governance/conversion/Kit target ports 皆 free；不是 Phase 3 port ownership blocker。

### Root-cause evidence

已完成兩輪 read-only probe：

1. 目前 `pwsh 7.5.4` 與 fresh `powershell.exe 5.1.26100.6899 -NoProfile -NonInteractive` 都能解析 `Get-FileHash`，來源均為 `Microsoft.PowerShell.Utility`。
2. Fresh Windows PowerShell child dot-source deployment checkout 的 `scripts/lib/design-assets.ps1` 後，能對實際 staged PNG 執行 `Get-DeploymentDesignAssetHash`，結果符合 64 位 hex digest。
3. Fresh child 執行完整 `Assert-DeploymentDesignAssetsPrestaged` 也成功，回報 `Mode=prestaged`、`Count=10`。
4. Static scan 未找到 deploy path 內的 `Remove-Module`、`PSModuleAutoLoadingPreference`、alias 或 function removal。

因此已排除「Windows PowerShell 5.1 不支援 `Get-FileHash`」與「cmdlet 全域缺失」。目前只能把 failure 定位到**原長生命週期 deploy session 在 Phase 2 的 command-resolution state**；缺少 failure 當下的 module/command telemetry，尚不能確認是哪個前置操作造成 state drift。

### Smallest next diagnostic（未執行）

在 `Sync-DeploymentDesignAssets` 前記錄 `Get-Command Get-FileHash`、command source、PowerShell version、`Microsoft.PowerShell.Utility` loaded/available module metadata，再重跑同一條 canonical helper。未確認 root cause 前，不以直接 import module或改 hash implementation當作修正。

### Regression guard status

尚未新增。應在 root cause 確認後，先建立能在與 production helper 相同 child-shell lifecycle 重現的 failing test，再實作單一修正並重跑 canonical rebuild。

## Post-failure runtime evidence

失敗後 coordinator 8004、viewer 5173、Kit 49100、conversion 49101、governance 49102、kit-manager 8010 與 spectator 49110/49120/49130/49140/49150 均為 `listener_count=0`。

下列 endpoints 皆 unreachable：

```text
http://127.0.0.1:8004/health
http://127.0.0.1:8004/ui
http://127.0.0.1:5173/health
http://127.0.0.1:49102/health
http://127.0.0.1:49101/health
http://127.0.0.1:49100/
http://127.0.0.1:8010/health
```

這只證明 canonical deploy 沒有完成並且 runtime 未啟動；不能推論 PR #398 runtime correctness。因 rebuild 未成功，`D:\Users\deploy\AI-bim-geo\scripts\verify-all.ps1` **未執行，並非 pass**。

## Ruff verification

### Availability

```text
ruff --version
ruff 0.15.21
exit 0
```

Deployment venv 並未安裝 Ruff：

```text
D:\Users\deploy\AI-bim-geo\.venv\Scripts\python.exe -m ruff --version
No module named ruff
exit 1
```

Repo 沒有 root/governance `pyproject.toml`、`ruff.toml` 或 `.ruff.toml`；`.github/workflows`、`scripts/deploy.ps1`、`scripts/verify-all.ps1` 與 `governance-service/requirements.txt` 的 Ruff reference count 為 0。因此 deployment venv 沒有 Ruff 不構成已定義 release/deploy gate failure。

### Affected-files result

對 PR base `a9f68c6e3bb72771a740e033c126d4e47e72040f` 到 merge commit的 12 個 changed Python files執行：

```powershell
ruff check <12 changed Python files>
```

結果為一個 F401：

```text
governance-service/issues/api.py:13
`.store.ISSUE_STATUSES` imported but unused
```

同一檔的 base content 以 stdin 重跑也得到同一 F401；排除該 base-known 檔後，其餘 11 個 changed/new Python files為 `All checks passed`。因此本輪沒有發現 PR #398 新增的 Ruff finding，但 repo baseline仍非全綠。

## Browser、design、Kit 與 live A4 applicability

### Design scope

以 PR exact base/head paths 呼叫 `Get-DesignSystemChangeScope`：

```text
status=not_applicable
frontend_product=false
visual_required=false
required_screen_ids=[]
unknown_paths=[]
```

Pinned reference integrity另行實測：

```text
scripts/tests/verify-design-system-reference.ps1
passed — 13 screens, 26 golden files
exit 0
```

這只證明 manifest/baseline integrity，不是 current pixel/semantic fidelity result。PR #398 的 20 個 changed files沒有 `web-viewer-sample`，`bim-review-coordinator/src/app.ts` 只新增 route import/mount；沒有 production frontend route、button、browser default fixture 或 visible states。因此 feature-specific browser/design gate對此 backend slice不適用。

### Kit/WebRTC

Kit generic process/port即使健康也不能替代 WebRTC first-frame、stage truth或DataChannel ack。本次 deployment未啟動，這些 evidence皆 `not observed`；它們不應被寫成 pass，也不是 PR #398 backend route的 feature-specific完成條件。

### Live A4 success path

新增 backend route是：

```text
POST /api/governance/issues/from-a4-search/for-session/{session_id}
```

目前 mounted resolver仍在 `bim-review-coordinator/src/app.ts` 產生 `primary_lease_capability: "lab_unverified"`；README與測試均把該狀態定義為 fail closed `503`。實際 production success需要server-authenticated principal、current primary lease、active stage/model/mapping、signed row proof與已啟動的coordinator/governance。

Live model本身不是 additive persistence contract的必要證明，但完整的「搜尋結果 → 使用者確認 → persisted Issue」production flow仍因 authentic lease authority與本次deploy failure而未驗證。

## Verification ledger

| Command/probe | Cwd | Result |
|---|---|---|
| `.\scripts\dev\rebuild-test-deploy.ps1 -Build` | evidence worktree | exit 2，Phase 2 blocker |
| `git rev-parse HEAD` / `origin/main` | deployment checkout | both `64cadb06...` |
| target-port listener probe | local host | 11 ports，listener count皆0 |
| seven HTTP endpoint probes | local host | all unreachable |
| `ruff --version` | evidence worktree | 0.15.21，exit 0 |
| deployment venv `python -m ruff --version` | deployment checkout | module missing，exit 1 |
| `ruff check` changed Python files | evidence worktree | one base-known F401 |
| `ruff check` remaining 11 files | evidence worktree | pass |
| `Get-DesignSystemChangeScope` | evidence worktree | not_applicable |
| `verify-design-system-reference.ps1` | evidence worktree | pass |
| fresh PS5 design-assets hash/manifest probes | deployment checkout | pass |
| `verify-all.ps1` | deployment checkout | not run；rebuild prerequisite failed |

## Verified facts / Inferences / Unverified risks / Next actions

### Verified facts

- Deployment checkout使用正確的PR #398 merge commit。
- Canonical build-only deploy停在Phase 2，沒有任何 runtime listener。
- Ruff CLI目前可用；PR changed Python files沒有新增 Ruff finding，但有一個base-known F401。
- Machine design scope對PR #398為`not_applicable`。
- Mounted A4 lease capability仍為`lab_unverified`，production mutation刻意fail closed。

### Inferences

- Phase 2 failure與原長生命週期deploy session的command-resolution state有關；fresh child無法重現。
- Deployment venv不含Ruff是dev-tooling差異，不是repo已定義的runtime/release gate。

### Unverified risks

- `Get-FileHash`在原deploy session失去解析能力的確切觸發點。
- Canonical deploy、aggregate verify與所有service health。
- Authentic A4 session/lease/stage/model/mapping/proof的live 201 flow。
- Browser-visible A4 confirmation、Kit first-frame/stage/DataChannel與current visual artifacts；其中browser/design/Kit不屬於本PR backend diff的feature-specificgate，但full-system claim仍不得使用它們。

### Next actions

1. 先對Phase 2 command-resolution加入最小、無secret的pre-stage telemetry，重跑相同canonical helper以確認root cause。
2. root cause修復後，必須重新執行`.\scripts\dev\rebuild-test-deploy.ps1 -Build`；只有exit 0後才跑deployment checkout的`.\scripts\verify-all.ps1`與runtime health probes。
3. A4 production E2E另需真正的shared/authenticated primary-lease authority；不得把`lab_unverified`直接改成`verified`來取證。
