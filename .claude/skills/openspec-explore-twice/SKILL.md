---
name: openspec-explore-twice
description: 強制執行至少兩輪 OpenSpec explore，第一輪收斂 why/scope/non-goals，第二輪收斂 design/verify/open-questions，直到所有 open questions 都被回答化。當要建立新 OpenSpec change、需要規格收斂、要產生 proposal/design/tasks/delta 時使用。
allowed-tools: Bash(openspec*) Read Edit Write Grep Glob
---

# OpenSpec Explore Twice

依 [CLAUDE.md](CLAUDE.md) §0.1 規範，OpenSpec change 必須至少做兩輪 explore，open questions 不可遺留。

## 為什麼是兩輪而非一輪

- **Round 1**：澄清「為什麼做」與「不做什麼」。預設容易把 scope 開太大或忽略 non-goals。
- **Round 2**：在 R1 已收斂 scope 的基礎上，談「怎麼驗證、設計取捨、依賴決策」。一輪做完容易把 design 與 scope 混在一起，導致 open questions 永遠開著。

## 執行步驟

### Step 1：建立 change 目錄結構

```
openspec/changes/<change-id>/
├── proposal.md
├── design.md
├── tasks.md
└── specs/
    └── <capability>.delta.md
```

若已存在 → 進入續做模式（讀現有檔案，承接 open questions）。

### Step 2：Round 1 — Why / Scope / Non-goals

以下面四個問題逐一收斂，每個問題都要有明確答案（不能寫「之後再決定」）：

1. **What is the real goal of this change?**
   - 寫進 `proposal.md` 的 Goal 段
2. **What is explicitly out of scope?**
   - 寫進 `proposal.md` 的 Non-goals 段
3. **What is the success criterion?**
   - 寫進 `proposal.md` 的 Success Criteria 段
4. **What is the smallest reversible diff that proves it works?**
   - 寫進 `tasks.md` 的最小驗證 task

**Open question handling**：
- 寫進 `proposal.md` 底部 Open Questions 段
- Round 1 結束時，全部 R1 open questions 都必須被回答化（轉成決策），否則不能進 R2

### Step 3：Round 2 — Design / Verify / Dependencies

在 Round 1 全清的基礎上，再收斂：

1. **Design**：邊界內外的職責分配、API contract、資料流
   - 寫進 `design.md`
2. **Verification ordering**：驗證的順序與每一步的證據
   - 寫進 `tasks.md` 的 Verification Plan 段
   - 順序固定：`openspec validate --strict` → focused tests → smoke / dry-run → real evidence
3. **Dependency decisions**：是否引入新 dependency、是否新增 capability
   - 寫進 `design.md` 的 Dependencies 段
4. **Spec delta**：相對於 `openspec/specs/` 既有 capability 的 ADDED / MODIFIED / REMOVED
   - 寫進 `specs/<capability>.delta.md`

**Round 2 結束條件**：
- 所有 R2 open questions 都已回答
- `proposal.md`、`design.md`、`tasks.md`、`specs/*.delta.md` 都存在且非空

### Step 4：驗證

```
!`openspec validate <change-id> --strict`
```

必須綠燈。失敗 → 回到對應 Round 補強。

### Step 5：輸出

回傳：

```yaml
change_id: <id>
artifacts:
  proposal: openspec/changes/<change-id>/proposal.md
  design: openspec/changes/<change-id>/design.md
  tasks: openspec/changes/<change-id>/tasks.md
  spec_deltas:
    - openspec/changes/<change-id>/specs/<capability>.delta.md
open_questions: []   # 必須為空
validate_strict: passed
rounds_completed: 2
```

## 邊界與限制

- 此 skill **不**寫產品程式碼（apply 階段才寫）
- 此 skill **不**動 `openspec/specs/` 正式 specs（只寫 delta；正式 specs 由 archive 階段同步）
- 若 Round 2 結束後發現 scope 太大，要拆 change → 停止並回報，由 orchestrator 決定拆法

## 範例 open question 模板

```markdown
## Open Questions (Round 1)

- [x] Q1: 這個 change 要不要承擔 visual preview render？
  - A: 不要。preview 仍由 coordinator/viewer/Kit 既有路徑處理。
- [ ] Q2: 是否允許縮小 coverage denominator？
  - A: 待 Round 2 profile 結果決定
```

R1 結束時，Q2 必須有明確答案才能進 R2。

## 參考

- [OpenSpec 官方 getting-started](https://github.com/Fission-AI/OpenSpec/blob/main/docs/getting-started.md)
- PR #31 / PR #35 是兩個成功的「兩輪 explore + delta」範例
