# 套用說明

## 1. 建 branch

```powershell
cd C:\Repos\active\iot\AI-BIM-governance
git switch main
git pull --ff-only
git switch -c codex/openspec/architecture-rework-2026-05-14
```

## 2. 複製 OpenSpec change

把 zip 裡的：

```txt
openspec/changes/architecture-rework-2026-05-14/
```

複製到 repo 的：

```txt
AI-BIM-governance/openspec/changes/architecture-rework-2026-05-14/
```

## 3. 驗證

```powershell
openspec validate architecture-rework-2026-05-14 --strict
```

若 parser 對某些 wording 太嚴格，先修 spec delta 標頭格式，不要改架構語意。

## 4. 開 PR 前檢查

```powershell
git status --short
git diff --stat
openspec validate architecture-rework-2026-05-14 --strict
```

PR 摘要要明確寫：

```txt
- B 方案：bim-streaming-server owns IFC→USDC conversion jobs
- _worker is RVT→IFC bridge only
- bim-review-platform is deployment boundary, not nested repo
- no runtime code changed in proposal stage
```

## 5. 後續 apply 建議

先不要直接搬 converter。建議按下面順序：

1. source-of-truth docs alignment
2. fake RVT intake + fake worker fixture mode
3. streaming-server conversion API stub
4. streaming-owned conversion result contract tests
5. migrate/wrap real converter behavior
6. platform profile + single-Kit multi-viewer smoke
7. USD stage composition smoke
