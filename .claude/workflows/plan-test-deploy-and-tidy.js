export const meta = {
  name: 'plan-test-deploy-and-tidy',
  description: '勘查 main=origin/main 一鍵測試區部署(啟用已實作功能)+ 參數整理 + 散落檔清理,依難度分派 Haiku/Sonnet/Opus',
  phases: [
    { title: 'Discover', detail: '4 個平行勘查 agent:部署機制(Opus)/功能啟用缺口(Opus)/參數盤點(Sonnet)/散落檔(Haiku)' },
  ],
}

const REPO = 'C:/Repos/active/iot/AI-BIM-governance'

const CONTEXT = `
專案: AI-BIM-governance (Windows / PowerShell 主). Repo root: ${REPO}
服務與 port(來自 AGENTS.md §1):
- bim-review-coordinator (:8004) 唯一對外 IFC intake + Session/Control plane,前端 /ui = EdgeConsole
- bim-streaming-server (49100/49101) IFC→USDC 轉檔 + Omniverse Kit + WebRTC runtime (host-native, GPU)
- governance-service (:49102 loopback) A1 rule-run / A2 diff / A3 federation 權威
- web-viewer-sample (:5173) browser client / viewer
- services/kit-manager-api (:8010) + apps/kit-manager-web operator UI
canonical 部署契約(docs/agents/product-operability-and-script-contract.md §6):
- scripts/deploy.ps1 = golden 一鍵部署入口(-Build / -DryRun / -Force -StrictPostVerify)
- 測試區重建口令 = scripts/dev/rebuild-test-deploy.ps1 -Build,會 freshly fetch origin/main、重建部署 checkout D:/Users/deploy/AI-bim-geo、排除 agent/tooling 與 root docs/openspec/patches,再從部署區跑 scripts/deploy.ps1 -Build。禁止 -DryRun 當重建。
- deploy.ps1 Phase 3 可能被 host-native blocker(kit.exe 佔 49100/49110+、conversion python.exe 佔 49101)擋住;已授權可停 blocking PID 後重跑同條 -Build。
近期已實作功能(git log):#215 將 governance-service 納入 deploy 啟動、#218 #/conv 轉檔 coverage 報告、#220 coverage 自我參照標註、#221 #/conv 轉檔佇列插隊/重試 controlled action、minio 自動 intake 系列。
鐵律: 不修改任何 .env 實際機密值(只能讀/比對/提建議);誠實標 DEMO/NOT BUILT;新增 root script 視為 script-contract 風險。
`

const DEPLOY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['oneclick_command_sequence', 'services_in_deploy', 'phase3_blockers', 'gaps_or_risks', 'notes'],
  properties: {
    oneclick_command_sequence: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['step', 'command', 'purpose'],
        properties: { step: { type: 'number' }, command: { type: 'string' }, purpose: { type: 'string' } },
      },
    },
    services_in_deploy: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'port', 'how_started', 'started_by_default'],
        properties: { name: { type: 'string' }, port: { type: 'string' }, how_started: { type: 'string' }, started_by_default: { type: 'boolean' } },
      },
    },
    phase3_blockers: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['blocker', 'ports', 'handling'],
        properties: { blocker: { type: 'string' }, ports: { type: 'string' }, handling: { type: 'string' } },
      },
    },
    gaps_or_risks: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const FEATURES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['features', 'summary'],
  properties: {
    features: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['feature', 'evidence', 'enabled_in_deploy', 'how_to_enable', 'risk'],
        properties: {
          feature: { type: 'string' },
          evidence: { type: 'string' },
          enabled_in_deploy: { type: 'string', enum: ['yes', 'no', 'partial', 'unknown'] },
          how_to_enable: { type: 'string' },
          risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        },
      },
    },
    summary: { type: 'string' },
  },
}

const PARAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['env_files', 'issues', 'secret_safety'],
  properties: {
    env_files: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['path', 'purpose', 'drift'],
        properties: { path: { type: 'string' }, purpose: { type: 'string' }, drift: { type: 'string' } },
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['param', 'where', 'problem', 'recommended_action'],
        properties: { param: { type: 'string' }, where: { type: 'string' }, problem: { type: 'string' }, recommended_action: { type: 'string' } },
      },
    },
    secret_safety: { type: 'string' },
  },
}

const FILES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'script_contract_violations', 'summary'],
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['path', 'category', 'recommended', 'reason'],
        properties: {
          path: { type: 'string' },
          category: { type: 'string' },
          recommended: { type: 'string', enum: ['keep', 'gitignore', 'relocate', 'delete'] },
          reason: { type: 'string' },
        },
      },
    },
    script_contract_violations: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

phase('Discover')

const [deploy, features, params, files] = await parallel([
  () => agent(
    `${CONTEXT}\n\n任務(Opus,難):精讀部署機制,輸出「main=origin/main 一鍵部署到測試區」的精確指令序列與服務啟動真相。\n` +
    `READ: ${REPO}/scripts/deploy.ps1 全文、${REPO}/scripts/dev/rebuild-test-deploy.ps1、${REPO}/scripts/script-registry.json、${REPO}/scripts/SCRIPT_CONTRACT.md(若存在)、任何 docker-compose*.yml、${REPO}/scripts/lib/ 內被 deploy.ps1 dot-source 的檔。\n` +
    `釐清:一鍵測試區部署的「確切命令序列」(從目前 repo 觸發 rebuild-test-deploy.ps1 -Build → 部署區 deploy.ps1 -Build);deploy.ps1 實際會 build/啟動哪些服務、各在哪個 port、哪些 default 啟動 vs 條件啟動;Phase 3 host-native blocker 的判定與處理;任何會擋住「一鍵成功」的缺口/風險。只回報你在檔案裡讀到的真相,讀不到的標 unknown,不要臆測。`,
    { label: 'deploy-path', phase: 'Discover', model: 'opus', effort: 'high', schema: DEPLOY_SCHEMA },
  ),
  () => agent(
    `${CONTEXT}\n\n任務(Opus,難):盤點「已實作但部署時未啟用」的功能缺口——這是部署的核心要求「啟用已實作的功能」。\n` +
    `做法:1) READ ${REPO}/scripts/deploy.ps1 看它實際啟動/build 了什麼、讀哪些 env 開關。2) 用 git log --oneline -40 與 gitnexus query 找近期已實作功能(governance-service #215、#/conv coverage #218/#220、#/conv 佇列插隊重試 #221、minio 自動 intake、A1/A2/A3 governance、kit-manager)。3) 對每個功能判定它在「測試區一鍵部署」後是否真的被啟用:是否需要某個 env flag(如 FEATURE_*、ENABLE_*、*_ENABLED)、是否需要某服務被納入啟動、是否需要 web build:ui 重建 console。\n` +
    `搜尋 env 開關:grep -ri 'ENABLE_|_ENABLED|FEATURE_|DISABLED' 於各服務 .env.example 與程式碼。對每個 feature 給 enabled_in_deploy(yes/no/partial/unknown)+ how_to_enable(具體 env 值或步驟)+ risk。summary 點出「要讓部署啟用全部已實作功能,最關鍵要動的幾個開關/服務」。`,
    { label: 'features-enabled-gap', phase: 'Discover', model: 'opus', effort: 'high', schema: FEATURES_SCHEMA },
  ),
  () => agent(
    `${CONTEXT}\n\n任務(Sonnet,中):盤點散落參數/設定,產出「整理參數」計畫。嚴禁修改或外洩任何 .env 機密值——只讀、只比對、只建議。\n` +
    `做法:glob 找出所有 **/.env、**/.env.example、各服務設定檔(coordinator/streaming-server/governance-service/web-viewer-sample/services/apps)。對每個 .env 對照同目錄 .env.example:列出 drift(.env 有但 .env.example 缺、或反之)、重複/散落的同義參數(如 port、API base、GOV_PORT/PORT/CONSOLE_DIST_DIR/GOVERNANCE_API_BASE 之類跨服務應一致的值)、可疑硬編碼。issues 每筆給 recommended_action(例:補進 .env.example、集中到單一來源、命名統一),但全部是「建議」不是「執行」。secret_safety 說明你完全沒讀取/輸出任何機密值的明文。`,
    { label: 'param-config-inventory', phase: 'Discover', model: 'sonnet', effort: 'medium', schema: PARAM_SCHEMA },
  ),
  () => agent(
    `${CONTEXT}\n\n任務(Haiku,機械式):清點散落檔案,產出清理計畫。只清點與分類,不刪任何東西。\n` +
    `做法:在 ${REPO} 跑 git status --porcelain 取得未追蹤/變更檔;ls artifacts/ artifacts/spec-to-done/ artifacts/e2e/ .workflow/ test-results/;READ docs/agents/product-operability-and-script-contract.md §6 的 script contract(新 smoke/check/e2e 不得加到 root scripts/、優先落點 scripts/tests|scripts/dev|tests/e2e|web-viewer-sample/scripts)。\n` +
    `對每個散落項目給 category(如 spec-to-done 狀態檔 / e2e trace / 暫存腳本 / 測試輸出 / 設計產物)+ recommended(keep / gitignore / relocate / delete)+ reason。特別點出:artifacts/spec-to-done/*.ps1 之類暫存腳本是否該移到 scripts/dev 或刪、root 是否有違反 script-contract 的新 script、哪些大目錄該進 .gitignore。script_contract_violations 列出任何 root scripts/ 內疑似違規的新檔。`,
    { label: 'scattered-files', phase: 'Discover', model: 'haiku', effort: 'low', schema: FILES_SCHEMA },
  ),
])

return { deploy, features, params, files }
