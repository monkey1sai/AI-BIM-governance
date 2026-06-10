export const meta = {
  name: 'fu1-adversarial-verify',
  description: 'FU-1 修復對抗複驗：7 個 per-finding 懷疑者(refute-by-default)+ 1 整體誠實/regression critic',
  phases: [{ title: 'Verify', detail: '每 finding 一懷疑者讀真 code 驗閉合 + 1 holistic critic' }],
}

const ROOT = 'C:/Repos/active/iot/AI-BIM-governance/.worktrees/a1-rule-engine-honesty'

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['finding_id', 'truly_closed', 'introduced_new_issue', 'reason'],
  properties: {
    finding_id: { type: 'string' },
    truly_closed: { type: 'boolean' },
    introduced_new_issue: { type: 'boolean' },
    reason: { type: 'string' },
  },
}

const CRITIC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overall_safe', 'issues'],
  properties: {
    overall_safe: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['kind', 'file', 'detail'],
        properties: {
          kind: { type: 'string', enum: ['new-honesty', 'regression', 'spec-drift', 'other'] },
          file: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
}

const PRE = `你是 AI-BIM-governance A1 governance-service 的對抗式驗證者。worktree(已套用修復)：${ROOT}。
這是 BIM 治理平台 A1 rule-run（host py312、純 CPU ifcopenshell；誠實鐵律：無假數字、error/未取得不得偽裝成 pass）。
用 Read/Grep 打開 ${ROOT}/governance-service/rule_engine/ 與 tests/ 的真實程式碼驗證。預設立場：修復「未真正閉合」，除非你在 code 找到確鑿證據證明已閉合。
教訓：「測試綠」不代表問題消失——對著該 finding 宣稱的失效模式驗 fix 是否真閉合，並檢查是否引入新的誠實/正確性問題。`

const FINDINGS = [
  { id: 'A1-RE-01', q: `engine.py run_rules 計分：分母原為 passed+failed（排除 errored），全 error 時 denom=0 → score=100 假滿分。驗：(a) 現在分母是否含 errored（全 error → score 0.0）；(b) errored==0 時是否與舊式等價（真實模型 99.0 不變）；(c) denom==0 僅在「無任何適用構件」時 → 100.0 是否合理。讀 engine.py 第 99-110 行附近。` },
  { id: 'A1-RE-04', q: `predicates.py eval_property_required：get_psets 注入合成 'id' key，property:id 規則會假性通過。驗：any-pset 與指定-pset 兩分支是否都排除合成 key（_SYNTHETIC_PSET_KEYS）；指定-pset 時 pset_found 行為是否仍誠實。確認 property:id 不再假性 pass。` },
  { id: 'ids-001', q: `ids_runner.py run_ids：原以 spec.name 為 target_summary key，同名/未命名 spec 互相覆寫低報。驗：_spec_code 是否產生唯一 key（identifier 否則 name+index）；同名兩 spec 是否得到兩個不同 key、計數不被覆寫。` },
  { id: 'ids-002', q: `ids_runner.py：prohibited applicability（spec.status False、零 requirement）原靜默丟棄 → 違規模型假 pass。驗：guard 是否在「無 result 產生 + spec.status is False + applicable 非空」時補逐構件 fail；guard 是否過度觸發（誤傷正常 spec）。誠實評估可達性。` },
  { id: 'ids-003', q: `ids_runner.py：errored 原硬寫 0。驗：errored 是否改為由結果推導 sum(status=='error')，且 IDS 計分分母與 YAML 一致。` },
  { id: 'A1-RE-03', q: `誠實文件：excel_export.py / engine.py docstring 與 default-governance.yaml description 原宣稱「BCF 未實作 / ifctester 未安裝 / IDS 為 p1」。驗：grep rule_engine/ 與 rules/ 是否仍殘留任何「未實作 / 未安裝 / p1 / p15 / 標後續」這類與已落地 bcf/、ids_runner、governance-service/CLAUDE.md 矛盾的過時敘述。` },
  { id: 'A1-RE-02', q: `test_rule_engine.py test_ifc4x3_type_alias_resolves_and_warns：驗測試是否真的建 IFC4X3 model + target IfcBuildingElement、真的走別名萃取到 IfcWall、斷言 warning 含「別名」「IfcBuiltElement」。確認是真迴歸守門而非空測試。` },
]

phase('Verify')
log(`FU-1：${FINDINGS.length} 個 per-finding 懷疑者 + 1 holistic critic`)

const verdicts = await parallel([
  ...FINDINGS.map((f) => () =>
    agent(`${PRE}

待驗 finding ${f.id}：
${f.q}

回傳 StructuredOutput：finding_id=${f.id}、truly_closed（僅當你在 code 親見已真正閉合才 true）、introduced_new_issue（修復是否引入新誠實/正確性問題）、reason（引用你讀到的真實 code 片段與行號）。`,
      { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA })
  ),
  () => agent(`${PRE}

任務（holistic critic）：通讀本次 FU-1 全部 diff（${ROOT}/governance-service/rule_engine/{engine,predicates,ids_runner,excel_export}.py、rules/default-governance.yaml、tests/{test_rule_engine,test_ids}.py）。
跑 \`git -C ${ROOT} diff HEAD\` 或直接讀檔。找：本次修改是否引入(a)新的誠實違規(假數字/把未取得當 pass)、(b)行為 regression(改壞既有 YAML/IDS 正常路徑)、(c)spec-drift(spec delta 與實作不符)。
特別檢查：score 公式改動是否意外改變真實模型既有 99.0；prohibited guard 是否誤傷正常 IDS；_spec_code 索引後綴是否破壞既有 IDS 分類。
回傳 StructuredOutput：overall_safe、issues[]（每筆 kind/file/detail）。寧可多報疑慮。`,
    { label: 'critic:holistic', phase: 'Verify', schema: CRITIC_SCHEMA }),
])

const fv = verdicts.slice(0, FINDINGS.length).filter(Boolean)
const critic = verdicts[FINDINGS.length]
const notClosed = fv.filter((v) => !v.truly_closed)
const newIssues = fv.filter((v) => v.introduced_new_issue)

log(`閉合 ${fv.filter((v) => v.truly_closed).length}/${fv.length}；未閉合 ${notClosed.length}；報新問題 ${newIssues.length}；critic overall_safe=${critic ? critic.overall_safe : 'null'}`)

return {
  verdicts: fv,
  not_closed: notClosed,
  new_issues: newIssues,
  critic: critic || null,
}
