# agent-doc-context-budget Specification

## Purpose
維持精簡、按需載入的 agent 入口，並對齊單一 sub-file index、tracked skill manifest 與跨平台 discovery；保留既有驗收、隔離與授權契約。
## Requirements
### Requirement: Root agent entrypoint files SHALL respect context budget

Repo root `AGENTS.md` 與 `CLAUDE.md` 是 agent session 啟動時自動載入的 entrypoint，其長度直接乘上每次 session 的 token 成本。兩份檔 SHALL 控制在以下行數預算：

- `AGENTS.md` SHALL 不超過 **250 行**（目標 ≤ 200 行）；
- `CLAUDE.md` SHALL 不超過 **130 行**（目標 ≤ 100 行）。

行數以 repo tracked text 正規化為 LF 後的 LF 數為準，包含已追蹤的 GitNexus block；不要假設工具會在 session 啟動時附加內容。`CLAUDE.md` 維持單一 `@AGENTS.md` import，不維護第二份 GitNexus block。任何 PR 若導致兩檔回胖超過上限，必須在 PR 描述說明原因並附對應 OpenSpec change，否則 review 應要求拆分到 `docs/agents/*.md` sub-file。

入口量測 SHOULD 同時記錄 UTF-8 bytes；可取得實際 token 指標時，記錄模型、環境與是否全新 session。bytes／行數減少不代表整個任務 token 等比例下降；不得為此新增任意 token 或 byte 阻斷門檻。

#### Scenario: PR 把 AGENTS.md 改超過 250 行

- **WHEN** 一個 PR 在 merge 前 `wc -l AGENTS.md` 回傳 > 250
- **THEN** review MUST 要求把新增內容拆到對應 `docs/agents/*.md` sub-file，或要求 PR 附 OpenSpec change 說明為何需要放寬閘門

#### Scenario: PR 把 CLAUDE.md 改超過 130 行

- **WHEN** 一個 PR 在 merge 前 `wc -l CLAUDE.md` 回傳 > 130
- **THEN** review MUST 要求把新增內容拆到對應 `docs/agents/*.md` sub-file，或附 OpenSpec change 放寬閘門

#### Scenario: 純粹的 link 修正不觸發閘門

- **WHEN** PR 只是修正 sub-file 路徑或標題、未實質新增內容，且總行數仍在上限內
- **THEN** 閘門 PASS，無額外要求

### Requirement: Root entrypoint files SHALL use lazy-load sub-files

`AGENTS.md` / `CLAUDE.md` SHALL 把以下五類細節內容放在 `docs/agents/*.md` sub-file，而不是主檔：

1. 完整 folder 結構、B 方案 mermaid、Source-of-Truth 完整表 → `docs/agents/repo-boundary-detail.md`
2. PR / branch / actions / merge / sync-archive 完整 GitHub workflow → `docs/agents/github-workflow.md`
3. GitNexus 完整規範、impact analysis SOP、skill 對應表 → `docs/agents/gitnexus-usage.md`
4. 各 sub-repo 的 `npm test` / `pytest` / `npm run verify` 細節 → `docs/agents/sub-repo-verify-commands.md`
5. 歷史 `_worker` / `_bim-control` 脈絡與退役說明 → `docs/agents/history-and-archive.md`

主檔可以保留**每類細節的「一句話摘要 + sub-file link」**，但 SHALL NOT 重述 sub-file 的完整內容。

#### Scenario: AGENTS.md 重新出現完整 mermaid 圖

- **WHEN** PR 把 B 方案閉環 mermaid 加回 `AGENTS.md` 主檔
- **THEN** review MUST 要求改為 link 指向 `docs/agents/repo-boundary-detail.md`，主檔最多保留一句話摘要

#### Scenario: 新增一類 agent 入口細節

- **WHEN** 有新類別細節（例：MCP server 設定 SOP）要加進 agent 入口
- **THEN** SHALL 在 `docs/agents/` 新建對應 sub-file（例：`docs/agents/mcp-setup.md`），並在主檔 link 表加一列；MUST NOT 直接把整段內容塞進主檔

#### Scenario: sub-file 內容變更不要求改主檔

- **WHEN** 只動 `docs/agents/<sub>.md` 內部章節
- **THEN** 主檔不必跟動；除非新增 sub-file 或 sub-file rename

### Requirement: Root entrypoint files SHALL maintain a complete sub-file index

`AGENTS.md` SHALL 維護唯一 sub-file index，欄位至少為「何時需要 / 讀哪份」。`CLAUDE.md` SHALL 以單一 `@AGENTS.md` import 共用 index，不另行同步表格。任務細節 SHALL 可由 index 直接或經主題文件的明確 routing 到達；歷史與條件式 references 不要求全部預載或平鋪於根入口。

#### Scenario: 新增 sub-file 但忘了更新主檔 index

- **WHEN** PR 在 `docs/agents/` 新增需要根入口路由的 `mcp-setup.md`，但 `AGENTS.md` 的 index 沒新增該列
- **THEN** review MUST 要求補上唯一 index 列；`CLAUDE.md` 不必跟動

#### Scenario: index 列指向不存在的 sub-file

- **WHEN** PR 把 `AGENTS.md` 的 index 表加上「docs/agents/X.md」但 X.md 不存在
- **THEN** review MUST 要求要嘛建立 X.md、要嘛從 index 移除

#### Scenario: Claude 入口重建第二份 index

- **WHEN** `CLAUDE.md` 新增與 `AGENTS.md` 重複的 sub-file index
- **THEN** review MUST 要求保留單一 `@AGENTS.md` import，移除重複表格

### Requirement: Sub-files SHALL stay single-topic and link instead of copy

`docs/agents/*.md` 每個 sub-file SHALL 對應單一主題；跨主題段落（例：「GitNexus + sub-repo verify」混合說明）SHALL 用 inline link 指向 sibling sub-file，**不得 copy**。

#### Scenario: 兩個 sub-file 出現相同段落

- **WHEN** `docs/agents/gitnexus-usage.md` 與 `docs/agents/sub-repo-verify-commands.md` 同時有「跑 `npx gitnexus analyze`」完整指令段
- **THEN** review MUST 要求其一改為 link；只能其中一份保留完整內容

#### Scenario: sub-file 自身過長

- **WHEN** 一個 `docs/agents/*.md` 超過 400 行
- **THEN** review SHOULD 提議再拆分為更細的單一主題 sub-file（非硬性要求，但需在 PR 描述評估）

### Requirement: CLAUDE.md SHALL remain a thin mirror, not a duplicate

`CLAUDE.md` SHALL 維持「Claude 鏡像入口」定位：

- MUST 在開頭聲明「本檔是 AGENTS.md 鏡像入口；衝突時以 AGENTS.md 為準」；
- MAY 包含必要的 Claude-specific runtime 補充，不重述共用 priority 或回報契約；
- MUST 以單一 `@AGENTS.md` import 共用唯一 sub-file index；
- MUST NOT 重複 GitNexus block；該 block 由 `AGENTS.md` 擁有；
- SHALL NOT 重述 B 方案閉環、mermaid 圖、完整 folder schema、sub-repo verify 細節（這些只留 link 到 sub-file）。

#### Scenario: CLAUDE.md 重新出現 B 方案閉環文字描述

- **WHEN** PR 把 B 方案閉環完整流程文字加回 `CLAUDE.md`
- **THEN** review MUST 要求改為 link 指向 `docs/agents/repo-boundary-detail.md`

#### Scenario: CLAUDE.md 沒有引述 AGENTS.md 為 source-of-truth

- **WHEN** PR 改寫 `CLAUDE.md` 開頭，移除「AGENTS.md 為 source-of-truth」聲明
- **THEN** review MUST 要求補回該聲明

#### Scenario: AGENTS.md 與 CLAUDE.md 規範矛盾

- **WHEN** agent 載入兩份主檔後發現某條規範矛盾（例：行為對齊 priority stack 不同）
- **THEN** agent SHALL 採用 `AGENTS.md` 版本作為 source-of-truth；PR 必須在發現矛盾時優先修正 `CLAUDE.md` 對齊 `AGENTS.md`

### Requirement: Information SHALL NOT be lost during slim-down

本 change 是「移位 + 加 link」，不是刪除。所有從 `AGENTS.md` / `CLAUDE.md` 移走的段落 SHALL 完整保留在對應 `docs/agents/*.md` sub-file，不得在搬移過程中刪除事實性內容。

#### Scenario: 搬移時誤刪某段操作細節

- **WHEN** PR 把 `AGENTS.md` 的「sub-repo verify 完整指令」段刪除但未在任何 sub-file 找到對應內容
- **THEN** review MUST 要求把該段補回 `docs/agents/sub-repo-verify-commands.md`，或附 OpenSpec change 說明為何要正式刪除（不只是搬移）

#### Scenario: 內容拆分但 link 斷掉

- **WHEN** PR 把某段內容搬到 sub-file，但主檔的 link 指向錯誤路徑（404）
- **THEN** review MUST 要求修正 link

### Requirement: Repo-local Codex skills SHALL align with Claude skills

`agent-skills-manifest.json` SHALL 管理受追蹤的 `.claude/skills/`、`.codex/skills/` 與 Codex discovery 入口 `.agents/skills/`。每個 entry 的 canonical source、mirrors、independent variants、thin adapters、provenance 與 tree digest SHALL 依 manifest 宣告；不得一律以 `.claude/skills/` 覆蓋其他平台。使用 tracked physical copies，不得用 symlink/junction 替代。

OpenSpec / opsx closed-loop skills 已退役；Superpowers skills（`writing-plans`、`subagent-driven-development`、`verification-before-completion`）保留為 explicit-only skill library，不是一般任務的主線治理。預設 routing 以 `docs/agents/superpowers-invocation-policy.md` 為準；只有使用者明確授權的 skill 或 workflow 才可使用。`.agent/`、`.cursor/`、`.windsurf/` 不再是 opsx skill source-of-truth。

#### Scenario: mirror 與 canonical source 不一致

- **WHEN** `scripts/dev/sync-agent-skills.ps1 -Mode Check` 發現宣告的 mirror drift
- **THEN** agent MUST 先核對 canonical source 與 reviewed digest；已授權的修正用既有 `-Mode Sync` 同步，再跑 `-Mode Check`。不得用更改 digest 掩蓋未知 drift；intentional variants 不要求 byte-identical

#### Scenario: PR 修改受追蹤 skill

- **WHEN** PR 修改 manifest 宣告的 skill
- **THEN** review MUST 檢查 canonical change、provenance、對應 tree digests 與全部 declared mirrors/adapters；不得僅因路徑位於三個 tracked skill roots 而阻擋。main 舊 ignored 副本依 `docs/agents/skill-discovery-migration.md` 備份與隔離，不直接覆寫

#### Scenario: 一般任務被升級為完整 workflow

- **WHEN** 文件因任務複雜、使用者提到完成或改動 code/tests，就要求自動啟動 Superpowers 或 `spec-to-done`
- **THEN** review MUST 要求回到 repo-native F/B/G routing；只有使用者明確要求才進入 S。OpenSpec artifact 的驗證沿用適用 scoped 規則，不把 artifact validation 當成重流程啟動

### Requirement: Agent IDE mirror docs SHALL not reintroduce opsx source-of-truth

若 repo 未來重新加入 Cursor / Windsurf / 其他 IDE 的 skill or workflow stub，該文件 SHALL 明確標記為 IDE-specific launcher 或 compatibility note，不得把 `.agent/`、`.cursor/`、`.windsurf/` 宣告為 opsx source-of-truth，也不得複製 `.claude/skills` / `.codex/skills` 內容。

#### Scenario: `.agent/` 被重新宣告為 source-of-truth

- **WHEN** PR 文件聲稱 `.agent/` 是 opsx workflow 或 skill 的唯一 source-of-truth
- **THEN** review MUST 要求移除該聲明，改以 `AGENTS.md` + `docs/agents/*.md` + `agent-skills-manifest.json` 描述治理與 discovery；Superpowers workflow 仍為 explicit-only

#### Scenario: IDE stub 複製 skill body

- **WHEN** PR 在 `.cursor/`、`.windsurf/` 或其他 IDE launcher 複製 `.claude/skills` / `.codex/skills` 的完整 body
- **THEN** review MUST 要求改成短 launcher / compatibility note，避免多份 skill body drift
