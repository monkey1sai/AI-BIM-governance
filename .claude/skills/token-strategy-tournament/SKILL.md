---
name: token-strategy-tournament
description: Use when the user asks to decide the :49101 token/auth strategy via tournament (e.g. 「跑 token 錦標賽」「:49101 認證方案比稿」), or when any 多方案認證/安全抉擇 needs independent designs + judged ranking + adversarial check before a spec is written.
---

# token-strategy-tournament — 指揮官手冊

把「:49101 token 策略」這類**做法不只一種、選錯很貴**的決策,用錦標賽拍板:
② fan-out 深讀(現況/約束/外部依據)→ ⑤ 三方案冠軍獨立設計 + 三 lens 評審排名 → 綜合裁決出 spec 草稿 → ③ compose `fu-adversarial-verify-generic` 對關鍵主張 refute-by-default。

**Source of truth**:本檔為 canonical;`.codex/skills/token-strategy-tournament/SKILL.md` 是 Codex 的 model-adapter copy(只映射模型與執行形態、不改 gate)。修改本檔 phase / gate / held 語義時 **MUST 同步該 copy**。

## 觸發與呼叫

```
Workflow({ name: 'token-strategy-tournament',
           args: { runStamp: '<YYYYMMDD-HHmm,指揮官現在補>',
                   root: 'C:/Repos/active/iot/AI-BIM-governance',
                   writeArtifact: true, skipAdversarial: false } })
```

- `runStamp` **必填**:workflow 腳本禁 Date/亂數 API(resume 相容),時間戳由指揮官帶入。
- 換題目:改 `args.subject` 與 `args.contenders`(同 schema),即可重用於 A3 clash 呈現、A9 Copilot 介面形態等抉擇。
- run 以 apex-first 契約審核(Fable/max)開場(repo apex-first 治理慣例);否決或無回傳 → `held: apex_denied`。

## Gate 與 held 語義(對齊 spec-to-done P5)

| 狀態 | 條件 | 指揮官動作 |
|---|---|---|
| `decided` | 對抗段 `not_closed=[]` 且 `new_issues=[]`,或 skipAdversarial | 呈報裁決 + specDraft;經使用者核可後才進 docs/superpowers/specs/ |
| `held: adversarial_not_closed` | 有主張被證偽/新問題 | 呈報 not_closed 逐條;修訂裁決後重跑(resumeFromRunId) |
| `held: apex_denied` | apex-first 契約審核否決或無回傳(arbiter on_unavailable=HELD) | 檢視 args / 契約後重跑 |
| 對抗段 composeError / fu 端 held | compose 失敗,或 fu 回 held(bad_args / run_budget_exhausted / reviewer_agent_failed)(infra) | advisory 未驗證:明白告知使用者「裁決未經對抗驗證」,由使用者決定放行與否 |

## 紀律

- 裁決寫入 `artifacts/decisions/token-strategy-<runStamp>.md`;**不**自動改 docs/plans、不開 openspec change —— spec 落地仍走既有 spec-to-done 管線。
- claimsRegistry 每條 q ≤ 800 字(DACS 慣例);對抗段 findings 形狀 = `{id, q, suspectFile}`。
- 誠實鐵律:引用 file:line 必親讀;查不到寫查不到;依賴未決事項掛 OQ,不假裝已解。
