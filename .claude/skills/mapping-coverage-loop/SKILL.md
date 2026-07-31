---
name: mapping-coverage-loop
description: Use when the user asks to push element_mapping coverage to a threshold (e.g. 「衝覆蓋率」「mapping coverage 迴圈」「G3 覆蓋率 ≥95%」), or whenever IFC→USD conversion coverage must be iterated with evidence instead of one-shot fixes.
---

# mapping-coverage-loop — 指揮官手冊

element_mapping 覆蓋率閉環:⑥ loop-until-done 為骨架(過關條件 + 圈數上限 + 連續綠確認),每圈內做 ④ 未對映 GUID 全量生成 → 三桶篩選(fixable / noGeometry / anomalies),① 只修可修桶、圈數到門檻自動升級 opus,gate 由 haiku 便宜判定。**量尺被動或 allow_fake_mapping 被打開 = 立即 held,不重試**。

**Source of truth**:本檔為 canonical;`.codex/skills/mapping-coverage-loop/SKILL.md` 是 Codex 的 model-adapter copy(只映射模型與執行形態、不改 gate)。修改本檔 gate / held / 圈數語義時 **MUST 同步該 copy**。

## 觸發與呼叫

```
Workflow({ name: 'mapping-coverage-loop',
           args: { runStamp: '<YYYYMMDD-HHmm,指揮官現在補>',
                   ifcPath: 'bim-control/270/機電/000001.ifc',
                   threshold: 95, maxRounds: 5, escalateAtRound: 3, confirmRuns: 1 } })
```

- `runStamp`、`ifcPath` 必填。對應 G3(streaming-owned 轉檔 + 真實 mapping 品質)。
- 大檔首跑建議先用小 fixture 驗管路,再上 65.7MB 真檔。

## Gate 與 held 語義

| 狀態 | 條件 | 指揮官動作 |
|---|---|---|
| `success` | 官方量尺 ≥ threshold 且確認跑連續綠 | 收 `artifacts/mapping-coverage/<runStamp>/` 證據,可作 G3 evidence |
| `blocked: env_blocked` | Baseline 環境跑不動 | 修環境(golden path)後重跑;**不接受捏造數字** |
| `held: turn_cap_exhausted` | 圈數用盡未達標 | 看逐圈 Δ 決定:再開一輪(調 maxRounds)或轉人工 |
| `held: no_fixable_left` | 無可修桶但未達標 | 大概率是**分母定義**問題 → 開 OQ 交人裁決,不得自行改量尺 |
| `held: metric_tampered` | 量尺檔被動 / fake mapping 被開(Baseline、每圈、Confirm 皆檢查) | **最高優先級違規**:人工審 diff,回滾後才可重跑 |
| `held: confirm_failed_flaky` | 確認跑翻車(無竄改跡象) | 轉檔非決定性 → 先查環境/暫存污染,單次偶然的綠不採計 |
| `held: apex_denied` | apex-first 契約審核否決或無回傳(arbiter on_unavailable=HELD) | 檢視 args / 契約後重跑 |
| `held: baseline_incomplete` | Baseline 缺 metricFiles / reportPath / coverageSource | 補量尺定位證據後重跑;防竄改無憑據不得續跑 |
| `held: bucket_agent_failed` / `measure_failed` / `gate_agent_failed` | 該圈子任務無回傳或量測失敗(infra) | 查 infra 原因後重跑;不得視為通過 |

## 紀律

- run 以 apex-first 契約審核(Fable/max)開場(repo apex-first 治理慣例);數值參數(threshold/maxRounds/escalateAtRound/confirmRuns/sampleCap)有型別與範圍驗證,不合法直接 throw。
- **pass / tampered 由 coordinator 依 evidence 本地重算(fail-closed)**;gate agent(extract 檔)輸出僅作交叉參考,不一致以本地重算為準。Baseline 同受防竄改與完整性檢查。
- gate 只認官方量尺(coverage 計算程式的定義,附 file:line);`adjustedCoverage` 僅 advisory,**永不翻轉 gate**(對齊「advisory 不改 gate」四不變式精神)。
- fixer 絕對禁區:量尺程式、threshold、allow_fake_mapping、forbidden paths;檔案修補一律 Python str.replace + count==1 斷言,禁 sed -i。
- anomalies 桶不在本 loop 修:報告列出,另開 issue。
