---
name: mapping-coverage-loop
description: Codex model-adapter copy. Use when the user asks to push element_mapping coverage to a threshold(「衝覆蓋率」「G3 覆蓋率 ≥95%」)and iterate conversion fixes with evidence.
---

# mapping-coverage-loop(Codex 版)— 逐 phase SOP

> **本檔性質**:`.claude/skills/mapping-coverage-loop/SKILL.md` + `.claude/workflows/mapping-coverage-loop.js` 的 **model-adapter copy**。
> 只映射模型與執行形態;**過關條件 / 圈數上限 / held 語義 / 防竄改規則一字不改**;canonical 檔更新時本檔 MUST 同步。

## 模型映射(tier 沿用 `.codex/skills/spec-to-done/SKILL.md` 的 global task routing 原則,不固定模型表)

| tier(canonical) | 本流程角色 | Codex 模型 |
|---|---|---|
| extract(←haiku) | **Gate 判定員**(只讀 evidence JSON 套 4 條規則,零判斷空間) | 照映射表最便宜檔 |
| standard(←sonnet) | Baseline / 量測 / 分桶 / 前段(第 1–2 圈)修復 / 報告 | 照映射表 |
| reason(←opus) | 第 `escalateAtRound`(預設 3)圈起的修復升級 | 照映射表 |
| judge(←opus max) | 本流程無自動 judge 段;保留給 `held: metric_tampered` 的人工複審輔助 | 不可降 |

## 執行形態差異(唯二可改之處)

1. **無 JS harness 的 for 迴圈** → 由指揮者(主對話)人肉維護圈數:每圈依序跑 4 個子任務(分桶 → 修復 → 量測 → gate),圈數與 `maxRounds` 記在 state.json,**嚴禁超圈**。
2. **state 落檔**:`artifacts/mapping-coverage/<runStamp>/state.json` 記 {round, prevCoverage, metricFiles, status};每圈結束更新;中斷重入從 state 續跑。`<runStamp>` 開跑時由使用者提供,之後不變。

## 參數(預設同 canonical)

`ifcPath`(必填)、`threshold=95`、`maxRounds=5`、`escalateAtRound=3`、`confirmRuns=1`、`sampleCap=50`、產物目錄 `artifacts/mapping-coverage/<runStamp>/`。

## 共同硬約束(每個子任務 prompt 都要帶,原文照抄 canonical `HARD_RULES`)

誠實鐵律(數字必來自真實指令輸出;跑不動回報 blocked,禁捏造)/ allow_fake_mapping 維持 false / 禁改量尺(coverage 計算、summary 產出、threshold)/ 禁動 forbidden paths(AGENTS.md、docs/plans/*-roadmap-*.md、openspec/specs/**、openspec/changes/archive/**、docs/contracts/**)/ 檔案修補用臨時 .py:pathlib 讀檔 + `str.count(old)==1` 斷言 + replace + utf-8 寫回,**禁 sed -i**(中文混編檔會炸)/ 產物落 artifacts 目錄,evidence 記真實值。

## SOP

### Phase 0 — 契約審核(apex 等價;canonical 的 apex-first governedAgent)
指揮者(最高檔模型)先審核執行契約:args 齊備、產物僅落 `artifacts/mapping-coverage/<runStamp>/`、量尺/threshold/allow_fake_mapping 屬絕對禁區、不碰 forbidden paths。否決或無法審核 → `held: apex_denied`,不開跑。

### Phase 1 — Baseline(standard tier,1 個子任務)
逐字使用 canonical Baseline prompt:定位 golden path 轉檔入口 → 環境不通則 `ok=false + blockedReason` **直接回報 blocked,流程結束** → 首跑轉檔 → 讀官方 coverage → 定位量尺檔清單 `metricFiles` 與分子分母定義(file:line)→ 實查 allow_fake_mapping → evidence JSON 落檔 `round-0-baseline.json`。回傳形狀 = canonical `EVIDENCE_SCHEMA`。
Baseline 回傳後由**指揮者本地檢查**(fail-closed,同 canonical):有竄改跡象(`fakeMappingEnabled≠false` 或 `metricFilesTouched` 非空)→ 立即 `held: metric_tampered`;缺 `metricFiles`/`reportPath`/`coverageSource` → `held: baseline_incomplete`。

### Phase 2 — Rounds(每圈 4 步;圈數 1..maxRounds)
1. **分桶**(standard):逐字用 canonical 分桶 prompt → 全量未對映清單落檔、三桶(fixable / noGeometry / anomalies)、coverageDefinition(含 advisory 的 adjustedCoverage)。回傳形狀 = `BUCKETS_SCHEMA`。
   - `fixableCount === 0` 且未達標 → **早停 `held: no_fixable_left`**(大概率分母定義問題,開 OQ 交人裁決,不得自行改量尺)。
2. **修復**(圈 < escalateAtRound 用 standard,否則升 reason):逐字用 canonical 修復 prompt;只修 fixable 桶、最小修改面、絕對禁區照 HARD_RULES。
3. **量測**(standard):重跑 Baseline 同一條指令;防竄改實查——`git diff --name-only` 交集 metricFiles → `metricFilesTouched`;實查 allow_fake_mapping → `fakeMappingEnabled`;evidence 落檔 `round-<i>-evidence.json`。
4. **Gate**:pass/tampered 由**指揮者依 evidence 本地重算**(fail-closed,同 canonical),4 條規則全成立才 pass——
   `ok===true`、`coverage>=threshold`、`fakeMappingEnabled===false`、`metricFilesTouched 為空`。
   extract 子任務的 gate 判定僅作交叉參考,不一致以本地重算為準。
   `tampered = fake 開了 或 量尺檔被動` → **立即 `held: metric_tampered`,不重試**(最高優先級違規;人工審 diff、回滾後才可重跑)。
   子任務無回傳:分桶 → `held: bucket_agent_failed`;量測失敗 → `held: measure_failed`;gate 子任務無回傳 → `held: gate_agent_failed`。

圈數用盡未 pass → `held: turn_cap_exhausted`,停下回報,不硬撐。

### Phase 3 — Confirm(standard tier;僅 pass 後)
連續 `confirmRuns` 次重跑量測,**中間不做任何修改**;任一次出現竄改跡象 → `held: metric_tampered`(不得歸為 flaky);其餘不過 → `held: confirm_failed_flaky`(單次偶然的綠不採計)。

### Phase 4 — Report(standard tier)
逐字用 canonical 報告 prompt:繁中總結 + 逐圈證據表 + 剩餘缺口 + 後續建議(含分母定義 OQ 建議),存 `report.md`。

## 狀態表(與 `.claude` 版 SKILL.md 完全相同,不重抄——判準以 canonical 為準)

`success` / `blocked: env_blocked` / `held: turn_cap_exhausted | no_fixable_left | metric_tampered | confirm_failed_flaky | apex_denied | baseline_incomplete | bucket_agent_failed | measure_failed | gate_agent_failed`,指揮者處置照 canonical 表格。
