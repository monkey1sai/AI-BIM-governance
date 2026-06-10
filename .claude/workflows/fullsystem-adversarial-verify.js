export const meta = {
  name: 'fullsystem-adversarial-verify',
  description: '全系統多 agent 交叉對抗驗證:A1/A2/A3 + coordinator + streaming + scripts + 安全 + 誠實鐵律;每個 finding 雙懷疑者 refute-by-default 驗證',
  phases: [
    { title: 'Review', detail: '14 子系統 × lens 平行對抗審查' },
    { title: 'Verify', detail: '每 finding correctness+reachability 雙懷疑者對抗驗證' },
  ],
}

const ROOT = 'C:/Repos/active/iot/AI-BIM-governance'

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['subsystem', 'findings'],
  properties: {
    subsystem: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'severity', 'kind', 'file', 'evidence', 'why'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          kind: { type: 'string', enum: ['bug', 'security', 'honesty', 'spec-mismatch', 'regression', 'hygiene', 'test-gap'] },
          file: { type: 'string' },
          line: { type: 'string' },
          evidence: { type: 'string' },
          why: { type: 'string' },
          proposed_fix: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['finding_id', 'real', 'reason'],
  properties: {
    finding_id: { type: 'string' },
    real: { type: 'boolean' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'not-a-bug'] },
    reason: { type: 'string' },
    fix_sound: { type: 'boolean' },
  },
}

const PREAMBLE = `你是 AI-BIM-governance 專案的對抗式 code reviewer。repo root: ${ROOT}。
這是 BIM 治理平台:A1 治理規則檢核 / A2 模型版本差異 / A3 跨專業 USD federation。後端 governance-service(FastAPI :49102 loopback,host py312 ifcopenshell 純 CPU),coordinator(Node :8004,proxy 到 :49102),web-viewer-sample(React Edge Console,掛 /console)。

誠實鐵律(違反即 honesty finding):
- 無願景假數字;每個 UI/輸出元素標 provenance(asbuilt/artifact/demo/p1/p15)。
- enum 用後端權威值;GPU/轉檔無遙測標「未取得」非 fail。
- 瀏覽器只打 coordinator :8004(governance :49102 / streaming 49xxx 為內部 loopback)。
- USD 非 source of truth;IFC GlobalId 為主鍵,model_version_id 綁定所有 issue。
- mapping fake(mock / allow_fake_mapping / fake_mapping_count>0 / mapping_method=fake)嚴禁當真 pass。

任務:只審查指派範圍,用 Read/Grep(絕對路徑)讀真實程式碼,找真實、可證據化的問題。
規則:寧缺勿濫——每個 finding 必須引用真實 code 片段(file + 行)。不要臆測、不要把「最佳實踐建議」當 bug。聚焦 correctness / security / honesty 違反 / spec 不符 / regression 風險 / 真實 test-gap。
回傳 StructuredOutput(subsystem + findings[]);findings 可空陣列(代表該範圍乾淨)。`

const REVIEWERS = [
  { key: 'a1-rule-engine', prompt: `${PREAMBLE}

範圍:A1 治理規則引擎。檔案:${ROOT}/governance-service/rule_engine/(全部), ${ROOT}/governance-service/rules/*.yaml, ${ROOT}/governance-service/tests/test_rule_engine.py。
Lens:correctness(規則評分 / pass-fail 邏輯、跨 schema 型別別名 IFC4X3 IfcBuildingElement→IfcBuiltElement)、honesty(is_fake_mapping 是否真擋假 mapping、score 是否可能被寫死或受 fake 汙染)、boundary。驗 score 計算與 failed 構件 ifc_guid 是否真從 ifcopenshell 萃取。` },

  { key: 'a1-bcf-export', prompt: `${PREAMBLE}

範圍:A1 BCF 匯出。檔案:${ROOT}/governance-service/bcf/(全部), ${ROOT}/governance-service/tests/test_bcf.py。
Lens:BCF 2.1 spec 合規(markup / viewpoints / .bcfzip 結構)、純 stdlib 不依賴 GPLv3、issue→bcfzip 是否綁 model_version_id、audit。對照 BCF 原則:BCF 管協作非模型、issue 必綁 model_version、無 mapping 不得建正式 BCF issue。` },

  { key: 'a1-ids-import', prompt: `${PREAMBLE}

範圍:A1 buildingSMART IDS-XML 匯入(ifctester)。檔案:grep ${ROOT}/governance-service 內 ids / ifctester 相關, ${ROOT}/governance-service/tests/test_ids.py。
Lens:IDS-XML 解析正確性、ifctester 缺席時誠實降級(health ifctester=false)、IDS spec 對應、輸入驗證。` },

  { key: 'a2-diff', prompt: `${PREAMBLE}

範圍:A2 模型版本差異。檔案:${ROOT}/governance-service/diff_engine/(全部), tests/test_diff_engine.py, test_diff_api.py, test_diff_geometry_impact.py。
Lens:GlobalId 多級對齊(GlobalId→Tag→type+name+loc)、moved(placement 平移) / property_changed(pset hash) / geometry_changed(opt-in) 分類正確性、issue-impact 連動。注意過去 blocking:『真實版本對』勿為 identity(同 SHA1 檔當兩版本)。` },

  { key: 'a3-federation', prompt: `${PREAMBLE}

範圍:A3 跨專業 USD federation。檔案:${ROOT}/governance-service/federation/(全部), tests/test_federation_api.py, test_federation_builder.py。
Lens:OpenUSD sublayer 疊合語義正確性、member usdc immutability、validate-coords(upAxis / metersPerUnit)、per-member transform。USD 對齊:pxr 26.5 為 ground truth;若對 USD composition 語義(sublayer 強弱 / LIVERPS)有疑慮以 pxr 官方為準——過去已修正『sublayer 為最弱 LIVERPS arc』是錯的(sublayer 不在 LIVERPS 七弧;subLayerPaths[0] 最強、opinion 在 Local 解析)。檢查 code / 註解 / spec 是否仍殘留錯誤論述。` },

  { key: 'issues-db', prompt: `${PREAMBLE}

範圍:Issue DB 生命週期。檔案:${ROOT}/governance-service/issues/(全部), ${ROOT}/governance-service/db.py, tests/test_issues.py。
Lens:issue lifecycle(open/resolved/rejected/...)、audit log 完整性、A1/A2 來源綁定、BCF 對齊(model_version 綁定)、SQLite 並發 / race / atomicity。` },

  { key: 'governance-app-api', prompt: `${PREAMBLE}

範圍:governance-service API 邊界與誠實。檔案:${ROOT}/governance-service/app.py, conftest.py, tests/test_api.py。
Lens:REST 端點正確性、health 誠實回報能力(ifctester / bcf)、501 p15 標示、錯誤路徑、loopback-only 綁定;重點安全:ifc_source_path / element_mapping_path 等檔案路徑輸入是否受控(path traversal / 任意檔讀取)。` },

  { key: 'coordinator-proxy', prompt: `${PREAMBLE}

範圍:coordinator governance proxy 與邊界。檔案:${ROOT}/bim-review-coordinator/src/routes/governanceProxy.ts, ${ROOT}/bim-review-coordinator/src/app.ts。
Lens:誠實 502(governance 缺席)、只 proxy 白名單路徑、瀏覽器→:8004→:49102 邊界、header / 方法 / body 轉發正確、無 SSRF(GOVERNANCE_API_BASE 是否可被污染)。` },

  { key: 'coordinator-security', prompt: `${PREAMBLE}

範圍:coordinator 安全(對照 L4 backlog,須讀真 code 驗當前 main 是否仍存在)。檔案:grep ${ROOT}/bim-review-coordinator/src 內 viewer-log / structLog / internal / token / cors。
Lens:#6 /api/internal/viewer-log 與 /structLog/health 是否明文無 token;internal 端點認證;CORS 設定;session / kit pool 安全。別照抄舊清單,以實際 code 為準。` },

  { key: 'streaming-security', prompt: `${PREAMBLE}

範圍:streaming-server / host-native conversion 安全。檔案:grep ${ROOT}/bim-streaming-server 內 token / 49101 / internal_conversion_token / bind / allowlist。
Lens:#2 :49101 internal_conversion_token 預設 None 無驗證是否仍真、host allowlist、loopback 綁定、轉檔輸入驗證。讀真 code 驗,標明檔案行號。` },

  { key: 'frontend-console', prompt: `${PREAMBLE}

範圍:Edge Console 前端誠實 + 型別。檔案:${ROOT}/web-viewer-sample/src/console/(EdgeConsole.tsx, pages.tsx, components.tsx, data.ts, governanceClient.ts), ${ROOT}/web-viewer-sample/src/AppStream.tsx, ${ROOT}/web-viewer-sample/src/Window.tsx。
已知 tsc --noEmit 錯誤(seed,請讀 code 確認並評估嚴重度):(a) EdgeConsole.tsx 第40/46行 provenance 值 'artifact' 不在型別 union 'asbuilt'|'demo'|'p1'|'p15' → 型別漏列(誠實鐵律要求 artifact 為合法 provenance);(b) AppStream.tsx 133/167 行 mediaPort number|null vs number|undefined;(c) 多個 unused React/var。
Lens:provenance 誠實標示、無寫死假資料、enum 來自後端、型別正確性、僅打 :8004。` },

  { key: 'scripts-deploy', prompt: `${PREAMBLE}

範圍:deploy.ps1 與 scripts 衛生(對照 CH-5 backlog)。檔案:${ROOT}/scripts/deploy.ps1, ${ROOT}/scripts/lib/*.ps1。
Lens:#22 Set-StrictMode -Version Latest 下未初始化變數 / 可能 null 取用 / 存取不存在的 property 會 throw 的點、#25 spectator port 上限常數是否仍硬寫散落、安全(env / token 處理)、preflight 邏輯正確性。實際讀 code 找 strict-mode 會炸或邏輯錯的點,標行號。` },

  { key: 'honesty-audit', prompt: `${PREAMBLE}

範圍:跨系統誠實鐵律稽核。手法:grep 全 repo(${ROOT}/governance-service, ${ROOT}/web-viewer-sample/src, ${ROOT}/bim-review-coordinator/src)找:寫死數字當遙測、fake/mock 資料外洩到正式路徑、provenance 缺漏或標錯、enum 前端硬寫非後端權威、瀏覽器直連內部 port(49xxx)、宣稱完成但實為 stub。每 finding 引真實 code(file+行)。` },

  { key: 'bcf-usd-principle', prompt: `${PREAMBLE}

範圍:BCF↔USD 開發原則對齊。檔案:${ROOT}/governance-service/bcf/, ${ROOT}/governance-service/issues/, ${ROOT}/governance-service/federation/, 及 mapping 相關。
對照原則:USD/USDC 管場景幾何、BCF 管 issue/comment/viewpoint;model.usdc 應 immutable 不被 issue 污染;IFC GUID 主鍵 + usd_prim_path 執行期定位;所有 issue 綁 model_version;無 mapping 只能視覺標註不能正式 BCF issue。找違反這些原則的實作,引真實 code。` },
]

function refutePrompt(f, lens, subsystem) {
  const lensInstr = lens === 'correctness'
    ? '(correctness lens)該問題在程式邏輯上是否真實存在、reviewer 引用的 code 是否屬實、是否誤判 / 過時行號。'
    : '(reachability lens)該問題是否真的可被觸發 / 可達 / 有實際影響,還是理論上不可達的死路或測試已涵蓋。'
  return `你是對抗式驗證者(${lens} lens)。預設立場:這個 finding 是 FALSE(refuted),除非你讀真實程式碼找到確鑿證據證明它為真。repo root: ${ROOT}。

待驗 finding(來自 ${subsystem} reviewer):
  id: ${f.id}
  title: ${f.title}
  file: ${f.file}   line: ${f.line || '?'}
  kind/severity: ${f.kind} / ${f.severity}
  reviewer 宣稱證據: ${f.evidence}
  why: ${f.why}
  proposed_fix: ${f.proposed_fix || '(none)'}

任務:用 Read/Grep 實際打開 ${f.file} 與相關檔確認:
  ${lensInstr}
教訓:reviewer 給的行號 / 版本 / 簽章可能是幻覺——自己 grep 驗。「有改 + 測試綠」不代表問題消失;對著宣稱的失效模式驗。
回傳 StructuredOutput:finding_id=${f.id}, real(true 僅當你親眼在 code 確認為真), severity(可下修或 not-a-bug), reason(引用你讀到的真實 code 片段), fix_sound(proposed_fix 是否正確可行)。`
}

phase('Review')
log(`啟動 ${REVIEWERS.length} 個對抗 reviewer,各審一子系統`)

const results = await pipeline(
  REVIEWERS,
  (r) => agent(r.prompt, { label: `review:${r.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  (review, r) => {
    const findings = (review && review.findings) ? review.findings : []
    if (!findings.length) return []
    return parallel(findings.map((f, fi) => () =>
      parallel([
        () => agent(refutePrompt(f, 'correctness', r.key), { label: `vc:${r.key}#${fi}`, phase: 'Verify', schema: VERDICT_SCHEMA }),
        () => agent(refutePrompt(f, 'reachability', r.key), { label: `vr:${r.key}#${fi}`, phase: 'Verify', schema: VERDICT_SCHEMA }),
      ]).then((vs) => ({ ...f, subsystem: r.key, verdicts: vs.filter(Boolean) }))
    ))
  }
)

const flat = results.flat().filter(Boolean)
const confirmed = flat.filter((f) => {
  const vs = f.verdicts || []
  const reals = vs.filter((v) => v && v.real).length
  return reals >= 1
})
const strongConfirmed = flat.filter((f) => {
  const vs = f.verdicts || []
  return vs.length >= 2 && vs.every((v) => v && v.real)
})

log(`Review 完成:${flat.length} findings;至少一懷疑者確認 ${confirmed.length};雙懷疑者皆確認 ${strongConfirmed.length}`)

return {
  total_findings: flat.length,
  confirmed_count: confirmed.length,
  strong_confirmed_count: strongConfirmed.length,
  all: flat,
}
