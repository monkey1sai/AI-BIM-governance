export const meta = {
  name: 'fu34-adversarial-verify',
  description: 'FU-3 + FU-4 自包含對抗複驗：per-finding 懷疑者(refute-by-default)+ 每 FU 一 critic',
  phases: [{ title: 'Verify', detail: 'FU-3 diff Tag + FU-4 federation TRS，refute-by-default' }],
}

const FU3 = 'C:/Repos/active/iot/AI-BIM-governance/.worktrees/a2-diff-tag-typeguard'
const FU4 = 'C:/Repos/active/iot/AI-BIM-governance/.worktrees/a3-federation-trs-coords'

const VS = {
  type: 'object', additionalProperties: false,
  required: ['finding_id', 'truly_closed', 'introduced_new_issue', 'reason'],
  properties: { finding_id: { type: 'string' }, truly_closed: { type: 'boolean' }, introduced_new_issue: { type: 'boolean' }, reason: { type: 'string' } },
}
const CS = {
  type: 'object', additionalProperties: false,
  required: ['overall_safe', 'issues'],
  properties: { overall_safe: { type: 'boolean' }, issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'file', 'detail'], properties: { kind: { type: 'string' }, file: { type: 'string' }, detail: { type: 'string' } } } } },
}

function pre(root) {
  return `你是 AI-BIM-governance governance-service 的對抗式驗證者。worktree(已套用修復、未 commit)：${root}。
誠實鐵律：無假數字、未取得不得偽裝成 pass。USD 相關以 pxr 26.5 本體為 ground truth（可用 host py312 「/c/Program Files/Python312/python.exe」跑真 pxr probe）。
**務必只讀 ${root} 內的檔案**（這是已修復的 worktree，不要去看 main 或別的 worktree）。用 Read/Grep 開真實 code 驗。預設立場：未真閉合，除非親見確鑿證據。對著 finding 宣稱的失效模式驗，「測試綠」不等於閉合。`
}

const FINDINGS = [
  { root: FU3, fu: 'FU3', id: 'A2-001', q: `diff_engine/engine.py 第二級 Tag 對齊。驗：Tag map 是否以複合鍵 (e.is_a(), tag) 帶型別護欄（讀 _tagmap）；用真 ifcopenshell probe：base IfcWall(Tag=999) + target IfcSlab(Tag=999, 不同 GlobalId) 是否正確得 removed+added（非 matched=1 吞變更）。` },
  { root: FU3, fu: 'FU3', id: 'A2-003', q: `diff_engine/engine.py 第三級同鍵簇 zip 配對。驗：配對前是否以穩定次鍵排序兩側；同鍵多構件 pset 不同時 property_changed 歸屬穩定可重現。` },
  { root: FU3, fu: 'FU3', id: 'A2-002', q: `tests/test_diff_engine.py 退階對齊測試。驗：是否真覆蓋 (a) 同型別同 Tag→tag 對齊 (b) type+name+loc 對齊 (c) 跨型別同 Tag→removed+added，非空實質斷言。` },
  { root: FU3, fu: 'FU3', id: 'A2-honesty', q: `grep diff_engine/ 是否仍殘留與已落地 geometry_changed（opt-in #162）矛盾的「p1 / MVP 不計算 / 未實作」過時敘述；仍正確的標示（issue-impact / 3D overlay p15）未被誤改。` },
  { root: FU4, fu: 'FU4', id: 'A3-1', q: `federation/builder.py per-member transform xformOp 順序。驗：是否 AddTranslateOp→AddRotateXYZOp→AddScaleOp（xformOpOrder=[translate,rotateXYZ,scale]）。**用真實 pxr 開合成 stage 算世界座標**：scale=2+translate=(100,0,0) 下 local 原點↦世界(100,0,0)、(1,0,0)↦(102,0,0)。註解是否同步改正。` },
  { root: FU4, fu: 'FU4', id: 'A3-2', q: `tests/test_federation_builder.py 是否改用真實 pxr GetLocalTransformation().Transform() 數值世界座標斷言（非順序字面），且舊錯誤碼下會變紅。` },
  { root: FU4, fu: 'FU4', id: 'A3-3', q: `federation/builder.py build 是否依 member metersPerUnit 呼叫 UsdGeom.SetStageMetersPerUnit、回傳 dict 含 meters_per_unit；pxr probe：傳 0.001→stage 0.001、不傳→0.01。` },
  { root: FU4, fu: 'FU4', id: 'A3-4', q: `federation/api.py build 是否先跑 validate_coords、upAxis/mpu 不一致回 409+issues、一致時傳真實 upAxis（非硬編 Z）、不誤拒一致 member。` },
]

phase('Verify')
log('FU-3 + FU-4 自包含對抗複驗：8 per-finding + 2 critic')

const all = await parallel([
  ...FINDINGS.map((f) => () =>
    agent(`${pre(f.root)}

待驗 ${f.fu} finding ${f.id}：
${f.q}

回傳 StructuredOutput：finding_id=${f.id}、truly_closed、introduced_new_issue、reason（引用 ${f.root} 內真實 code 行號 + probe 結果）。`,
      { label: `v:${f.id}`, phase: 'Verify', schema: VS })),
  () => agent(`${pre(FU3)}

critic（FU-3 diff）：通讀 ${FU3}/governance-service/diff_engine/{engine,keys,models}.py 與 tests/test_diff_engine.py。檢 Tag 複合鍵是否破壞第一級 GlobalId 或既有 matched 計數、同鍵排序是否改既有 property_changed 歸屬、誠實註解清理是否過頭、新測試是否空。回傳 overall_safe + issues[]。`,
    { label: 'critic:FU3', phase: 'Verify', schema: CS }),
  () => agent(`${pre(FU4)}

critic（FU-4 federation）：通讀 ${FU4}/governance-service/federation/{builder,api}.py 與 tests/test_federation_*.py。用真實 pxr 26.5 確認 per-member transform 世界座標正確、member usdc immutable、build 回傳向後相容、validate_coords 接線正確不誤拒。回傳 overall_safe + issues[]。`,
    { label: 'critic:FU4', phase: 'Verify', schema: CS }),
])

const fv = all.slice(0, FINDINGS.length).filter(Boolean)
const critics = all.slice(FINDINGS.length).filter(Boolean)
const notClosed = fv.filter((v) => !v.truly_closed)
const newIssues = fv.filter((v) => v.introduced_new_issue)
log(`閉合 ${fv.filter((v) => v.truly_closed).length}/${fv.length}；未閉合 ${notClosed.length}；新問題 ${newIssues.length}；critics safe=${critics.map((c) => c.overall_safe).join(',')}`)
return { verdicts: fv, not_closed: notClosed, new_issues: newIssues, critics }
