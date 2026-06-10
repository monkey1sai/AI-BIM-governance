export const meta = {
  name: 'spec-to-done-design',
  description: '深讀四套工具介面 → 3 視角設計 spec-to-done 工作流 → judge panel 評審',
  phases: [
    { title: 'DeepRead', detail: '5 agents 平行深讀 superpowers / mattpocock / gitnexus / gstack / repo 治理' },
    { title: 'Design', detail: '3 個 Opus agents 以不同視角各產一份工作流設計', model: 'opus' },
    { title: 'Judge', detail: '3 個 Opus judges 以不同 lens 比較評分', model: 'opus' },
  ],
}

phase('DeepRead')
log('深讀:superpowers / mattpocock / gitnexus / gstack / repo 治理規範')

const READERS = [
  {
    key: 'superpowers',
    prompt: `你是工具介面研究員。深讀 Superpowers plugin 全部 14 個 skills,目錄:
C:/Users/IOT/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/
子目錄:brainstorming, dispatching-parallel-agents, executing-plans, finishing-a-development-branch, receiving-code-review, requesting-code-review, subagent-driven-development, systematic-debugging, test-driven-development, using-git-worktrees, using-superpowers, verification-before-completion, writing-plans, writing-skills
每個讀其 SKILL.md(部分有 references/ 補充檔,關鍵的也讀)。
回傳一份繁體中文「能力卡清單」,每個 skill 一張卡:
- skill 名
- 觸發時機(什麼情境下用)
- 輸入(需要什麼前置產物,如 spec / plan 檔)
- 輸出(產生什麼,如 plan 檔路徑格式、worktree、PR)
- 流程要點(它內部的步驟與 gate,特別是哪些步驟要求「等使用者批准」)
- 與下一步的銜接(它結束時指示要 invoke 哪個 skill)
特別注意:writing-plans 的 plan 檔格式與存放路徑、subagent-driven-development 怎麼派 subagent 與兩階段 review、executing-plans 與 subagent-driven 的差異(何時選哪個)、verification-before-completion 的 done-gate 清單、finishing-a-development-branch 的收尾選項、using-git-worktrees 的隔離時機、dispatching-parallel-agents 的適用條件。
最後給一段「在全自主(無人值守)模式下,哪些『等使用者批准』的點可以如何處理」的客觀觀察(只描述 skill 原文怎麼寫,不要自行放寬)。`,
  },
  {
    key: 'mattpocock',
    prompt: `你是工具介面研究員。盤點 repo project-local skills 目錄 C:/Repos/active/iot/AI-BIM-governance/.claude/skills/ 下的 Matt Pocock 系列與其他輔助 skills(排除 gitnexus/ 子目錄與 generated/)。
先 ls 全部子目錄,讀每個 SKILL.md 的 frontmatter(name + description),然後深讀這幾個與開發管線最相關的全文:tdd, review, triage, to-issues, to-prd, diagnose, design-an-interface, request-refactor-plan, prototype, qa, grill-me, zoom-out, ubiquitous-language。
回傳繁體中文報告:
1. 全部 skills 的一行式清單(name — 一句話用途)
2. 上述深讀 skills 的能力卡(觸發時機/輸入/輸出/流程要點)
3. 重要脈絡:repo AGENTS.md 規定 Matt Pocock skills「僅 optional 輔助:issue / triage / domain-doc;不得當主線」。請標出哪些卡在「spec 已定、要精準實作到 merge」的流程中有實際輔助價值(例如 triage 處理 reviewer 發現、to-issues 把殘留工作開成 issue、diagnose 處理實作中遇到的 bug),哪些與主線重疊必須避免(例如 plan/build/ship/spec 類與 Superpowers 重疊)。`,
  },
  {
    key: 'gitnexus',
    prompt: `你是工具介面研究員。深讀 GitNexus 在本 repo 的使用介面:
1. C:/Repos/active/iot/AI-BIM-governance/docs/agents/gitnexus-usage.md
2. C:/Repos/active/iot/AI-BIM-governance/.claude/skills/gitnexus/ 下全部子 skill 的 SKILL.md(exploring / impact-analysis / debugging / refactoring / guide / cli)
3. C:/Repos/active/iot/AI-BIM-governance/.claude/skills/gitnexus-blast-radius/SKILL.md
回傳繁體中文報告:
- MCP tools 清單與各自時機(query / context / impact / detect_changes / rename / cypher),含參數要點
- 「改 symbol 前 impact、commit 前 detect_changes、HIGH/CRITICAL 先回報」的精確規範原文意涵
- index stale 的偵測與處理(npx gitnexus analyze / status;LadybugDB crash 復原存在 agent memory)
- pre-change vs post-change 兩種模式(gitnexus-blast-radius)
- 在多 task 連續實作的流程中,建議的最小成本模式(例如:每個 task 改前 impact 一次 vs 整批;何時需要 re-analyze)
注意:你只讀文件與 skill,不需要實際跑 MCP tools。`,
  },
  {
    key: 'gstack-browser-evidence',
    prompt: `你是工具可用性稽核員。任務:確認 gstack 與本 repo browser E2E evidence 的現實狀態,設計 fallback 鏈。
1. 讀 C:/Users/IOT/.claude/skills/gstack/SKILL.md 全文(了解它提供哪些操作:navigate/screenshot/interact/diff 等與 CLI 形態)
2. 實測可用性(只跑無害指令):bash 下試 'ls C:/Users/IOT/.claude/skills/gstack/bin/' 看有哪些執行檔;試跑 gstack bin 的 --version 或 --help(若是 bun script 會失敗,記錄錯誤訊息);'bun --version' 確認 bun 是否存在。
3. 盤點 repo 既有 browser E2E 慣例:ls C:/Repos/active/iot/AI-BIM-governance/web-viewer-sample/scripts/ 與 C:/Repos/active/iot/AI-BIM-governance/tests/e2e/(若存在),看用什麼引擎(Playwright? puppeteer? 自製?);看 C:/Repos/active/iot/AI-BIM-governance/artifacts/e2e/ 的檔名模式了解 evidence 慣例;grep web-viewer-sample/package.json 的 devDependencies 找 playwright/puppeteer。
4. claude-in-chrome MCP tools 是另一個 fallback(本 session 有,headless/cron 可能沒有)。
回傳繁體中文報告:
- gstack 目前可用性結論(可用/不可用+原因+啟用條件)
- repo 實際的 browser E2E 引擎與 evidence 慣例(指令、輸出路徑、截圖命名)
- 建議的 browser-evidence 引擎優先序 fallback 鏈(gstack → Playwright script → claude-in-chrome),每層的偵測指令與適用條件
- AGENTS.md 說 gstack 是「user-facing 驗收唯一證據來源」但 product-operability 文件接受「Playwright / Chrome E2E 截圖或 trace」— 指出這個現實落差,工作流文件該怎麼寫才誠實`,
  },
  {
    key: 'governance-gates',
    prompt: `你是流程治理研究員。深讀本 repo 對「從 spec 到 merge」全流程的硬性規範,輸出工作流必須內建的 gate 清單。
讀:
1. C:/Repos/active/iot/AI-BIM-governance/AGENTS.md(§0.1 開發管線/四工具不平權/anti-patterns/誠實鐵律/完成標準)
2. C:/Repos/active/iot/AI-BIM-governance/docs/agents/github-workflow.md
3. C:/Repos/active/iot/AI-BIM-governance/docs/agents/product-operability-and-script-contract.md
4. C:/Repos/active/iot/AI-BIM-governance/.claude/workflows/ship-item.md(既有 buffered auto-merge ship-cycle 權威程序)
5. C:/Repos/active/iot/AI-BIM-governance/.claude/workflows/fu-adversarial-verify-generic.js(既有對抗驗證 workflow 模式)
6. C:/Repos/active/iot/AI-BIM-governance/CLAUDE.md
回傳繁體中文報告:
1. 「spec→plan→實作→驗收→PR→merge」每一段的 MUST gates(逐條,註明出處檔案)
2. 四工具不平權的精確分工與 4 條 anti-patterns 原文
3. user-facing vs runtime/deploy vs 純 tooling/docs 三類變更的不同驗收表要求
4. ship-item 工作流的輸入(args)、gate 與輸出 — 新工作流如何直接 compose 它
5. 分支/worktree 紀律(不在 main 開發、worktree closeout 守衛)
6. 模型預算慣例(memory 提示:曾有「sonnet 讀 / opus 其餘」預算;本次使用者指定 Fable 5 max + Opus 4.8 max)
7. 既有 fu-adversarial-verify-generic.js 的可重用結構(它怎麼參數化、怎麼派 verifier)`,
  },
]

const readings = await parallel(READERS.map(r => () =>
  agent(r.prompt, { label: `read:${r.key}`, phase: 'DeepRead' })
))
const readingDigest = READERS.map((r, i) => `\n\n===== [${r.key}] =====\n${readings[i] || '(讀取失敗)'}`).join('')
log(`深讀完成:${readings.filter(Boolean).length}/5 份報告`)

phase('Design')
log('3 個 Opus 設計 agents 以不同視角產出工作流設計')

const TASK_BRIEF = `# 任務:為 AI-BIM-governance repo 設計「spec-to-done」可重複使用工作流

## 使用者需求(原文意涵)
當使用者與 AI 完成頭腦風暴(superpowers:brainstorming)產出一份 spec 後,AI coding agent 能依照此工作流「自主執行」,在適當時機運用/搭配/組合/混合 repo 內四套工具 — Superpowers + gstack + GitNexus + Matt Pocock — 精準無誤地完成該 spec。模型配置:Fable 5(max effort)+ Opus 4.8(max effort)搭配使用。

## 硬性脈絡(不可違反)
- AGENTS.md 固定管線:spec/prototype → Superpowers 拆 plan → GitNexus impact → 實作 → gstack(browser E2E)驗收 → GitNexus detect_changes → branch → PR → Actions → merge
- 四工具不平權:Superpowers=主線 plan/execution governance;GitNexus=impact/detect_changes;gstack=browser QA evidence(user-facing 驗收);Matt Pocock=僅 issue/triage/domain-doc 輔助
- 4 anti-patterns:Matt Pocock 不可取代 Superpowers plan;Superpowers 不可宣告 UI 完成而不跑 browser E2E;GitNexus 不可當產品設計依據;改 backend symbol 不可跳過 GitNexus impact
- 誠實鐵律:前端要真能操作;無 backend 處標 DEMO DATA / NOT BUILT / not observed;不偽裝 CI 綠;不 merge 真 P1/P2
- user-facing 完成標準 = 前端 route 可操作 + 預設 fixture + loading/success/failure/retry + runtime ID + browser E2E 截圖 evidence
- 不在 main 上開發;ship 段已有權威 named workflow「ship-item」(commit→push→PR→CI watch→reviewer buffer→三來源查 reviewer 發現→carry-forward→buffered auto-merge→closeout),新工作流應 compose 它而非重造
- HIGH/CRITICAL impact 規範要求「先回報再繼續」
- gstack 目前 bun 缺失不可用 → 需 fallback 鏈(Playwright / Chrome E2E)且文件要誠實標註
- 執行環境:Claude Code + Workflow tool(named workflows 放 .claude/workflows/*.js,skill 放 .claude/skills/<name>/SKILL.md);Workflow 內 subagent 無法問使用者;主對話可以問但 autonomous 模式應盡量不問
- Workflow script 限制:純 JS、不可呼叫時間與亂數 API(會破壞 resume,需由 args 傳入時間戳)、agent() 可帶 schema/model('fable'|'opus'|'sonnet'|'haiku')/isolation:'worktree'/agentType、支援 workflow() compose(一層)、支援 resumeFromRunId 重入

## 你的交付物(繁體中文)
一份完整工作流設計,必含:
1. 形態與檔案結構(哪些 SKILL.md、哪些 .claude/workflows/*.js,各自職責)
2. 端到端階段圖:從「spec 檔已存在」到「merged + evidence + 回報」,每階段:用什麼工具/skill、誰執行(主對話 or workflow subagent)、模型(fable/opus)、gate 條件、失敗處理
3. 四套工具各自的精確切入點(對照 anti-patterns 證明不犯規)
4. 自主性設計:哪些 gate 全自動、哪些必須停下回報使用者(HIGH/CRITICAL、merge carve-out、spec 矛盾)、停下時如何可重入(resume)
5. 參數化(args:spec 路徑、user-facing 與否、branch 名…)與可重複使用方式(下次怎麼一句話觸發)
6. 防錯設計:GitNexus stale、gstack 不可用、CI 異常(report generation failed 慣例)、plan 與 spec 偏離、subagent 失敗
7. token/模型預算:何處 fable、何處 opus、何處可平行`

const DESIGN_LENSES = [
  { key: 'sop-first', angle: '視角 A「SOP 文件主導」:以權威 SKILL.md 程序文件為核心(像 ship-item.md),主對話親自走每一步並在關鍵點派 subagent;Workflow scripts 只用於 fan-out 驗證(plan review、adversarial verify)。優先考慮:與 superpowers skills 原生流程的相容、人類可讀可維護、context 連續性。' },
  { key: 'phase-engines', angle: '視角 B「分階段引擎」:skill 入口文件 + 每個重階段一個 named workflow(如 plan-review、per-task implement、e2e-evidence、adversarial-review),主對話是指揮官,在 phase 之間做 gate 判斷與重入;ship 段 compose 既有 ship-item workflow。優先考慮:每段可獨立重跑(resume)、平行化收益最大化、失敗隔離。' },
  { key: 'max-autonomy', angle: '視角 C「極致自主」:單一 spec-to-done 大 workflow,args 給 spec 路徑一鍵跑到 merged;所有 gate 內建為自動判斷規則,僅在 repo 規範強制「先回報」處輸出 hold 狀態收尾。優先考慮:無人值守完成率、決定論編排、最少人工介面。' },
]

const designs = await parallel(DESIGN_LENSES.map(d => () =>
  agent(`${TASK_BRIEF}\n\n## 你的設計視角\n${d.angle}\n\n## 工具深讀情報(5 份)\n${readingDigest}\n\n請產出該視角下最強的完整設計。誠實面對視角弱點並給緩解。`,
    { label: `design:${d.key}`, phase: 'Design', model: 'opus' })
))
log(`設計完成:${designs.filter(Boolean).length}/3 份`)

phase('Judge')
const designDigest = DESIGN_LENSES.map((d, i) => `\n\n########## 設計方案 ${d.key} ##########\n${designs[i] || '(設計失敗)'}`).join('')

const JUDGE_LENSES = [
  { key: 'compliance', lens: 'repo 規範一致性:逐條對照 AGENTS.md 管線、4 anti-patterns、誠實鐵律、ship-item 紀律、HIGH/CRITICAL 回報義務、worktree 守衛。任何犯規都是重大扣分。' },
  { key: 'autonomy-resilience', lens: '自主可執行性與失敗復原:無人值守能跑多遠?GitNexus stale、gstack 缺 bun、CI report-generation-failed、subagent 半途死亡、context 耗盡後 resume — 每個故障點是否有可行恢復路徑?gate 停下後使用者一句話能否重入?' },
  { key: 'precision-evidence', lens: '精準完成 spec 的保證力:spec→plan 的忠實度怎麼驗?per-task 驗證夠不夠小步?browser evidence 是否真實不可偽?adversarial review 的覆蓋與誠實標註?「精準無誤」的最終 done-gate 是否可被客觀檢查?' },
]

const verdicts = await parallel(JUDGE_LENSES.map(j => () =>
  agent(`你是嚴格的工作流設計評審。以下是同一任務的 3 份設計方案與任務脈絡。\n\n${TASK_BRIEF}\n\n${designDigest}\n\n## 你的評審 lens\n${j.lens}\n\n輸出(繁體中文,固定格式):\n1. 每方案逐一:【方案 key】SCORE: x/10 — 3-6 行理由(指出具體段落的優劣)\n2. RANKING: 第一名 key > 第二名 > 第三名\n3. 給最終綜合設計的 3-5 條「必須吸收的元素」與 2-3 條「必須避免的陷阱」(可跨方案擷取)`,
    { label: `judge:${j.key}`, phase: 'Judge', model: 'opus' })
))
log(`評審完成:${verdicts.filter(Boolean).length}/3 份`)

return {
  readings: Object.fromEntries(READERS.map((r, i) => [r.key, readings[i] || null])),
  designs: Object.fromEntries(DESIGN_LENSES.map((d, i) => [d.key, designs[i] || null])),
  verdicts: Object.fromEntries(JUDGE_LENSES.map((j, i) => [j.key, verdicts[i] || null])),
}