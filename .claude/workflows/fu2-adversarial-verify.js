export const meta = {
  name: 'fu2-adversarial-verify',
  description: 'FU-2(Issues-DB + BCF)修復對抗複驗：7 per-finding 懷疑者(refute-by-default)+ 1 交易/誠實 critic',
  phases: [{ title: 'Verify', detail: 'refute-by-default 讀真 code 驗閉合 + 交易正確性 critic' }],
}

const ROOT = 'C:/Repos/active/iot/AI-BIM-governance/.worktrees/issue-bcf-integrity'

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
    issues: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['kind', 'file', 'detail'],
      properties: { kind: { type: 'string' }, file: { type: 'string' }, detail: { type: 'string' } },
    } },
  },
}

const PRE = `你是 AI-BIM-governance governance-service 的對抗式驗證者。worktree(已套用 FU-2 修復)：${ROOT}。
範圍：Issues-DB（issues/store.py, issues/api.py）+ BCF 匯出（bcf/bcf_writer.py）。誠實鐵律：model_version_id 綁定所有 issue；缺值不得以 Python None 字面外洩；BCF 2.1 schema 合規。
用 Read/Grep 打開真實程式碼驗證；可用 host py312 跑 probe：「/c/Program Files/Python312/python.exe」。預設立場：修復未真正閉合，除非你在 code 找到確鑿證據。「測試綠」不代表閉合——對著 finding 宣稱的失效模式驗。`

const FINDINGS = [
  { id: 'ISS-001', q: `issues/api.py issues_from_diff 原未傳 model_version_id（diff issue mv=NULL，違反「所有 issue 綁 model_version」鐵律，且斷裂 BCF 匯出過濾與 diff-impact）。驗：現在是否讀 diff_row 的 target_model_version_id 並傳入；DiffStore.get_diff 是否真有該欄位（讀 diff_engine/store.py schema）。` },
  { id: 'ISS-002', q: `issues/api.py from-rule-run / from-diff 原無冪等，重複呼叫產生重複 issue。驗：是否改用 create_issues_batch 且該方法對同 (source_type, source_ref) 跳過（讀 store.py）；重複呼叫第二次 created==0/skipped>0。` },
  { id: 'ISS-003', q: `issues/store.py transition 原讀-改-寫跨兩連線（TOCTOU race / lost update）。驗：是否改為單一連線 BEGIN IMMEDIATE + 條件式 UPDATE WHERE id=? AND status=? + rowcount==0 偵測並發落空 raise。檢查 isolation_level/busy_timeout 設定是否正確、ROLLBACK 路徑是否完整、有無連線洩漏（finally close）。` },
  { id: 'ISS-004', q: `issues/api.py 批次建立原每筆獨立交易、中途失敗留部分寫入。驗：create_issues_batch 是否單一連線 BEGIN IMMEDIATE...COMMIT、except ROLLBACK 整批回滾；endpoint 是否改用它。` },
  { id: 'bcf-002', q: `bcf/bcf_writer.py build_bcfzip 原未驗 IfcGuid 22 字元，可產出違反 BCF 2.1 XSD 的 .bcfzip。驗：是否以 ^[0-9A-Za-z_$]{22}$ 過濾非法 guid（跳過不匯出）；既有 22 字元測試 fixtures 是否仍通過。` },
  { id: 'bcf-003', q: `bcf/bcf_writer.py _iso 對 naive 時間戳用 astimezone 會吃系統本地偏移。驗：是否改為 tzinfo is None 時 replace(tzinfo=utc)；用 probe 驗 _iso("2026-06-01T10:00:00") == "2026-06-01T10:00:00Z"。` },
  { id: 'bcf-005', q: `bcf/bcf_writer.py 原把 Python None 以字面 'None' 寫進 BCF comment。驗：缺值是否改輸出 'unbound'（或省略），不得出現字面 model_version=None；值有設時是否仍原樣（既有 model_version=mvB 測試相容）。` },
]

phase('Verify')
log(`FU-2：${FINDINGS.length} per-finding 懷疑者 + 1 critic`)

const verdicts = await parallel([
  ...FINDINGS.map((f) => () =>
    agent(`${PRE}

待驗 finding ${f.id}：
${f.q}

回傳 StructuredOutput：finding_id=${f.id}、truly_closed（僅當 code 親見真閉合）、introduced_new_issue、reason（引用真實 code 片段 + 行號；可附 probe 結果）。`,
      { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA })
  ),
  () => agent(`${PRE}

任務（critic）：通讀 FU-2 全 diff（issues/store.py, issues/api.py, bcf/bcf_writer.py, tests/test_issues.py, tests/test_bcf.py）。重點：
1. 交易正確性：transition 與 create_issues_batch 的 BEGIN IMMEDIATE / isolation_level=None / busy_timeout / COMMIT / ROLLBACK / conn.close 是否正確，有無在例外路徑漏 close 或留未結束交易；get_issue（另開連線）在 COMMIT 後呼叫是否安全。
2. 既有行為相容：model_version 綁定是否破壞既有 test_issues_from_diff（mv 應為 'b'/'t'？讀 _seed_diff）；create_issues_batch 是否正確處理 annotation（無 ifc_guid → kind=annotation）；既有 transition 生命週期測試（created+3 transition=4 events）是否仍成立。
3. 誠實：BCF 缺值是否真不洩漏 None；IfcGuid 過濾是否誠實（跳過而非捏造）。
4. 新測試是否真守門（非空斷言）。
回傳 StructuredOutput：overall_safe、issues[]（kind/file/detail）。寧可多報疑慮。`,
    { label: 'critic:fu2', phase: 'Verify', schema: CRITIC_SCHEMA }),
])

const fv = verdicts.slice(0, FINDINGS.length).filter(Boolean)
const critic = verdicts[FINDINGS.length]
const notClosed = fv.filter((v) => !v.truly_closed)
const newIssues = fv.filter((v) => v.introduced_new_issue)
log(`閉合 ${fv.filter((v) => v.truly_closed).length}/${fv.length}；未閉合 ${notClosed.length}；新問題 ${newIssues.length}；critic safe=${critic ? critic.overall_safe : 'null'}`)
return { verdicts: fv, not_closed: notClosed, new_issues: newIssues, critic: critic || null }
