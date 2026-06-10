// Workflow-tool 腳本(由 Workflow({name:'std-implement', args}) 執行),非 standalone Node 程式。
// 編排權威見 .claude/skills/spec-to-done/SKILL.md(本檔為 spec-to-done P3:per-task 序列實作引擎 + fix-cycle)。
// mode='tasks':逐 task TDD+兩階段 review+commit 錨點;mode='fix':只修 fixFindings(P5/P6 修復迴圈的真實通道)。
export const meta = {
  name: 'std-implement',
  description: 'spec-to-done P3:mode=tasks 逐 task 序列實作(impact→TDD→spec review→quality review→commit);mode=fix 修 P5/P6 未閉合 findings。嚴禁平行 implementer。',
  phases: [
    { title: 'Parse', detail: 'fable 讀 plan 抽出每 task 全文(implementer 不自讀 plan)', model: 'fable' },
    { title: 'Implement', detail: '序列:per-task impact→implementer→spec review→quality review→commit 錨點' },
    { title: 'Fix', detail: 'mode=fix:fixer 修 findings + verify reviewer 驗閉合', model: 'opus' },
    { title: 'FinalReview', detail: 'opus 整體 diff vs plan+spec,產出 adversarial findings', model: 'opus' },
  ],
}

// args 防護:harness 可能把 args 序列化成 JSON 字串,字串就 parse;必填缺直接 fail-fast
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const PLAN_PATH = A.planPath
const ROOT = A.worktreeRoot
const BRANCH = A.branch
const SPEC_PATH = A.specPath
const USER_FACING = A.userFacing === true
const START = A.startTaskIndex || 0
const MAX_FIX = A.maxFixRounds ?? 2
const MODE = A.mode || 'tasks'
const FIX_FINDINGS = A.fixFindings || []
const ACKED_CRITICAL = A.acknowledgedCriticalSymbols || []
{
  const missing = [['planPath', PLAN_PATH], ['worktreeRoot', ROOT], ['branch', BRANCH], ['specPath', SPEC_PATH]].filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) return { ok: false, held: 'bad_args', missing }
}

const TASKS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['index', 'title', 'fullText', 'files', 'symbols', 'mechanical'],
        properties: {
          index: { type: 'integer' },
          title: { type: 'string' },
          fullText: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          symbols: { type: 'array', items: { type: 'string' } },
          mechanical: { type: 'boolean' },
        },
      },
    },
  },
}

const TASK_IMPACT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overallRisk', 'note'],
  properties: {
    overallRisk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN'] },
    note: { type: 'string' },
  },
}

const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'commitSha', 'summary', 'concerns', 'detectVerdict'],
  properties: {
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    commitSha: { type: ['string', 'null'] },
    summary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
    detectVerdict: { type: 'string', enum: ['pass', 'fallback', 'fail', 'skipped'] },
  },
}

const SPEC_REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['specOk', 'gaps'],
  properties: {
    specOk: { type: 'boolean' },
    gaps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['detail'],
        properties: { detail: { type: 'string' } },
      },
    },
  },
}

const QUALITY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['criticalCount', 'importantCount', 'minorNotes', 'detail'],
  properties: {
    criticalCount: { type: 'integer' },
    importantCount: { type: 'integer' },
    minorNotes: { type: 'array', items: { type: 'string' } },
    detail: { type: 'string' },
  },
}

const FIX_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['fixed', 'commitSha', 'summary', 'detectVerdict'],
  properties: {
    fixed: { type: 'boolean' },
    commitSha: { type: ['string', 'null'] },
    summary: { type: 'string' },
    detectVerdict: { type: 'string', enum: ['pass', 'fallback', 'fail', 'skipped'] },
  },
}

// fixer 的 detect 結果也要計數與覆核(fix commit 的 scope 驗證不可成為盲區)
let detectFailCount = 0
const fixDetectVerdicts = []
const trackFixDetect = (label, fixR) => {
  if (!fixR) return
  fixDetectVerdicts.push({ label, verdict: fixR.detectVerdict })
  if (fixR.detectVerdict === 'fail') {
    detectFailCount++
    log(`⚠ ${label} detect_changes=fail(本 run 第 ${detectFailCount} 次)`)
  }
}

const FIX_VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['closed', 'notClosed'],
  properties: {
    closed: { type: 'array', items: { type: 'string' } },
    notClosed: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'why'],
        properties: { id: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
}

const FINAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['ok', 'findings'],
  properties: {
    ok: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'q'],
        properties: { id: { type: 'string' }, q: { type: 'string' } },
      },
    },
  },
}

// implementer / fixer 共用紀律段(誠實鐵律 + repo 已知坑)
const disciplineFor = (commitPrefix) => `紀律(逐條遵守):
- 工作目錄:${ROOT}(branch ${BRANCH} 的 worktree;絕不動 main)。
- TDD:先寫失敗測試→親眼看它以預期原因失敗→最小實作→看它通過→其他測試也綠。禁止無失敗測試先寫 production code。例外:若目標行為前次 run 已實作且測試已綠(resume 情境),先盤點現狀、跑現有測試,只對「新增或缺漏的行為」走 TDD,不要對已通過的行為重寫失敗測試。
- 誠實鐵律:前端要真能操作、不可只接 mock;無 backend 處 UI 明標 DEMO DATA / NOT BUILT / not observed;mock 嚴禁覆蓋真 element_mapping.json。
- 跑測試前讀 docs/agents/sub-repo-verify-commands.md 選對指令;root contracts pytest 必走主工作區 .venv/Scripts/python.exe(worktree 不帶 .venv;主工作區路徑 = git rev-parse --git-common-dir 的上一層)。
- 若需修改 task/finding 清單外的既有 function/class/method:先 ToolSearch 載入 mcp__gitnexus__impact 跑 impact({target, direction:"upstream"});CRITICAL → 不要動,回報 BLOCKED 並在 concerns 說明;HIGH → 記入 concerns(指揮官會轉述+寫 PR 補強)。改名一律 gitnexus_rename,禁 find-and-replace。
- commit 前 scope 驗證(不可省):(1) ToolSearch 載入 mcp__gitnexus__detect_changes 跑 detect_changes({scope:"staged"}),scope 只含預期 symbols → detectVerdict=pass;(2) 工具看不到 staged(linked worktree 已知坑)或回錯 → MUST 改跑 git diff --name-only --cached 自查 scope,乾淨 → detectVerdict=fallback;(3) 連 git diff 自查都做不到才記 fail(此值會被計數,3 次 held)。skipped 僅限本次 commit 純 docs/plan 無 code 改動。(4) git diff --cached --check,trailing whitespace 先修。
- commit message 繁中、第一行前綴「${commitPrefix}」,結尾附「Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>」。
- YAGNI:只做要求的;不順手重構、不動無關檔案。`

// ---------- mode='fix':P5/P6 修復迴圈的真實通道 ----------
if (MODE === 'fix') {
  phase('Fix')
  if (!FIX_FINDINGS.length) return { ok: true, mode: 'fix', closed: [], notClosed: [], note: 'fixFindings 為空,無事可修' }
  log(`fix-cycle:${FIX_FINDINGS.length} 個 findings`)

  const fixList = FIX_FINDINGS.map((f) => `- [${f.id || f.finding_id || '?'}] ${f.q || f.reason || f.detail || JSON.stringify(f)}`).join('\n')
  const fix = await agent(`你是修復者。逐項修掉以下對抗複驗/reviewer 未閉合的 findings,修完 commit。
spec:${SPEC_PATH};plan:${ROOT}/${PLAN_PATH}(理解原意,但以 findings 為準)
## 必修 findings
${fixList}
${disciplineFor('fix:')}
若某項 finding 你判斷是誤報(code 實際正確),不要硬改——在 summary 說明理由,留給 verify reviewer 判。
回傳 StructuredOutput:fixed(至少修了一項或確認全為誤報)、commitSha、summary(逐項:修了什麼/為何誤報)、detectVerdict(依紀律第 6 條;無 commit 時 skipped)。`,
    { label: 'fix:cycle', phase: 'Fix', model: 'opus', schema: FIX_SCHEMA })

  if (!fix) return { ok: false, mode: 'fix', held: 'reviewer_agent_failed', notClosed: FIX_FINDINGS, note: 'fixer 回 null' }
  trackFixDetect('fix:cycle', fix)

  const verify = await agent(`你是 fix 驗證 reviewer。Do Not Trust the Report——親自 Read 真實 code,逐項判斷以下 findings 是否已真正閉合(fixer 自述:${fix.summary})。
工作目錄:${ROOT}
## findings
${fixList}
誤報判定:fixer 主張誤報的項,你要在 code 找到「原 finding 不成立」的確鑿證據才算 closed。
回傳 StructuredOutput:closed[](已閉合的 id)、notClosed[](id + why)。`,
    { label: 'fix:verify', phase: 'Fix', model: 'opus', schema: FIX_VERIFY_SCHEMA })

  if (!verify) return { ok: false, mode: 'fix', held: 'reviewer_agent_failed', notClosed: FIX_FINDINGS, note: 'fix verify reviewer 回 null' }
  log(`fix-cycle:closed=${verify.closed.length} notClosed=${verify.notClosed.length}`)
  return { ok: verify.notClosed.length === 0, mode: 'fix', closed: verify.closed, notClosed: verify.notClosed, fixCommit: fix.commitSha, fixDetectVerdicts }
}

// ---------- mode='tasks':主實作迴圈 ----------
phase('Parse')
log(`std-implement:plan=${PLAN_PATH} from task#${START}(branch=${BRANCH})`)

const parsed = await agent(`你是 plan 解析員。讀 ${ROOT}/${PLAN_PATH} 全文,把每個「### Task N」節抽成獨立 task。
fullText 必須含該 task 的完整原文(含 Files 清單、全部 checkbox 步驟、code block)——之後的 implementer 不會讀 plan 檔,只看你抽的 fullText。
symbols = 該 task 會**修改**的既有 function/class/method 名(新建的不算;沒有就空陣列)。
mechanical = 該 task 只動 1-2 個檔、步驟完整可機械執行、且**不動使用者可見 UI**(動 UI 一律 false)。
回傳 StructuredOutput:tasks[](index 從 0、title、fullText、files、symbols、mechanical)。`,
  { label: 'parse:plan', phase: 'Parse', model: 'fable', schema: TASKS_SCHEMA })

if (!parsed || !parsed.tasks.length) return { ok: false, held: 'plan_parse_failed', resumeHint: { startTaskIndex: START } }
const tasks = parsed.tasks
log(`plan 解析:${tasks.length} tasks,從 #${START} 開始`)

phase('Implement')

const perTask = []
const highRiskNotes = []
const minorNotes = []

// reviewer 呼叫的 infra 重試包裝:第一次回 null 重試一次,仍 null 回 null(由呼叫端 held)
const withRetry = async (fn, label) => {
  let r = await fn()
  if (!r) { log(`${label} 回 null,重試一次`); r = await fn() }
  return r
}

for (const task of tasks) {
  if (task.index < START) continue
  const T = `task#${task.index}`

  // 1) 改前 impact(per-task;index 隨 commit 演進,改前再驗)
  const symbolsToCheck = (task.symbols || []).filter((s) => !ACKED_CRITICAL.includes(s))
  if (symbolsToCheck.length) {
    const imp = await agent(`你是 GitNexus 影響分析員。工作目錄:${ROOT}。
ToolSearch 載入 mcp__gitnexus__impact;對下列 symbols 各跑 impact({target, direction:"upstream"}),回報最大風險:
${symbolsToCheck.map((s) => `- ${s}`).join('\n')}
分級:<5 affected=LOW;5-15=MEDIUM;>15 或多 processes=HIGH;critical path(auth/conversion authority/session 核心)=CRITICAL;圖中找不到=UNKNOWN。
若 tool 報 index stale → bash 跑「npx gitnexus analyze --skip-agents-md」+「npx gitnexus status」確認(banner 不算成功)後重試;工具整體故障(crash/連不上)→ overallRisk=UNKNOWN 並在 note 寫明故障。
回傳 StructuredOutput:overallRisk、note(直接 callers / 關鍵 processes / 故障說明)。`,
      { label: `impact:${T}`, phase: 'Implement', model: 'fable', schema: TASK_IMPACT_SCHEMA })
    if (imp && imp.overallRisk === 'CRITICAL') {
      return {
        ok: false, held: 'critical_impact', taskIndex: task.index, impactNote: imp.note,
        criticalSymbols: symbolsToCheck, perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index },
      }
    }
    if (imp && imp.overallRisk === 'UNKNOWN') {
      return {
        ok: false, held: 'impact_unavailable', taskIndex: task.index, impactNote: imp.note,
        perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index },
      }
    }
    if (imp && imp.overallRisk === 'HIGH') {
      log(`⚠ ${T} impact=HIGH:${imp.note.slice(0, 160)}(續做;PR body 須寫補強)`)
      highRiskNotes.push(`${T} ${task.title}:${imp.note}`)
    }
  }

  // 2) implementer(NEEDS_CONTEXT → 補脈絡一次;BLOCKED → 升 opus 一次)
  const implPrompt = (extra) => `你是 implementer subagent(superpowers subagent-driven-development 模式)。實作以下 task,完成後 commit。

## Task ${task.index}:${task.title}
${task.fullText}

## 場景脈絡
spec:${SPEC_PATH};plan:${ROOT}/${PLAN_PATH}(僅供溯源,task 全文已在上方);user-facing spec:${USER_FACING}
${extra || ''}
${disciplineFor(`task#${task.index}: `)}

回傳 StructuredOutput:status(DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED)、commitSha(本 task 最後一個 commit 的 sha;**沒有任何 commit 不得回 DONE**)、summary、concerns[]、detectVerdict(pass/fallback/fail/skipped,依紀律第 6 條)。
NEEDS_CONTEXT:說清楚缺什麼脈絡。BLOCKED:說清楚卡在哪(含 plan 本身錯誤的證據)。不確定就誠實回報,不要硬做。`

  const implModel = task.mechanical ? 'fable' : 'opus'
  let impl = await agent(implPrompt(''), { label: `impl:${T}`, phase: 'Implement', model: implModel, schema: IMPL_SCHEMA })

  if (impl && impl.status === 'NEEDS_CONTEXT') {
    log(`${T} NEEDS_CONTEXT:${impl.summary} → 補脈絡重派`)
    const neighbor = tasks.filter((t) => Math.abs(t.index - task.index) === 1).map((t) => `### 鄰近 Task ${t.index}:${t.title}\n${t.fullText}`).join('\n\n')
    impl = await agent(implPrompt(`\n## 補充脈絡(前次回報缺:${impl.summary})\n請先 Read spec 全文 ${SPEC_PATH} 取得需求脈絡。\n${neighbor}`),
      { label: `impl:${T}:retry`, phase: 'Implement', model: 'opus', schema: IMPL_SCHEMA })
  }
  if (impl && impl.status === 'BLOCKED' && implModel === 'fable') {
    log(`${T} BLOCKED(fable)→ 換 opus 重派`)
    impl = await agent(implPrompt(`\n## 前次嘗試 BLOCKED:${impl.summary}(concerns:${(impl.concerns || []).join(';')})`),
      { label: `impl:${T}:opus`, phase: 'Implement', model: 'opus', schema: IMPL_SCHEMA })
  }
  if (!impl) {
    // infra null ≠ plan 錯;held 值決定指揮官處置通道(reviewer_agent_failed=重呼一次,plan_error_at_task=要使用者修 plan)
    return {
      ok: false, held: 'reviewer_agent_failed', taskIndex: task.index,
      note: 'implementer agent 失敗(回 null)', perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index },
    }
  }
  if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
    return {
      ok: false, held: 'plan_error_at_task', taskIndex: task.index,
      blockedDetail: `${impl.summary};concerns:${(impl.concerns || []).join(';')}`,
      perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index },
    }
  }
  if ((impl.status === 'DONE' || impl.status === 'DONE_WITH_CONCERNS') && !impl.commitSha) {
    return {
      ok: false, held: 'plan_error_at_task', taskIndex: task.index,
      blockedDetail: `implementer 回 ${impl.status} 但 commitSha=null(per-task commit 錨點不變量被破壞):${impl.summary}`,
      perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index },
    }
  }

  // detect_changes 失敗計數(blocker 修復:fail 不可靜默通過;3 次門檻在 task 尾端統一檢查,涵蓋 fix commits)
  if (impl.detectVerdict === 'fail') {
    detectFailCount++
    log(`⚠ ${T} detect_changes=fail(本 run 第 ${detectFailCount} 次)`)
  }

  // 3) spec-compliance review(先)→ 4) quality review(後);各自動修 ≤ MAX_FIX 輪
  const reviewSpec = () => agent(`你是 spec-compliance reviewer。Do Not Trust the Report——不要相信 implementer 的自述,親自 Read 真實 code 逐行比對 task 需求。
工作目錄:${ROOT};本 task 的 commits:git log --oneline -30 中第一行以「task#${task.index}:」開頭的那些(含「task#${task.index}: fix」;最早一個的 ^ 到 HEAD 即本 task diff 範圍;不要抓「fix:」開頭的 P5 修復 commits)。
## Task ${task.index}:${task.title}(需求原文)
${task.fullText}
檢查:漏做(需求沒實作)、多做(超出 task 的 scope creep)、做錯方向(實作偏離需求意圖)、測試是否真驗行為(非空測試)、誠實標註(無 backend 的 UI 是否標 DEMO DATA / NOT BUILT)。
回傳 StructuredOutput:specOk、gaps[](每項 detail 引用具體檔案+行號)。`,
    { label: `spec-review:${T}`, phase: 'Implement', model: 'opus', schema: SPEC_REVIEW_SCHEMA })

  let sr = await withRetry(reviewSpec, `${T} spec-review`)
  if (!sr) {
    return { ok: false, held: 'reviewer_agent_failed', taskIndex: task.index, perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index }, note: 'spec reviewer 連兩次回 null' }
  }
  for (let round = 1; !sr.specOk && round <= MAX_FIX; round++) {
    log(`${T} spec review 未過(第 ${round} 輪):${sr.gaps.length} gaps → 修復`)
    const fixR = await agent(`你是修復者,修掉本 task 的 spec-compliance gaps 後 commit。
## Task ${task.index}:${task.title}
${task.fullText}
## 必修 gaps
${sr.gaps.map((g, i) => `${i + 1}. ${g.detail}`).join('\n')}
${disciplineFor(`task#${task.index}: fix `)}
回傳 StructuredOutput:fixed、commitSha、summary(若 gap 源自 plan/spec 本身矛盾,fixed=false 並在 summary 說明)、detectVerdict(依紀律第 6 條;無 commit 時 skipped)。`,
      { label: `spec-fix:${T}:r${round}`, phase: 'Implement', model: 'opus', schema: FIX_SCHEMA })
    if (!fixR) {
      // fixer infra null 不可靜默吞掉續輪(會被誤分類成 not_closing 硬停;同構於 std-plan plan-fixer 守門)
      return { ok: false, held: 'reviewer_agent_failed', taskIndex: task.index, note: `spec-fix r${round} 回 null`, perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index } }
    }
    if (fixR.fixed === false) {
      return { ok: false, held: 'plan_error_at_task', taskIndex: task.index, blockedDetail: `spec-fix 判定問題源自 plan/spec:${fixR.summary}`, perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index } }
    }
    trackFixDetect(`spec-fix:${T}:r${round}`, fixR)
    sr = await withRetry(reviewSpec, `${T} spec-review`)
    if (!sr) return { ok: false, held: 'reviewer_agent_failed', taskIndex: task.index, perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index }, note: 'spec reviewer 連兩次回 null' }
  }
  if (!sr.specOk) {
    return {
      ok: false, held: 'spec_review_not_closing', taskIndex: task.index,
      gaps: sr.gaps, perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index },
    }
  }

  const reviewQuality = () => agent(`你是 code quality reviewer(superpowers requesting-code-review 模板精神)。
工作目錄:${ROOT};review 範圍:git log --oneline -15 中第一行前綴「task#${task.index}:」「task#${task.index}: fix」的全部 commits(最早一個的 ^ 到 HEAD)。
## Task 脈絡
${task.title}(spec:${SPEC_PATH})
評估:正確性 bug、錯誤處理、安全(secrets/injection)、測試品質(是否真驗行為)、可讀性。分級:critical(會壞/安全)、important(該修才能 merge)、minor(nit)。
回傳 StructuredOutput:criticalCount、importantCount、minorNotes[]、detail(每個 critical/important 的檔案+行號+理由)。`,
    { label: `quality-review:${T}`, phase: 'Implement', model: 'opus', schema: QUALITY_SCHEMA })

  let qr = await withRetry(reviewQuality, `${T} quality-review`)
  if (!qr) return { ok: false, held: 'reviewer_agent_failed', taskIndex: task.index, perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index }, note: 'quality reviewer 連兩次回 null' }
  for (let round = 1; (qr.criticalCount > 0 || qr.importantCount > 0) && round <= MAX_FIX; round++) {
    log(`${T} quality review:critical=${qr.criticalCount} important=${qr.importantCount}(第 ${round} 輪)→ 修復`)
    const qFix = await agent(`你是修復者,修掉本 task 的 quality 發現後 commit。
## 發現(critical/important 必修;minor 不動)
${qr.detail}
## Task 脈絡
Task ${task.index}:${task.title}
${disciplineFor(`task#${task.index}: fix `)}
回傳 StructuredOutput:fixed、commitSha、summary、detectVerdict。`,
      { label: `quality-fix:${T}:r${round}`, phase: 'Implement', model: 'opus', schema: FIX_SCHEMA })
    if (!qFix) {
      return { ok: false, held: 'reviewer_agent_failed', taskIndex: task.index, note: `quality-fix r${round} 回 null`, perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index } }
    }
    trackFixDetect(`quality-fix:${T}:r${round}`, qFix)
    qr = await withRetry(reviewQuality, `${T} quality-review`)
    if (!qr) return { ok: false, held: 'reviewer_agent_failed', taskIndex: task.index, perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index }, note: 'quality reviewer 連兩次回 null' }
  }
  if (qr.criticalCount > 0 || qr.importantCount > 0) {
    return {
      ok: false, held: 'quality_review_not_closing', taskIndex: task.index,
      qualityDetail: qr.detail, perTask, highRiskNotes, resumeHint: { startTaskIndex: task.index },
    }
  }
  minorNotes.push(...(qr.minorNotes || []).map((n) => `${T}:${n}`))

  perTask.push({
    index: task.index, title: task.title, commitSha: impl.commitSha,
    implStatus: impl.status, detectVerdict: impl.detectVerdict, concerns: impl.concerns,
  })
  log(`✓ ${T}「${task.title}」完成 @ ${impl.commitSha}`)

  // 3 次門檻統一檢查(涵蓋 implementer + 本 task 全部 fix commits 的累積)
  if (detectFailCount >= 3) {
    return {
      ok: false, held: 'detect_changes_repeatedly_failing', taskIndex: task.index,
      perTask, highRiskNotes, fixDetectVerdicts, resumeHint: { startTaskIndex: task.index + 1 },
      note: '同 run 第 3 次 detect_changes 完全失敗;指揮官依 SKILL.md 開 gh issue,等修復或 reviewer sign-off',
    }
  }
}

phase('FinalReview')

const scopeRecheckTasks = perTask.filter((t) => t.detectVerdict === 'fallback' || t.detectVerdict === 'fail' || t.detectVerdict === 'skipped')
const scopeRecheckFixes = fixDetectVerdicts.filter((f) => f.verdict !== 'pass')
const final = await agent(`你是最終總 reviewer。整體檢視本 feature branch 全部改動是否精準完成 spec。
工作目錄:${ROOT};diff 範圍:git diff origin/main...HEAD(加 git log origin/main..HEAD --oneline)。
spec:${SPEC_PATH};plan:${ROOT}/${PLAN_PATH}
檢查:(1) spec 每條需求都有對應實作與測試;(2) 無 plan 外的意外改動;(3) 跨 task 整合點(task 各自綠但合起來壞);(4) 誠實標註完整(DEMO DATA / NOT BUILT / not observed);(5) **scope 覆核**:detect_changes 非 pass 的 commits(tasks:${scopeRecheckTasks.map((t) => `task#${t.index}=${t.detectVerdict}`).join(', ') || '無'};fix commits:${scopeRecheckFixes.map((f) => `${f.label}=${f.verdict}`).join(', ') || '無'})逐一用 git show 驗 commit 只含預期檔案。
回傳 StructuredOutput:ok(無重大疑慮)、findings[](每項 id 用 f1/f2/...,q = 待對抗驗證的具體疑慮:檔案+行號+宣稱的失效模式;沒有就空陣列)。ok=true 仍可帶低信心 findings 供後續對抗複驗;ok=false 時 findings 必須涵蓋你的全部疑慮(這是它們進入修復迴圈的唯一通道)。`,
  { label: 'final-review', phase: 'FinalReview', model: 'opus', schema: FINAL_SCHEMA })

const completedThrough = perTask.length ? perTask[perTask.length - 1].index : (START - 1)
log(`std-implement 完成:${perTask.length} tasks,finalReviewOk=${final ? final.ok : 'null'}`)

return {
  ok: true, // 全部 task 完成即 ok;finalReview 的 verdict 獨立回報,findings 一律進 P5 對抗複驗
  finalReviewOk: !!(final && final.ok),
  completedThrough, perTask, highRiskNotes, minorNotes,
  finalReview: final || { ok: false, findings: [{ id: 'f-final-null', q: 'final reviewer 回 null,整體 diff 未經總審——P5 critic 須以全 diff 通讀替代' }] },
  detectFallbackTasks: perTask.filter((t) => t.detectVerdict === 'fallback').map((t) => t.index),
  detectFailTasks: perTask.filter((t) => t.detectVerdict === 'fail').map((t) => t.index),
  fixDetectVerdicts,
  resumeHint: { startTaskIndex: completedThrough + 1 },
}
