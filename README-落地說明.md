# bim-workflows-pack — 落地說明

> 2026-07-30 · 兩支新工作流(token 策略錦標賽 / mapping 覆蓋率閉環)+ Claude/Codex 雙版 SKILL 入口。
> 設計原則:**compose 既有、不重造**;gate 語義兩版一致,Codex 版只映射模型與執行形態。

## 包內容(直接覆蓋到 repo 根目錄即可,路徑已對齊)

```
.claude/workflows/token-strategy-tournament.js   ← ②fan-out + ⑤tournament + ③adversarial 組合拳
.claude/workflows/mapping-coverage-loop.js       ← ⑥loop + ④generate-filter + ①classify 組合拳
.claude/skills/token-strategy-tournament/SKILL.md  ← 指揮官手冊(canonical)
.claude/skills/mapping-coverage-loop/SKILL.md      ← 指揮官手冊(canonical)
.codex/skills/token-strategy-tournament/SKILL.md   ← Codex model-adapter copy
.codex/skills/mapping-coverage-loop/SKILL.md       ← Codex model-adapter copy
```

新檔全部落在 `.claude/` `.codex/` `artifacts/`,**不碰任何 forbidden paths**(AGENTS.md、docs/plans/*-roadmap-*、openspec/specs/**、archive、docs/contracts/**)。

## 對「現有功能」做了什麼(優化 = 對齊既有規範,不盲改你的檔)

我這邊只讀得到 project knowledge 節錄、看不到 harness 完整原始碼,所以**沒有直接 patch 你既有的 .js**(亂改會出事)。優化改用五個「吸收既有慣例」落實:

1. **compose `fu-adversarial-verify-generic`,不重造對抗段**:錦標賽的 AdversarialCheck 直接 `workflow({name:'fu-adversarial-verify-generic', ...})`,findings 壓成 DACS registry `{id, q≤800字, suspectFile}`,與 spec-to-done P5 慣例一致。
2. **抄 `std-implement.js` 升級通道**:coverage loop 的 fixer 在第 `escalateAtRound` 圈自動 sonnet→opus。
3. **抄 `/goal` 紀律**:evidence JSON 過關 + 圈數上限 + 連續綠確認,gate 用 haiku(extract 檔)便宜判定。
4. **抄 hexagon routing 慣例**:每支 workflow inline 一份完整 `ROUTING`(extract/standard/reason/judge,judge 不可降),**不生共用模組**(workflow 腳本不能互相 import 是已證實限制)。
5. **抄「advisory 不改 gate」四不變式**:coverage loop 的 `adjustedCoverage`(扣掉無幾何實體的參考值)永遠只是 advisory,gate 只認官方量尺 —— 分母有疑義走 OQ 人裁,不自行改尺。

### 建議順手做的兩個既有檔小 patch(在 repo 裡叫 Claude Code 做,一句話即可)

- **`repo-wide-adversarial-round-1.js`**:把 lenses 抽成可由 args 覆寫(預設不變),讓 honest-degradation lens 能被單獨呼叫 —— spec 凝固前的誠實稽核就能重用它,不必整包跑。
- **`.claude/skills/spec-to-done/SKILL.md`**:在「四套工具的唯一切入點」表後補一行:遇到「多方案抉擇未決」的 spec,可先跑 `token-strategy-tournament` 拍板再進 P1(optional 支流,不改主線 gate)。改完記得同步 `.codex` copy(你們自己的同步鐵律)。

## 落地前檢查清單(誠實標註:以下三點我無法在此環境驗證)

1. **args 注入方式**:兩支 .js 用 `typeof args === 'object'` 防禦式收參。請對照任一支 `std-*.js` 檔頭實際怎麼收 args——不同的話,只改檔頭 `const A = ...` 那一段。
2. **workflow() compose 簽名**:錦標賽對抗段假設腳本內可 `await workflow({name, args})`(一層 compose,SKILL.md 有記載此能力)。若實際 API 名稱/形狀不同,只改 AdversarialCheck 那一段;已包 try/catch,compose 失敗會降級成 advisory 而不是整跑炸掉。
3. **agent() 的 schema 行為**:schema 形狀抄 `repo-health-scan.js` 慣例(JSON-schema 物件)。若 harness 對頂層形狀有特定要求(如必須 array),微調各 `*_SCHEMA` 即可,prompt 不用動。

跑不起來時的定位順序:先 dry(小 IFC / `skipAdversarial:true`)→ 看是 args 段、schema 段還是 compose 段報錯 → 只動對應段。

## 整合到 routing 單一真相(hexagon 慣例)

兩支新檔的 inline `ROUTING` 已按四檔位寫死。若要納入防漂移體系:
1. 在 `routing.json` 的 codegen 對象(`scripts/gen_routing.py`)加上這兩支檔的 ROUTING 區塊。
2. pytest drift 測試加兩筆斷言(inline ROUTING == routing.json 對應 tier)。
3. `judge` 檔位維持 immutable —— codegen 只驗不覆寫。

## 建議首跑

```
# 1) 錦標賽 dry run(先跳過對抗段,驗管路)
Workflow({ name:'token-strategy-tournament', args:{ runStamp:'<現在時間>', skipAdversarial:true } })

# 2) coverage loop 用小 fixture 驗管路,再上真檔
Workflow({ name:'mapping-coverage-loop', args:{ runStamp:'<現在時間>', ifcPath:'<小fixture>', maxRounds:2 } })
Workflow({ name:'mapping-coverage-loop', args:{ runStamp:'<現在時間>', ifcPath:'bim-control/270/機電/000001.ifc' } })
```

Codex 側:對 Codex 說「照 .codex/skills/token-strategy-tournament/SKILL.md 跑」即可;它會逐 phase 序列/平行執行,gate 判準與 Claude 版完全相同。

## 同步鐵律(沿用你們 spec-to-done 的規則)

`.claude/skills/*/SKILL.md` 為 canonical;改 phase / gate / held / 圈數語義時 **必須**同步對應的 `.codex/skills/*/SKILL.md`,否則兩邊對同一任務會分歧。
