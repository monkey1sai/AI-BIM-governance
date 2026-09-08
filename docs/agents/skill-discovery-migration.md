# Skill discovery migration

本變更只在獨立 worktree 建立 tracked `.agents/skills`。Main 的既有 ignored Skill 與其他 active task 不會自動遷移。人工核可與正常 merge 完成前，不要改主 checkout。

在整合此 branch 的受控維護時段：

1. 確認所有使用該 checkout 的任務已暫停，記 exact root、HEAD、tracked status；不碰其他 worktree。
2. 將該 root 的 `.agents/skills` 完整備份到同信任範圍、但位於任何 `.agents/skills` discovery tree 外的時間戳目錄；記每檔相對路徑與 SHA-256。檢查 junction/symlink，未知則停止。
3. 驗證備份與原檔逐一相符後，把原 Skill tree 移到同信任範圍的 quarantine（驗證絕對目標、不得遞迴刪除）。不要只覆蓋同名檔而留下 extra。`.agents/board` 等其他本機內容不動。
4. 依原本人工 exact-head approval 與 branch protection 流程整合經核可的 commit。讓 Git materialize 新 tracked `.agents/skills`。
5. 執行 `pwsh -NoProfile -File scripts/dev/sync-agent-skills.ps1 -Mode Check`、`pwsh -NoProfile -File scripts/tests/test-agent-skills-sync.ps1`。新 session 檢查 CLI Skill rendering，確認 blip-approve refusal-only、GitNexus CLI-only、heavy workflow explicit-only。
6. 備份中的 repo-authored 個人差异應逐項 review 後另案納入 canonical source；不可把整份 quarantine 放回。Check 對任何未宣告 discovered Skill fail closed。

Rollback：尚未整合 tracked tree 時，驗證 quarantine 未漂移後可移回原位置。整合後不得直接把舊 ignored tree 蓋在 tracked files 上；先以正常 Git revert/新 worktree 處理 tracked 變更，再於確認沒有活躍 writer 的維護範圍還原。保留備份直到新 session 驗證完成。

這是後續操作者步驟，不授權自動 approve、merge、部署、ACL 修改或刪除其他任務內容。

三項大型 Omniverse Skill 使用 thin discovery adapter：`sync.adapters` 只允許 codex → agents，驗證 canonical entrypoint、frontmatter name、source/adapter digests 與 metadata；資源路徑依 canonical `.codex/skills/<name>` 解析。Sync 不重寫 thin adapter。其他 mirror 仍完整驗證；不得從薄入口推論其引用的 runtime 已驗收。
