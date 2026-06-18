# spec-to-done routing baseline

> P0 baseline。PR-A flag 預設關＝零行為變更，本檔在翻 `flags.plan_author_xhigh=true` 前才需填「實測列」。

- baseline_head_sha: 57f2fa8d44b97ebec04fa270edde495bb278523f
- clean_worktree: true
- representative_spec_id: <PR-A 收尾時選定：最近一支已 merged 且完整跑過 P0–P6 的 spec>

## metrics schema（每次量測一列）
| run | spec_id | total_tokens | held_count | impl_round_count | wall_sec | routing_flag |
|-----|---------|--------------|------------|------------------|----------|--------------|
| baseline(flag=off) | TBD-operational | | | | | off |

## 回歸判定（翻 flag 前必過）
- held_count 不升
- total_tokens 不超 baseline 20%
