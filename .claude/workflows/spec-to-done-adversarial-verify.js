export const meta = {
  name: 'spec-to-done-adversarial-verify',
  description: '對抗驗證 spec-to-done 工作流四個落地檔:規範一致性 / 技術正確性 / 應用測試 / 防錯覆蓋',
  phases: [{ title: 'Verify', detail: '4 個 Opus verifiers 平行,refute-by-default', model: 'opus' }],
}

const FILES = [
  'C:/Repos/active/iot/AI-BIM-governance/.claude/skills/spec-to-done/SKILL.md',
  'C:/Repos/active/iot/AI-BIM-governance/.claude/workflows/std-plan.js',
  'C:/Repos/active/iot/AI-BIM-governance/.claude/workflows/std-implement.js',
  'C:/Repos/active/iot/AI-BIM-governance/.claude/workflows/std-evidence.js',
]

const ISSUES_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'issues'],
  properties: {
    lens: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'file', 'detail'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
}

const PRE = `你是 spec-to-done 工作流落地檔的對抗驗證者。預設立場:檔案有問題,除非親讀證明沒有。逐字讀這四個剛落地的檔案:
${FILES.map((f) => '- ' + f).join('\n')}

背景:這組檔案實作「spec → merged PR」的可重複工作流。主對話(指揮官)載入 SKILL.md,依編排呼叫 named workflows:std-plan(plan+四軸review+impact預掃)→ std-implement(per-task TDD+兩階段review+commit錨點)→ std-evidence(browser evidence,僅 user-facing)→ 既有 fu-adversarial-verify-generic(對抗複驗)→ 既有 ship-item(merge)。模型:fable=讀/導航/機械,opus=設計/裁決/實作。
回傳 StructuredOutput:lens、issues[](severity:blocker=會導致流程做錯事或違反 repo 規範 / major=會卡住或誤導 / minor=nit;file;detail 引用具體行文)。沒有問題就空陣列——但你應該努力找。`

phase('Verify')
log('4 個 verifiers:compliance / technical / usability / resilience')

const verdicts = await parallel([
  () => agent(`${PRE}

你的 lens:【repo 規範一致性】。對照這些權威檔逐條驗證:
- C:/Repos/active/iot/AI-BIM-governance/AGENTS.md(§0.1 四工具不平權、4 anti-patterns、誠實鐵律、完成標準、不在 main 開發)
- C:/Repos/active/iot/AI-BIM-governance/docs/agents/gitnexus-usage.md(改 symbol 前 impact、commit 前 detect_changes、HIGH/CRITICAL 先回報)
- C:/Repos/active/iot/AI-BIM-governance/.claude/workflows/ship-item.md(merge 紀律、closeout worktree 守衛、consent carve-out)
- C:/Repos/active/iot/AI-BIM-governance/docs/agents/product-operability-and-script-contract.md(user-facing 完成標準、PR 驗收表)
特別找:四檔有沒有哪裡讓 Matt Pocock 越界進主線?有沒有 gate 可被自動繞過而 repo 規範要求停?誠實鐵律(DEMO DATA/not observed/不偽裝)有沒有漏注入的環節?HIGH 的「先回報」在編排裡是否真的會發生?`,
    { label: 'verify:compliance', phase: 'Verify', schema: ISSUES_SCHEMA }),

  () => agent(`${PRE}

你的 lens:【技術正確性】。逐行檢查:
1. 三支 .js 的 JS 邏輯 bug:迴圈邊界(startTaskIndex/continue/MAX_FIX 輪數)、null 處理(agent 回 null 的每條路徑)、schema 與 prompt 要求的欄位是否一致、return shape 是否完整。
2. 跨檔簽名一致性:SKILL.md 編排引用的欄位(P1.planPath、P1.impact.overallRisk、P3.finalReview.findings、P3.resumeHint.startTaskIndex、P4.evidence.gaps、P5.not_closed/new_issues/critic.overall_safe、P6.merged/prNumber/heldReason)是否與各 .js 實際 return 及既有 workflow 真實簽名吻合——既有簽名請親讀 C:/Repos/active/iot/AI-BIM-governance/.claude/workflows/fu-adversarial-verify-generic.js 與 ship-item.js 確認。
3. Workflow runtime 限制:meta 是否純 literal;有無時鐘/亂數 API 呼叫(連 prompt 字串裡的字面也會被靜態檢查擋);agent() 的 model 值只能是 sonnet/opus/haiku/fable;schema additionalProperties:false。
4. prompt 內指令可執行性:bash 片段(probe 偵測鏈、git 指令、npx gitnexus)在 Windows + git-bash 環境是否可跑;MCP 工具名(mcp__gitnexus__impact / mcp__gitnexus__detect_changes)是否真實存在。`,
    { label: 'verify:technical', phase: 'Verify', schema: ISSUES_SCHEMA }),

  () => agent(`${PRE}

你的 lens:【應用測試(可依循性)】。模擬你是一個全新的主對話 agent,使用者說:「用 spec-to-done 跑 docs/superpowers/specs/2026-06-15-demo-feature-design.md,user-facing」。
只靠 SKILL.md 一步步走(P0 開場 → P1..P7),每一步問自己:(a) 我知道現在要跑什麼指令/呼叫什麼 Workflow 嗎?(b) args 每個欄位我都湊得齊嗎(從哪來)?(c) gate 判斷我有明確的布林/枚舉可讀嗎?(d) HELD 之後使用者說「繼續」,我能從 hold block 還原出該帶哪些 args 嗎?
也驗 resume 劇本:P3 在 task#3 因 critical_impact HELD → 使用者拆了 change 說繼續 → 文件有沒有告訴我 startTaskIndex 怎麼帶、要不要重跑 P1?
找出所有「文件沒講清楚會卡住或做錯」的點。`,
    { label: 'verify:usability', phase: 'Verify', schema: ISSUES_SCHEMA }),

  () => agent(`${PRE}

你的 lens:【防錯覆蓋與失敗復原】。逐故障場景檢查四檔是否有可行路徑(refute-by-default:宣稱有處理就去找那段文字,找不到 = issue):
1. GitNexus index stale / LadybugDB crash / detect_changes 在 linked worktree 看不到 staged(memory 已知坑)
2. gstack 缺 bun(NEEDS_SETUP)/ Playwright 在 worktree 缺 node_modules / 三層引擎全失敗
3. implementer 回 null / BLOCKED / NEEDS_CONTEXT;reviewer 永遠不過(無限迴圈風險?)
4. plan 檔已 commit 但 std-plan 在 review 階段死掉 → resume 會重寫 plan 嗎(冪等性)?
5. P5 findings 為空陣列時 fu-adversarial-verify-generic 的行為(只剩 critic?)
6. P6 ship held 後帶 prNumber 重入的路徑是否完整
7. evidence 寫到主工作區 artifacts/(worktree closeout 不會清掉)的指引是否真的可執行
8. 多次 fix commit 後 quality reviewer 的 diff 範圍會不會看錯`,
    { label: 'verify:resilience', phase: 'Verify', schema: ISSUES_SCHEMA }),
])

const all = verdicts.filter(Boolean)
const flat = all.flatMap((v) => v.issues.map((i) => ({ ...i, lens: v.lens })))
log(`驗證完成:${all.length}/4 verifiers,blocker=${flat.filter((i) => i.severity === 'blocker').length} major=${flat.filter((i) => i.severity === 'major').length} minor=${flat.filter((i) => i.severity === 'minor').length}`)

return { verdicts: all, blockers: flat.filter((i) => i.severity === 'blocker'), majors: flat.filter((i) => i.severity === 'major'), minors: flat.filter((i) => i.severity === 'minor') }