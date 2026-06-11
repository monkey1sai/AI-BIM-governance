---
name: spec-to-done
description: Use when a brainstormed spec already exists under docs/superpowers/specs/ and the user asks to autonomously drive it to a merged PR (e.g. 「跑 spec-to-done」「用 spec-to-done 跑 <spec 路徑>」), or when resuming a previously held spec-to-done run.
---

# spec-to-done — 指揮官手冊(主對話 SOP)

把一份**已經使用者核准的 spec**(brainstorming 產物)自主推進到 **merged PR + browser evidence + 四項回報**。
主對話 = 指揮官:只做 (a) phase 之間讀 StructuredOutput 比 gate 規則、(b) 配 args、(c) 命中強制停下點就輸出 hold block。苦工全在 named workflows 的 subagent(獨立 context)。

**Source of truth 聲明**:本檔是 spec-to-done 的唯一編排權威;`std-*.js` 檔頭指回本檔。merge 段權威是 `.claude/workflows/ship-item.md`(compose,不重造)。

## 四套工具的唯一切入點(AGENTS.md anti-patterns 防線)

| 工具 | 切入點 | 防線 |
|---|---|---|
| Superpowers | P1 writing-plans 規格產 plan;P3 subagent-driven(TDD + 兩階段 review);done 宣稱前 verification-before-completion 精神 | plan 作者只能是 writing-plans 規格 |
| GitNexus | P1 尾段 impact 預掃(CRITICAL 早停);P3 每 task 改前 impact、每 commit 前 detect_changes;rename 一律 gitnexus_rename | 只做 code intelligence,從不參與「要做什麼」的設計決策 |
| gstack(browser evidence) | P4 fallback 鏈:gstack browse → **Playwright(現行 default)** → claude-in-chrome | userFacing 時 P4 是硬 gate;P3 完成 ≠ done |
| Matt Pocock | **不進主線**。僅兩個 optional 支流:流程尾把 non-blocking findings 用 `to-issues` 開 backlog;發現多時 `triage` 分類 | `to-prd`/`grill-me`/`design-an-interface`/`prototype`/`tdd`/`review` 在本流程**無呼叫點**;缺 setup 時退回 `gh issue create` 或跳過 |

## 觸發與 args(主對話填;workflow 不自取)

使用者句型:「用 spec-to-done 跑 `docs/superpowers/specs/<檔>.md`,user-facing」。主對話補齊:

```
specPath     spec 絕對路徑(必填;不存在 → 停,要路徑)
slug         spec 檔名去掉日期前綴與 -design 後綴(例 2026-06-15-demo-feature-design.md → demo-feature)
dateStamp    今天 YYYY-MM-DD(主對話算;workflow 內禁時鐘/亂數 API)
branch       feat/<slug>(或 fix/ chore/;絕不在 main 開發)
userFacing   spec 是否含使用者可操作介面(看 spec;不確定當 true)
worktreeRoot worktree 的「絕對路徑」(P0 建立後填;std-*.js 都用它串路徑,不可相對)
```

## P0 指揮官開場(主對話親自做)

1. 讀 spec 全文;自檢 placeholder / 內部矛盾 / scope 歧義 → **spec 矛盾 = HELD**(spec 是唯一忠實源,agent 不得擅自補)。
2. 偵測隔離:`git rev-parse --git-dir` ≠ `--git-common-dir` → 已在 linked worktree,直接用(絕不疊加)。在主 checkout 時:
   - `.worktrees/<slug>/` 已存在(前次 held 殘留)→ **沿用**,worktreeRoot 指向它,確認 branch 正確即可。
   - 否則:`git fetch origin +refs/heads/main:refs/remotes/origin/main` → `git worktree add .worktrees/<slug> -b <branch> origin/main`。
   - worktree 不帶 ignored/local artifact(storage/ 真 IFC、node_modules、.venv)— 讀主工作區絕對路徑或 worktree 內 `npm install`。
3. TodoWrite 建 P1–P7。**每次 Workflow 呼叫的工具回應都有「Run ID: wf_...」,把它記進 TodoWrite 與 state 檔**(見 Resume)。

## 編排(可複製;gate 讀 StructuredOutput 布林/枚舉)

> ⚠ Workflow 的 `args` 必須是 JSON object,**不可序列化成字串**(字串會讓腳本取欄位全 undefined;
> 腳本雖有 parse 防護與 `bad_args` fail-fast,仍應正確傳 object)。收到 `held='bad_args'` = args 傳壞,修 args 重呼。

```
P1 = Workflow({name:'std-plan', args:{specPath, slug, dateStamp, branch, worktreeRoot, userFacing,
               acknowledgedCriticalSymbols:[]}})
     gate: P1.ok === true 才前進;P1.held → 查「held 對照表」
     P1.impact.overallRisk==='HIGH' 或 P1.impact.blockers 非空 → 本訊息中明確回報 blast radius
       (direct callers / processes / risk)後繼續;補強策略之後寫進 PR body
P3 = Workflow({name:'std-implement', args:{planPath:P1.planPath, worktreeRoot, branch, specPath,
               userFacing, startTaskIndex:0, maxFixRounds:2, acknowledgedCriticalSymbols:[],
               mode:'tasks', fixFindings:[]}})
     gate: P3.held → 查「held 對照表」;P3.ok===true(全 task 完成)才前進
     P3.highRiskNotes 非空 → 對話中轉述(臨時 HIGH 的事後回報)並列入 PR body 補強段
     P3.finalReviewOk===false → 不是死路:findings 照樣進 P5 對抗複驗定真假
P4 = userFacing ? Workflow({name:'std-evidence', args:{worktreeRoot, slug, specPath, planPath}})
                : {ok:true, skipped:true}
     gate: P4.ok
       held='no_browser_engine' → interactive session:主對話以 claude-in-chrome 親自取證(第 3 層;
         按本檔「Vertical slice 七項」逐項驗、產物落同樣 artifacts/e2e/ 慣例、自組 gaps:[{id,q}]、
         engine 誠實記 chrome)後重新裁決;headless/cron 無此層 → HELD
       held='no_browser_evidence' 且 detail 顯示 backend stack 沒起 → 指揮官依 golden path
         啟動(.\scripts\deploy.ps1;勿在 workflow 內自啟)後重跑 P4;否則 HELD(not observed 不得宣告 done)
P5 = Workflow({name:'fu-adversarial-verify-generic', args:{
        root: worktreeRoot, label: slug,
        findings: [...P3.finalReview.findings, ...((P4.evidence && P4.evidence.gaps) || [])],
        criticFocus: '通讀全 diff 找新誠實違規 / 行為 regression / spec-drift / 空測試 / DEMO DATA 漏標。'}})
     infra 分支(與內容性不過分開):P5===null 或 P5.critic===null 或 P5.verdicts.length !== 送入
       findings 數(verifier 回 null 被 filter 掉 = 有 finding 沒驗到,不可視為通過)
       → 重呼 P5 一次(resumeFromRunId);仍 infra 失敗 → HELD(視同 reviewer_agent_failed)
     gate(內容性): P5.not_closed.length===0 && P5.new_issues.length===0 && P5.critic.overall_safe
     不過 → 修復迴圈(有真實通道):
       Workflow({name:'std-implement', args:{...同 P3, mode:'fix',
                 fixFindings:[...P5.not_closed, ...P5.new_issues, ...P5.critic.issues 轉成 {id,q}]}})
       → 重跑 P5(同樣檢查);≥2 輪仍不閉合 → HELD
P6 前置(指揮官親自做,解決 PR body 資料通道):
     a. openspec gate:diff 觸及 scripts/ bim-review-coordinator/ web-viewer-sample/
        bim-streaming-server/ tests/ .github/workflows 時,pr-review-agent 會因無 active
        openspec change 掛 missing_openspec blocker → 在 worktree 建最小 openspec/changes/<slug>/
        (proposal.md + tasks.md,對應本 spec)並 commit
     b. push:git push -u origin <branch>
     c. gh pr create --base main(繁中):body 含 ──
        - user-facing:product-operability §4 的 10 列 Frontend 驗收表(資料來自 P4.evidence 的
          screenshots/runtimeIds/engine + **Read 其 summaryJson 檔**補齊 route/buttons/fixture/
          backend API/E2E command/manual steps)
        - P1.impact HIGH 的補強策略、P3.highRiskNotes
        - P3.detectFallbackTasks / detectFailTasks / fixDetectVerdicts(非 pass 項)的 GitNexus fallback 揭露
        - 動 runtime/deploy 時附 Deploy Path 表;純 tooling/docs 註明不適用
        記下 prNumber
P6 = Workflow({name:'ship-item', args:{branch, prNumber:<前置 c 的號碼>, userFacing}})
     consume:
       P6===null → 對話回報 ship agent 失敗,重呼一次;仍 null → HELD
       P6.merged===true → P7
       P6.heldReason 屬 production P1/P2 → fix 迴圈(同 P5 的 mode:'fix',fixFindings=該 P1/P2)
         → 重呼 ship-item 帶同一 prNumber(沿用 PR 重跑 buffer cycle)
       P6.heldReason 屬 consent carve-out(revert-*/release/hotfix/破壞性對外)→ HELD(須使用者明確同意)
       其他(CI 持續紅、merge conflict、report generation failed 類工具故障)→ 對話回報 +
         依 ship-item.md 判斷層次處置;不可只看 check 狀態 merge
P7 = 主對話回報四項:改了哪些 tracked files / 跑了哪些最小驗證 / 哪些測試沒跑及原因 / 已知風險
     + mergeCommit + evidence 路徑 + AGENTS.md 7 欄 Frontend 表(回報用;PR body 已用 10 列表)
```

P1 內含 plan 四軸 review(Completeness/Spec Alignment/Task Decomposition/Buildability);P3 內含每 task 兩階段 review(spec 先 quality 後)— 都在 workflow 內自動修迴圈,不回主對話。

## held 對照表(workflow 回傳的全部 held 值與處置)

| held | 來源 | 指揮官處置 |
|---|---|---|
| `bad_args` | 任一 std-* / fu-generic(必填 args 缺或被字串化) | 修正 args 為正確 object 後重呼(非流程問題) |
| `plan_author_failed` / `plan_parse_failed` / `reviewer_agent_failed` | P1/P3 infra(agent 回 null) | 重呼該 workflow 一次(resumeFromRunId);再失敗 → HELD |
| `plan_not_aligned` | P1 修 2 輪仍不過 | **一律 HELD**(附 spec 矛盾診斷 specConflict;不自動重跑 P1 — 強制停下點,不可自動繞) |
| `critical_impact` | P1 預掃 / P3 per-task | HELD(CRITICAL 阻擋)。使用者選:(a) 拆 change → 修 spec/plan 後重跑;(b) reviewer sign-off → resume 時把該 symbols 放進 `acknowledgedCriticalSymbols`,gate 對已 ack 的 symbol 放行(這是唯一解鎖通道) |
| `impact_unavailable` | P1/P3 GitNexus 整體故障(含 overallRisk=UNKNOWN) | HELD;按 memory 復原 LadybugDB(`gitnexus status`+meta.json 為準)後 resume |
| `plan_error_at_task` | P3 implementer 判 plan 錯 | HELD(附 blockedDetail);使用者核可後修 plan 檔 → resume P3 帶 startTaskIndex=該 task(P3 會重新 Parse 修過的 plan) |
| `spec_review_not_closing` / `quality_review_not_closing` | P3 修 N 輪仍不過 | HELD(附 gaps/qualityDetail)— 真 P1/P2 修不閉合,不可繞 |
| `detect_changes_repeatedly_failing` | P3 同 run 內 detectVerdict=fail 達 3 次 | HELD;指揮官 `gh issue create`(標題含 branch + 失敗摘要),等修復或 reviewer sign-off |
| `no_browser_engine` / `no_browser_evidence` | P4 | 見編排 P4 gate(第 3 層 / stack 啟動 / HELD) |
| `ship_blocked` 類(由 heldReason 文字) | P6 | 見編排 P6 consume |

## 強制停下點(repo 規範明文,不可自動繞)

spec 矛盾(P0/P1)、GitNexus CRITICAL(未 ack)、browser evidence not observed、真 P1/P2 修不閉合、ship consent carve-out、工具反覆故障(detect 3 次 / GitNexus 不可復原)。
HIGH 不是停下點:在對話中明確回報 blast radius 後繼續,PR body 必寫補強策略(P6 前置 c 是執行通道)。

**Hold block 固定格式**(輸出後停;同時 append 到 state 檔):

```
HELD@P<n> | reason=<held 值> | spec=<specPath> | slug=<slug> | userFacing=<bool> | dateStamp=<..>
| branch=<..> | worktree=<絕對路徑> | planPath=<..> | taskIndex=<..> | prNumber=<..>
| runIds=<P1:wf_.. P3:wf_.. ...> | 診斷=<specConflict/gaps/blockedDetail 摘要> | 需要使用者決定:<具體選項>
```

## Resume(使用者一句話重入;支援跨 session)

- **State 檔(durable,跨 session 唯一座標)**:每個 phase 完成或 HELD 時,把上方 hold block 格式的一行 append 到主工作區 `artifacts/spec-to-done/<slug>-state.md`(TodoWrite 與 transcript 不跨 session,不可依賴)。
- 「繼續 spec-to-done」→ 讀 state 檔最後一行還原全部 args → 只重跑該 phase:`Workflow({name:<phase>, args:{...還原}, resumeFromRunId:<該 phase runId>})`(resumeFromRunId 讓已完成的 agent 呼叫吃 cache,只重跑未完成段)。
- 前序產物(plan 檔、commits、evidence)都在 git/磁碟,不重做;P3 錨點 = startTaskIndex(per-task commit 訊息規定前綴 `task#N:`,崩潰時可從 git log 重建);P6 帶同一 prNumber(ship-item 沿用既有 PR,不重複 create)。
- 時間戳一律由主對話經 args 注入(dateStamp);workflow 內禁時鐘/亂數 API。

## 模型預算(四級配置 haiku/sonnet/opus/fable;2026-06-11 降本調整,gates 不動)

| 位置 | 模型 | 品質守恆(誰兜底) |
|---|---|---|
| 指揮官(主對話) | 當前 session(Fable) | — |
| plan 解析(P3 Parse)、引擎偵測(P4 Probe) | haiku | 機械抽取/探測,錯誤顯性:抽壞 → implementer 立刻 BLOCKED;探錯 → E2E 起不來即 held |
| GitNexus impact 預掃 + per-task impact、機械性 task implementer(1-2 檔、步驟完整、非 user-facing)、P1 四軸 reviewer、P3 spec/quality reviewer(首審)、P6 ship-item | sonnet | impact 只是風險輸入(CRITICAL gate 在指揮官);機械 impl 有雙 review;四軸/雙 review 有 plan-fix(opus)+final-review(opus)+P5 critic 三層兜底;ship 是程序性 buffered cycle |
| plan 作者、非機械 implementer、NEEDS_CONTEXT/BLOCKED 升級重派、plan/spec/quality fix、fix-cycle + fix-verify(P5 修復)、final-review(全 diff 兜底)、evidence 執行+裁決(P4 誠實鐵律本體) | opus | 創造/修復/兜底層,**不降** |
| P5 fu-adversarial-verify-generic(verifier + critic) | runtime default(=session 模型) | 抓雷主力(實績:#206 三顆連環雷 + fix 自引 regression 全在 merge 前攔下),**不動** |

升級通道(自動,腳本內建):sonnet implementer 回 BLOCKED → 換 opus 重派;NEEDS_CONTEXT → opus 補脈絡重派。
平行:P1 四軸 review、P5 per-finding verifier 平行;**P3 implementer 嚴禁平行**(實作衝突)。
**降本原則**:hard gates(四軸 approved 條件/兩階段 review 閉合條件/P4 vertical slice 七項/P5 refute-by-default + critic/P6 buffered merge)一個不動;降級只發生在「產出被 ≥2 層更強 gate 複核」或「錯誤顯性必爆」的位置。等效性靠 gate 結構保證,非靠單點模型強度。

## 誠實鐵律(本流程的落實)

- evidence **綁產物不綁工具品牌**:browser 真實操作截圖 + trace + summary JSON 落主工作區 `artifacts/e2e/<slug>-*`(trace 也要 copy 出 worktree,closeout 會清掉);3D/真實 IFC 類另放一份 summary+抽樣截圖到 worktree `docs/evidence/<slug>/`(tracked,隨 PR 可審,product-operability §5)。engine 記真實值,**不得謊報引擎**。
- 現狀:gstack NEEDS_SETUP(缺 bun;啟用 = 裝 bun + `cd ~/.claude/skills/gstack && ./setup`)→ **default 引擎 = Playwright**。gstack SKILL 的「NEVER use claude-in-chrome」是 gstack 可用時的內規,不可用時第 3 層合法。
- `web-viewer-sample/scripts/verify-*.mjs` 是 source-level check,**不可充當 browser evidence**。
- Vertical slice 七項(P4 與 chrome 手動路徑共用同一把尺):UI route 可達 → 明確按鈕 → default fixture → 真實 backend API(mock 處已標 DEMO DATA)→ runtime ID 可見 → loading/success/failure/retry 可見 → 截圖/trace 已落檔。3D 加驗:GPU-backed review session + stage truth matched=true;不得宣稱零 GPU 完成 3D。
- 無 backend 處 UI 標 `DEMO DATA` / `NOT BUILT` / `not observed`;不偽裝 CI 綠;不 merge 真 P1/P2。

## 已知限制與衝突(誠實註記)

1. AGENTS.md 寫 gstack 是「唯一驗收證據來源」,現實是 Playwright(歷史 evidence 全為 Playwright/Chrome 產)。本流程採「綁產物不綁品牌」;改字面需另開 docs PR。github-workflow.md 7 欄表的「gstack E2E command」欄同理 — 填實際引擎指令並括註引擎名。
2. PR body 用 product-operability §4 的 10 列表;P7 回報用 AGENTS.md 7 欄表 — 兩版並存是權威檔既有張力,本流程兩處各用各的。
3. commit trailer:本流程 commit 統一 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`(harness 規則);ship-item.md 釘 Opus 4.8 字樣 — 已知雙標準,squash 後實質影響極小。
4. GitNexus detect-changes 在 linked worktree 看不到 staged(已知坑)→ implementer fallback `git diff --name-only --cached` 並記 `detectVerdict='fallback'`,PR body 揭露;完全失敗記 `fail`,同 run 3 次 → held。
5. pr-review-agent 兩種非內容故障:`missing_openspec`(P6 前置 a 預防)與`report generation failed`(工具整體故障,非 required check,由 ship-item 判斷層次處置)。
6. 本組檔案(SKILL.md + 3 支 std-*.js)目前被 .gitignore 蓋住(repo policy:.claude/ 預設 local-only);要 commit / 跨機共享須使用者明確同意加 whitelist(`!` 例外,如 ship-item 先例)。
7. P1 四軸 review 第二輪起只重審上輪未過的軸(fixer 改 plan 可能影響已過軸)— 由 P3 per-task spec review 與 P5 critic 兜底,屬已知取捨。
