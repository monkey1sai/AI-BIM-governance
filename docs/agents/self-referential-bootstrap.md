> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> 何時讀本檔：PR 的變更對象包含驗證機制本身（deploy path / evidence harness / gate script），或需要關閉 bootstrap ledger 欠帳時。

# Self-Referential Change Bootstrap

> 本規則刻意以**可攜形式**撰寫：不綁定任何產品專有名詞。規則文字與 ledger **格式**屬治理腳手架（可搬遷）；ledger **內容**屬本 repo（留下）。機器實作：`scripts/lib/self-referential-bootstrap.ps1` ＋ `scripts/self-referential-bootstrap-ledger.json`。

## 1. 問題

當一個 PR 的變更對象**包含驗證機制本身** — deploy path、evidence harness、gate script、或決定 evidence 是否成立的契約 — 該 PR 無法用「變更前的機制」取得代表「變更後行為」的證據：

```txt
新機制要驗證 → 只能用驗證機制驗 → 驗證機制只認已 merge 的內容 → 得先 merge
                                                                    ↑
                                                  但沒驗過就不該 merge ──┘
```

這不是特定遷移的一次性例外，是驗證機制自我指涉時的**通用形狀**（編譯器 bootstrap 問題）。標準解是 fixpoint：用舊機制建新機制 → merge 後用新機制重建自己 → 兩者一致才算通過。

## 2. 規則

**觸發（通則）**：PR 的 changed paths 命中 `Get-SelfReferentialMechanismPaths` 的機制清單（canonical deploy path、evidence harness、adjudicating gate scripts、本機制自身）。

觸發時允許以 `stack_kind=self_referential_bootstrap` 在該 branch 上取證，並承擔三條義務（**缺一則 evidence 視為未閉合**）：

1. **標示** — evidence 必須標 `stack_kind=self_referential_bootstrap`，不得被引用為 deploy-target evidence 或 `isolated_branch_stack` evidence；三者互不推論。
2. **理由** — 必須具體說明「為何既有機制取不到此證據」；泛稱（"bootstrap"、"needed"）不通過。
3. **fixpoint 重驗** — merge 後必須以**變更後的正規機制**重跑同一驗證，並把結果 commit 回 ledger（`fixpoint` 欄位）。

## 3. Ledger 機制

- Ledger：`scripts/self-referential-bootstrap-ledger.json`（schema `self-referential-bootstrap-ledger/v1`）。
- **Gate 以 base-vs-head 轉移判定**（非只看 head）：ledger 為 append-only，entry 除唯一合法轉移 `open → closed` 外不可變。刪除 entry、修改既有 entry、或宣告一個「base 已存在」的 entry 一律 fail closed；宣告的 entry 必須是**本 PR 新增**（自我登記的機器證明）。
- **Fixpoint 實質驗證**：`mechanism_commit` 必須真實存在且為 PR base 的 ancestor（即已 merge 進 main），`evidence_refs` 必須存在於 PR head tree；格式正確但查無實體者拒絕。缺 base context 時拒絕任何閉合（refusing format-only closure）。
- 新 entry 綁定：`pr` 必須等於當前 PR number（live check 傳入）；`verification_mechanism_paths` 必須是本 PR changed paths 的子集；`bootstrap_evidence_refs` 必須存在於 head tree。
- 觸發清單含 **enforcement 面本身**：`agent-governance.yml`、`pr-review-agent.yml`、`ci.yml`、`scripts/verification-manifest.json` — 改掉執法者也是改機制。
- 使用 bootstrap 取證的 PR **必須在同一個 PR 內新增自己的 open entry**（自我登記），並在 PR body 填：

| Item | Result |
|---|---|
| Self-referential bootstrap | `yes` / `no` |
| Bootstrap ledger entry | entry id（`yes` 時必填） |
| Bootstrap reason | 具體機制缺口（`yes` 時必填，>=30 字元） |

- **債務閘門**：open debt 以 **base ∪ head** 計算 — head 刪掉也照樣算帳。存在任何 open entry 時，下一個觸發本規則的 PR 被機器擋下（不影響無關 PR）。清除欠帳的唯一方式＝commit 通過實質驗證的 fixpoint 記錄，該 commit 本身可被 review。
- open entry 不得帶 fixpoint；closed entry 必須帶完整 fixpoint — ledger 完整性每次 CI 驗證（`scripts/tests/test-self-referential-bootstrap.ps1`），malformed 一律 fail closed。

## 4. Entry schema

```json
{
  "id": "kebab-case-slug",
  "status": "open | closed",
  "pr": 123,
  "opened_at": "2026-07-31T00:00:00Z",
  "reason": "why the pre-change mechanism cannot produce this evidence",
  "verification_mechanism_paths": ["scripts/deploy.ps1"],
  "bootstrap_evidence_refs": ["docs/evidence/<slug>/self-referential-bootstrap/..."],
  "fixpoint": null
}
```

`bootstrap_evidence_refs` 的每個 ref 必須含 `self-referential-bootstrap`（或底線變體）字樣，作為 stack kind 標示。closed 時 `fixpoint`：

```json
{
  "reverified_at": "2026-08-01T00:00:00Z",
  "mechanism_commit": "<merge 後 origin/main 上的 40-hex commit>",
  "evidence_refs": ["docs/evidence/<slug>/fixpoint/..."]
}
```

## 4.1 已知邊界（trusting-trust）

本 gate 是 `pull_request` 觸發的 required check，執行的是 **PR 自己樹上的 workflow YAML**（同 repo PR 的 GitHub 限制）。因此存在一個靜態檢查無法自我封閉的殘餘面：一個 PR 若同時修改 `pr-review-agent.yml`，可保留 required job 名稱、卻刪除「materialize base-pinned gate + 呼叫」步驟，使 check 變綠卻從未跑過 base-pinned checker（round-4 P1）。

現行緩解（非完全封閉）：`pr-review-agent.yml` 已在 mechanism 清單內 → 改它必須宣告 bootstrap 並登記 ledger 欠帳，reviewer 看得到；gate 腳本本身取自 base revision。**完全封閉需 owner 決策**：改用 base-owned 觸發（`pull_request_target`，會把 secrets 暴露給 PR-triggered context，屬安全姿態變更）或 org-level required action。此為分家後腳手架的待決項，不由自動流程擅改。

## 5. 已知實例

- 測試部署區遷移（`docs/plans/remote-linux-test-deploy-target.plan.md` §5）：PR 改 deploy path 本身，部署區依契約只驗 `origin/main`。
- PR #458 single-owner merge consent：修改 merge 治理的 PR 無法用新治理 merge 自己，需一次性手動 bootstrap — 同模式第二實例。
