// Workflow-tool 腳本(由 Workflow({name:'std-evidence', args}) 執行),非 standalone Node 程式。
// 編排權威見 .claude/skills/spec-to-done/SKILL.md(本檔為 spec-to-done P4:browser evidence,僅 userFacing spec 執行)。
// 誠實鐵律:evidence 綁產物不綁工具品牌;engine 欄位記真實值;三層引擎全不可用或 slice 不綠 = not observed,不得宣告 done。
export const meta = {
  name: 'std-evidence',
  description: 'spec-to-done P4:偵測 browser 引擎(gstack→Playwright)→ 跑 E2E 收 evidence(截圖/trace 落 artifacts/e2e/)→ vertical slice 裁決。not observed 即 held。',
  phases: [
    { title: 'Probe', detail: 'fable 偵測引擎可用性(gstack browse binary / Playwright deps)', model: 'fable' },
    { title: 'Evidence', detail: 'opus 跑 E2E、收 evidence、逐項裁決 vertical slice', model: 'opus' },
  ],
}

// args 防護:harness 可能把 args 序列化成 JSON 字串,字串就 parse;必填缺直接 fail-fast
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const ROOT = A.worktreeRoot
const SLUG = A.slug
const SPEC_PATH = A.specPath
const PLAN_PATH = A.planPath
{
  const missing = [['worktreeRoot', ROOT], ['slug', SLUG], ['specPath', SPEC_PATH], ['planPath', PLAN_PATH]].filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) return { ok: false, held: 'bad_args', missing }
}

const PROBE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'detail'],
  properties: {
    engine: { type: 'string', enum: ['gstack', 'playwright', 'none'] },
    detail: { type: 'string' },
  },
}

const EVIDENCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verticalSliceOk', 'engine', 'screenshots', 'summaryJson', 'runtimeIds', 'notObserved', 'gaps'],
  properties: {
    verticalSliceOk: { type: 'boolean' },
    // enum 含 'chrome' 是刻意:SKILL P4 第 3 層(主對話 claude-in-chrome 手動取證)與本 workflow 共用同一份 summary 契約;本 workflow 內 evidence agent 只該填 probe 給的 gstack/playwright
    engine: { type: 'string', enum: ['gstack', 'playwright', 'chrome'] },
    screenshots: { type: 'array', items: { type: 'string' } },
    summaryJson: { type: ['string', 'null'] },
    runtimeIds: { type: 'array', items: { type: 'string' } },
    notObserved: { type: 'array', items: { type: 'string' } },
    gaps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'q'],
        properties: { id: { type: 'string' }, q: { type: 'string' } },
      },
    },
  },
}

phase('Probe')
log(`std-evidence:slug=${SLUG} worktree=${ROOT}`)

const probe = await agent(`你是 browser 引擎可用性偵測員。依序檢查(bash),回報第一個可用引擎:
1. gstack browse(NEEDS_SETUP 表示缺 bun 未 build,直接跳下一層,不要嘗試安裝 bun):
   B="$HOME/.claude/skills/gstack/browse/dist/browse"
   [ -x "$B" ] && echo READY || echo NEEDS_SETUP
2. Playwright(repo 事實標準)。依序跑,worktree 缺 node_modules 時先在 ${ROOT}/web-viewer-sample 跑 npm install(失敗才放棄);瀏覽器 cache 缺 chromium-* 時跑 npx playwright install chromium 補:
   node --version
   ls "${ROOT}/web-viewer-sample/node_modules/.bin/" | grep -i playwright
   ls "$LOCALAPPDATA/ms-playwright"
3. 順帶檢查(結果寫進 detail,不影響 engine 判定):
   curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8004/
   (coordinator 沒回 2xx/3xx 就在 detail 標「stack_down」——E2E 打真 API 需要 backend,指揮官會依 golden path 啟動;curl 被環境擋時改用 python urllib 等價探測,不可因工具被擋就略過此檢查)
   netstat -ano | grep ':5180'
   (Playwright webServer strictPort 不 reuse,:5180 被殘留 vite 占用會起不來;占用時在 detail 標 PID)
兩層引擎都不可用 → engine=none。
回傳 StructuredOutput:engine(gstack/playwright/none,取第一個 READY 的)、detail(各層實測結果、stack_down/port 占用註記)。`,
  { label: 'probe:engine', phase: 'Probe', model: 'fable', schema: PROBE_SCHEMA })

if (!probe || probe.engine === 'none') {
  return {
    ok: false, held: 'no_browser_engine',
    detail: probe ? probe.detail : 'probe agent 失敗(回 null)',
    note: 'interactive session 時主對話可改用 claude-in-chrome MCP 親自取證(第 3 層 fallback),evidence 落同樣產物與命名後重新裁決;headless/cron 無此層。',
  }
}
log(`engine=${probe.engine}(${probe.detail.slice(0, 120)})`)

phase('Evidence')

const ev = await agent(`你是 browser evidence 執行與裁決員。用「${probe.engine}」引擎為本 feature 取得 user-facing 驗收證據,並誠實裁決 vertical slice。
工作目錄:${ROOT};spec:${SPEC_PATH};plan:${ROOT}/${PLAN_PATH}

執行:
1. 找出本 feature 的 E2E 入口:git diff origin/main...HEAD --name-only 過濾 web-viewer-sample/e2e/ 下新增/修改的 spec;plan 的 browser E2E task 也列了要跑的 spec/route。
2. ${probe.engine === 'playwright'
    ? `跑:cd ${ROOT}/web-viewer-sample && npx playwright test <本 feature 的 spec 檔>(config 自起 vite :5180、trace/screenshot 全開;輸出大時導向檔案再 grep 關鍵行)。`
    : `用 gstack browse CLI(~/.claude/skills/gstack/browse/dist/browse)goto 目標 route、互動、screenshot(操作見 gstack SKILL.md)。`}
3. evidence 落主工作區(git rev-parse --git-common-dir 的上一層)的 artifacts/e2e/:截圖命名 ${SLUG}-<route|步驟>.png、Playwright trace/test-results 整批 copy 到 artifacts/e2e/${SLUG}-trace/,並寫成對的 ${SLUG}-summary.json(routes、按鈕、fixture、runtime IDs、結果、engine 真實值)。worktree 會被 closeout 清掉,evidence(含 trace)不可只留在 worktree。
3b. 3D/真實 IFC viewer 類 spec(有 stage truth / review session 的)另放一份 summary JSON + 抽樣截圖到 worktree 的 docs/evidence/${SLUG}/(tracked,隨 PR 可審;product-operability §5 慣例,大型輸出只留 summary 與抽樣)。

裁決 vertical slice(逐項,缺一即不綠):
UI route 可達 → 明確按鈕可點 → default fixture(不要求使用者手動 curl)→ 打真實 backend API(不是 mock;mock 處須已標 DEMO DATA)→ 看到 runtime ID(job_id / model_version_id / review_session_id / prim_path / ifc_guid 之類)→ loading/success/failure/retry 狀態可見 → 截圖/trace 已落檔。
3D/viewer 類加驗:GPU-backed review session、stage truth matched=true(expected vs loaded artifact URL);黑畫面可能是相機框取非 pipeline 失敗,要看 stage truth 而非只看像素。不得宣稱零 GPU 完成 3D。

誠實鐵律:跑不到/看不到的項目列進 notObserved(原文標 not observed),不准畫成 fail 也不准略過;engine 填真實用的引擎;測試失敗就如實回報 verticalSliceOk=false。
回傳 StructuredOutput:verticalSliceOk、engine、screenshots[](絕對路徑)、summaryJson(路徑)、runtimeIds[]、notObserved[]、gaps[](id 用 e1/e2/...,q = 待對抗驗證的疑慮:哪個環節證據薄弱+宣稱的失效模式;沒有就空陣列)。`,
  { label: `evidence:${SLUG}`, phase: 'Evidence', model: 'opus', schema: EVIDENCE_SCHEMA })

if (!ev) return { ok: false, held: 'no_browser_evidence', detail: `evidence agent 失敗(回 null);probe:${probe.detail}` }

log(`evidence:engine=${ev.engine} sliceOk=${ev.verticalSliceOk} shots=${ev.screenshots.length} notObserved=${ev.notObserved.length}`)

// 誠實鐵律在程式層 enforce:宣稱 slice 綠但沒截圖或沒 summary JSON 落檔 = 不可信
// (summaryJson 是 P6 前置 PR 10 列表的資料來源,缺它通道會斷在 P6)
// detail 帶 probe 結果(含 stack_down / port 占用註記),SKILL P4 gate 靠它分流 golden-path 重啟
if (!ev.verticalSliceOk || ev.notObserved.length > 0 || ev.screenshots.length === 0 || !ev.summaryJson) {
  return { ok: false, held: 'no_browser_evidence', evidence: ev, detail: probe.detail }
}

return { ok: true, engine: ev.engine, evidence: ev }
