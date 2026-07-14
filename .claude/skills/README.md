# Repo-local agent skills

[`agent-skills-manifest.json`](../../agent-skills-manifest.json) 是 Claude / Codex repo-local skill inventory、platform locations、mirror policy 與 upstream provenance 的唯一 machine-readable source of truth。本檔只提供人類入口，不維護第二份清單。

## Materialization contract

- `.claude/skills/` 與 `.codex/skills/` 都是 tracked physical copies；禁止 symlink / junction。
- `mirror` skill 以 manifest 宣告的 source platform 為 canonical copy。
- `spec-to-done` 是刻意的 Claude / Codex platform variants，不做 byte mirror；P0–P7 shared gates 由 agent-governance tests 檢查。
- `gitnexus/` 是 GitNexus CLI 產生的 Claude family；`ai-bim-fast-fix` / `ai-bim-bounded-change` 是 Codex-only lane helpers。
- `skills-lock.json` 是舊的個人 skill installer lock，不代表本 repo 目前 tracked skill inventory。

## Deterministic check and sync

```powershell
pwsh -NoProfile -NonInteractive -File .\scripts\dev\sync-agent-skills.ps1 -Mode Check
pwsh -NoProfile -NonInteractive -File .\scripts\dev\sync-agent-skills.ps1 -Mode Sync
```

`Sync` 只更新 manifest 中 declared mirror target 的檔案。它可逐檔移除 target 內的 stale files，但不 recursive-delete 整個 skill directory，也不碰 undeclared / independent skill。
