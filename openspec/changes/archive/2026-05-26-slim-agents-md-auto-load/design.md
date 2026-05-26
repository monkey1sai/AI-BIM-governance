## Context

`AGENTS.md`（1,120 行）與 `CLAUDE.md`（221 行）目前是 monolithic root agent entrypoint：同時承載 identity / repo boundary / GitHub workflow / GitNexus 規範 / B 方案閉環 / sub-repo 驗證指令 / 歷史脈絡 / agent priority stack。

「每次 session 啟動」這個語意在不同 IDE 略有差異，但共通點是 **root-level `AGENTS.md` 或 `CLAUDE.md` 會被自動讀入** 並作為 system prompt 一部分：

- Claude Code：load `<repo>/CLAUDE.md` 全文進 system reminder；
- Codex CLI：load `<repo>/AGENTS.md` 全文；
- Cursor / Windsurf：load 各自 `.cursor/` `.windsurf/` 內的 rule 檔，但會同時尊重 root AGENTS.md / CLAUDE.md；
- 其他 agent：多半 fallback 到 AGENTS.md。

換句話說，這兩份檔的「長度」直接乘上每次 session 的 token 成本。當前 11K+ tokens 級別、且 49.5% 是 markdown 的 repo，會讓 long-running agent 的 context 預算很快進入緊張區間。

## Goals / Non-Goals

**Goals:**

- 把 `AGENTS.md` 自動載入體積壓到 **約 200 行內**（保留 identity / boundary 摘要 / source-of-truth 表 / sub-file index）。
- 把 `CLAUDE.md` 壓到 **約 80 行內**（指向 AGENTS.md 為主、Claude-specific 補充為輔）。
- **資訊不丟**：所有被移走的內容落地到 `docs/agents/*.md` sub-files，並在主檔以 inline link 標示「需要 X 時讀這份」。
- 入口主檔的 link 表 SHALL 涵蓋全部 sub-file（無孤兒 sub-file、無斷裂 link）。
- 建立可驗證的行數閘門：CI / smoke 可以用簡單 `wc -l` 規則檢查主檔是否回胖。

**Non-Goals:**

- 不改 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 與 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 的分工（由 `documentation-source-of-truth` spec 管轄）。
- 不搬移 `openspec/changes/archive/` 內容。
- 不合併 `.agent/.claude/.cursor/.windsurf` 重複 skills（另案）。
- 不修改 sub-repo 內的 `bim-review-coordinator/CLAUDE.md`、`bim-streaming-server/AGENTS.md`（七段 schema 已是精簡入口）。
- 不引入 `.claudeignore` / `.aiignore`（不同 IDE 行為不一致，不在本 change scope）。
- 不刪除任何資訊——只移位與加 link。

## Decisions

### Decision 1：拆 sub-file 的切分軸

選擇按「agent 需要做什麼任務時才需要這份內容」切分，而不是按 IDE 切分。

拆分結果（暫定，最終以 task 階段為準）：

| Sub-file | 內容 | 何時需要讀 |
|---|---|---|
| `docs/agents/repo-boundary-detail.md` | 完整 folder 結構、B 方案 mermaid、一句話定位、Source-of-Truth 表 | 需要做跨 sub-repo 決策、修改 repo boundary 時 |
| `docs/agents/github-workflow.md` | PR / branch / actions / merge / sync-archive 完整流程 | 開 PR、處理 actions failure、archive change 時 |
| `docs/agents/gitnexus-usage.md` | 完整 GitNexus 規範 + skill 對應表 + impact analysis SOP | 修改 function / class / method 前 |
| `docs/agents/sub-repo-verify-commands.md` | 每個 sub-repo 的 `npm test` / `pytest` / `npm run verify` 細節 | 跑 sub-repo 驗證時 |
| `docs/agents/history-and-archive.md` | 歷史 `_worker` / `_bim-control` 脈絡、退役說明 | 解讀舊 archive 文件時 |

備選方案：按 IDE 切（`docs/agents/claude.md` / `docs/agents/codex.md` / `docs/agents/cursor.md`）。**不採用**，因為 90% 內容跨 IDE 共用，重複會更多。

### Decision 2：主檔的 link 表結構

主檔以一張 markdown 表呈現 sub-file index：

```markdown
## Sub-files (lazy-load, read when needed)

| 何時需要 | 讀這份 |
|---|---|
| 跨 sub-repo 決策 / 改 repo boundary | docs/agents/repo-boundary-detail.md |
| 開 PR / 處理 actions / archive change | docs/agents/github-workflow.md |
| 修改 code symbol（function/class/method） | docs/agents/gitnexus-usage.md |
| 跑 sub-repo 驗證 | docs/agents/sub-repo-verify-commands.md |
| 解讀舊 archive 文件 | docs/agents/history-and-archive.md |
```

備選：用 frontmatter 列 sub-files。**不採用**，因為 markdown table 是 agent 與人類都看得懂的最低共識格式。

### Decision 3：CLAUDE.md 與 AGENTS.md 的關係

CLAUDE.md 縮為：

- 第 0 節：定位「本檔是 AGENTS.md 鏡像入口；衝突時以 AGENTS.md 為準」（4–6 行）；
- 第 1 節：Claude-specific 行為對齊（priority stack + 完成工作必回報 4 點），不重述 B 方案閉環；
- 第 2 節：sub-file index（指向 `docs/agents/*.md`，與 AGENTS.md 同一份表）；
- 第 3 節：GitNexus block（保留——因為 Claude Code 對這段引用度高），但壓縮重複描述。

備選：CLAUDE.md 改成 stub 只 link 到 AGENTS.md。**不採用**，因為 Claude Code 對「有 CLAUDE.md」這個檔的存在有特殊處理，留一個薄入口比完全空更穩。

### Decision 4：行數閘門的可驗證形式

在 spec 的 Scenario 用 `wc -l` 規則：

- `AGENTS.md` SHALL ≤ 250 行（含 200 行緩衝）
- `CLAUDE.md` SHALL ≤ 100 行（含 80 行緩衝）

備選：用 byte 上限（KB）。**不採用**，因為 markdown 行數比 byte 數更貼近 token 體積感受、也更容易 PR review 時看出回胖。

### Decision 5：sub-file 命名 prefix

`docs/agents/<topic>.md` 而非 `docs/<topic>.md`。

理由：用 `docs/agents/` 子目錄把所有「agent 入口的 lazy-load 子檔」聚在一起，方便 future agent 一眼找到 sibling sub-file；不會跟 `docs/plans/` `docs/wiki/` `docs/runbooks/` 混在一起。

## Risks / Trade-offs

- **[風險] Agent 看不到主檔提到的 sub-file，繼續用主檔的舊 stale 內容做決策** → Mitigation: 拆分時主檔對應段落 SHALL 換成「相關細節見 `docs/agents/X.md`」一句話，迫使 agent read sub-file；不留 stale 摘要。
- **[風險] sub-file 之間出現重複（例：`gitnexus-usage.md` 跟 `sub-repo-verify-commands.md` 都提 GitNexus）** → Mitigation: spec 規定 sub-file 必須單一主題；跨主題段落只能用 link 不能 copy。
- **[風險] 拆完後 agent 一次 session 同時讀 5 個 sub-file，反而 token 用更多** → Mitigation: 主檔 link 表的「何時需要」欄是判斷依據；只有相關任務才讀對應 sub-file；spec 不規範 agent 強制讀所有 sub-file。
- **[風險] CLAUDE.md 變薄後 Claude Code 的 system reminder 載入語意改變** → Mitigation: CLAUDE.md 保留必要 metadata（priority stack + GitNexus block），不會空到 Claude Code 認為「沒設定」。
- **[Trade-off] 加了一層 indirection** → 換到的好處是「每次 session 啟動的 token 預算」直接下降 60%+，相對成本是 agent 在做特定任務時要多一次 read sub-file（每次任務 ~1 次 read，遠低於每次 session 都載入整套）。
- **[風險] 行數閘門易被 PR 漸進回胖** → Mitigation: spec scenario 寫成可被 `wc -l` 直接驗證的條件；後續可在 `.github/workflows/` 加 lint job（本 change 不含 CI 接線，留給 future change）。

## Migration Plan

1. 建立 `docs/agents/` 目錄與 5 個 sub-file，內容從 AGENTS.md / CLAUDE.md 對應段落直接搬移（不重寫、不刪資訊）。
2. 把 AGENTS.md 改寫為「精簡主檔 + sub-file index 表」；CLAUDE.md 同步精簡。
3. 在 PR 描述列出每個 sub-file 對應的原文段落（reviewer 用來確認「資訊不丟」）。
4. 跑 `git diff --stat` 確認移動規模合理；跑 root contracts pytest（root `tests/` 不依賴 AGENTS.md 結構，預期 pass）。
5. 不需要 rollback strategy：純文件搬移，revert PR 即可。

## Open Questions

- (Q1) `docs/agents/` 之下的 sub-file 是否需要在 `documentation-source-of-truth` spec 補一條 cross-reference 義務？
  - 暫定 **不需要**：本 change 的 spec 自帶 cross-reference 義務 requirement；不污染既有 `documentation-source-of-truth` spec。
  - 若 reviewer 要求補，apply 階段再加 delta。
- (Q2) sub-file 是否應同時鏡像到 `bim-review-coordinator/` 等 sub-repo？
  - 暫定 **否**：sub-repo 各自有 repo-local AGENTS.md / CLAUDE.md（七段 schema），不需要 root sub-file 的副本。
- (Q3) `wc -l` 行數閘門是否要設更嚴（如 AGENTS.md ≤ 180）？
  - 暫定 **AGENTS.md ≤ 250 / CLAUDE.md ≤ 100**：留 20% 緩衝吸收後續正當增補。spec scenario 寫死門檻，回胖時 review 就會看到。
