export const meta = {
  name: 'fu-adversarial-verify-generic',
  description: '參數化修復對抗複驗：per-finding 懷疑者(refute-by-default)+ holistic critic；worktree/findings/critic 由 args 帶入',
  phases: [{ title: 'Verify', detail: 'refute-by-default 讀真 code 驗閉合 + critic' }],
}

// args 防護:harness 可能把 args 序列化成 JSON 字串(2026-06-10 wf_26373b35 實證:字串上取 .root 全 undefined → 0 個懷疑者被生成),字串就 parse;root 缺直接 fail-fast。
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const ROOT = A.root
const LABEL = A.label || 'fu'
const FINDINGS = A.findings || []
const CRITIC_FOCUS = A.criticFocus || '通讀全 diff 找新誠實違規 / 行為 regression / spec-drift / 空測試。'
if (!ROOT) return { label: LABEL, held: 'bad_args', missing: ['root'], verdicts: [], not_closed: [], new_issues: [], critic: null }

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['finding_id', 'truly_closed', 'introduced_new_issue', 'reason'],
  properties: {
    finding_id: { type: 'string' }, truly_closed: { type: 'boolean' },
    introduced_new_issue: { type: 'boolean' }, reason: { type: 'string' },
  },
}
const CRITIC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overall_safe', 'issues'],
  properties: {
    overall_safe: { type: 'boolean' },
    issues: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['kind', 'file', 'detail'],
      properties: { kind: { type: 'string' }, file: { type: 'string' }, detail: { type: 'string' } },
    } },
  },
}

const PRE = `你是 AI-BIM-governance governance-service 的對抗式驗證者。worktree(已套用修復)：${ROOT}。
誠實鐵律：無假數字、未取得不得偽裝成 pass、輸出標真實 provenance。USD 相關以 pxr 26.5 本體為 ground truth（可用 host py312 「/c/Program Files/Python312/python.exe」跑真 pxr probe 算世界座標）。
用 Read/Grep 打開真實 code 驗。預設立場：修復未真正閉合，除非在 code 找到確鑿證據。「測試綠」不代表閉合——對著 finding 宣稱的失效模式驗。`

phase('Verify')
log(`${LABEL}：${FINDINGS.length} per-finding 懷疑者 + 1 critic`)

const verdicts = await parallel([
  ...FINDINGS.map((f) => () =>
    agent(`${PRE}

待驗 finding ${f.id}：
${f.q}

回傳 StructuredOutput：finding_id=${f.id}、truly_closed（僅當 code 親見真閉合）、introduced_new_issue、reason（引用真實 code 片段+行號，可附 probe 結果）。`,
      { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA })
  ),
  () => agent(`${PRE}

任務（holistic critic）：${CRITIC_FOCUS}
回傳 StructuredOutput：overall_safe、issues[]（kind/file/detail）。寧可多報疑慮。`,
    { label: `critic:${LABEL}`, phase: 'Verify', schema: CRITIC_SCHEMA }),
])

const fv = verdicts.slice(0, FINDINGS.length).filter(Boolean)
const critic = verdicts[FINDINGS.length]
const notClosed = fv.filter((v) => !v.truly_closed)
const newIssues = fv.filter((v) => v.introduced_new_issue)
log(`${LABEL} 閉合 ${fv.filter((v) => v.truly_closed).length}/${fv.length}；未閉合 ${notClosed.length}；新問題 ${newIssues.length}；critic safe=${critic ? critic.overall_safe : 'null'}`)
return { label: LABEL, verdicts: fv, not_closed: notClosed, new_issues: newIssues, critic: critic || null }
