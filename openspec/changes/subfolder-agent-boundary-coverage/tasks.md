# Tasks

## 1. OpenSpec

- [x] 1.1 建立 isolated worktree 與 branch `codex/openspec/subfolder-agent-boundary-coverage`
- [x] 1.2 撰寫 proposal / design / spec delta / tasks
- [ ] 1.3 跑 `npx openspec validate subfolder-agent-boundary-coverage --strict`
- [ ] 1.4 User review spec → 同意後進入實作

## 2. 新增 6 份 sub-folder AGENTS.md（七段 schema，≤ 100 行）

- [ ] 2.1 `scripts/AGENTS.md` — Workspace 驗證 / smoke / deploy / preflight 入口集合
- [ ] 2.2 `tests/AGENTS.md` — Root contracts 與 test-only fakes（B 方案閉環最後 gate）
- [ ] 2.3 `docs/AGENTS.md` — 文件總入口（agents / contracts / wiki / runbooks / superpowers）
- [ ] 2.4 `apps/kit-manager-web/AGENTS.md` — 獨立 Vite 前端 Kit Manager UI
- [ ] 2.5 `infra/AGENTS.md` — Docker compose 對應 Dockerfile / 部署資產
- [ ] 2.6 `openspec/AGENTS.md` — OpenSpec artifacts 自治（明寫排除 `changes/archive/`）

## 3. 新增 6 份 sub-folder CLAUDE.md mirror（≤ 30 行）

- [ ] 3.1 `scripts/CLAUDE.md`
- [ ] 3.2 `tests/CLAUDE.md`
- [ ] 3.3 `docs/CLAUDE.md`
- [ ] 3.4 `apps/kit-manager-web/CLAUDE.md`
- [ ] 3.5 `infra/CLAUDE.md`
- [ ] 3.6 `openspec/CLAUDE.md`

## 4. 升級既有 sub-repo CLAUDE.md

- [x] 4.1 `bim-review-coordinator/CLAUDE.md` — tracked 檔；更新過期章節指標、加 sibling AGENTS.md + 根目錄 CLAUDE.md lazy-load pointer
- [~] 4.2 `bim-streaming-server/CLAUDE.md` — **N/A**：該 sub-repo `.gitignore` line 64 `/CLAUDE.md` 排除，local-only convenience，不在本 change 範圍
- [~] 4.3 `web-viewer-sample/CLAUDE.md` — **N/A**：該 sub-repo `.gitignore` line 32 `/CLAUDE.md` 排除，local-only convenience，不在本 change 範圍

## 5. Validation

- [ ] 5.1 `wc -l` 12 個新檔，確認 sub-folder AGENTS.md ≤ 100，CLAUDE.md mirror ≤ 30
- [~] 5.2 `grep -c gitnexus:start` marker 配對檢查 — **N/A**：兩個帶 marker 的 sub-repo CLAUDE.md 為 .gitignored local-only，不在本 change 範圍
- [ ] 5.3 `npx openspec validate subfolder-agent-boundary-coverage --strict`
- [ ] 5.4 `git diff --cached --check` 排除 trailing whitespace
- [ ] 5.5 跑 `gitnexus_detect_changes` —— 已知 linked worktree 看不到 staged，改用 `git diff --stat origin/main..HEAD` fallback 並記錄

## 6. Commit / PR

- [ ] 6.1 `git add` 改動檔（6 新 sub-folder AGENTS.md + 6 新 CLAUDE.md + 1 改 sub-repo CLAUDE.md + 4 個 OpenSpec artifacts，合計 17 檔）
- [ ] 6.2 commit message 用 HEREDOC（含 Co-Authored-By）
- [ ] 6.3 `git push -u origin codex/openspec/subfolder-agent-boundary-coverage`
- [ ] 6.4 `gh pr create` 開 PR，title + body 用繁中

## 7. Post-merge

- [ ] 7.1 PR merged 後 `npx openspec archive subfolder-agent-boundary-coverage`
- [ ] 7.2 確認 `openspec/specs/subfolder-agent-boundary-coverage/spec.md` 落地
- [ ] 7.3 worktree cleanup `git worktree remove .worktrees/subfolder-agent-boundary-coverage`

## 8. Risk follow-up

- [~] 8.1 `npx gitnexus setup` dry test — **N/A**：原預期需確認 marker 覆寫行為，但發現帶 marker 的兩個 sub-repo CLAUDE.md 為 .gitignored local-only，不會進 git history，不需要 dry test
