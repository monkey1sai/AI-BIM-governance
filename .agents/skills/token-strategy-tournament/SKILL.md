---
name: token-strategy-tournament
description: Codex model-adapter copy. Use when the user asks to decide the :49101 token/auth strategy via tournament(「跑 token 錦標賽」), or any 多方案認證/安全抉擇 needs independent designs + judged ranking + adversarial check.
---

# token-strategy-tournament(Codex 版)— 逐 phase SOP

> **本檔性質**:`.claude/skills/token-strategy-tournament/SKILL.md` + `.claude/workflows/token-strategy-tournament.js` 的 **model-adapter copy**。
> 只做兩件事:(1) 模型 tier 映射、(2) 執行形態從「Workflow JS harness」改為「Codex 逐 phase 子任務」。
> **Phase / gate / held / schema 語義一字不改**;canonical 檔更新時本檔 MUST 同步。

## 模型映射(不自帶新表,避免雙處漂移)

tier 沿用 `.codex/skills/spec-to-done/SKILL.md` 的 global task routing 原則(不固定模型表):

| tier(canonical) | 用途 | Codex 模型 |
|---|---|---|
| extract(←haiku) | 純抽取/格式化 | 照 spec-to-done 映射表 |
| standard(←sonnet) | 讀檔/盤點(DeepRead 3 readers) | 照 spec-to-done 映射表 |
| reason(←opus) | 設計/合成(Design、Synthesize) | 照 spec-to-done 映射表 |
| judge(←opus max) | 評審(Judge 3 lenses)——**不可降** | 照 spec-to-done 映射表,judge 檔位不可降 |

## 執行形態差異(唯二可改之處)

1. **無 Workflow JS harness** → 每個 phase = 一段獨立子任務;Codex 支援平行子任務就平行跑(DeepRead 3 讀者、Design 3 冠軍、Judge 3 評審),不支援就**逐一序列跑**——序列化只是慢,判準不變。
2. **state 落檔以支援中斷重入**(對應 resumeFromRunId):指揮者(主對話)在每 phase 結束把產出 JSON 追加寫入 `artifacts/decisions/token-strategy-<runStamp>/state.json`;重入時讀 state.json 從缺的 phase 續跑。`<runStamp>` 由使用者/指揮者在開跑時提供(YYYYMMDD-HHmm),之後不變。

## SOP(與 canonical 的 .js 一一對應)

**共同硬約束(每個子任務 prompt 都要帶)**:誠實鐵律——只寫查證過的事實,引用程式碼附 file:line 且必須親讀;查不到寫查不到;效力順序 互動實作規格 > v3 計畫 > v2 規格 > 兩份 .html;落地情境 = 客戶自購 GPU、Windows host、無專職 IT。

### Phase 1 — DeepRead(standard tier,3 個子任務,可平行)
逐字使用 canonical `.js` 內 `READERS` 三段 prompt(status-quo / constraints / external),把 `${A.root}` 代成 repo 根目錄。各回傳繁中報告,串成 readingDigest。

### Phase 2 — Design(reason tier,3 個子任務,可平行)
逐字使用 canonical `.js` 內 `TASK_BRIEF` + 三個 `CONTENDERS`(short-jwt / reverse-proxy / mtls)的 angle;每個子任務回傳 JSON,形狀 = canonical `DESIGN_SCHEMA`(approach / summary / architecture / ssoIntegration / tokenLifecycle / failureModes[] / opsCost / rolloutSteps[] / honestWeaknesses[] / openQuestions[])。

### Phase 3 — Judge(judge tier,3 個子任務,可平行;**模型不可降**)
逐字使用 canonical 三個 `JUDGE_LENSES`(sso-compat / ops-cost / failure-safety);輸入 = TASK_BRIEF + 三份設計 JSON;每個回傳 JSON,形狀 = `JUDGE_SCHEMA`(scores[] / ranking[] / mustAbsorb[] / mustAvoid[])。

### Phase 4 — Synthesize(reason tier,1 個子任務)
逐字使用 canonical Synthesize prompt;回傳 `SYNTH_SCHEMA`(finalChoice / rationale / absorbed / avoided / oqHooks / specDraft / claimsRegistry[{id, q≤800字, suspectFile}] / artifactPath)。
writeArtifact=true 時把完整裁決寫入 `artifacts/decisions/token-strategy-<runStamp>.md`。

### Phase 5 — AdversarialCheck(judge tier)
Codex 側沒有 `fu-adversarial-verify-generic` workflow 可 compose → **手工等價**,gate 語義與 canonical JS 完全相同,且保留 fu 的邊界(claims ≤32 條、每條 q ≤800 字、verifier 至多分 2 批、含 critic 總呼叫 ≤8):
1. 對 claimsRegistry 派 verifier 子任務(至多 2 批,批內逐條):「預設此主張為假,親自 Read/grep 指定檔案舉證;回傳 {id, verdict: 'refuted'|'upheld'|'cannot_verify', introduced_new_issue, evidence}」。
2. 再派一個 critic 子任務通讀整份裁決 + specDraft:「找與 docs/plans 約束或 repo 現況的矛盾、file:line 不實、未驗證假設寫成事實、偷渡 loopback-only / silent fallback;回傳 {overall_safe, issues[]}」。
3. **Gate(對齊 canonical:not_closed / new_issues 判定)**:`not_closed = verdict 非 'upheld' 的清單`(**`cannot_verify` 視同未閉合**,refute-by-default);`new_issues = introduced_new_issue=true 的清單`。兩清單皆空 → `decided`;否則 → `held: adversarial_not_closed`,逐條呈報後修訂裁決重跑本 phase。critic 的 `overall_safe`/`issues` **呈報為 advisory,不翻 gate**(與 canonical JS 相同)。
4. verifier 有任一子任務無回傳 = infra 失敗:重跑一次;仍失敗 → 記 advisory 未驗證(視同 canonical 的 composeError / fu 端 held 處置),**不得視為通過**,由使用者決定放行與否。

## Held 語義與紀律(與 canonical 相同)

- `decided` / `held: adversarial_not_closed` / `held: apex_denied`(開跑前契約審核否決,Codex 側=指揮者 Phase 0 自審)/ infra composeError 或 fu 端 held=advisory 未驗證,處置同 `.claude` 版 SKILL.md 表格。
- 裁決不自動改 docs/plans、不開 openspec change;spec 落地仍走 spec-to-done 管線(Codex 側走 `.codex/skills/spec-to-done`)。
