## 1. 建立 sub-file 目錄結構

- [ ] 1.1 建立 `docs/agents/` 目錄並加 `.gitkeep` 或第一個 sub-file，確保進 git
- [ ] 1.2 確認 `docs/agents/` 不被 `.gitignore` / `.gitnexusignore` 排除（必要時加 allow rule）

## 2. 拆出 sub-files（不刪資訊，只搬移）

- [ ] 2.1 建 `docs/agents/repo-boundary-detail.md`：搬移 AGENTS.md 中「完整 folder 結構 + B 方案 mermaid + 一句話定位 + Source-of-Truth 完整表」段落原文（不改寫）
- [ ] 2.2 建 `docs/agents/github-workflow.md`：搬移 AGENTS.md 中「PR / branch / GitHub Actions / merge / OpenSpec sync-archive」流程段落原文
- [ ] 2.3 建 `docs/agents/gitnexus-usage.md`：搬移 AGENTS.md 中「GitNexus — Code Intelligence」整段 + CLAUDE.md 中重複的 GitNexus 段
- [ ] 2.4 建 `docs/agents/sub-repo-verify-commands.md`：搬移 AGENTS.md / CLAUDE.md 中各 sub-repo 的 `npm test` / `pytest` / `npm run verify` 完整指令
- [ ] 2.5 建 `docs/agents/history-and-archive.md`：搬移 AGENTS.md / CLAUDE.md 中「歷史 `_worker` / `_bim-control` 退役脈絡」段落
- [ ] 2.6 每個 sub-file 開頭加一行「Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md」metadata，確保孤兒檢查可一眼識別

## 3. 改寫 AGENTS.md 為精簡主檔

- [ ] 3.1 把 AGENTS.md 中已搬出的段落原地換成「一句話摘要 + sub-file link」（例：「完整 folder 結構與 B 方案 mermaid → `docs/agents/repo-boundary-detail.md`」）
- [ ] 3.2 在 AGENTS.md 加一節「Sub-files (lazy-load, read when needed)」table，欄位：何時需要 / 讀哪份；涵蓋 §2.x 全部 sub-file
- [ ] 3.3 確認 `wc -l AGENTS.md` ≤ 250 行（目標 ≤ 200）
- [ ] 3.4 確認 AGENTS.md 不再含完整 mermaid 圖、完整 folder schema、完整 GitNexus block

## 4. 改寫 CLAUDE.md 為精簡鏡像入口

- [ ] 4.1 CLAUDE.md 開頭聲明維持「本檔是 AGENTS.md 鏡像入口；衝突時以 AGENTS.md 為準」
- [ ] 4.2 保留 Claude-specific 補充（priority stack + 完成工作必回報 4 點）
- [ ] 4.3 加上與 AGENTS.md 一致的 sub-file index 表（同一組 sub-file，描述可微調）
- [ ] 4.4 保留 GitNexus block（Claude Code 引用度高），但壓縮重複描述、刪掉 mermaid
- [ ] 4.5 確認 `wc -l CLAUDE.md` ≤ 100 行（目標 ≤ 80）
- [ ] 4.6 確認 CLAUDE.md 不再含完整 B 方案閉環文字流程、完整 mermaid

## 5. 內容完整性對照（資訊不丟）

- [ ] 5.1 跑 `git diff main -- AGENTS.md CLAUDE.md docs/agents/` 並逐段對照：每個從主檔移走的段落都能在某個 sub-file 找到
- [ ] 5.2 在 PR 描述貼出「原文段落 → sub-file」對應表，供 reviewer 一眼驗證資訊不丟
- [ ] 5.3 確認所有主檔 link 路徑都實際存在（無 404 link）

## 6. 主檔 index 完整性

- [ ] 6.1 確認 `docs/agents/` 之下每個 sub-file 都至少出現在 AGENTS.md 的 index 表一次
- [ ] 6.2 確認 `docs/agents/` 之下每個 sub-file 都至少出現在 CLAUDE.md 的 index 表一次
- [ ] 6.3 確認兩份主檔的 index 涵蓋同一組 sub-file（集合一致）

## 7. 驗證

- [ ] 7.1 root contracts 驗證：`python -m pytest tests -p no:cacheprovider`（純文件改動，預期 PASS）
- [ ] 7.2 `openspec validate slim-agents-md-auto-load`（spec 結構驗證）
- [ ] 7.3 `gitnexus_detect_changes()`：僅 documentation 改動，預期不觸發 code symbol 變更警告
- [ ] 7.4 `git diff --cached --check`：確認無 trailing whitespace（避免 hook 擋）

## 8. PR + Archive

- [ ] 8.1 push branch `codex/openspec/slim-agents-md-auto-load`
- [ ] 8.2 開 PR（標題使用繁體中文），description 含「原文段落 → sub-file」對應表 + 行數對照（before/after `wc -l`）
- [ ] 8.3 等 GitHub Actions PASS、reviewer approve、merge to main
- [ ] 8.4 merge 後在 main 跑 `openspec archive slim-agents-md-auto-load`，把 change 搬到 `openspec/changes/archive/2026-MM-DD-slim-agents-md-auto-load/`
- [ ] 8.5 同 PR 或後續 PR sync 新 spec 到 `openspec/specs/agent-doc-context-budget/spec.md`
