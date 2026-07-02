---
name: spec-to-done
description: Use when a brainstormed spec already exists under docs/superpowers/specs/ and the user asks to autonomously drive it to a merged PR (e.g. 「跑 spec-to-done」「用 spec-to-done 跑 <spec 路徑>」), or when resuming a previously held spec-to-done run.
---

# spec-to-done — 指揮官手冊(主對話 SOP)

把一份**已經使用者核准的 spec**(brainstorming 產物)自主推進到 **merged PR + browser evidence + 四項回報**。
主對話 = 指揮官:只做 (a) phase 之間讀 StructuredOutput 比 gate 規則、(b) 配 args、(c) 命中強制停下點就輸出 hold block。苦工全在 named workflows 的 subagent(獨立 context)。

**Source of truth 聲明**:本檔是 spec-to-done 的唯一編排權威;`std-*.js` 檔頭指回本檔。merge 段權威是 `.claude/workflows/ship-item.md`(compose,不重造)。**本檔為 canonical**;`.codex/skills/spec-to-done/SKILL.md` 是 Codex 的 model-adapter copy(只把 haiku/sonnet/opus tier 映射到 GPT 模型與調整 helper 路徑、不改 gate)——修改本檔 phase / gate / HELD / resume / evidence / ship 語義時 MUST 同步該 copy,否則兩邊對同一 spec 的執行會分歧。

## 四套工具的唯一切入點(AGENTS.md anti-patterns 防線)

| 工具 | 切入點 | 防線 |
|---|---|---|
| Superpowers | P1 writing-plans 規格產 plan;P3 subagent-driven(TDD + 兩階段 review);done 宣稱前 verification-before-completion 精神 | plan 作者只能是 writing-plans 規格 |
| GitNexus | P1 尾段 impact 預掃(CRITICAL 早停);P3 每 task 改前 impact、每 commit 前 detect_changes;rename 一律 gitnexus_rename — **並列 codebase-memory 佐證、UNKNOWN/crash 時 fallback(見「知識圖譜雙源交叉驗證」節);第二意見只寫 note,不改任何 gate** | 只做 code intelligence,從不參與「要做什麼」的設計決策 |
| gstack(browser evidence) | P4 fallback 鏈:gstack browse → **Playwright(現行 default)** → claude-in-chrome | userFacing 時 P4 是硬 gate;P3 完成 ≠ done |
| Matt Pocock | **不進主線**。僅兩個 optional 支流:流程尾把 non-blocking findings 用 `to-issues` 開 backlog;發現多時 `triage` 分類 | `to-prd`/`grill-me`/`design-an-interface`/`prototype`/`tdd`/`review` 在本流程**無呼叫點**;缺 setup 時退回 `gh issue create` 或跳過 |

## 知識圖譜雙源交叉驗證(advisory,不改 gate)

兩套知識圖譜:**GitNexus = 合規主源**(所有 gate 的 risk/scope 判定唯一依據),**codebase-memory(`mcp__codebase-memory-mcp__*`)= advisory 第二意見**。三種用法皆加法式,絕不讓第二圖譜翻轉任何 gate:

- **(a) 並列佐證**:P1 impact 預掃 / P3 per-task impact 跑 GitNexus 同時,並列查 codebase-memory(`trace_path` inbound / `search_code`),差異寫 advisory note。
- **(b) UNKNOWN/crash fallback**:GitNexus 回 UNKNOWN 或 LadybugDB crash 時,用 codebase-memory 取第二意見寫 note 供指揮官 resume 判斷;**held 照常觸發、不自動解除**。
- **(c) 提速導航**:不限 spec-to-done——plan / 實作階段與一般互動對話的日常探索皆可優先 `search_graph(name_pattern)` / `get_code_snippet(qualified_name)` / `trace_path` 取代整檔 Read 與 `grep -r`(graph 查詢 ~500 token vs grep ~80K,見 `AGENTS.md` 陌生模組探索段);查無結果或有疑義時回退 GitNexus `query`/`context`。雙查同一 message 並列發出,不增 round-trip。

四不變式(寫進每個 impact prompt 的硬約束):
1. `overallRisk` / `perSymbol.risk` / `taskImpact.overallRisk` 只由 GitNexus 決定;codebase-memory 差異即使更大也不得升降 risk、不得寫 blockers。
2. codebase-memory 只寫 advisory 自由字串欄位(`perSymbol.note` / `taskImpact.note` / impl `concerns`)——被所有 gate 條件結構性忽略。
3. GitNexus 正常時不參與分級(只做 a/c);UNKNOWN/crash 才 fallback(b),結論仍 UNKNOWN → held 不變。
4. 方向:`trace_path inbound` ≡ `impact upstream`、`outbound` ≡ `downstream`。建模差異(節點數/術語/process)不報;只報「symbol+檔路徑對得上卻 caller 集不同」。**特例:GitNexus 回 0/LOW 但 codebase-memory 找到 caller(實測 deriveIntakeFromKey)→ note 醒目標『GitNexus 疑有盲點、手動覆核』,仍不自動翻 gate。**

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
       held='no_browser_evidence' 且 detail 顯示 backend stack 沒起 → 指揮官依 golden path 啟動：
         **先跑「啟動/重建 backend stack 前置」(見專節)清掉殘留 kit/conversion port,再跑** `.\scripts\deploy.ps1`
         (勿在 workflow 內自啟)後重跑 P4;否則 HELD(not observed 不得宣告 done)
P5 = Workflow({name:'fu-adversarial-verify-generic', args:{
        root: worktreeRoot, label: slug,
        findings: [...P3.finalReview.findings, ...((P4.evidence && P4.evidence.gaps) || [])],
        criticFocus: '通讀全 diff 找新誠實違規 / 行為 regression / spec-drift / 空測試 / DEMO DATA 漏標。'}})
     // DACS（arXiv:2604.07911）：P5 findings 一律壓成 registry {id, q:<一句話 claim ≤800 char>, suspectFile}，
     //   不灌 P3 finalReview 全文；fu-...js 對超長 q / 缺 id / 非字串 suspectFile 會 held:'bad_findings' fail-fast。
     //   （指揮官真截斷 q 為 doc 紀律；機械只驗入參合規。）
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
        - 若 impact 曾走 codebase-memory fallback(GitNexus UNKNOWN/crash)或有 `[xref]` 雙圖譜分歧 → 揭露「impact 由 codebase-memory 佐證;分歧 symbol(若有):…」(informational,非 gate)
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
| `impact_unavailable` | P1/P3 GitNexus 整體故障(含 overallRisk=UNKNOWN) | HELD;按 memory 復原 LadybugDB(`gitnexus status`+meta.json 為準)後 resume;復原前可用 codebase-memory trace_path 取暫時 blast-radius 寫 note 供 resume 判斷,**held 不因此解除** |
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

## 啟動 / 重建 backend stack 前置:host-native port 乾淨化(防 deploy Read-Host 卡死)

**鐵則**:跑 `.\scripts\deploy.ps1` 或 `.\scripts\dev\rebuild-test-deploy.ps1 -Build` **之前**,指揮官(主對話)
MUST 先從主工作區 root 跑本技能 helper 清掉佔住必要 host-native port 的殘留:

```
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\spec-to-done\ensure-host-native-ports-free.ps1
# 若 .codex 側或 user 級亦存在同名 helper，三份內容必須一致（.codex copy 定義了跨 host 優先序）
```

- **為什麼**:Kit 無 live reload / migration(docs/plans 鐵則 #4、D9——換 stage 只能 terminate+recreate)。殘留的
  `kit.exe`(49100 + spectator 49110…)/ conversion `python.exe`(49101)還佔著 port 時,`deploy.ps1` Phase 3 會把
  它們當『非 docker-forwarder stranger』丟給 `Read-Host 'y/N'`(`deploy.ps1:961`);spec-to-done 無人值守 + stdin
  非互動 → **無限阻塞、卡數小時**。`rebuild-test-deploy` 的 `git clean -fdx` 清掉 `scripts\.run\*.pid`,讓 deploy
  連自己上一輪起的 process 都認不得 → 必觸發。
- **helper 做什麼**:by-port(不依賴 `.pid` / workspace 路徑,跨主工作區 / worktree / 部署區 D:\ 通殺)tree-kill
  `kit/python/nvstreamer` owner → **釋放 Kit 對 storage/*.usd(c) 的檔案鎖**(根治殘留導致 viewer 切不動 / 轉檔覆寫失敗),
  輪詢等到全 FREE。對齊 CLAUDE.md 授權(停 blocking PID,不用 `-Force`/`-DryRun`);只動 host-native,docker plane 交給
  deploy.ps1 idempotent 處理。
- **退出碼處置**:`0` = port 全 FREE → 接著跑 deploy / rebuild。`1` = 逾時仍有殘留(helper 已列 PID,多為非 kit/python
  程序、helper 不擅殺)→ 對話回報該 PID + port 並 **HELD**,不可硬跑 deploy(會撞 Read-Host)。`-DetectOnly` 只偵測不停
  (啟動前先看一眼)。
- **範圍限制(誠實)**:只解 host-native port 這條 Read-Host;`deploy.ps1:989` 的 `.venv WRONG_VERSION` Read-Host 不在
  範圍(需重建 .venv 或 `-Force`,CLAUDE.md 禁),撞到 HELD 回報。spectator count 非預設 5 時須同步調整 helper 內 port 陣列。

## 模型預算(agent 三級 haiku/sonnet/opus + 指揮官/runtime-default=session;2026-06-11 降本,gates 不動)

> ⚠ 2026-06-15:**Claude Fable 5 官方停用**。本流程 agent 呼叫的 `model:` 欄位**從不傳 fable**(四級降本那輪已全改 haiku/sonnet/opus);唯一「跑 fable」的是指揮官(主對話)與 P5/P6 的 runtime-default(= session 模型,過去是 Fable)。session 改 **Opus 4.8 max** 後,這兩處自動跑 Opus 4.8 max,**無 .js 改動需要**——本表只更新描述。

| 位置 | 模型 | 品質守恆(誰兜底) |
|---|---|---|
| 指揮官(主對話) | 當前 session(**Opus 4.8 max**;Fable 5 已停用) | — |
| plan 解析(P3 Parse)、引擎偵測(P4 Probe) | haiku | 機械抽取/探測,錯誤顯性:抽壞 → implementer 立刻 BLOCKED;探錯 → E2E 起不來即 held |
| GitNexus impact 預掃 + per-task impact、機械性 task implementer(1-2 檔、步驟完整、非 user-facing)、P1 四軸 reviewer、P3 spec/quality reviewer(首審) | sonnet | impact 只是風險輸入(CRITICAL gate 在指揮官);機械 impl 有雙 review;四軸/雙 review 有 plan-fix(opus)+final-review(opus)+P5 critic 三層兜底 |
| plan 作者、非機械 implementer、NEEDS_CONTEXT/BLOCKED 升級重派、plan/spec/quality fix、fix-cycle + fix-verify(P5 修復)、final-review(全 diff 兜底)、evidence 執行+裁決(P4 誠實鐵律本體) | opus | 創造/修復/兜底層,**不降** |
| P5 fu-adversarial-verify-generic(verifier + critic)、P6 ship-item | runtime default(=session 模型,**現為 Opus 4.8 max**;Fable 5 停用前是 Fable) | P5=抓雷主力(實績:#206 三顆連環雷 + fix 自引 regression 全在 merge 前攔下);P6=端到端代理操作(git/gh/merge 判斷),sonnet 首跑即出程序偏差(#208:無視指定 prNumber、把主工作區 WIP 打包成獨立 PR merge),2026-06-12 回退 default,**兩者不降**(跑 spec-to-done 時 session 維持 Opus 4.8 max 即可) |

升級通道(自動,腳本內建):sonnet implementer 回 BLOCKED → 換 opus 重派;NEEDS_CONTEXT → opus 補脈絡重派。
平行:P1 四軸 review、P5 per-finding verifier 平行;**P3 implementer 嚴禁平行**(實作衝突)。
**降本原則**:hard gates(四軸 approved 條件/兩階段 review 閉合條件/P4 vertical slice 七項/P5 refute-by-default + critic/P6 buffered merge)一個不動;降級只發生在「產出被 ≥2 層更強 gate 複核」或「錯誤顯性必爆」的位置。等效性靠 gate 結構保證,非靠單點模型強度。

## 誠實鐵律(本流程的落實)

- evidence **綁產物不綁工具品牌**:browser 真實操作截圖 + trace + summary JSON 落主工作區 `artifacts/e2e/<slug>-*`(trace 也要 copy 出 worktree,closeout 會清掉);3D/真實 IFC 類另放一份 summary+抽樣截圖到 worktree `docs/evidence/<slug>/`(tracked,隨 PR 可審,product-operability §5)。engine 記真實值,**不得謊報引擎**。
- 現狀:gstack NEEDS_SETUP(缺 bun;啟用 = 裝 bun + `cd ~/.claude/skills/gstack && ./setup`)→ **default 引擎 = Playwright**。gstack SKILL 的「NEVER use claude-in-chrome」是 gstack 可用時的內規,不可用時第 3 層合法。
- `web-viewer-sample/scripts/verify-*.mjs` 是 source-level check,**不可充當 browser evidence**。
- Vertical slice 七項(P4 與 chrome 手動路徑共用同一把尺):UI route 可達 → 明確按鈕 → default fixture → 真實 backend API(mock 處已標 DEMO DATA)→ runtime ID 可見 → loading/success/failure/retry 可見 → 截圖/trace 已落檔。3D 加驗:GPU-backed review session + stage truth matched=true;不得宣稱零 GPU 完成 3D。
- 寫任何「環境降級 / 無 GPU / pending」前先查證(`nvidia-smi` / port / health);容器受限 ≠ host 無能力(harness 佔位是刻意選用、非被迫降級)。
- 無 backend 處 UI 標 `DEMO DATA` / `NOT BUILT` / `not observed`;不偽裝 CI 綠;不 merge 真 P1/P2。

## 已知限制與衝突(誠實註記)

1. AGENTS.md 寫 gstack 是「唯一驗收證據來源」,現實是 Playwright(歷史 evidence 全為 Playwright/Chrome 產)。本流程採「綁產物不綁品牌」;改字面需另開 docs PR。github-workflow.md 7 欄表的「gstack E2E command」欄同理 — 填實際引擎指令並括註引擎名。
2. PR body 用 product-operability §4 的 10 列表;P7 回報用 AGENTS.md 7 欄表 — 兩版並存是權威檔既有張力,本流程兩處各用各的。
3. commit trailer:std-*.js 內的 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 是 **harness attribution 文字、非模型調用**(改它不影響哪個模型實際跑;只要 session 是 Opus 4.8 max,agent 就跑 Opus 4.8)。Fable 5 停用後此 trailer 字面已是 legacy;要不要連同 harness 規則一起改成 Opus 4.8 屬另一個獨立決策(改 trailer 須與 harness commit 規則同步,否則 repo 出現雙 trailer)。squash 後實質影響極小。
4. GitNexus detect-changes 在 linked worktree 看不到 staged(已知坑)→ implementer fallback `git diff --name-only --cached` 並記 `detectVerdict='fallback'`,PR body 揭露;完全失敗記 `fail`,同 run 3 次 → held。
5. pr-review-agent 兩種非內容故障:`missing_openspec`(P6 前置 a 預防)與`report generation failed`(工具整體故障,非 required check,由 ship-item 判斷層次處置)。
6. 本組檔案已 whitelist tracked(`.gitignore:37` `!.claude/skills/spec-to-done/`、`:42` `!.claude/workflows/`;含 SKILL.md、std-*.js、ship-item、本目錄 `ensure-host-native-ports-free.ps1`),隨 PR 進 git/CI。pr-review-agent 對所有 PR 都會跑(#202 的 paths-ignore 已移除,`pr-review-agent.yml` 現無 paths 過濾),且是 main branch protection 的 required check(11 項之一;2026-07-02 以 gh api 親查)——`.claude/**` 變更同樣受 review 與 AI Coding Governance body-evidence 表約束。
7. P1 四軸 review 第二輪起只重審上輪未過的軸(fixer 改 plan 可能影響已過軸)— 由 P3 per-task spec review 與 P5 critic 兜底,屬已知取捨。

## 維運注意事項

1. routing.json 改動後須跑 `.venv\Scripts\python.exe scripts/gen_routing.py` 重生各 std-*.js 的 ROUTING 區塊，並 re-save 受影響 workflow 讓 harness reload；禁止 workflow run 中途執行 codegen。
