## Why

`AGENTS.md`（1,120 行 / ~44 KB）與 `CLAUDE.md`（221 行 / ~9 KB）在**每次 agent session 啟動時都會被完整載入**，合計超過 1,300 行（約 11K+ tokens 級別）的純文字，吃掉相當比例的 context window 還沒進入實際工作。同時 repo 已累積 460 個 markdown（占 tracked files 49.5%），其中大量歷史脈絡、重複 mermaid 圖、跨 sub-repo 的驗證指令細節都被塞進這兩個入口檔，導致：

- 每次新 conversation 都先付 token 成本讀完整套規範，才能談需求；
- AGENTS.md 內容混雜「core boundary（必看）」與「歷史/操作細節（偶爾看）」，agent 難以判斷哪些是 source-of-truth、哪些只是參考；
- CLAUDE.md 與 AGENTS.md 大量重複（B 方案閉環、mermaid、驗證入口、GitNexus 段落），實質是雙倍載入。

**現在改的理由**：roadmap 已穩定走向 B 方案閉環，AGENTS.md 的「歷史脈絡」段已可以從入口層拆走；同時下個階段會有更多 OpenSpec change 與 PR 審查，agent context 預算只會更緊。

## What Changes

- 新增 `agent-doc-context-budget` capability spec，規範 agent 入口文件（`AGENTS.md` / `CLAUDE.md`）的 context budget 與 lazy-load 結構：
  - `AGENTS.md` 主檔 SHALL 控制在 **約 200 行內**（保留 identity / repo boundary 摘要 / source-of-truth 表 / 「需要 X 時讀哪份」index）；
  - `CLAUDE.md` 主檔 SHALL 控制在 **約 80 行內**（指向 `AGENTS.md` 為 source-of-truth + Claude-specific 補充）；
  - 拆分內容 SHALL 落地到 `docs/agents/*.md` 子檔（GitHub workflow / GitNexus 規範 / 完整 folder schema / B 方案閉環細節 / sub-repo 驗證指令 / 歷史脈絡）；
  - 入口主檔 SHALL 以 inline link 指向每個子檔並標註「需要 X 時讀」；
  - 重複出現於 AGENTS.md 與 CLAUDE.md 的段落（B 方案閉環、mermaid、驗證入口、GitNexus 段落）SHALL 只在 sub-file 留一份，CLAUDE.md 改為 link。
- 建立 `docs/agents/` 目錄與 sub-files；不刪除任何資訊，只移位 + 加 link。
- **BREAKING**（對 agent prompt 載入語意而言，但不會破壞 runtime）：每次 session 啟動時自動載入的 markdown 從 `AGENTS.md + CLAUDE.md` 縮為兩份精簡主檔；agent 需要時 SHALL 自行 read sub-file。

### Non-goals

- 不動 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 與 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 的分工（由 `documentation-source-of-truth` spec 既有規範管轄）。
- 不搬移 `openspec/changes/archive/`（另案處理，scope #2）。
- 不合併 `.agent/.claude/.cursor/.windsurf` 重複 skills（另案處理，scope #3）。
- 不修改 sub-repo 內的 `bim-review-coordinator/CLAUDE.md`、`bim-streaming-server/AGENTS.md` 等 repo-local 文件（七段 schema 已是精簡入口，本 change 不再壓縮）。
- 不引入 `.claudeignore` / `.aiignore` 之類 search-mask（agent 行為依各 IDE 而異，不在本 change 規範）。

## Capabilities

### New Capabilities

- `agent-doc-context-budget`: 規範 `AGENTS.md` / `CLAUDE.md` 兩個 root agent 入口文件的最大行數預算、lazy-load 拆分原則、sub-file 命名與 cross-reference 義務。

### Modified Capabilities

- `documentation-source-of-truth`: 不變更既有 workflow v3 / roadmap / README 分工要求；本 change 是新加 capability，不覆寫此 spec。

## Impact

- **改動範圍**：repo root `AGENTS.md`、`CLAUDE.md`；新增 `docs/agents/*.md` sub-files；新增 `openspec/specs/agent-doc-context-budget/spec.md`。
- **不影響**：所有 product runtime（coordinator / streaming-server / viewer / tests）；OpenSpec workflow CLI；GitHub Actions；GitNexus index；sub-repo 內的 repo-local AGENTS.md / CLAUDE.md。
- **Boundary**：本 change 屬於 documentation/governance 層，不跨 repo boundary，不影響 B 方案閉環。
- **Agent prompt 載入語意**：每次 session 啟動讀入的 root markdown 體積預期下降 60%+；agent 需 read 對應 sub-file 才能取得歷史脈絡與完整操作細節，依然「資訊不丟、只是 lazy-load」。
- **Cross-reference 義務**：拆分後每份 sub-file 必須在主檔有對應 link；主檔的 link 表必須涵蓋全部 sub-file（由本 spec 的 requirement 規範）。
- **依賴**：無新 production dependency；不動 `package.json` / `pyproject.toml`。
