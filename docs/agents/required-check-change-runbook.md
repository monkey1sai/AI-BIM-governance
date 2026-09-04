# Required-check 變更 Runbook

> 適用：任何會改變 `main` branch protection 所要求的 status check **名稱**的變更。
> 這不是 code 變更就能完成的事；其中一步是 repo **設定**，git 無法 revert，只能由 owner 手動執行。
> 沿用既有機制：`.github/workflows/agent-governance.yml:381-419` 的 name-stable aggregator 是本 runbook 的範本。

## 0. 為什麼需要 runbook

branch protection 以 **名稱 + app_id** 比對 required check。三個事實決定了順序：

1. **一個 required check 若在該 head 上從未被建立，PR 永遠 pending。** skipped（job 存在於 graph、`if:` 為 false）算通過；不存在的 job 不算。
2. **改 `ci.yml` 的那個 PR 會用它自己的新 `ci.yml` 跑**，因此它永遠產不出「舊的」required context → 若先改名再改 protection，該 PR 自我鎖死。
3. required check 名稱有 **四處鏡像** 必須同步：live branch protection、`agent-contracts/trusted-host-merge.contract.json` `executor.required_check_sources`（`:101-112`）、同檔 `verification_target_sources`（`:113-128`）、`scripts/tests/test-agent-governance-check.ps1:931-946` 的逐字簽章。任一處不同步，required `agent-governance` check 立刻變紅。

以下為 2026-09-04 快照的 10 個 required context（`app_id 15368`）：
`agent-governance`、`root contracts and fakes`、`coordinator build and tests`、`governance-service tests`、`viewer build and tests`、`kit-manager-api tests`、`kit-manager-web build`、`docker compose config`、`powershell static analysis`、`secret pattern scan`。

## 1. 會靜默改名的重構（禁止在沒有本 runbook 的情況下做）

| 重構 | 效果 | 結果 |
|---|---|---|
| 把 required job 變成 matrix leg | check-run 名稱變成 `name (leg)` | 舊名稱永不建立 → 所有 open PR 永久 pending |
| 搬進 reusable workflow（`uses: ./.github/workflows/x.yml`） | 名稱變成 `<caller> / <callee>` | 同上 |
| 刪除任何 `verification_target_sources` 列出的 job（即使它不是 required） | `trusted-host-merge-evidence.mjs:511-518` 找不到 check run → `required_check_not_green` | merge executor 失敗 |
| 改 job `name:` 字串 | 名稱不再匹配 | 同第一列 |
| 改動 always()-guarded job 的數量 | `test-agent-governance-check.ps1:322` `-eq 13` 紅 | required check 紅 |

## 2. 安全順序（三階段，不可顛倒）

### Phase A — 引入 name-stable aggregator（純 code，可 revert）

在 `ci.yml` 新增**一個**永遠建立的 roll-up job，形狀複製 `agent-governance.yml:381-419`：

```yaml
  ci-required:
    name: ci-required
    needs: [changes, root-contracts, coordinator, governance-service, viewer, kit-manager-api, kit-manager-web, compose-config, powershell-static, secret-pattern-scan]
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Publish required CI result
        shell: pwsh
        run: |
          # 1. classifier 必須 success，且其 plan 必須綁定本 head（plan_result == planned、subject == head）
          # 2. 每個 needs.<job>.result 只能是 success 或 skipped；skipped 只有在 classifier 說「不需要」時才可接受
          # 3. 任何 failure / cancelled → throw
          # 拒絕 skipped-success：classifier 沒發 plan 就沒有人可以宣稱通過
```

**必須的 plan-bound 斷言**：aggregator 只在 `needs.changes.outputs.plan_result == 'planned'` 且 plan 的 `subject_sha` 等於本次 head 時才發 success。否則「因不相關而 skip」與「因什麼都沒跑而 skip」無法區分——metadata-only `edited` 事件會讓 `changes` 以空輸出成功、13 個下游全 skip，把先前的紅燈洗成綠燈。

此階段：`ci-required` 只是**額外**的 check，舊的 9 個 required 仍在。PR 可正常合併。**可 git revert。**

### Phase B — owner 重指 branch protection（repo 設定，git 不可 revert）

**owner 親自執行**（agent 不得代做）：

```bash
# 1. 讀取現況並存檔（rollback 依據）
gh api repos/monkey1sai/AI-BIM-governance/branches/main/protection/required_status_checks > protection-before.json

# 2. 新增 ci-required（保留舊 9 個；此時是 11 個）
gh api -X PATCH repos/monkey1sai/AI-BIM-governance/branches/main/protection/required_status_checks \
  --input - <<'EOF'
{ "strict": true, "checks": [
  {"context":"agent-governance","app_id":15368},
  {"context":"ci-required","app_id":15368},
  {"context":"root contracts and fakes","app_id":15368}, ... 其餘 8 個 ...
]}
EOF

# 3. 等至少一個真實 PR 在 ci-required 綠燈下合併，作為 parity 證據

# 4. 移除舊的 9 個 ci.yml 個別 context，只留 agent-governance + ci-required
```

同一個 PR 內同步更新四處鏡像中的三處 code 鏡像（contract `:101-112`、`:113-128`、test `:931-946`）——這屬 `candidate_mechanism_change: separate_authorization`，需獨立授權。

**Rollback**：`gh api -X PUT ... --input protection-before.json`。這是 owner 動作。

### Phase C — 自由重構 job 拓樸（純 code，可 revert）

只有在 Phase B 完成、且 protection 只剩 `agent-governance` + `ci-required` 之後，底下 9 個 job 才可自由 matrix 化、搬移、合併——它們的名稱不再是 protection 的一部分。`verification_target_sources` 仍需維護（merge executor 用它找 check run）。

## 3. 每次動 required check 前的檢查清單

- [ ] `gh api .../branches/main/protection` 已讀取並存檔
- [ ] 四處鏡像的 diff 已列出
- [ ] `test-agent-governance-check.ps1` 的 `-eq 5` / `-eq 13` / `>= 31` 計數已對照
- [ ] PINNED_LOAD_BEARING 若受影響，已用 `-DumpFingerprints` 更新
- [ ] 不會讓任何目前 open 的 PR 在 protection 變更瞬間變成永久 pending（改名前先加、改名後再刪）
- [ ] rollback 命令已寫在 PR body

## 4. 與本 repo 其他契約的關係

- `docs/agents/self-referential-bootstrap.md`：改 `.github/workflows/**` 是 mechanism change；Lean policy 下 `bootstrap = no`，ledger 不可動。
- `docs/agents/agent-governance-policy.md`：rules 只能新增、不能靜默移除；改動 `yaml_every` 所涵蓋的 job 要先看 rule。
- `docs/plans/agent-hooks-ci-convergence-redesign.md` §6.3、§11 Phase 2：本 runbook 的來源與量測依據。
