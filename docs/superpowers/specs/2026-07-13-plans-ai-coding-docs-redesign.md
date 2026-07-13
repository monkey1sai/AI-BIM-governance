# Spec — docs/plans AI-coding 文件體系重設計（TRUTH/TARGET/PROCESS 三分）

- **日期**：2026-07-13（使用者授權 2026-07-10）
- **類型**：documentation/governance replatform（docs/plans 全面改版＋活指標同步；不改 runtime）
- **Requirement source**：使用者明確指令——以 `docs/plans/ai-bim-governance-prototype.html` 與 `docs/plans/ai-bim-geo-viewer-prototype.html` 為基準，重新設計驅動 AI coding 的文件體系（因對開發進度與結果不滿）。

## 問題

舊 docs/plans 核心 6 檔（約 4,600 行）以「不動正文＋疊增補層」演化，累積裁決帳、禁寫清單、跨檔效力序；文件/治理 commits（136）已多於產品服務 commits（105），文件維護吞噬開發產能，且 stale 宣稱造成返工。

## 變更契約

1. **新增核心 7 檔**（`docs/plans/`）：`docs-plans-README.md`（重寫，入口）＋`TRUTH.md`（現況帳本，唯一可寫建成狀態）＋`TARGET-contracts.md`（全域凍結契約，含後端凍結 13 條＋4 筆例外與 IX-TN 4 張）＋`TARGET-shell.md`（22 route 垂直切片，route 所屬 IX 21 張全文）＋`TARGET-viewer.md`（七區塊＋AC-1~21＋IX-3D 5 張）＋`BACKLOG.md`（gap 佇列＋OPEN 決策）＋`PROCESS.md`（DoD／驗收／防腐三閘）。
2. **刪除 6 舊正本**（五條驗證閘全過後）：互動實作規格與標準對齊／開發軌跡與執行計畫／設計規格／實作紀律與技術債防線／design-system-對齊矩陣／前端對齊DS-保留後端-實作手冊。去向對照＝新 README §7。
3. **keep 原地**：兩份 prototype HTML（產品樣貌唯一真相基準，不修改）、saas-* 六檔（PLANNED 增補層）、審批報告、nvidia-cosmos-diagram.jpg。
4. **活指標同步**：所有 active consumers 改指新體系，至少包含 `AGENTS.md`、`CLAUDE.md`、`README.md`、`docs/agents/product-operability-and-script-contract.md`、`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`、`.claude/skills/repo-health/SKILL.md`、兩個 `.claude/workflows/*.js`、`.github/ISSUE_TEMPLATE/agent-task.yml`、active `openspec/specs/`、demo 與 SaaS keep docs。歷史文件不改。
5. **審批紀錄**：`docs/plans/審批報告-docs-plans-AI-coding重設計-2026-07-10.md`（裁決追溯唯一來源，含 R2 對齊、session enum 更正、驗證閘結果）。
6. **正式規格程序**：以 `openspec/changes/plans-ai-coding-docs-redesign/` 修改 `documentation-source-of-truth` capability，並依 `openspec/AGENTS.md` strict validate；本 branch 採 `codex/openspec/plans-ai-coding-docs-redesign`。

## 不變式（必保資產，遷移零損）

- 後端凍結面契約 13 條＋已批准例外 4 筆（→ TARGET-contracts §1；唯一刻意差異＝session enum 更正誤植）。
- 正典路由 22 條＋9 個別名＋1 個獨立保留頁＋四鐵則（→ TARGET-contracts §4）。
- IX 互動卡 30 張全文零濃縮（route 所屬 21 張→TARGET-shell；IX-3D 5 張→TARGET-viewer §6；IX-TN 4 張→TARGET-contracts §12）。
- A1–A10 誠實狀態、NOT BUILT 硬清單、Prov 7 值映射、GPU 物理鐵律、官方對齊鐵律、六通用互動模式。
- 誠實鐵律：NOT BUILT 不寫成已交付；TARGET 檔結構性禁含建成宣稱（PROCESS §6 閘 1 grep 0 命中）。

## 驗證

- 刪除前五條閘全過（計數核對／NOT BUILT 反向 grep／TARGET 中文零命中＋英文 positive-built allowlist audit／行數預算／evidence tracked），紀錄見審批報告 §4。
- 全 repo grep：docs/plans 之外的活檔對六舊檔零殘留引用（歷史文件除外，救援表＝README §7）。
- 本 PR 為 documentation/governance-only 變更；會更新 workflow prompt、issue template 與 OpenSpec artifact，但不觸碰四服務 route/API 面、runtime code 或凍結後端檔。
