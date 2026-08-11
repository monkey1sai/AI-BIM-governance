# Repo-local agent skills

[`agent-skills-manifest.json`](../../agent-skills-manifest.json) 是 Claude / Codex repo-local skill inventory、platform locations、mirror policy 與 upstream provenance 的唯一 machine-readable source of truth。本檔只提供人類入口，不維護第二份清單。

每個 skill entry 由 `entry_defaults` 繼承 owner 與 executable consumer，並各自宣告 `sync.mode` 與 reviewed `agent-skill-tree/v2` SHA-256；`sync-agent-skills.ps1 -Mode Check` 對缺漏或內容漂移 fail closed。

## Materialization contract

- `.claude/skills/` 與 `.codex/skills/` 都是 tracked physical copies；禁止 symlink / junction。
- `mirror` skill 以 manifest 宣告的 source platform 為 canonical copy。
- Superpowers 是固定於官方 `obra/superpowers` v6.1.1 的 skill-only bundle；`.claude/skills/` 為 canonical，mirror 至 `.codex/skills/`。不 vendor plugin hooks / commands，且可用性不覆蓋 repo 的 explicit-only invocation policy。
- `spec-to-done` 是刻意的 Claude / Codex platform variants，不做 byte mirror；P0–P7 shared gates 由 agent-governance tests 檢查。
- `gitnexus/` 是 GitNexus CLI 產生、再套用 repo `--index-only` policy 的 Claude family；`ai-bim-fast-fix` / `ai-bim-bounded-change` 是 Codex-only lane helpers。
- GitNexus 的本機 generated advisory snapshots 只可留在 ignored `.agents/skills/generated/`；它們不屬於 manifest-governed Claude / Codex provider copies，也不是 product source of truth。index refresh 必須使用 `--index-only`，不得要求 community skill generation；inventory check 會把 `.claude/skills/generated/` 或 `.codex/skills/generated/` 視為 undeclared drift。
- Repo-local executable reference audit 確認舊 `skills-lock.json` 沒有 consumer 後已移除；`agent-skills-manifest.json` 是唯一 inventory/provenance truth。verification manifest 只保留該舊檔名作 reintroduction trigger，讓 absence gate 能阻止假鎖檔復活。

## Deterministic check and sync

```powershell
pwsh -NoProfile -NonInteractive -File .\scripts\dev\sync-agent-skills.ps1 -Mode Check
pwsh -NoProfile -NonInteractive -File .\scripts\dev\sync-agent-skills.ps1 -Mode Sync
```

`Check` 是零寫入檢查。v2 tree digest 以 ordinal 排序的 `/` relative path 加每檔 content SHA-256 計算。explicit Git `text` 將 CRLF 正規化為 LF；explicit `-text` 維持 raw bytes；`text=auto`／unspecified 遵循 indexed Git classification。演算法不做 Unicode decode/re-encode、保留 lone CR；classification-neutral bytes 只有在 ambiguity 可能改變 digest 時才 fail closed，untracked asset 一律拒絕。mirror equality 仍是 byte-identical raw comparison。

`Sync` 在任何寫入前驗證 canonical／single／independent digest，並要求既有與 planned mirror target files 都已有 Git index entry；所以可還原 deleted-but-tracked target，但全新 untracked target 會零寫入拒絕。通過 preflight 後只更新 declared mirror target；它可逐檔移除 tracked stale files，但不 recursive-delete 整個 skill directory、不更新 manifest digest，也不碰 undeclared／independent skill。
