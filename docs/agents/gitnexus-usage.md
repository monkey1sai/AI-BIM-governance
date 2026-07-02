> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> 何時讀本檔：GitNexus index stale 需重建、LadybugDB crash 復原、查 re-index 授權邊界時。

# GitNexus Usage（stale 重建與復原）

## 規範本文在哪

GitNexus 規則本文（Always Do / Never Do / Resources / CLI skill 對應表）以根目錄 `AGENTS.md` / `CLAUDE.md` 內 `<!-- gitnexus:start -->` … `<!-- gitnexus:end -->` 區塊為準——該區塊由 `analyze` **自動維護**（含最新 symbol 統計與工具名）。本檔**不再鏡像副本**，避免第三份拷貝分岔（2026-07-02 前本檔曾殘留 4953-symbol 舊版與 `gitnexus_impact` 舊工具名，已移除）。

核心鐵律（與自動區塊一致）：修改 code symbol 前 MUST 跑 `impact`；commit 前 MUST 跑 `detect_changes`；HIGH / CRITICAL 先回報再繼續。

## 本 repo 的 stale 處理

若 GitNexus index stale，但 re-index 需要匯出或重新分析私有 repo，需遵守當前工具權限與使用者授權；不可自動 export sensitive code。重 index 流程：

```powershell
node .gitnexus/run.cjs analyze   # 自動選 runner；無 run.cjs 時 npx gitnexus analyze（npm 11 crash → npm i -g gitnexus）
node .gitnexus/run.cjs status    # 確認結束 + meta.json 對齊；analyze banner 不算成功
```

已知坑：`detect_changes` 在 linked worktree 看不到 staged（fallback `git diff --name-only --cached` 並揭露）；LadybugDB crash 後的復原順序見 `~/.claude/projects/.../memory/gitnexus-ladybugdb-crash-recovery.md`（agent memory）。
