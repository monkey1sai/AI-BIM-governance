> 文件性質：**contract**。機器實作為
> `scripts/lib/self-referential-bootstrap.ps1` 與
> `scripts/self-referential-bootstrap-ledger.json`，由
> `scripts/tests/check-pr-body-evidence.ps1` 在 PR 時裁決。
>
> Loaded lazily by AGENTS.md / CLAUDE.md。Source of truth：AGENTS.md
> §0.0 Lean Governance & Subtraction Directive。

# Self-Referential Change Governance

## 1. 現行政策

自 Lean Governance commit
`2a759f4ac488750c4f3e1e1945b4d5de9f936b50` 起，驗證機制變更採
**single-PR closure**：

- 不再新增 fixpoint、classifier repair、ledger reconciliation 或
  ledger-only closure PR。
- `Get-SelfReferentialMechanismPaths` 仍分類 deploy path、evidence
  harness、gate script 與直接裁決依賴，但命中結果是 review advisory，
  不是建立新治理債務的指令。
- `parallel-delivery-fabric` 的 Phase 0 調和同樣適用此 closure：future
  fixpoint 或 reconciliation 工作以單一 ordinary protected PR 收斂，並且
  明確不改寫 historical lifecycle ledger；該 archive 持續 byte-frozen。
- 一般 PR body 填 `Self-referential bootstrap = no`，且不得修改
  `scripts/self-referential-bootstrap-ledger.json`。
- typecheck、tests、GitNexus、CODEOWNER、exact-head review、branch
  protection 與其他 P0–P7 gate 不因本政策降低。

機器閘門仍先讀取 PR base/head 的精確 ledger，解析完整 schema、驗證
歷史 evidence blob，並拒絕任何歷史 row 改寫、刪除或格式漂移；通過後才
對 mechanism paths 發出 non-blocking warning。

## 2. 歷史 ledger

`scripts/self-referential-bootstrap-ledger.json` 是 closed historical
archive，schema 為 `self-referential-bootstrap-ledger/v1`。現行規則：

1. base 與 head 的 ledger bytes 必須相同。
2. 不得新增 entry、追加 `repair_prs`、執行 `open → closed`、建立
   `successor_of`，或修改 ledger 引用的 bootstrap/fixpoint evidence。
3. 所有既有 closed rows、contract digest、mechanism commit 與 evidence
   refs 保持可重播；legacy transition code/tests 僅供歷史驗證，不授權
   新 PR 重新啟動舊 fixpoint lifecycle。
4. malformed ledger 或任何 open debt 都 fail closed；不得把 warning
   policy 當成 ledger integrity bypass。

## 3. PR #704 一次性 migration

PR #704 是從舊 executable debt gate 移到 Lean single-PR policy 的唯一
bootstrap bridge。它不是可編輯 registry，也不提供 future bypass。head
gate 必須同時驗證：

- PR number：`704`
- base：
  `c9c9ebff649e2bf7dadebca2eaaeb646e5307ac3`
- declaration：`owner-authorized-migration`
- owner user-message：UTF-8、無 BOM、無尾端 newline、3265 bytes、37 lines、
  SHA-256
  `ccb6cca014b86b2f653b859dd8f447b5af002112723096e55352c0a3ea0a13fb`
- changed paths：精確等於
  `$script:SelfReferentialLeanMigrationPaths`
- ledger：與 base 完全一致，且 PR body 不得宣稱 entry、reason 或 future
  fixpoint。

任一 tuple 欄位、path、base 或 ledger 漂移即 fail closed。#704 合併後，
其 literal base 不可能成為未來 PR 的 live base，因此此 mode 不可重用。

PR body：

| Item | Result |
|---|---|
| Self-referential bootstrap | `owner-authorized-migration` |
| Lean migration owner message | `sha256=ccb6cca014b86b2f653b859dd8f447b5af002112723096e55352c0a3ea0a13fb;bytes=3265` |
| Current candidate head | exact 40-character PR head SHA |
| Bootstrap ledger entry | `not applicable` |
| Bootstrap reason | `not applicable` |

## 4. Trust boundary

`.github/workflows/pr-review-agent.yml` 的 PR Metadata Contract 由 immutable
PR base materialize。#704 的 base 尚未包含本 migration mode，所以該
diagnostic 不能用 #704 head code 自證，也不得改成執行 head gate。

#704 必須以：

1. exact-head deterministic tests；
2. read-only correctness/security reviewers；
3. live CODEOWNER/current-head owner decision；以及
4. 未降低的 native branch protection

承擔這一次 bootstrap trust boundary。此限制不授權 auto-merge、
`--admin`、force-push、跳過 required checks，或另開 ledger/fixpoint
後繼 PR。

## 5. Mechanism surface

分類判準維持不變：若一條 path 的行為會改變其他 PR 的裁決結果，或改變
canonical deployment 的驗證結果，就屬 mechanism surface。產品量測或
只供人工閱讀、未被 gate 機器消費的報告不屬此 surface；日後接入 gate
時，接線 PR 必須同步更新 classifier 與負向測試。

分類結果只決定 review/verification scope，不取代原始碼、可執行 tests、
GitNexus risk 或 owner/CODEOWNER 決定。
