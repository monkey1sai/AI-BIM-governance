---
name: spec-to-done
description: Use only when the user explicitly invokes spec-to-done (or explicitly requests the full Superpowers lifecycle), or supplies or identifies an approved spec and asks for autonomous progress to a merged PR; also use when explicitly resuming a held spec-to-done run. Do not trigger from "實作 spec", "完成需求", or "使用 agents" alone.
---

# spec-to-done — 指揮官手冊(主對話 SOP)

把一份**已經使用者核准的 spec**(brainstorming 產物)自主推進到 **merged PR + browser evidence + 四項回報**。
主對話 = 指揮官:只做 (a) phase 之間讀 StructuredOutput 比 gate 規則、(b) 配 args、(c) 命中強制停下點就輸出 hold block。苦工全在 named workflows 的 subagent(獨立 context)。

本技能是 Lane S 的明確 opt-in 流程；不得因任務非平凡、文字含「完成」、changed path 位於 code/tests，或模型主觀判斷「適合完整流程」而自行啟動。

**Source of truth 聲明**:本檔是 spec-to-done 的程序編排權威;`std-*.js` 檔頭指回本檔。merge 段權威是 `.claude/workflows/ship-item.md`(compose,不重造)。phase 集合、durable state canonical path 與完整 closed held enum 的 machine source of truth 是 `agent-contracts/spec-to-done.contract.json`；本檔的 held 表只解釋常用處置，不複製完整 raw enum。`.codex/skills/spec-to-done/SKILL.md` 是 Codex adapter copy——修改程序 gate / resume / evidence / ship 語義時 MUST 同步該 copy；修改 machine shape 時 MUST 先改 contract，再讓 validator/tests 驗證兩端一致。

## Machine contract（Claude/Codex 共用）

- phases 必須逐字等於 contract 的 `P0,P1,P3,P4,P5,P6,P7`；不存在 P2。
- durable state 唯一路徑是 contract 的 `artifacts/spec-to-done/{slug}-state.md`。
- `reason=` 只能取 contract `durable_state.held_reasons` 的 closed enum；低階補充只能寫 `heldDetail`／`診斷=`，不得創造新 reason 或把多個 reason 串在一起。
- `.claude/skills/spec-to-done/validate-state.mjs` 直接載入 machine contract；contract 缺失、malformed 或 state 值不在 closed enum 都 fail closed。

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
- **(c) 提速導航**:不限 spec-to-done——plan / 實作階段與一般互動對話的 code analysis 先用 GitNexus `query`/`context`;codebase-memory 的 `search_graph(name_pattern)` / `get_code_snippet(qualified_name)` / `trace_path` 只能並列作為第二意見、GitNexus UNKNOWN/crash/unavailable 時的 advisory fallback,或用於非 gate 的快速定位後再回 GitNexus 交叉確認。雙查同一 message 可並列發出,但不得把 codebase-memory 當第一順位或取代 GitNexus discovery。

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
executionMode `full`(預設)或 `evidence-closeout`;不得在 resume 時切換
changePath   `evidence-closeout` 必填:已核准 OpenSpec change 的絕對路徑
closeoutTaskIds `evidence-closeout` 必填:明確且不重複的 task IDs(禁 wildcard/整個 change)
```

每個新 run 固定同一組上限，跨 phase / retry / resume 累計，不得重設：

```
maxAgentCalls=40; maxP5VerifierBatches=2; maxP5Rounds=2; maxEvidenceAttempts=2
```

`resume`、retry、換 session／CLI 永遠不得重設上述 counter。唯一合法例外是前一行已是有效
`HELD@P<n> reason=run_budget_exhausted`、至少一個固定 counter 精確到頂，且 owner 對舊 state tuple 與
fresh descendant worktree 明確啟動**新 run**。先用唯讀命令判讀，不得靠聊天記憶猜測：

```powershell
node .claude/skills/spec-to-done/append-new-run.mjs status --state <absolute-state-path> --json
```

只有 exact owner message 已存在時，才可呼叫同檔 `append`；不得手寫、copy/paste 或一般 append
`NEW_RUN@P0`。`--git-exe` 只能選 owner 安裝的 system Git：Windows 的
`C:\Program Files\Git\{cmd,bin,mingw64\bin}\git.exe`，或 POSIX 的 `/usr/bin/git`／`/usr/local/bin/git`；
不得使用 `Get-Command git`、PATH proxy、repo 內工具或 caller-writable binary。helper 會保留舊 state 的每個 byte，
綁定舊全檔 SHA-256/bytes/checkpoint count、terminal line hash、舊/新 spec/branch/worktree/HEAD ancestry、
Git executable path/hash/size/trust class、git-dir/common-dir 與 owner message SHA-256/bytes，取得 exclusive lock 後
atomic replace 並立即用 canonical validator readback。`ownerProvenance=sha256-tuple-binding-not-digital-signature`
只是可稽核 tuple binding，**不是數位簽章或 owner 身分驗證**；coordinator 仍須親眼確認當輪 owner 訊息。
`status --json` 會列出 `nextAction` 與 `appendRequiredArguments`；不得省略、補猜或從舊對話沿用值。
成功 append 後產生新的 `runSequence`，三個 counter 依 machine contract 歸零，plan/task/PR/run/evidence
欄位清空；歷史 ledger/hash 不刪不改。`NEW_RUN@P0` 只建立 P0 rollback point，不代表任何 P0–P7
gate 已通過。

`remainingAgentCalls=maxAgentCalls-agentCalls.used` 必須傳入每個 `std-*` / `fu-*` workflow；回傳的
`agentCallsUsed` 立即累加後才可決定下一步。P6 每次 `ship-item` workflow 呼叫另計 1 call。任何計數到頂、
workflow 試圖超額、或 resume 缺少可信計數，一律 fail-closed，不可用新 session / 新 run ID 歸零。

## P0 指揮官開場(主對話親自做)

1. `executionMode=full`:讀 spec 全文;自檢 placeholder / 內部矛盾 / scope 歧義 → **spec 矛盾 = HELD**(spec 是唯一忠實源,agent 不得擅自補)。
   `executionMode=evidence-closeout`:只在已核准 OpenSpec proposal/spec 明載 production / contract 已落地，且
   `closeoutTaskIds` 每一項都只需 evidence、docs 或該 change 的 task ledger 時成立。P0 逐 ID 做 scope lock；
   任一項仍需 production source、UI、public contract、dependency/config 變更，或語意不明，一律
   `HELD@P0 reason=scope_drift`，不得退回 full mode 自動擴張。`userFacing` 沿用 change 真實分類，不得為跳過 P4 改成 false。
2. 偵測隔離:`git rev-parse --git-dir` ≠ `--git-common-dir` → 已在 linked worktree,直接用(絕不疊加)。在主 checkout 時:
   - `.worktrees/<slug>/` 已存在(前次 held 殘留)→ **沿用**,worktreeRoot 指向它,確認 branch 正確即可。
   - 否則:`git fetch origin +refs/heads/main:refs/remotes/origin/main` → `git worktree add .worktrees/<slug> -b <branch> origin/main`。
   - worktree 不帶 ignored/local artifact(storage/ 真 IFC、node_modules、.venv)— 讀主工作區絕對路徑或 worktree 內 `npm install`。
3. TodoWrite 建 P1–P7，記錄目前 `git rev-parse HEAD` 與四個固定上限。**每次 Workflow 呼叫的工具回應都有
   實際「Run ID: wf_...」；只記真實 ID，不得以 `native-*` 描述標籤代替**。每個 phase 結束先累加計數，再寫 state(見 Resume)。

## 編排(可複製;gate 讀 StructuredOutput 布林/枚舉)

> ⚠ Workflow 的 `args` 必須是 JSON object,**不可序列化成字串**(字串會讓腳本取欄位全 undefined;
> 腳本雖有 parse 防護與 `bad_args` fail-fast,仍應正確傳 object)。收到 `held='bad_args'` = args 傳壞,修 args 重呼。

```
若 executionMode==='evidence-closeout':
  P1 = {ok:true, scopeLocked:true, runId:'none'} // 指揮官只讀 change 逐 ID 鎖 scope，不啟 agent
  P3 = Workflow({name:'std-evidence-closeout', args:{worktreeRoot, changePath, closeoutTaskIds,
                expectedHead:head, fixFindings:[], maxEvidenceAttempts:2-evidenceAttempts.used,
                remainingAgentCalls}})
  累加 P3.agentCallsUsed 與 P3.evidenceAttemptsUsed；productionFilesChanged 非空、HEAD 不符或 task ID
  不完整都由 workflow fail-closed。P4={ok:true, skipped:true, reason:'evidence-closeout'}；P5 仍以
  P3.findings(可為空)跑一次 critic，不能因是 closeout 跳過 adversarial gate。P5 不過時只可在剩餘
  evidence attempt 內重跑 `std-evidence-closeout`，把 P5 問題壓成 `fixFindings`；禁止呼叫 `std-implement`
  或擴張到 production。closeout 的 P6 資料只取 scope lock、P3.completedTaskIds/evidencePaths/evidenceHead/
  commitSha 與 P5 verdict；不得讀 full-only 的 P1.impact、P3.finalReview 或 P4.evidence。

若 executionMode==='full':
P1 = Workflow({name:'std-plan', args:{specPath, slug, dateStamp, branch, worktreeRoot, userFacing,
               acknowledgedCriticalSymbols:[], remainingAgentCalls}})
     gate: P1.ok === true 才前進;P1.held → 查「held 對照表」
     P1.impact.overallRisk==='HIGH' 或 P1.impact.blockers 非空 → 本訊息中明確回報 blast radius
       (direct callers / processes / risk)後繼續;補強策略之後寫進 PR body
P3 = Workflow({name:'std-implement', args:{planPath:P1.planPath, worktreeRoot, branch, specPath,
               userFacing, startTaskIndex:0, maxFixRounds:2, acknowledgedCriticalSymbols:[],
               mode:'tasks', fixFindings:[], remainingAgentCalls}})
     gate: P3.held → 查「held 對照表」;P3.ok===true(全 task 完成)才前進
     P3.highRiskNotes 非空 → 對話中轉述(臨時 HIGH 的事後回報)並列入 PR body 補強段
     P3.finalReviewOk===false → 不是死路:findings 照樣進 P5 對抗複驗定真假
P4 = userFacing ? Workflow({name:'std-evidence', args:{worktreeRoot, slug, specPath, planPath,
                  evidenceAttempt:evidenceAttempts.used+1, remainingAgentCalls}})
                : {ok:true, skipped:true}
     呼叫前確認 evidenceAttempts.used<2，回傳後立即累加 P4.evidenceAttemptsUsed；interactive Chrome 也算一次
     evidence attempt，必須先扣額度再操作，總計最多 2 次。
     gate: P4.ok
       held='no_browser_engine' → interactive session:主對話以 claude-in-chrome 親自取證(第 3 層;
         按本檔「Vertical slice 七項」逐項驗、產物落同樣 artifacts/e2e/ 慣例、自組 gaps:[{id,q}]、
         engine 誠實記 chrome)後重新裁決;headless/cron 無此層 → HELD
       held='no_browser_evidence' 且 detail 顯示 backend stack 沒起 → 指揮官依 golden path 啟動：
         **先跑「啟動/重建 backend stack 前置」(見專節)清掉殘留 kit/conversion port,再跑** `.\scripts\deploy.ps1`
         (勿在 workflow 內自啟)後重跑 P4;否則 HELD(not observed 不得宣告 done)
P5 前置(指揮官親自建立 immutable review snapshot):
     所有 intended tracked code/tests/evidence 先 commit 完整；`git status --porcelain` 必須空。
     **先 `git fetch origin +refs/heads/main:refs/remotes/origin/main`**，再
     targetSha=`git rev-parse origin/main`；subjectSha=`git rev-parse HEAD`；
     baseSha=`git merge-base <targetSha> <subjectSha>`(三者皆完整 40-hex，且 baseSha 不得等於 subjectSha)。
     domainContext=從 spec scope 壓成的 owning service/public entrypoint/deployment boundary，≤8000 char；
       不得把某個 service/runtime/tool 版本硬編進 generic workflow。
     requirements 是必填的 bounded acceptance context：`acceptanceDigest` 為 64-hex SHA-256、
       `acceptanceSummary` 為非空且 ≤8000 字元、`refs` 為 1..16 個 path 唯一的
       `{path,commitSha,blobOid,sha256}`（path 是 canonical repo-relative；兩個 Git OID 為 full 40-hex，
       sha256 為 64-hex）。它與下列 git facts 都只是 `coordinator-attested`；Workflow 只驗 shape/界限並
       傳給 reviewer，沒有 host shell/hash 能力可獨立重算，因此不得宣稱 machine-bound。
     **workflow runtime 沒有 shell(`typeof $ === 'undefined'`)，git 事實一律由指揮官收集後經 args.git 傳入**；
     以下全部在同一個 clean snapshot 內取得，任一步之後 worktree 有變動就必須整批重取：
       git.attestation   = 'coordinator-attested'
       git.cleanBefore   = (`git status --porcelain` 為空)
       git.headSha       = `git rev-parse HEAD`                      // 必須 === subjectSha
       git.originMainSha = `git rev-parse origin/main`               // 必須 === targetSha(trusted-ref 綁定)
       git.mergeBase     = `git merge-base <targetSha> <subjectSha>` // 必須 === baseSha
       git.targetIsCommit/baseIsCommit/subjectIsCommit = (`git cat-file -t <sha>` === 'commit')
       git.trackedAtSubject = registry 內所有 suspectFile 中，`git cat-file -t <subjectSha>:<file>` === 'blob' 者
       git.subjectFiles  = {path: `git show <subjectSha>:<path>`}    // range 內變更檔 + 全部 suspectFile
       git.baseFiles     = {path: `git show <baseSha>:<path>`}       // 僅本次刪除/改名前的路徑——這些路徑同時是合法 suspectFile，刪除型 regression 不得在收集階段被丟棄
     subjectFiles+baseFiles 合計上限 400000 char，超過即 bad_args——拆小 change，不得偷減供給範圍。
P5 = Workflow({name:'fu-adversarial-verify-generic', args:{
        root: worktreeRoot, label: slug, targetSha, baseSha, subjectSha, domainContext,
        findings: [...P3.finalReview.findings, ...((P4.evidence && P4.evidence.gaps) || [])],
        criticFocus: '通讀 immutable diff 找新誠實違規 / 行為 regression / spec-drift / 空測試 / DEMO DATA 漏標。',
        maxVerifierBatches:2, p5Round:p5Rounds.used+1, remainingAgentCalls, requirements, git}})
     // DACS（arXiv:2604.07911）：P5 findings 一律壓成 registry {id, q:<一句話 claim ≤800 char>, suspectFile}，
     //   不灌 P3 finalReview 全文；suspectFile/evidence.file 必須是 canonical repo-relative path，且 suspectFile
     //   必須是 subjectSha 的 tracked blob，或本次刪除/改名、已由 git.baseFiles 供給的路徑（intake 接受 trackedAtSubject ∪ baseFiles）；fu-...js 對超長 q / 缺/重複 id / 非法或未供給路徑 / >=32 findings
     //   會 held:'bad_findings' / 'run_budget_exhausted' fail-fast。findings 分成最多 2 批 verifier 平行，
     //   holistic critic 等批次完成後才串行執行；verifier+critic 合計最多 32 筆，最大同時 agent 數=2，
     //   不再 per-finding fan-out。每筆 evidence.file/line/quote 會由 workflow 以 `git show <subjectSha>:<file>`
     //   機械綁定 coordinator 供給的 exact subject/base content；reviewer 只准 pinned git show/diff/grep，
     //   禁止 Read worktree/.env/untracked。合法 output 但 evidence content 未能驗證時是 durable
     //   review_unverified；null/agent infra、缺失或 invalid schema/identity 仍是 reviewer_agent_failed。
     //   （指揮官真截斷 q 為 doc 紀律；機械只驗入參合規。）
     每次 P5 呼叫(含 bad input 修正、infra retry、evidence stale 後的新 snapshot 與內容修復後複驗)
       都先確認 p5Rounds.used<maxP5Rounds=2 並增加 p5Rounds；回傳後立即累加 P5.agentCallsUsed，
       retry/resume/新 session 都不得把兩個累計器歸零。額度已滿一律 held='run_budget_exhausted'。
     immutable/infra gate:P5===null、P5.critic===null、P5.verdicts.length !== 送入 findings 數、
       P5.targetSha!==targetSha、P5.baseSha!==baseSha 或 P5.subjectSha!==subjectSha 都不可視為通過。
     **P5 回傳後立即執行 P5.postReviewCheck(workflow 沒有 shell，這一步只能由指揮官做，不得跳過)**：
       重跑 `git status --porcelain`(須空)與 `git rev-parse HEAD`(須 === postReviewCheck.expectHeadSha)；
       任一不符即視同 held='evidence_stale'、丟棄全部 verdict，依 evidence_stale 路徑重取 snapshot。
       未執行本檢查就引用 P5 結果 = 違反 evidence 契約，等同宣告未取得的 pass。
     P5.unverified 內 taxonomy_error==='evidence_file_not_supplied' 代表指揮官供給的 git.subjectFiles/
       baseFiles 沒有涵蓋該 evidence 路徑——補齊供給後在同一 clean subjectSha 重呼(仍消耗額度)，
       不得因為「工具說 unverified」就把該 finding 當成不存在。
     P5.held==='bad_args'/'bad_findings' → 修正 invocation/registry；只有 P5 round 尚有額度才可重呼。
     P5.held==='evidence_stale' → 丟棄全部舊 verdict；重新 fetch/commit/clean、重取 targetSha+baseSha+subjectSha 後啟動新 P5，
       不得 resume 或沿用舊 SHA evidence；新 snapshot 的 P5 仍消耗下一輪額度，無額度即 HELD。
     P5.held==='review_unverified' → durable HELD；逐項保存 P5.unverified taxonomy/evidence。只有補齊同一
       immutable snapshot 的 supplied content 或修正實際內容後，才可在剩餘 P5 round 內重跑；不得當成 infra retry 或 pass。
     P5.held==='reviewer_agent_failed' 或上述 reviewer infra 失敗 → 只有尚有 P5 round 與 agent call 額度時，
       才可在同一 clean subjectSha 重呼一次；仍失敗或額度用盡 → HELD。
     P5.held==='external_blocked' → HELD；逐項回報 evidence 與 external_blockers[].unblock_condition，
       外部條件實現後在新 clean subjectSha 重跑，禁止送進 std-implement 假修。
     gate(內容性):P5.fix_now.length===0 && P5.external_blockers.length===0 && P5.unverified.length===0。
       P5.critic.overall_safe 是 coordinator 計算的摘要，不是 reviewer 自報的獨立放行鍵。
     P5.refuted = 被對抗複驗駁回(verdict=refuted、disposition=none)的 findings，附駁回理由；
       不進修復通道也不擋 gate，final report 引用原 finding 時必須標明已駁回、不得當成未處理。
     P5.known_gaps/P5.follow_ups 不自動修；**逐輪併入 deferredAccum(以 finding_id 去重，跨 round/retry/
       resume 持續累計，重跑 P5 不得歸零、不得只看最後一輪——修復型重跑的 registry 只帶 fix_now，
       critic 不保證重新發現前一輪的 deferred 項)**。寫入 PR/final known gaps 與 Full completion
       claimed=false 的判定一律以 deferredAccum 為準；任何 deferred 項要移出 deferredAccum，只能由
       指揮官在 final report 附上該項已閉合的具體 evidence，不得因新一輪未再回報就視為消失。
     P5.fix_now 非空 → 依 executionMode 走唯一有界修復通道：full 用 `std-implement mode:'fix'`；
       evidence-closeout 只能在剩餘 evidence attempt 內重跑 `std-evidence-closeout`，禁止改 production。
       fixFindings=P5.fix_now.map(x=>({id:<normalize(x.finding_id)>,q:<x.reason 截斷至 ≤800 char>,
         suspectFile:x.evidence.file}))。normalize：P5 允許的 finding_id 字元集寬於 executor 的
         ^[A-Za-z0-9][A-Za-z0-9._-]*$——先把非法字元(如':'、空白)替換為'-'，首字元非英數則加前綴'f'，
         正規化後碰撞再加'-2'/'-3'序號；不得因 id/q 形狀直接把 fix_now 變 bad_findings 燒掉 closeout 額度。
       executor 完成後 commit、確認 clean、重取新 subjectSha；只有尚有 P5 round 額度才重跑 P5，
       第 2 輪仍有 fix_now 或沒有對應 executor 額度 → HELD，不得開新 session 重設。
P6 前置(指揮官親自做,解決 PR body 資料通道):
     a. behavior gate:PR body 填 Change lane=S、Behavior contract changed=yes、
        Requirement source=superpowers spec,並連到本次已核准 specPath。不得只因 changed path
        建立 OpenSpec；只有 repo 需求明確要求 OpenSpec artifact 時才建立。
     a.1 base freshness gate:先把 implementation + evidence 的 tracked work commit 完整並確認 worktree clean；
        `git fetch origin +refs/heads/main:refs/remotes/origin/main` 後用 `git merge-base HEAD origin/main`
        與 `git rev-parse origin/main` 比對。不同代表 branch stale：尚無 prNumber 且未發布的 branch MUST
        `git rebase origin/main`；已有 prNumber 或 published PR branch MUST NOT 改寫 history，改用
        `git merge --no-edit origin/main` 以維持 normal push（conflict → HELD）。完成後重跑 affected verify、
        必要 evidence、以新 targetSha/baseSha/subjectSha 完整重跑 P5 與 GitNexus detect_changes；不得拿更新 base 前的驗證直接進 P6。
     b. push:git push -u origin <branch>
     c. gh pr create --base main(繁中):body 含 ──
        - Change lane / Behavior contract changed / Requirement source 三個 machine fields
        - user-facing:product-operability §4 的 10 列 Frontend 驗收表(資料來自 P4.evidence 的
          screenshots/runtimeIds/engine + **Read 其 summaryJson 檔**補齊 route/buttons/fixture/
          backend API/E2E command/manual steps)
        - P1.impact HIGH 的補強策略、P3.highRiskNotes
        - P3.detectFallbackTasks / detectFailTasks / fixDetectVerdicts(非 pass 項)的 GitNexus fallback 揭露
        - deferredAccum(P5 known_gaps/follow_ups 跨輪累計，非只最後一輪) 與 Full completion claimed=false(accumulator 任一非空時)
        - 若 impact 曾走 codebase-memory fallback(GitNexus UNKNOWN/crash)或有 `[xref]` 雙圖譜分歧 → 揭露「impact 由 codebase-memory 佐證;分歧 symbol(若有):…」(informational,非 gate)
        - 動 runtime/deploy 時附 Deploy Path 表;純 tooling/docs 註明不適用
        記下 prNumber
     d. local preflight（進入持 merge authority 的 workflow 前）：在目前已 push 的乾淨 head 上執行
        `.\scripts\dev\check-pr-local-preflight.ps1 -PrNumber <prNumber>`；通過後立即比對
        `git rev-parse HEAD` 與 `gh pr view <prNumber> --json headRefOid --jq .headRefOid` 完全相同。
        任一失敗或 head 改變都 HELD；不得把舊 head 的 preflight 當成 P6 證據。
P6 = Workflow({name:'ship-item', args:{branch, prNumber:<前置 c 的號碼>, userFacing}})
     **目前實際狀態**：已量測 Workflow runtime 沒有 `$` shell helper。`ship-item` 在 Validate 完成 args 檢查後
       回 `heldReason='host_env_blocked'`、`heldDetail='ship_workflow_shell_unavailable'`；不 dispatch apex、
       不讀 git/gh、不 merge。production `ship-item.js` 已移除 legacy coordinator 與 merge sink；注入 synthetic
       `$`／`agent` 的測試只證明 caller capability 無法解鎖這個 durable hold，不是 deployability evidence。
     **external executor**：repo 已實作 default-branch-only `.github/workflows/trusted-elevated-merge.yml`，
       由 freshly fetched trusted base 執行固定 preparation、tool-free Claude/Codex apex、final reads 與
       exact-head REST merge；不得 checkout 或執行 PR branch 可修改的 script/action/hook/dependency。
     **activation**：repo state=`requires_live_attestation` 時，credential step 前的 trusted-base preflight 只接受
       workflow input/assertion 與 protected variables 所綁 exact mode/tuple 的 `attesting_negative`／`attesting_positive`。negative mode 可完成
       reversible gates 但永不到達 merge sink；positive live merge 通過後仍須受審 closure 把 repo/external state
       一起改為 `active` 並清除 tuple digest。之前一律 `trusted_elevated_authorization_unavailable`，不得 retry 成
       成功、手填 `merged=true` 或進 P7；sink 已嘗試但 bounded authoritative reads 無法確認時必須保留
       `status=merge_outcome_unverified`、`merged=null`，不得降成未 merge。
     external executor consume：所有 `heldReason` 必須先通過 machine contract closed enum；raw 細節寫
       `heldDetail`／`診斷=`。review／approval／protection／elevated／consent carve-out 依下方處置表停下；
       常用 protection/branch checkpoint 是 `branch_requires_separate_authorization`、
       `branch_protection_changed_during_buffer`、`branch_protection_changed_after_verdict` 與
       `human_approval_changed_after_verdict`；
       只有 trusted host 已重新驗證 exact repo/PR/base/head、required checks、三處 review evidence、branch
       protection 與 shell-free apex verdict，且 authoritative GitHub state 證明 merge 後，才可進 P7。
P7 = 主對話回報四項:改了哪些 tracked files / 跑了哪些最小驗證 / 哪些測試沒跑及原因 / 已知風險
     + mergeCommit + evidence 路徑 + AGENTS.md 7 欄 Frontend 表(回報用;PR body 已用 10 列表)
     宣告前先對帳:OpenSpec/plan 的 task 勾選 ↔ state 檔 + task#N commits;不一致 → held='ledger_mismatch'
     DONE@P7 前仍須 freshly fetch `origin/main`，但用途只限讓 merge commit object 在本機可供 ancestry/tree
     檢查；local tracking ref 不構成信任證據。machine contract 的 `terminal_evidence` 固定 trusted HTTPS remote
     與 `refs/heads/main`；validator 使用已驗證、worktree 外的絕對 Git executable，清除 local/global Git config
     與不安全 CA override 後同步執行 `git ls-remote`。live remote SHA 必須等於 full 40-char `mergeCommit` 與
     terminal `head`；`git merge-base --is-ancestor <prHead> <mergeCommit>` 必須成功，且
     `git diff --quiet <prHead> <mergeCommit> --` 證明 same tree；`evidenceHead..prHead` 仍只含 evidence
     allowlist。state 另記 prHead=<合併前 PR head>、mergeCommit=<live remote refs/heads/main commit>。任一 live
     resolution、ancestry 或 tree 證據失敗都 `evidence_stale`；terminal 行不得 resume 任何 agent phase。
```

P1 內含 plan 四軸 review(Completeness/Spec Alignment/Task Decomposition/Buildability);P3 內含每 task 兩階段 review(spec 先 quality 後)— 都在 workflow 內自動修迴圈,不回主對話。

## held 對照表（常用處置；完整 closed enum 以 machine contract 為準）

| held | 來源 | 指揮官處置 |
|---|---|---|
| `bad_args` | 任一 std-* / fu-generic(必填 args/SHA/domainContext 缺、malformed 或被字串化) | 修正 args 為正確 object；只在對應 run/P5 額度內重呼 |
| `bad_findings` | P5 registry 缺欄、重複 id、q 過長、型別錯或 suspectFile 非 canonical repo-relative path | 修正 bounded registry；只在 P5 round 尚有額度時重呼，不得丟棄 finding 或灌 review 全文 |
| `run_budget_exhausted` | 任一 phase 的 agentCalls / P5 / evidence 上限已到，或 findings >32 | **HELD**；一般 resume 永不可歸零。只有 exact owner 啟動後由 `append-new-run.mjs` 建立 machine-bound `NEW_RUN@P0`；手寫或複製 boundary 一律無效 |
| `resume_state_invalid` | state 缺必要欄位、假 run ID、計數器/HEAD 不可信或 schema 漂移 | **HELD**；依 git/artifact 建立新格式 checkpoint，通過 validator 前不啟 agent |
| `scope_drift` | evidence-closeout 需要 production/UI/contract/config 變更 | **HELD**；改用另一個已核准 full change，不得在 closeout 內擴張 |
| `evidence_stale` / `evidence_not_closing` | P5 worktree/HEAD/target/base/subject identity 漂移、空 review range，或 closeout evidence 未綁目前 HEAD/兩次仍未閉合 | 丟棄舊 verdict；fetch/commit/clean 後重取完整 SHA；只在剩餘額度內重跑，禁止第三輪自動重試 |
| `external_blocked` | P5 有 confirmed/adjusted external blocker | HELD；回報 evidence＋精確 unblock_condition；條件實現後以新 clean subjectSha 重跑，禁止自動修 |
| `plan_author_failed` / `plan_parse_failed` / `reviewer_agent_failed` | P1/P3 infra；P5 agent null、verifier/critic 缺失或 output schema/identity 不合法 | 只在剩餘 run/P5 額度內以同一 immutable input 重呼一次；再失敗或額度用盡 → HELD |
| `review_unverified` | P5 output 合法但 supplied immutable content 無法支持 evidence/taxonomy | durable HELD；保存 unverified 細節，補齊 pinned content 或修正實際內容後才可在剩餘額度內重跑，不得當 pass |
| `plan_not_aligned` | P1 修 2 輪仍不過 | **一律 HELD**(附 spec 矛盾診斷 specConflict;不自動重跑 P1 — 強制停下點,不可自動繞) |
| `critical_impact` | P1 預掃 / P3 per-task | HELD(CRITICAL 阻擋)。使用者選:(a) 拆 change → 修 spec/plan 後重跑;(b) reviewer sign-off → resume 時把該 symbols 放進 `acknowledgedCriticalSymbols`,gate 對已 ack 的 symbol 放行(這是唯一解鎖通道;sign-off 由使用者親自給,或經「State 行詞彙與簽核委派」節的委派通道由受委派 agent 代行) |
| `impact_unavailable` | P1/P3 GitNexus 整體故障(含 overallRisk=UNKNOWN) | HELD;按 memory 復原 LadybugDB(`gitnexus status`+meta.json 為準)後 resume;復原前可用 codebase-memory trace_path 取暫時 blast-radius 寫 note 供 resume 判斷,**held 不因此解除** |
| `plan_error_at_task` | P3 implementer 判 plan 錯 | HELD(附 blockedDetail);使用者核可後修 plan 檔 → resume P3 帶 startTaskIndex=該 task(P3 會重新 Parse 修過的 plan) |
| `spec_review_not_closing` / `quality_review_not_closing` | P3 修 N 輪仍不過 | HELD(附 gaps/qualityDetail)— 真 P1/P2 修不閉合,不可繞 |
| `detect_changes_repeatedly_failing` | P3 同 run 內 detectVerdict=fail 達 3 次 | HELD;指揮官 `gh issue create`(標題含 branch + 失敗摘要),等修復或 reviewer sign-off |
| `no_browser_engine` / `no_browser_evidence` | P4 | 見編排 P4 gate(第 3 層 / stack 啟動 / HELD) |
| `test_deploy_process_unproven` | backend / 測試部署區 preflight | HELD；port / process-name / pidfile 都不能單獨授權停止。listener 必須符合 per-port service role、deployment pidfile ancestor 與精確 launcher entrypoint，且 creation identity 經雙快照與 stop 前重驗一致，才可用下方 explicit stop 模式重跑 |
| `host_env_blocked` | 任一 phase(host/環境層阻斷:CLI auth 失效、platform command/approval policy 擋操作、runtime 依賴或探測缺口等,非 spec/plan/品質問題) | HELD;診斷欄寫明被阻斷的具體操作與環境成因;修復環境後以同 phase(同 taskIndex/prNumber)resume;不得因環境阻斷降級或跳過任何 gate,也不得為個別環境狀況發明表外 held 值(細節一律進診斷欄) |
| `ledger_mismatch` | P7 對帳(指揮官發出,非 workflow 回傳):OpenSpec tasks.md / plan 勾選與 state 檔+`task#N` commits 不一致 | HELD;以 git/code 證據為準做 forensic 調和(單獨 commit/PR 修 ledger),不得單方按 state 檔補勾、也不得按 ledger 否定已有 commit 證據的完成;調和後才可宣告 done |
| `review_required` / `human_approval_required` | P6 branch protection / canonical review | HELD；使用者以固定 CODEOWNER 帳號完成 exact-head canonical approval 後，以同一 prNumber resume；agent 禁止 `gh pr merge --admin` |
| `reviewer_permission_not_strict` / `reviewer_permission_changed_after_verdict` | P6 fixed reviewer identity | HELD；使用者恢復固定 reviewer exact `write` permission/role 後 resume，不得降級 identity gate |
| `branch_requires_separate_authorization` | P6 revert-* / release / hotfix branch | HELD；持久化目前 checkpoint，取得使用者明確同意後改走另行授權流程；不得以同一 ship-item 自動重試、resume 或 merge |
| `branch_protection_changed_during_buffer` / `branch_protection_changed_after_verdict` / `human_approval_changed_after_verdict` | P6 protected-state drift | HELD；重讀 protection 與 exact-head human approval，狀態穩定且 fresh approval 綁定目前 head 後才能 resume；不得自動重試或 merge |
| `trusted_elevated_authorization_unavailable` | P6 elevated authorization broker | HELD；repo broker contract 已實作，但 hosted environment 未 provision／未 attested，或 exact tuple/runId/provider/nonce/expiry approval 不成立；caller-supplied `elevatedAuthorization` 不得解鎖或 resume |
| `unexpected_elevated_authorization` | P6 routine caller args | 移除 routine PR 不應出現的 `elevatedAuthorization` 後，以同一 prNumber resume |
| `branch_protection_single_owner_gate_not_strict` | P6 live protection | HELD；使用者／admin 恢復 approvals=1、dismiss stale、code-owner review、strict checks、conversation resolution、enforce-admins 且無 bypass/force/delete 後 resume |
| `cyber_safeguard_payload` | P5/P6 reviewer safeguard | separator-only fixture 才可換成 `a/b` / `seg/seg/id`，確認 payload paths 的 `passwd` grep 無結果後 resume；涉及 security 語意則 HELD |
| `ship_blocked` 類(由 heldReason 文字) | P6 | 見編排 P6 consume |

## 強制停下點(repo 規範明文,不可自動繞)

spec 矛盾(P0/P1)、GitNexus CRITICAL(未 ack)、browser evidence not observed、真 P1/P2 修不閉合、
evidence-closeout scope drift / stale / 兩輪未閉合、run budget 到頂、ship consent carve-out、工具反覆故障(detect 3 次 / GitNexus 不可復原)。
HIGH 不是停下點:在對話中明確回報 blast radius 後繼續,PR body 必寫補強策略(P6 前置 c 是執行通道)。

**Hold block 固定格式**(輸出後停;同時 append 到 state 檔):

```
HELD@P<n> | reason=<held 值> | spec=<specPath/changePath> | slug=<slug> | userFacing=<bool>
| branch=<..> | worktree=<絕對路徑> | head=<git SHA> | executionMode=<full/evidence-closeout>
| closeoutTaskIds=<逗號分隔;full 留空> | runIds=<P1:wf_.. P3:wf_..;只記實際 ID>
| agentCalls=<used>/40 | p5Rounds=<used>/2 | evidenceAttempts=<used>/2 | evidenceHead=<SHA 或空>
| dateStamp=<..> | planPath=<..> | taskIndex=<..> | prNumber=<..>
| 診斷=<specConflict/gaps/blockedDetail 摘要> | 需要使用者決定=<具體選項>
```

## Resume(使用者一句話重入;支援跨 session)

- 任何 resume 先跑 `append-new-run.mjs status --state <absolute-state-path> --json`。若
  `canStartNewRun=true`，目前 audit chain 仍是 terminal HELD；沒有當輪 exact owner authorization 時只回報
  所需 tuple，不得啟 agent。取得 authorization 後也只能由該 helper 的 `append` action 遷移到 freshly
  fetched main descendant worktree，再對 canonical state 跑 validator；不得修改或截斷舊 state。
- **State 檔(durable,跨 session 唯一座標)**:`agent-contracts/spec-to-done.contract.json` 固定 canonical path
  `artifacts/spec-to-done/{slug}-state.md`。每個 phase 完成或 HELD 時，先把 durable history 完整複製到
  sibling temp，再 append 候選行（禁止只寫單一候選行），執行
  `node .claude/skills/spec-to-done/validate-state.mjs --state <temp> --platform claude --git-exe <上述 system Git 的絕對路徑> --expected-head <git SHA> --expected-worktree <worktreeRoot> --expected-agent-limit 40 --expected-p5-limit 2 --expected-evidence-limit 2 --trusted-main-ref refs/heads/main`；若 allowlist 內沒有 caller 不可寫的 system Git，回 `host_env_blocked`，不得改傳其他 binary。exit 0 才把候選 append 到 canonical durable state。`--trusted-main-ref` 只是 machine contract 所定 remote ref 的固定 marker，不接受 local tracking ref。validator 會清除 ambient `GIT_*`／config injection，載入 machine contract，檢查完整 history 的每一行、所有相鄰 transition、實際 Git executable 與 git-dir/common-dir identity、HEAD、dirty/staged/untracked、rename source，並只在 DONE@P7 獨立 live-resolve 固定 trusted remote、驗 remote main SHA、prHead ancestry 與 same tree。若既有 history 無法通過行或 transition 驗證，只能追加 counters 全到上限的 `HELD ... reason=resume_state_invalid` 作終端封存；該行不能用來繼續 progress，必須先修復或正規化歷史。
- 「繼續 spec-to-done」→ 先對 durable state 跑同一 validator；通過後還原全部 args 與累計計數，只重跑該 phase：
  `Workflow({name:<phase>, args:{...還原,remainingAgentCalls:40-agentCalls.used}, resumeFromRunId:<該 phase 實際 runId>})`。
  state HEAD 與目前 worktree HEAD 不同即 `evidence_stale`；不得靠 resumeFromRunId 或新 session 跳過。
- `evidenceHead` 可等於目前 HEAD，或是目前 HEAD 的 ancestor；後者只在所有 committed/dirty 路徑都位於
  `docs/evidence/**`、`artifacts/e2e/**` 或精確的 `openspec/changes/<change>/tasks.md` 時有效；closeout
  只能改命名 change 的該 tasks.md。rename 來源與目的都會檢查，中間任何產品檔變動皆判 `evidence_stale`。
- 舊格式 state 不可直接 resume。最多由指揮官做一次 bounded read，以 git log / task ledger / evidence artifact 建立新格式 checkpoint；
  無法證明的計數一律視為已到上限並回 `resume_state_invalid`，不得派 reviewer swarm 猜測或把計數設 0。
- 前序產物(plan 檔、commits、evidence)都在 git/磁碟,不重做;P3 錨點 = startTaskIndex(per-task commit 訊息規定前綴 `task#N:`,崩潰時可從 git log 重建);P6 帶同一 prNumber(ship-item 沿用既有 PR,不重複 create)。
- 時間戳一律由主對話經 args 注入(dateStamp);workflow 內禁時鐘/亂數 API。

## State 行詞彙與簽核委派(跨 CLI resume 契約;Claude 與 Codex 共用)

state 檔是跨 session / 跨 CLI 的唯一 resume 座標；新寫入的行一律遵守下列詞彙。歷史行保留作 audit，
但必須先正規化並通過 validator，禁止直接「盡力解析」後啟 agent：

- **行首 token 只允許五種**:`HELD@P<n>`、`DONE@P<n>`、`RESUMED@P<n>`、
  `AUTHORIZATION@P<n>`，以及只准 `append-new-run.mjs` 生成的 `NEW_RUN@P0`。後者不是 resume；它是
  owner-only 新 run boundary，且只能直接接在有效 `run_budget_exhausted` terminal 後。
- **`reason=` 的 held 值 MUST 取自 `agent-contracts/spec-to-done.contract.json` 的 closed enum**；本檔處置表不是完整名單。不得發明表外值、不得把多個值併成複合值（一行一個主因，其餘寫 `heldDetail`／診斷欄）。host/環境層阻斷一律用 `host_env_blocked`。
- **欄位鍵固定 hold block 契約**，包含 `head/executionMode/closeoutTaskIds/runIds/agentCalls/p5Rounds/evidenceAttempts/evidenceHead` 與中文鍵
  (`診斷=`、`需要使用者決定=`)；不得混入同義欄位(`diagnosis=` / `need=` / `stateSchema=`)。
- **phase 編號取自 machine contract，固定 P0/P1/P3–P7 跳號，不存在 P2**；任何 state 行不得出現 `P2`(全域或他處 skill 的「P2 Test Design」詞彙不得滲入本 repo 的 run;測項設計屬 P1 plan 範圍)。
- **跨 CLI handoff**：先由原平台 validator 驗 durable state；新平台不得 reattach 異平台 ID，而是啟一個
  bounded 新 agent（Codex 使用 `fork_turns:"none"` 或最小必要 turns）。append `RESUMED@P<n> |
  decision=cross-cli-handoff`，`runIds` 同時保留所有舊、新實際 `wf_*`/`codex:*` ID；若新 agent call 已發生，
  `agentCalls` 必須照實遞增，其餘 counters 不得重設。

**簽核委派(delegated sign-off)**:使用者可顯式委派一個獨立 read-only agent 代行本 run 後續 HIGH/CRITICAL sign-off。委派必須由使用者明說(agent 不得自行發起或暗示),記錄為一行:

```
AUTHORIZATION@P<n> | spec=<specPath/changePath> | slug=<slug> | userFacing=<bool> | branch=<branch>
| worktree=<絕對路徑> | head=<git SHA> | executionMode=<mode> | closeoutTaskIds=<IDs 或空>
| runIds=<實際 IDs> | agentCalls=<used>/40 | p5Rounds=<used>/2 | evidenceAttempts=<used>/2
| evidenceHead=<SHA 或空> | decision=delegate-repo-workflow-signoff | scope=<代簽範圍>
| exclusions=<排除項> | 診斷=<使用者授權原文摘要> | 需要使用者決定=none
```

AUTHORIZATION 行也必須複製當前完整 checkpoint 與計數；`decision` 只能是
`delegate-repo-workflow-signoff`，`scope` 只能取 `impact-signoff,detect-signoff,review-signoff,repo-workflow-signoff`
的非空子集，`exclusions` 必須完整且只能是
`secrets,credentials,billing,production-data,destructive-delete,unproven-process-stop`。validator 只驗 schema，
不會創造使用者同意；仍須由真實使用者訊息提供 provenance。短格式或自行生成的授權一律無效。

## 啟動 / 重建 backend stack 前置:host-native port preflight(防 deploy Read-Host 卡死)

**預設鐵則**:跑 `.\scripts\deploy.ps1` 或 `.\scripts\dev\rebuild-test-deploy.ps1 -Build` **之前**,指揮官(主對話)
MUST 先從主工作區 root 跑 helper。無參數與 `-DetectOnly` 都是 read-only；不得預設停止任何程序:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\spec-to-done\ensure-host-native-ports-free.ps1
# 若 .codex 側亦存在同名 helper，兩份內容必須一致（user 級路徑不存在，勿引用）
```

**測試部署區真實驗證授權(放寬但限縮)**:只有明確執行 spec-to-done、目前 spec 的 PR 已 merge 且 commit 可由 freshly
fetched `origin/main` 取得時，才可在 P7 真實驗證前執行 explicit stop 模式，接著走唯一 rebuild 入口:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\spec-to-done\ensure-host-native-ports-free.ps1 `
  -StopOwnedRuntime -DeploymentRoot 'D:\Users\deploy\AI-bim-geo'
# 只有 exit 0 才可繼續
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

- **停止條件**:conversion port 只接受 deployment venv Python、精確 conversion launcher lineage；Kit / spectator ports 只接受
  Kit executable、精確 port argument、extension root 與 streaming launcher lineage。pidfile 必須是目前 listener 的 ancestor，
  只能作 lineage 佐證，不能單獨授權。creation identity 在完整雙快照、每次 stop 前與取得 handle 後都必須一致；同一 port
  的全部 owners 先分類，任何一個未通過即不做 initial partial cleanup，回 `test_deploy_process_unproven` HELD。這個精確
  lineage 也容納 Kit build 的 Packman symlink，不把任意 reparse path 當 ownership。禁止其他 root / worktree / caller topology。
- **為什麼**:Kit 無 live reload / migration。殘留 runtime 會讓 `deploy.ps1` Phase 3 對非互動 stdin 啟動 `Read-Host`,並持有
  `storage/*.usd(c)` 鎖。explicit stop 只用已取得且重驗一致的 exact process handle 停止 canonical deployment listener；
  不用 PID-only tree kill。docker plane 仍由 `deploy.ps1` idempotent 處理。
- **退出碼處置**:`0` = port 全 FREE。`1` = busy / ownership unproven / identity changed / timeout；`2` = 非 canonical root、
  topology/參數不合法或無法可靠檢查 port。任何
  nonzero 都回報 port + PID + process name + ownership kind 並 **HELD**,不可硬跑 deploy。helper 不輸出完整 command line。
- **誠實限制**:rebuild 固定驗證 freshly fetched `origin/main`,不得拿未 merge branch 宣稱已在部署區驗證。`.venv WRONG_VERSION`
  等非 port prompt 不在本 helper 範圍。explicit stop 會一次讀取 canonical deployment 的 `.env.web-plane.host-kit`（或
  tracked `.example` fallback）形成 immutable hash + topology snapshot；不讀 caller process environment，caller port/count
  override 一律拒絕，且每次 stop 前重驗 source hash。
- **長時執行紀律(2026-07-28 cross-service 教訓)**:runtime attempt / deploy / rebuild 類長 runner 禁止經短 timeout 的
  shell 工具呼叫直跑;必須背景執行,以其持久化 log/artifact 輪詢判定結果。外層工具 timeout 強殺不是 runtime pass/fail
  證據——該 attempt 一律誠實作廢、記入 state,不得改寫成 success。

## 模型、effort 與 prompt 路由

本 skill 不保存第三份 exact model table。repo operational source of truth 是 `.claude/workflows/routing.json`；`scripts/gen_routing.py` 將它的 model/effort、apex-first gate、兩席 semaphore 與 prompt contract 生成至所有 active workflow，pinned tests 阻止 drift。全域 `task-routing.md` 只擁有跨 repo 的角色／難度政策。

升級通道由 call-site task tier 決定：機械抽取、有界掃描、一般實作、困難推理、修復／裁決逐級選用最小充分 assignment。只有 non-apex tier 可依 registry 的 fallback 鏈原子切換；arbiter 無 fallback。P6 production workflow 是 validation-only，無論 caller 是否注入 `$`／`agent` 都以 `host_env_blocked` fail closed，且不 dispatch apex；未來 base-pinned trusted host executor 獨占 evidence collection 與 identity-bound merge sink，apex 始終沒有 shell/write capability。
平行:P1 四軸 review 分波執行(每波最多 2 個)；P5 最多 2 個 batch verifier 平行，critic 必須在 batches 後串行；generated `governedAgent` 對每個 workflow 硬限最多 2 個 active child；nested workflow 必須序列呼叫，避免各自 semaphore 疊加。**P3 implementer 嚴禁平行**(實作衝突)。
**降本原則**:hard gates(四軸 approved 條件/兩階段 review 閉合條件/P4 vertical slice 七項/P5 refute-by-default + critic/P6 buffered merge)一個不動;降級只發生在「產出被 ≥2 層更強 gate 複核」或「錯誤顯性必爆」的位置。等效性靠 gate 結構保證,非靠單點模型強度。

## 誠實鐵律(本流程的落實)

- evidence **綁產物不綁工具品牌**:browser 真實操作截圖 + trace + summary JSON 落主工作區 `artifacts/e2e/<slug>-*`(trace 也要 copy 出 worktree,closeout 會清掉);3D/真實 IFC 類另放一份 summary+抽樣截圖到 worktree `docs/evidence/<slug>/`(tracked,隨 PR 可審,product-operability §5)。engine 記真實值,**不得謊報引擎**。
- 現狀:gstack NEEDS_SETUP(缺 bun;啟用 = 裝 bun + `cd ~/.claude/skills/gstack && ./setup`)→ **default 引擎 = Playwright**。gstack SKILL 的「NEVER use claude-in-chrome」是 gstack 可用時的內規,不可用時第 3 層合法。
- `web-viewer-sample/scripts/verify-*.mjs` 是 source-level check,**不可充當 browser evidence**。
- Vertical slice 七項(P4 與 chrome 手動路徑共用同一把尺):UI route 可達 → 明確按鈕 → default fixture → 真實 backend API(mock 處已標 DEMO DATA)→ runtime ID 可見 → loading/success/failure/retry 可見 → 截圖/trace 已落檔。3D 加驗:GPU-backed review session + stage truth matched=true;不得宣稱零 GPU 完成 3D。
- 寫任何「環境降級 / 無 GPU / pending」前先查證(`nvidia-smi` / port / health);容器受限 ≠ host 無能力(harness 佔位是刻意選用、非被迫降級)。
- 無 backend 處 UI 標 `DEMO DATA` / `NOT BUILT` / `not observed`;不偽裝 CI 綠;不 merge 真 P1/P2。

## 已知限制與衝突(誠實註記)

1. Browser evidence 綁可見結果與 artifact，不綁工具品牌；Playwright / gstack / supported browser engine 都必須誠實記錄實際 engine、command、screenshot/trace。
2. PR body 用 product-operability §4 的 10 列表;P7 回報用 AGENTS.md 7 欄表 — 兩版並存是權威檔既有張力,本流程兩處各用各的。
3. commit trailer:std-*.js 與 ship-item 內的 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 是 **harness attribution 文字、非模型調用**(agent 實際模型由 routing/session 決定)。2026-07-02 已裁決與現行 harness commit 規則同步為單一 trailer——此為文件與程式碼**第一次真正對齊**(先前程式碼字面是 Opus 4.8、本檔敘述卻寫 Fable 5,兩邊各錯一半),非「改回」。
4. GitNexus detect-changes 在 linked worktree 看不到 staged(已知坑)→ implementer fallback `git diff --name-only --cached` 並記 `detectVerdict='fallback'`,PR body 揭露;完全失敗記 `fail`,同 run 3 次 → held。
5. pr-review-agent 會阻擋 behavior=yes 卻缺 formal requirement source，或 behavior=no 但 diff 明顯新增 route/API/schema/外部行為；`report generation failed` 仍是工具整體故障。
6. 本組檔案已 whitelist tracked(`.gitignore:37` `!.claude/skills/spec-to-done/`、`:42` `!.claude/workflows/`;含 SKILL.md、std-*.js、ship-item、本目錄 `ensure-host-native-ports-free.ps1`),隨 PR 進 git/CI。pr-review-agent 對所有 PR 都會跑(#202 的 paths-ignore 已移除,`pr-review-agent.yml` 現無 paths 過濾),且是 main branch protection 的 required check(11 項之一;2026-07-02 以 gh api 親查)——`.claude/**` 變更同樣受 review 與 AI Coding Governance body-evidence 表約束。
7. P1 四軸 review 第二輪起只重審上輪未過的軸(fixer 改 plan 可能影響已過軸)— 由 P3 per-task spec review 與 P5 critic 兜底,屬已知取捨。
8. 40 calls / P5 2 rounds / evidence 2 attempts 是整個 run 的硬上限，不是每 phase 配額；大型 change 可能提早 HELD，
   應拆 change 而不是提高 fan-out。此取捨刻意把可預測成本與主機負載置於單次全自動完成之前，所有品質 gate 保留。

## 維運注意事項

1. routing.json 改動後須跑 `.venv\Scripts\python.exe scripts/gen_routing.py` 重生各 std-*.js 的 ROUTING 區塊，並 re-save 受影響 workflow 讓 harness reload；禁止 workflow run 中途執行 codegen。
2. 模型退役/供應中斷應變：non-apex tier 可取 routing.json 的 `fallback` 第一個可用項，並以同一 commit 原子更新 registry、generated files 與 tests；fallback 不得作日常降階。arbiter 沒有 fallback，Fable/max 不可用時維持 HELD，直到供應恢復或使用者明確修改 apex 政策。
