> 文件性質：**contract**。本檔是機器強制的閘門契約，實作為
> `scripts/lib/self-referential-bootstrap.ps1` ＋ `scripts/self-referential-bootstrap-ledger.json`，
> 於 PR 時由 `scripts/tests/check-pr-body-evidence.ps1` 裁決。不是 working note，也不是完成證據。
>
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

## 2.1 範圍界定（何謂 mechanism surface）

機制清單的收錄判準是單一謂詞：**該路徑的行為改變會改變其他 PR 的裁決結果，或改變 canonical deployment 的驗證結果**。§2 觸發通則的三個類別逐類收斂如下：

1. **裁決者及其直接決策依賴** — required CI / merge 治理的 gate scripts、workflows、verification manifest、CODEOWNERS、本機制自身。
2. **canonical deploy path** — 部署契約只重建／驗證已 merge 的內容，branch 上取不到 post-change canonical evidence。
3. **evidence harness** — 僅限其輸出被第 1 或第 2 類**以機器方式消費**的 harness（煙霧證據、視覺 gate、runtime evidence 驗證器等）。

**明確排除**：產品量測／遙測腳本 — 輸出餵人工撰寫的文件或產品決策、沒有任何 gate 以機器方式消費其報告者，不屬 mechanism surface。「新腳本自行定義自己的報告格式」是所有新程式碼的常態，由一般 code review 與單元測試把關；§1 循環的定義性特徵是**契約禁止在 merge 前用正規機制對變更後行為取證**，而非「報告格式沒有前版可比」。

**升級規則**：後續 PR 把此類腳本的輸出接進第 1／2 類的任何機器消費者時，該接線 PR 必然觸及 mechanism surface（manifest／workflow／gate script），**必須在同一 PR 把該腳本加入 `Get-SelfReferentialMechanismPaths`**；該腳本自此成為 mechanism surface。反向亦同：要從清單移除一個路徑，必須先移除它的所有機器消費者。

## 2.2 Regression-repair lane（修復既有 open debt 的唯一通道）

fixpoint 首跑本身就是機制的第一次正規執行，因此**可能就地驗出該機制的 regression**。在此之前契約沒有任何合法修復通道：宣告既有 entry 被 impersonation guard 擋（entry 必須是本 PR 新增）、自增新 entry 被「其他 open debt」擋、宣告 `bootstrap=no` 也被同一道 open debt 擋 — 三面互鎖（issue #494）。

Repair lane 只開一扇門：**修復 PR 把自己的 PR number 追加到該 open entry 的 `repair_prs`**，藉此以機器方式把修復綁定到既有債務，而不是新增或竄改債務。`repair_prs` 是選填的正整數陣列，必須嚴格遞增且不得重複；未列出者等同空陣列（repair lane 之前寫入的 entry 因此保持可解析且不可變）。

**新開 entry 不得帶 `repair_prs`**（含空陣列 `[]`）；該欄位只能由 repair transition 追加產生。schema 層的「選填」僅為了讓 repair lane 之前寫入的 entry 維持可解析，不是允許自我登記時憑空宣告修復歷史 —— 那種記錄從未經過 repair transition，也從未綁定任何修復 PR 的號碼。

放行的**五個條件（缺一即 fail closed）**：

1. PR body 宣告的 entry 在 **PR base 已存在且 `status=open`**，在 head 仍為 `open`。
2. 本 transition 對該 entry 的**唯一**差異是 `repair_prs` 的**尾端追加**，且追加內容**恰好等於本 PR number**（單一值）。無法取得 live PR number 時直接拒絕，不得略過驗證。
3. 本 PR 命中機制清單的 changed paths **全部落在該 entry 已宣告的 `verification_mechanism_paths` 之內**（case-sensitive）。要改該範圍以外的機制，開新 entry。
4. 本 PR **不得修改本 gate 自身的 adjudicator**（`$script:SelfReferentialAdjudicatorPaths`）。修改裁決者仍須依 §2／§3 另開 debt，不能藉 repair lane 讓被改過的規則裁決自己。
5. 同一 transition **不得新增任何 entry，也不得關閉任何 entry**，且**只能修復 body 具名的那一個 entry** — 整個 transition 至多一筆 `repair_prs` 追加。否則未具名的 entry 稽核歷史會被改動，卻沒經過它自己的 PR number 與範圍檢查。

Repair lane **不放寬**任何既有不變式：ledger 仍為 append-only（`repair_prs` 只能追加，既有元素不可改寫或刪除）；entry 除 `repair_prs` 外所有欄位仍不可變，唯一合法狀態轉移仍是一次 `open → closed`；closure 仍須提交完整且全綠的 fixpoint attestation（修復後的機制必須自己通過該 entry 凍結的 `verification_contract`）；同一 transition 仍不得一邊關債一邊開債；closed entry 仍完全不可變 — `repair_prs` 不是進入 closed entry 的後門。

**刻意不設的一道檢查**：repair lane **不**因「存在其他 open debt」而拒絕。這是設計，不是遺漏 —— 若修復 PR 也要被其他未清債務擋住，就會在允許多筆 open entry 的未來重現本節要解的死鎖（修復需要債先關、債關需要修復先 merge）。開新債仍受 §3 的 open-debt 封鎖約束；**清舊債的通道不受它約束**。現行契約下同時至多一筆 open entry，故此條今日不可觀察，先寫明意圖以免日後被誤讀為缺口。

## 3. Ledger 機制

- Ledger：`scripts/self-referential-bootstrap-ledger.json`（schema `self-referential-bootstrap-ledger/v1`）。
- **Gate 以 base-vs-head 轉移判定**（非只看 head）：ledger 為 append-only，entry 除唯一合法轉移 `open → closed` 外不可變。刪除 entry、修改既有 entry、或宣告一個「base 已存在」的 entry 一律 fail closed；宣告的 entry 必須是**本 PR 新增**（自我登記的機器證明）。
- **Fixpoint 實質驗證**：`mechanism_commit` 必須真實存在、位於 PR base 的 first-parent mainline（即該機制的 merge/squash commit）、以 first-parent diff 真正修改 entry 宣告的機制 path，且 merge/squash subject 必須綁定該 entry 的原始 PR number；`evidence_refs` 必須存在於 PR head tree，且 base/head blob OID 必須不同（mode-only／metadata-only change 不算新證據）。每次閉合另須提交嚴格 JSON attestation，逐項綁定 entry、mechanism commit、不可變 verification contract 與每條 command 的零 exit code。格式正確但查無實體者拒絕。缺 base context 時拒絕任何閉合（refusing format-only closure）。
- 新 entry 綁定：`pr` 必須等於當前 PR number（live check 傳入）；`verification_mechanism_paths` 必須是本 PR changed paths 的子集；`bootstrap_evidence_refs` 必須存在於 head tree，並且是 base 不存在的新 blob 或 base/head blob OID 不同的內容更新。
- 觸發清單含 **enforcement 面本身與直接依賴**：`agent-governance.yml`、`pr-review-agent.yml`、`ci.yml`、`scripts/verification-manifest.json`、驗證 helper／policy／config、bootstrap regression suites、CODEOWNERS — 改掉執法者或其直接決策依賴也是改機制。classifier regression 必須逐一路徑證明它們都能進入 debt gate。
- 使用 bootstrap 取證的 PR **必須在同一個 PR 內新增自己的 open entry**（自我登記），並在 PR body 填：

| Item | Result |
|---|---|
| Self-referential bootstrap | yes / no |
| Bootstrap ledger entry | entry id（`yes` 時必填） |
| Bootstrap reason | 具體機制缺口（`yes` 時必填，>=30 字元） |

- **債務閘門**：open debt 以 **base ∪ head** 計算 — head 刪掉也照樣算帳。存在任何 open entry 時，下一個觸發本規則的 PR 被機器擋下（不影響無關 PR）。清除欠帳的唯一方式＝commit 通過實質驗證的 fixpoint 記錄，該 commit 本身可被 review；同一個 transition 不得一邊關閉既有 debt、一邊新增下一筆 debt。
- **Closure 單一目的**：關閉 entry 的 PR 在 mechanism surface 內只能修改 ledger；不得同時修改其他驗證機制。修改本 gate 自己的 adjudicator 或本 contract 一律要宣告 `bootstrap=yes` 並新增 debt，不能用 `no` 讓新規則自證。
- open entry 不得帶 fixpoint；closed entry 必須帶完整 fixpoint。entry 的 `verification_contract` 在 opening 時固定，`id` 與有序 `command_ids` 以 LF 串接後的 SHA-256 必須等於 `contract_sha256`，後續 transition 不得改寫。base ledger 已引用的 bootstrap／fixpoint evidence 亦不可由後續 PR 改寫或刪除；gate 以 base/head blob OID 判定。ledger 完整性每次 CI 驗證（`scripts/tests/test-self-referential-bootstrap.ps1`），malformed 一律 fail closed。

本 contract 檔本身也由 `Get-SelfReferentialMechanismPaths` 分類為 mechanism surface；修改契約文字不能繞過同一份 ledger 義務。

## 4. Entry schema

```json
{
  "id": "kebab-case-slug",
  "status": "open | closed",
  "pr": 123,
  "opened_at": "2026-07-31T00:00:00Z",
  "reason": "why the pre-change mechanism cannot produce this evidence",
  "verification_mechanism_paths": ["scripts/deploy.ps1"],
  "verification_contract": {
    "id": "gate-name/v1",
    "command_ids": ["stable-command-id"],
    "contract_sha256": "<sha256 of id plus ordered command_ids, LF-separated>"
  },
  "bootstrap_evidence_refs": ["docs/evidence/<slug>/self-referential-bootstrap/..."],
  "fixpoint": null
}
```

`bootstrap_evidence_refs` 的每個 ref 必須含 `self-referential-bootstrap`（或底線變體）字樣，作為 stack kind 標示。新 entry 不帶 `repair_prs`；該欄位是選填的嚴格遞增正整數陣列，只由 §2.2 repair lane 追加。closed 時 `fixpoint`：

```json
{
  "reverified_at": "2026-08-01T00:00:00Z",
  "mechanism_commit": "<merge 後 origin/main 上的 40-hex commit>",
  "evidence_refs": [
    "docs/evidence/<slug>/fixpoint/summary.md",
    "docs/evidence/<slug>/fixpoint/attestation.json"
  ]
}
```

所有 fixpoint refs 必須位於 `docs/evidence/<slug>/fixpoint/`，且必須恰有一個 `attestation.json`。attestation 的 exact-head blob schema：

```json
{
  "schema_version": "self-referential-fixpoint-attestation/v1",
  "entry_id": "kebab-case-slug",
  "mechanism_commit": "<same 40-hex commit as ledger fixpoint>",
  "verification_contract_sha256": "<same immutable contract digest as ledger entry>",
  "result": "pass",
  "commands": [
    { "id": "stable-command-id", "exit_code": 0 }
  ]
}
```

`commands` 的順序與集合必須精確等於 opening contract 的 `command_ids`，不得漏項、重複或改名。此 attestation 是 PR-authored evidence：它提供嚴格的語意與 commit／contract 綁定，但不單獨證明可信 runner provenance；exact-head CODEOWNER approval、base-owned gate 與 live branch protection 仍是 merge trust root。

## 4.1 已知邊界（trusting-trust）

歷史上的 `pull_request` required context 執行 PR 自己樹上的 workflow YAML，因此 PR 可保留同名 job 卻刪除真正 gate。該 context 不具獨立信任根，不能再作 merge authority。

本次修復把 `PR Metadata Contract` 改為 `pull_request_target` base-owned diagnostic：checkout 固定為 `pull_request.base.sha`，`permissions` 只有 `contents: read`；PR head 的 body、changed paths 與 git objects 只作資料解析，不 checkout、不 dot-source、不執行 head code，也不使用 head-controlled action。base capability incomplete 時固定輸出 `base_gate_incomplete_external_approval_required` 並 fail closed，禁止 grep 後改跑 head checker。

這個 base-owned definition 只有合併後才保護後續 PR，不能替導入它的 bootstrap PR 自證。PR #459 在 merge 前維持 HELD，直到 live branch protection 將舊 `pr-metadata-contract-diagnostic` 移出 required contexts，並由 base `.github/CODEOWNERS` 指定的 `monkey1sai-blip` 對 final head 做一次性 approval；任何新 push 都必須重新 approval。若 live protection 尚未完成該遷移，文件不得宣稱 SEC-001 已關閉。

未來若有 dedicated external GitHub App 具 `checks:write`，可另建 exact-head required check 並以 expected App source 綁定。repository owner 為 User，不能使用 organization-level required workflow ruleset。

## 5. 已知實例

- 測試部署區遷移（`docs/plans/remote-linux-test-deploy-target.plan.md` §5）：PR 改 deploy path 本身，部署區依契約只驗 `origin/main`。
- PR #458 single-owner merge consent：修改 merge 治理的 PR 無法用新治理 merge 自己，需一次性手動 bootstrap — 同模式第二實例。
- **Scope 反例**（PR #511 review thread → issue #520 裁決紀錄）：GPU session baseline 量測 harness（`scripts/measure-session-baseline.ps1`，由 PR #511 引入）被主張應入機制清單；依 §2.1 判準裁決為**不屬 mechanism surface** — 其報告無任何 gate 機器消費者，僅餵人工撰寫的 SLO 文件。若日後被接進 gate，依升級規則於接線 PR 補登。升級規則本身維持 review 強制（非機器強制）：把它機器化等於再改一次 adjudicator，須依本規則另開 debt，收益不成比例。
