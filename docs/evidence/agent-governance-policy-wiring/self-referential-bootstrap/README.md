# agent-governance-policy-wiring — self-referential bootstrap evidence

## What changed

The report-only Agent Governance Policy module (#565) becomes an adjudicator:

- `.github/workflows/agent-governance.yml` suite gains two steps: `verify-governance-policy.ps1
  -BaseRef <PR base>`（政策評估＋rule ratchet，error 或 warning 即紅）and the module behaviour
  suite `test-agent-governance-policy.ps1`（106 assertions，PINNED 語彙與承重指紋）。
- `scripts/tests/test-agent-governance-check.ps1` loses the 182 text assertions the rule document
  supersedes（1299 → 1117 行）；13 條 provenance 標錯的斷言經逐塊重錨定後保留。
- `Get-SelfReferentialMechanismPaths` registers the module, the gate, and the behaviour suite
  （§2.1 升級規則，同 PR 完成）；`$commandSpecById` resolves the two new command ids.
- `scripts/agent-governance-rules.json` 修正四條規則的 `replaces` 溯源（改為 additive）；
  **刻意不註冊為 mechanism path** — 新增規則必須維持零自舉債，刪除與降級由 gate 內的
  rule ratchet fail-closed 把守。

## Why it is bootstrap debt

The branch edits the adjudication surface that judges it（agent-governance suite、其 meta
assertions、mechanism 分類清單), so no pre-merge run can prove the post-merge wiring. The
obligation closes with a post-merge fixpoint replay from `main`.

## Verification contract

| Field | Value |
|---|---|
| id | `agent-governance-policy-wiring/v1` |
| command_ids | `verify-governance-policy`, `test-agent-governance-policy`, `test-agent-governance-check`, `test-self-referential-bootstrap`, `test-pr-body-evidence`, `invoke-powershell-static` |
| contract_sha256 | 見 ledger entry（依 gate 演算法 SHA256(id + LF + ordered ids) 產生） |

Pre-merge, every command passed on this branch — full transcript in
[`verification.txt`](verification.txt), including the deletion re-anchoring record（182 deleted,
13 retained with corrected provenance）and the gate's fail-closed negative probe.
