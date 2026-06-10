## Why

`agent-doc-context-budget` 規格對 root `CLAUDE.md` 設「≤ 100 行（目標 ≤ 80）」硬上限，閘門為 `wc -l CLAUDE.md`。實務狀況：

- 追蹤檔 `CLAUDE.md` 本體為 **77 行**，`wc -l` 閘門**未超標**。
- 但 GitNexus code-intelligence 工具於**每次 session 載入時**，會在 `CLAUDE.md` 檔尾自動附加「# GitNexus — Code Intelligence」區塊（約 42 行：Always Do / Never Do / Resources / CLI 表）。實際載入進每次 session 的 `CLAUDE.md` 約 **119 行**，超過 100 行的精神上限。

`wc -l` 閘門量的是追蹤檔（77，過關），但 spec 的精神（「其長度直接乘上每次 session 的 token 成本」）關心的是真實載入成本（約 119）。為讓上限對齊真實載入成本並保留 headroom，將 `CLAUDE.md` 上限自 100 放寬至 130（目標 80 → 100）。

## What Changes

- **MODIFIED** `agent-doc-context-budget` 之「Root agent entrypoint files SHALL respect context budget」requirement：`CLAUDE.md` 上限 100 → 130 行、目標 80 → 100 行；並明寫 `wc -l` 閘門量追蹤檔本體、GitNexus runtime 附加區塊另計。
- 對齊更新兩個入口檔的預算自述句：`AGENTS.md`（sub-file 表尾）、`CLAUDE.md`（§2 行數預算）。
- `AGENTS.md` 預算（250 / 200）**不變**。

## Impact

- Affected spec: `agent-doc-context-budget`
- Affected files: `AGENTS.md`、`CLAUDE.md`（僅預算自述句；本體內容不變、仍 77 行）
- 無 code / runtime 影響；純文件治理閘門放寬。
