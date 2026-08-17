# Session baseline gate wiring bootstrap

- `stack_kind`: `self_referential_bootstrap`
- PR: `#553`
- trusted base: `80a388f2b813c5197262a01408f77d3e64435e73`
- ledger entry: `session-baseline-gate-wiring`
- verification contract: `session-baseline-gate-wiring/v1`

## Why bootstrap evidence is required

本 PR 修改 required Agent Governance workflow（新增 session-baseline gate step）與 bootstrap adjudicator 的 immutable command map（tri-adversarial round-2 finding TG-539-01）。依 gate 的 entry-claim 規則，entry 的 mechanism paths 僅登記本 PR 實際改動的 adjudicator surface（workflow／ledger／command map）；量測 harness 檔案本身未在本 PR 改動，其 gate 化保護由新 command map 鍵（固定 invocation）與新 suite step 承擔，issue #520 升級規則的 surface 補登延後到未來實際修改 harness 檔案的 PR。

Merge 之前 GitHub 只能以 base workflow 作為既定機制執行；該機制無法證明新 gate step 會以 mainline 行為執行量測 harness、root CLI 與 downstream report validator suite。本分支因此記錄 bounded bootstrap evidence；它不是 canonical 部署證據，也不關閉 ledger entry。Merge 後必須自 main 重跑精確 verification contract，並以 ledger-only fixpoint PR 關帳。

## Intended invariant

- Agent Governance suite 內固定存在一步執行 `scripts/tests/test-measure-session-baseline.ps1`；該 suite 迴歸（量測 shape、fail-safe 不捏造、schema、registry 一致性、`Test-SessionBaselineReportForDownstream`、CLI exit code／stdout verdict）失敗即使 required check 變紅。
- Immutable command map 新增 `test-measure-session-baseline`，僅指向該測試檔的固定 invocation。
- 未修改 scope classifier、manifest 或其他 gate step 的行為。

No credential, private topology, production metadata, or external runtime identifier is recorded.
