export const meta = {
  name: 'repo-health-scan',
  description: 'AI-BIM repo 五面向健檢：版本漂移 / 清理 / .claude 資產 / 文件同步（4 個可修衛生面向）+ 進度差異（計畫自報 vs 獨立查證，唯讀評估）。Explore agent 平行唯讀掃描 → 合併結構化發現。不修改任何檔案。',
  phases: [{ title: 'Scan', detail: '5 面向平行唯讀掃描（4 衛生 + 1 進度評估）' }],
}

// args 防護：harness 可能把 args 序列化成字串（見 fu-adversarial-verify-generic 實證）→ 字串就 parse。
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
// ROOT 優先用 args.root（呼叫端傳入）；fallback 用 git toplevel 自動偵測；再 fallback 用已知本機路徑（避免找不到 git）。
const ROOT = A.root || (await $`git rev-parse --show-toplevel`.text().catch(() => '')).trim() || 'C:\\Repos\\active\\iot\\AI-BIM-governance'

// 每個面向回傳同一份結構化發現，skill 端據此畫狀態表、分流 safe/risky。
const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'items', 'summary'],
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string', description: '一句話總結這個面向的健康狀態（zh-TW）' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'evidence', 'fixSuggestion', 'fixSafety'],
        properties: {
          severity: { type: 'string', enum: ['warn', 'fail'], description: '問題嚴重度' },
          title: { type: 'string', description: '問題標題（zh-TW，精簡）' },
          evidence: { type: 'string', description: '證據：檔案路徑 + 具體值（如版本號、分支名）' },
          fixSuggestion: { type: 'string', description: '建議修法（zh-TW）' },
          fixSafety: { type: 'string', enum: ['safe', 'risky'], description: 'safe=可低風險自動修；risky=動版本/agent設定/文件內容，需人工確認' },
        },
      },
    },
  },
}

const COMMON = `\n\n你是唯讀掃描者：只用 Read/Grep/Glob/Bash(僅 git/ls 等查詢指令) 觀察，**絕對不修改任何檔案**。
精簡如實回報，prose 欄位用繁體中文台灣用語。沒有問題就回空 items 陣列並在 summary 說明健康。`

// 進度差異面向（第 5 面向）：輸出形狀與前 4 個不同——不是「可修問題」，而是「計畫自報 vs 獨立查證」的對照評估。
const PROGRESS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scope', 'items', 'summary'],
  properties: {
    scope: { type: 'string', description: '評估了哪些 App/里程碑（zh-TW）' },
    summary: { type: 'string', description: '一句話總結：進度大致落在哪、計畫與現實最大的落差是什麼（zh-TW）' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'planSays', 'actuallyIs', 'gap', 'alignment'],
        properties: {
          target: { type: 'string', description: 'App 或里程碑，如「A1 治理與模型檢核」「M1 A1 核心閉環」' },
          planSays: { type: 'string', description: '計畫自報：文件裡的 🟢/🟡/⚪、DoD 勾選狀態' },
          actuallyIs: { type: 'string', description: '獨立查證的實際現況 + 證據（服務/code 是否存在、docs/superpowers/plans 完成項、git 軌跡）' },
          gap: { type: 'string', description: '差距一句話描述' },
          alignment: { type: 'string', enum: ['aligned', 'plan-ahead', 'plan-behind', 'unknown'], description: 'aligned=相符；plan-ahead=計畫高估(說做了實際沒有)；plan-behind=計畫低報(說待建實際做了)；unknown=查不出' },
        },
      },
    },
  },
}

const PROGRESS_PROMPT = `掃描 ${ROOT} 的「進度差異」（唯讀評估，不修改任何檔案）。
讀計畫權威：docs/plans/ai-bim-governance-開發軌跡與執行計畫.md（里程碑 M0–M8、§2.99 A1–A10 總覽狀態表、各 App 的 DoD/驗收清單 [ ] 勾選、誠實標記 🟢已實作/🟡示範/⚪待建）；輔助讀 docs/plans/docs-plans-README.md。
對每個 App（A1–A10）與里程碑（M0–M8）做「計畫自報 vs 獨立查證」並列：
- planSays：直接抄文件裡的狀態標記與 DoD 勾選。
- actuallyIs：**獨立查證**，不盡信文件——查對應服務/code 是否真的存在（如 governance-service、coordinator、各 .ts/.py 模組）、docs/superpowers/plans/ 裡哪些功能已有完成計畫、git log 近期軌跡、有無 provenance.json。附具體證據。
- alignment：相符 aligned / 計畫高估 plan-ahead（說做了但 code 找不到）/ 計畫低報 plan-behind（說待建但實際已做）/ 查不出 unknown。
- gap：一句話。
重點放在「計畫自報與現實不符」之處（高估=過度承諾風險；低報=文件過期）。`

const SCANNERS = [
  {
    key: 'version-drift',
    prompt: `掃描 ${ROOT} 的「版本/依賴漂移」。
讀這些檔：governance-service/requirements.txt、services/kit-manager-api/requirements.txt、bim-streaming-server/requirements.txt、apps/kit-manager-web/package.json、bim-review-coordinator/package.json、web-viewer-sample/package.json。
找出「同一個套件在不同子專案被釘到不同版本」（如 fastapi / uvicorn / pydantic / vitest / typescript / react）。
每個漂移列一筆 item：title=套件名漂移；evidence=各檔的版本對照；fixSuggestion=建議對齊到哪個版本；fixSafety=risky（改依賴檔有風險）。`,
  },
  {
    key: 'cleanup',
    prompt: `掃描 ${ROOT} 的「分支/worktree/暫存清理」。
查：git branch --merged（已合併進預設分支、可刪的分支，排除目前分支與預設分支）、.worktrees/ 目錄（對照現存分支，找孤兒/過期 worktree）、.tmp/、.pytest_cache/、pytest-*-tmp/、logs/（找舊暫存與可輪替的 log）。
每個清理目標列一筆 item：evidence=路徑/分支名 + 大小或時間；fixSuggestion=刪除/輪替，**優先指明複用既有腳本** scripts/git-prune-merged-branches.ps1、scripts/log-retention/；fixSafety=safe（純清理可低風險，刪分支/暫存）。`,
  },
  {
    key: 'claude-assets',
    prompt: `掃描 ${ROOT}/.claude 的「資產治理」。
列 skills/、workflows/、commands/、agents/ 內容。找：命名風格不一致、重複或近重複的 skill/workflow、沒有任何地方引用的孤兒 workflow（用 grep 在 .claude 與 scripts 內找引用）、skill 漏進索引或 README。
每個問題列一筆 item：evidence=檔案路徑 + 觀察；fixSuggestion=改名/移除孤兒/補索引；fixSafety=risky（動 agent 設定需人工確認）。`,
  },
  {
    key: 'doc-sync',
    prompt: `掃描 ${ROOT} 的「文件/設定同步」。
比對：scripts/ 內實際 *.ps1/*.sh/*.mjs vs scripts/script-registry.json（找未登記或登記了卻不存在的腳本）；.env 的 key vs .env.example 的 key（**只比 key 名，不讀也不回報任何值**，找 example 缺的 key）；AGENTS.md/CLAUDE.md/README.md 是否指到不存在的檔案路徑。
每個落差列一筆 item：evidence=檔案 + 落差描述（key 名可列，值不可）；fixSuggestion=補 registry/同步 example 的 key/修正文件指向；fixSafety=risky（文件內容需人工確認；.env.example 只補 key 名留空值）。`,
  },
]

phase('Scan')

// 5 個 scanner 同批平行：前 4 個是可修衛生面向（FINDINGS_SCHEMA），第 5 個是進度評估（PROGRESS_SCHEMA）。
const all = await parallel([
  ...SCANNERS.map(s => () =>
    agent(s.prompt + COMMON, {
      label: `scan:${s.key}`,
      phase: 'Scan',
      schema: FINDINGS_SCHEMA,
      agentType: 'Explore',
    })
  ),
  () =>
    agent(PROGRESS_PROMPT + COMMON, {
      label: 'scan:progress',
      phase: 'Scan',
      schema: PROGRESS_SCHEMA,
      agentType: 'Explore',
    }),
])

const findings = all.slice(0, SCANNERS.length).filter(Boolean)
const progress = all[SCANNERS.length] || null // 第 5 面向；agent 失敗則 null

const totalItems = findings.reduce((n, f) => n + (f.items?.length || 0), 0)
log(`健檢完成：衛生 ${findings.length}/${SCANNERS.length} 面向共 ${totalItems} 項；進度評估 ${progress ? '完成' : '未完成'}`)

return { root: ROOT, dimensions: findings, progress, totalItems }
