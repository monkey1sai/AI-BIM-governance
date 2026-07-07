# .claude/skills — 索引

本目錄技能清單與來源標註。新增技能時同步補一列（repo-health 健檢會抓「漏索引的 skill」）。

## 來源分類

| 來源 | 技能 | 管理方式 |
|---|---|---|
| mattpocock/skills（29 個） | caveman、design-an-interface、diagnose、edit-article、git-guardrails-claude-code、grill-me、grill-with-docs、handoff、improve-codebase-architecture、migrate-to-shoehorn、obsidian-vault、prototype、qa、request-refactor-plan、review、scaffold-exercises、setup-matt-pocock-skills、setup-pre-commit、tdd、teach、to-issues、to-prd、triage、ubiquitous-language、write-a-skill、writing-beats、writing-fragments、writing-shape、zoom-out | 根層 `skills-lock.json` 鎖版管理 |
| 本地自撰 | repo-health、spec-to-done、gitnexus-blast-radius | 本 repo 維護；gitnexus-blast-radius 另有 `.codex/skills/` 鏡像 |
| GitNexus CLI 產生 | `gitnexus/`（巢狀家族：cli、debugging、exploring、guide、impact-analysis、refactoring） | `node .gitnexus/run.cjs analyze` / GitNexus 安裝時產生維護 |
| 外部安裝（未入 lock） | figma、figma-use、figma-generate-design、figma-implement-design、omniverse-cad-to-simready、omniverse-realtime-viewer、omniverse-usd-performance-tuning | 手動安裝；來源標註待補 |

## 結構備註（repo-health 2026-07-07 裁決）

`gitnexus/` 是唯一的兩層巢狀家族，與頂層 `gitnexus-blast-radius` 並存**是刻意現狀，不是不一致**：

- `gitnexus/*` 六個子技能是 GitNexus CLI 的產生器輸出（隨重建更新，不手改）。
- `gitnexus-blast-radius` 是本地自撰 closed-loop 技能，被 `.gitignore` 白名單（兩處）、`.codex/skills/` 鏡像與 openspec 不可變 archive 引用，搬移的連動成本高於整齊收益。

若日後 GitNexus 產生器改變輸出結構，再一併調整。

## 主要技能速查

| 技能 | 用途 |
|---|---|
| repo-health | 五面向 repo 健檢（掃描→報告→確認→修） |
| spec-to-done | 從 docs/superpowers/specs 的 spec 自主推進到 merged PR |
| gitnexus-blast-radius | 改動前 impact 算 blast radius；改動後 detect_changes 驗 scope |
| gitnexus/*（六子技能） | GitNexus 探索/除錯/影響分析/重構/CLI/指南參考文件 |
| figma* 家族 | Figma MCP 讀設計/寫畫布/設計轉 code |
| omniverse-* 家族 | CAD→SimReady、Realtime Viewer、USD 效能調校 |

其餘 mattpocock 技能用途見各自 `SKILL.md` frontmatter description。
