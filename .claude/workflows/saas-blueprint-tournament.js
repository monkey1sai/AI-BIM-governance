export const meta = {
  name: 'saas-blueprint-tournament',
  description: '4 視角 SaaS 藍圖提案 → 3 評審 → fable 仲裁合成最終藍圖與逐檔寫作 brief',
  phases: [
    { title: 'Propose', detail: '4 個視角提案 (opus)' },
    { title: 'Judge', detail: '3 位評審評分 (opus)' },
    { title: 'Arbitrate', detail: 'fable max 仲裁合成', model: 'fable' },
  ],
}

let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { throw new Error('bad_args: ' + e.message) } }
if (!A || !A.dir) throw new Error('bad_args: dir missing')
const DIR = A.dir

const HARD = ['硬約束(不可違反,違反=提案作廢):',
'H1 雲地分離架構保留:雲端=控制面(租戶/身分/計費計量/編排/規則版本分發/跨站聚合 dashboard);落地端(客戶站點)=資料/GPU 面(Kit GPU 渲染、IFC→USD 轉檔、governance 檢核、本地 storage/MinIO、WebRTC 串流)。SaaS ≠ 全上雲;研究合成裡「SaaS 只做雲端、on-prem 另外報價」的路線【不採納】——本產品的 SaaS 主形態就是「雲端控制面 + 落地端 plane」混合平台(可另設全雲託管 tier 作為選項,但雲地混合是主線)。',
'H2 落地端程式碼是一級產品元件:現有 host-native 服務(coordinator :8004 / governance-service :49102 / bim-streaming-server 49100·49101·47998 / kit-manager-api :8010 / Kit)持續存在並演進為 edge plane;不得規劃成「過渡期後淘汰」。',
'H3 A1–A10 規格功能完整保留:功能定義、建成狀態(對齊矩陣 §4.4 裁決:Hero built=A1+A2+A3-federation;A3-clash blocked-on-OCC;A4-A10 NOT BUILT p3/p4)、Prov 7 值不變;SaaS 重定位只能加脈絡不能改裁決。',
'H4 保存契約全數遵守(wf1-contract.json preservation_contract 32 條);SaaS 概念一律「增補層」:新章節/新檔案/hash 之外的租戶維度,不覆寫不重編既有錨點(README §1 效力序 / A.1.1 22 條 / §4.4 / DS手冊 §1 凍結 12 條)。',
'H5 誠實鐵律:所有 SaaS 新能力在文件中一律標 PLANNED / NOT BUILT / 待建;現況已建成僅單站點閉環。不得寫成「已交付/已支援多租戶」;無假數字;規劃中的定價/容量數字一律標「規劃值·非實測」。',
'H6 模型檔不出站原則:雲端控制面只收 metadata(計量/狀態/hash/摘要),IFC/USD payload 不進雲(全雲託管 tier 例外且須客戶選擇);落地端斷線時必須能獨立運作(參照 research-hybrid-edge.json:Azure Arc outbound-only、GDC survivability、metadata-only 投影)。',
'H7 docs/plans 目錄不搬、既有檔名不改;新檔命名沿用 ai-bim-governance-saas-* 慣例;新審批報告命名 審批報告-docs-plans-SaaS改版-2026-07-06.md。',
'H8 GPU 物理與法務死線:1 GPU=1 Kit=1 stream、無 live migration、換 GPU=terminate+recreate 30-40 秒;time-slicing 不得當多租戶隔離;RTX 4060 Ti(GeForce)EULA 禁 datacenter——datacenter/雲託管 tier 須 L4/L40S 級,消費卡只存在於客戶自有落地端;Kit 官方容器化 Linux-only,Windows host-native edge 要自建排程層。'].join('\n')

const READS = ['先用 Read 依序讀完以下材料(全部都要讀):',
'1. ' + DIR + '/wf1-contract.json(保存契約 32 條 + corpus_map 11 檔改寫幅度 + 10 個 open questions)',
'2. ' + DIR + '/wf2-synthesis.json(12 主題官方研究合成 + 30 條 blueprint inputs + gaps)',
'3. ' + DIR + '/research-hybrid-edge.json(雲地混合 SaaS 官方模式:Arc/Outposts/GDC/Fleet Command)',
'(可選深查)' + DIR + '/wf2-findings.json(逐主題原始研究)、' + DIR + '/wf1-couplings.json(CI/治理文件耦合細節)'].join('\n')

const PROPOSAL = {
  type: 'object',
  required: ['angle', 'summary', 'cloud_control_plane', 'edge_plane', 'tenancy_identity', 'gpu_economics', 'metering_billing', 'apis_and_standards', 'a1a10_positioning', 'migration_roadmap', 'open_question_rulings', 'doc_set_outline', 'risks'],
  properties: {
    angle: { type: 'string' }, summary: { type: 'string' },
    cloud_control_plane: { type: 'string' }, edge_plane: { type: 'string' },
    tenancy_identity: { type: 'string' }, gpu_economics: { type: 'string' },
    metering_billing: { type: 'string' }, apis_and_standards: { type: 'string' },
    a1a10_positioning: { type: 'string' }, migration_roadmap: { type: 'string' },
    open_question_rulings: { type: 'array', items: { type: 'object', required: ['question', 'ruling', 'rationale'], properties: { question: { type: 'string' }, ruling: { type: 'string' }, rationale: { type: 'string' } } } },
    doc_set_outline: { type: 'string' }, risks: { type: 'array', items: { type: 'string' } },
  },
}

const JUDGMENT = {
  type: 'object',
  required: ['scores', 'ranking', 'notes'],
  properties: {
    scores: { type: 'array', items: { type: 'object', required: ['angle', 'total', 'contract_compliance', 'cloud_edge', 'feasibility', 'saas_completeness', 'honesty', 'hard_violations', 'strengths', 'weaknesses', 'steal'], properties: { angle: { type: 'string' }, total: { type: 'number' }, contract_compliance: { type: 'number' }, cloud_edge: { type: 'number' }, feasibility: { type: 'number' }, saas_completeness: { type: 'number' }, honesty: { type: 'number' }, hard_violations: { type: 'array', items: { type: 'string' } }, strengths: { type: 'array', items: { type: 'string' } }, weaknesses: { type: 'array', items: { type: 'string' } }, steal: { type: 'array', items: { type: 'string' } } } } },
    ranking: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const FINAL = {
  type: 'object',
  required: ['decision_summary', 'winning_angle', 'blueprint', 'open_question_rulings', 'doc_plan', 'honesty_rules', 'risks'],
  properties: {
    decision_summary: { type: 'string' }, winning_angle: { type: 'string' },
    blueprint: { type: 'object', required: ['vision', 'cloud_control_plane', 'edge_plane', 'tenancy_identity', 'gpu_economics', 'metering_billing', 'apis_and_standards', 'ops_slo_security', 'migration_roadmap'], properties: { vision: { type: 'string' }, cloud_control_plane: { type: 'string' }, edge_plane: { type: 'string' }, tenancy_identity: { type: 'string' }, gpu_economics: { type: 'string' }, metering_billing: { type: 'string' }, apis_and_standards: { type: 'string' }, ops_slo_security: { type: 'string' }, migration_roadmap: { type: 'string' } } },
    open_question_rulings: { type: 'array', items: { type: 'object', required: ['question', 'ruling', 'rationale'], properties: { question: { type: 'string' }, ruling: { type: 'string' }, rationale: { type: 'string' } } } },
    doc_plan: { type: 'array', items: { type: 'object', required: ['path', 'action', 'writer_model', 'brief', 'must_preserve'], properties: { path: { type: 'string' }, action: { type: 'string' }, writer_model: { type: 'string' }, brief: { type: 'string' }, must_preserve: { type: 'array', items: { type: 'string' } }, size_guidance: { type: 'string' } } } },
    honesty_rules: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const ANGLES = [
  { key: 'migration-first', title: '增量遷移優先', focus: '從現況單站點部署出發,設計最小安全增量路徑到雲地混合 SaaS。里程碑接續既有 M0-M8(新階段從 SaaS-M1 起編),每階段有 DoD 與回退方案;現有六服務怎麼一步步長出 edge connector 與雲端控制面;絕不 big-bang。' },
  { key: 'platform-api-first', title: '平台與 API 優先', focus: '把平台做成開發者可整合的產品:公開 API 面(governance rule-run / conversion / session)、webhook(比照 APS manifest+HMAC 簽章 dispatch)、BCF-API 3.0 相容、openCDE、IDS 1.0 BYO-ruleset、bSDD 對接;API 版本策略與 tenant-scoped token;現有凍結 proxy 契約如何原樣保留並在其上加公開 API gateway 層。' },
  { key: 'tenant-economics-first', title: '租戶經濟與 GPU 容量優先', focus: 'Bridge 隔離分層對應定價 tier;GPU deployment stamp 設計(datacenter tier vs 客戶自有落地端);session broker 排隊/配額/公平調度/warm pool/429+Retry-After 契約;計量三軸(GPU 分鐘/轉檔 job 複雜度分檔/儲存 GB)與 Stripe meter 模型;COGS 與定價地板(L4 $0.80-1.02/hr × 2-4x);spectator 與 primary 拆費率。' },
  { key: 'trust-governance-first', title: '信任與治理優先', focus: '法遵與資料主權作為差異化賣點:模型檔不出站的 metadata-only 投影;資料主權三層可售承諾(region/stamp pinning、ISO 27001 範疇、ISO 19650-5 need-to-know);租戶隔離 ADR 書面化(SOC 2 佐證);租戶生命週期狀態機(active→deactivated→retained→purged)與 per-tenant DR/PITR;審計軌跡;BIM IP 歸屬專案級可設定;離線 survivability 寬限期設計。' },
]

function proposalPrompt(ang) {
  return ['你是 SaaS 重規劃提案者,視角:【' + ang.title + '】。', '',
'背景:BIM 治理與審查平台(A1-A10 十大功能模組;IFC 檢核/IDS、版本 diff、跨專業疊合、IFC→USD 轉檔(NVIDIA Kit GPU,Windows host-native)、Kit WebRTC 3D 串流審查、Issue/BCF 2.1)要從單租戶單站點重新規劃為【多租戶 SaaS 平台】,docs/plans/ 需求語料將整組改寫。',
'', READS, '', HARD, '',
'你的視角聚焦:' + ang.focus, '',
'產出完整提案(schema 對應欄位全部要填,每個 string 欄位寫成結構化細節文字,可用條列;不是摘要是設計):',
'- cloud_control_plane:雲端控制面服務清單、職責、API 面、與落地端的通訊契約(方向/協定/頻率)',
'- edge_plane:落地端保留什麼、新增什麼(connector 設計:註冊/心跳/metadata 上報/規則版本拉取)、六服務演進路線、斷線行為',
'- tenancy_identity:租戶模型(tenant→project→model 三層)、隔離策略(Bridge:哪些 pool 哪些 silo)、身分(org-per-tenant/SSO/token tenant_id claim)、與現有單租戶 governance token 的相容路徑',
'- gpu_economics:session broker、排隊/配額、warm pool、stamp、datacenter vs 落地端 GPU 分界(H8)',
'- metering_billing:計量單位、方案分層(對應隔離 tier)、entitlements、落地端計量上報(斷線佇列)',
'- apis_and_standards:公開 API/webhook/BCF-API/IDS/openCDE 對齊',
'- a1a10_positioning:A1-A10 每個在 SaaS 語境的定位一句話(狀態不變!built 的持續 built、NOT BUILT 的持續 NOT BUILT 並排進 SaaS 里程碑)',
'- migration_roadmap:階段化路線(每階段 scope + DoD + 回退),第一階段必須是「現況可交付的最小 SaaS 增量」',
'- open_question_rulings:對 wf1-contract.json 裡 10 個 open_questions 逐一裁決(question 摘要/ruling/rationale;凡涉及突破凍結契約的,ruling 必須寫「標記為待人類簽核的新決策」而非直接改)',
'- doc_set_outline:docs/plans 檔案組改寫大綱(既有 11 檔各怎麼動(遵守 corpus_map 幅度)+ 新增哪些檔(4-7 個,含每檔章節大綱))',
'- risks:此提案的風險與未驗證假設',
'語言:繁體中文(台灣用語),code/API/埠/路由保留原文。'].join('\n')
}

phase('Propose')
log('4 視角提案並行(opus)')
const props = (await parallel(ANGLES.map((ang) => () =>
  agent(proposalPrompt(ang), { label: 'propose:' + ang.key, phase: 'Propose', schema: PROPOSAL, model: 'opus', effort: 'high' })))).filter(Boolean)
log('提案完成 ' + props.length + '/4')
if (!props.length) throw new Error('no proposals survived')

phase('Judge')
const judgePrompt = (persona) => ['你是 SaaS 藍圖評審,人格:【' + persona + '】。', '',
READS.replace('(可選深查)', '(必要時深查)'), '', HARD, '',
'以下是 ' + props.length + ' 份提案(JSON):', JSON.stringify(props), '',
'評分規則(每項 0-10,total=加權:contract_compliance×0.30 + cloud_edge×0.25 + feasibility×0.20 + saas_completeness×0.15 + honesty×0.10,換算 0-100):',
'- contract_compliance:保存契約 32 條與 corpus_map 幅度遵守度;錨點/裁決/凍結契約是否原樣',
'- cloud_edge:H1/H2/H6 雲地分離品質(控制面最小職責、connector 設計、斷線 survivability、metadata-only)',
'- feasibility:對物理/法務死線(H8)與現有六服務現實的可行性;遷移路線是否真的最小安全增量',
'- saas_completeness:租戶/身分/計量計費/API/營運的完整度與研究依據引用品質',
'- honesty:PLANNED/NOT BUILT 標記紀律、規劃值不冒充實測',
'hard_violations:列出該提案違反 H1-H8 的具體點(有violation該項 contract_compliance 或對應軸直接 ≤3)。',
'steal:此提案中值得被最終藍圖採納的獨到設計(即使總分不高)。',
'ranking:由高至低排 angle。', '語言:繁體中文。'].join('\n')

const judges = (await parallel([
  () => agent(judgePrompt('物理現實主義者——盯 GPU/Windows/埠/凍結契約的可行性'), { label: 'judge:realist', phase: 'Judge', schema: JUDGMENT, model: 'opus', effort: 'high' }),
  () => agent(judgePrompt('SaaS 營運老手——盯租戶隔離/計費/生命週期/營運完整度'), { label: 'judge:saas-operator', phase: 'Judge', schema: JUDGMENT, model: 'opus', effort: 'high' }),
  () => agent(judgePrompt('治理稽核者——盯保存契約逐條合規/誠實鐵律/增補層紀律'), { label: 'judge:auditor', phase: 'Judge', schema: JUDGMENT, model: 'opus', effort: 'high' }),
])).filter(Boolean)
log('評審完成 ' + judges.length + '/3')

phase('Arbitrate')
const finalBp = await agent(['你是最終仲裁者(最高規格模型),對「BIM 治理平台 → 雲地混合多租戶 SaaS」的 docs/plans 改寫做終局藍圖裁決。', '',
READS, '', HARD, '',
'=== 4 份提案 ===', JSON.stringify(props), '',
'=== 3 份評審 ===', JSON.stringify(judges), '',
'任務:',
'1. 以評審共識選出 winning_angle,但用其他提案的 steal 清單補強,合成【最終藍圖】(blueprint 各欄位寫成可直接落文件的設計細節,不是摘要;衝突處以 H1-H8 與保存契約為準)。',
'2. open_question_rulings:對 10 個 open questions 給終局裁決;涉及突破凍結契約/效力序的一律裁「維持現契約 + SaaS 需求記為待人類簽核的新決策」,並寫明觸發條件。',
'3. doc_plan:逐檔寫作計畫,這是下游改寫 agents 的唯一 brief,品質決定成敗:',
'   - 既有 11 檔:action 遵守 corpus_map(minimal-touch=只增補指定段落;section-rewrite=指名哪些章節重寫哪些逐字保留;major-rewrite(兩份 prototype.html)=優先「外科手術式增補」(加 SaaS 頁/租戶脈絡/雲地標籤)而非整檔重生,逐頁語意與誠實標記不可失;keep-as-is=不動)',
'   - 新增檔案 4-7 個:路徑(docs/plans/ai-bim-governance-saas-*.md)+ 完整章節大綱 + 每章要寫什麼(引用哪些研究依據);必含一份新審批報告 審批報告-docs-plans-SaaS改版-2026-07-06.md(承接 2026-07-02 版:記錄本輪指令、裁決、四釘子/22路由/七值延續聲明)',
'   - 另含 docs/superpowers/specs/2026-07-06-plans-saas-replatform-design.md(formal spec:本輪改寫的變更契約,給 CI governance gate)',
'   - README(docs-plans-README.md)的增補指示:§1 效力序不動;§2 檔案角色表增列新檔;新增 SaaS 導讀段落(放在既有章節之後,禁重編號)',
'   - 每檔:writer_model(sonnet=標準增補/opus=重寫與新架構檔)、brief(該檔的完整寫作指示,含章節結構、必寫內容、引用來源、與其他檔的分工邊界——寧詳勿略)、must_preserve(該檔逐字錨點)、size_guidance(行數上限建議)',
'4. honesty_rules:給所有 writer 的統一誠實規則(PLANNED 標記格式、規劃值標註、prov 值紀律、NOT BUILT 呈現)。',
'5. risks:整體風險與 gaps(研究未解者誠實列出,寫進文件的「未驗證假設」章)。',
'語言:繁體中文(台灣用語)。'].join('\n'), { label: 'arbitrate:final', phase: 'Arbitrate', schema: FINAL, model: 'fable', effort: 'max' })

return { final: finalBp, judges, props }