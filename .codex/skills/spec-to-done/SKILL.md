---
name: spec-to-done
description: Use only when the user explicitly invokes spec-to-done (or explicitly requests the full Superpowers lifecycle), or supplies or identifies an approved spec and asks for autonomous progress to a merged PR; also use when explicitly resuming a held spec-to-done run. Do not trigger from "實作 spec", "完成需求", or "使用 agents" alone.
---

# spec-to-done — 指揮官手冊(主對話 SOP)

把一份**已經使用者核准的 spec**(brainstorming 產物)自主推進到 **merged PR + browser evidence + 四項回報**。
主對話 = 指揮官:只做 (a) phase 之間讀 StructuredOutput 比 gate 規則、(b) 配 args、(c) 命中強制停下點就輸出 hold block。苦工全在 named workflows 的 subagent(獨立 context)。

本技能是 Lane S 的明確 opt-in 流程；`agents/openai.yaml` 已禁止 implicit invocation。不得因任務非平凡、文字含「完成」、changed path 位於 code/tests，或模型主觀判斷而自行啟動。

**Source of truth 聲明**:本檔是 spec-to-done 的 Codex copy;phase / gate / HELD / resume / evidence / ship 語義必須精準對齊 `.claude/skills/spec-to-done/SKILL.md`。`std-*.js` 與 `ship-item` 的 canonical runtime 仍在 `.claude/workflows/`(compose,不重造);Codex 只能做 executor / model / path 配接,不得改寫成較弱的 parent-only 流程。

## Codex 對齊補充(只配接,不改 gate)

- `Workflow({name:'std-plan' | 'std-implement' | 'std-evidence' | 'fu-adversarial-verify-generic' | 'ship-item', args:{...}})` 在 Codex copy 仍代表**同一個 phase contract**:相同 args、相同 StructuredOutput 欄位、相同 retry / HELD / resumeFromRunId 語義;不得用「Codex-native phase mapping」替代或省略 P4/P5/P6。
- 若當前 Codex host 沒有 Claude workflow runtime,指揮官必須用可用 native subagents / workflow artifacts 產生等價 StructuredOutput;若無法產生等價 StructuredOutput,必須 HELD,不得 parent-only 手跑後視為通過。缺欄位、null reviewer、verdict 數量不符、無 browser evidence 一律依本檔 gate 重呼或 HELD,不得視為通過。
- 在 Codex host 中,`Workflow(...)` 的 host-side 等價操作是 `ultracode`-style workflow discipline:主 agent 編排、必要時 native subagents、artifact、StructuredOutput、gate、驗證與 HELD。這不是 Claude Code dynamic workflow runtime、不是 `/workflows` UI、也不代表 `.claude/workflows/*.js` 可在 Codex 直接執行。
- P0→P1→P3→P4→P5→P6→P7 的跳號排序不可整理成 P0-P7 連號;文中的 production P1/P2 / 真 P1/P2 是 quality / production blocker 等級,不是主對話新增 phase。
- spec-to-done 的請求本身即授權本流程推進到 merged PR;不要加入「commit / push / PR / merge 必須另行明確要求」的 Codex-only 限制。只有本檔列出的 consent carve-out / destructive / production-data / credentials / billing / user-account 類 gate 需要再停下。
- **Claude hook 不會自動帶入 Codex session**:目前 Codex CLI 支援 repo/global hooks，但本 repo 未配置與 Claude commit/browser hooks 完全等價的 Codex hook。P6 仍由指揮官顯式把關：(a) commit 前確認 verify、diff scope 與 message；(b) user-facing merge 前確認近 24h browser screenshot/trace，否則 HELD。
- **知識圖譜雙源(見下節)在 Codex 與 Claude 同義**:GitNexus = 合規主源、codebase-memory = advisory 第二意見。若當前 Codex host 未掛載某套 MCP server → 缺的那套降為「第二意見不可用」並在 note 註明,**不得因第二圖譜缺席或分歧翻轉任何 gate**;GitNexus 仍為唯一 risk/scope 判定來源。

## Claude/Codex 對齊契約(防 drift)

`.claude/skills/spec-to-done/SKILL.md` 是 phase / gate / HELD / resume / evidence / ship 語義 canonical;`.codex/skills/spec-to-done/SKILL.md` 只能作為 Codex adapter copy。兩份檔案可有差異,但差異必須落在下列白名單。

允許差異:

- Source-of-truth 文字可說明 Codex copy 仍以 Claude canonical 為準。
- Codex 可補充「無 Claude Workflow runtime 時如何產生等價 StructuredOutput / 何時 HELD」。
- Codex 可把 `Workflow(...)` 的 host-side 執行方式映射為 `ultracode`-style workflow discipline,但不得宣稱與 Claude Code dynamic workflow runtime 等價。
- Codex 可把 Claude haiku / sonnet / opus / fable routing tier 映射到可用 GPT model / reasoning effort。
- Codex 可補充 CLI 無 Claude hook 時的手動 commit / gstack gate 等價把關。
- Codex 可列出 `.codex/skills/spec-to-done/ensure-host-native-ports-free.ps1` 作為 helper fallback,但 helper 內容必須與 `.claude` copy 一致。
- Codex 可補充 `.codex/**` tracked whitelist 與 PR review 約束。
- Codex 可額外產出 runDir machine artifacts(`artifacts/spec-to-done/<slug>/` 下的 capability-snapshot.json、workflow-ir.json、acceptance-evidence-map.json、risk-register.json、parameter-provenance.json、human-approval-points.json、state.jsonl、event-log.jsonl、attempt-ledger.json、command-provenance.json、evidence/evidence-ledger.json)——advisory 痕跡,不參與任何 gate 判定;Claude 端不要求產出。

禁止差異:

- 不得改 P0/P1/P3/P4/P5/P6/P7 的 phase 順序、gate 條件、HELD 值語義或 resume contract。
- 不得把 `userFacing=true` 的 browser evidence gate 降級成 source inspection / unit test。
- 不得讓 codebase-memory 取代 GitNexus 的正式 risk/scope 判定。
- 不得把 `ultracode`-style discipline 說成 Claude Code `/effort ultracode`、dynamic workflow runtime、`/workflows` UI 或背景 workflow manager。
- 不得加入「需要另行授權 commit / push / PR / merge」來覆蓋本檔既有 spec-to-done ship 語義;只有 consent carve-out 類別可再停。
- 不得移除 P5 adversarial review、P6 ship-item、OpenSpec / pr-review-agent / GitNexus fallback 揭露等 gate。
- 不得在 Codex copy 自行創造與 `.claude/workflows/*.js` 不相容的欄位或 StructuredOutput 名稱。
- 不得使用 held 對照表以外的 held 值或複合值;環境阻斷一律 `host_env_blocked`。
- 不得在 state 行使用「State 行詞彙」白名單外的行首 token、英文 schema 欄位(`diagnosis=` / `need=` / `stateSchema=`)或 P2 phase 編號。

改任何一份 spec-to-done skill 時,同一 PR 必須跑 drift check:

```powershell
git diff --no-index -- .claude\skills\spec-to-done\SKILL.md .codex\skills\spec-to-done\SKILL.md
```

審查時只接受上方白名單差異;其餘 phase / gate / evidence / ship 語義差異一律視為 blocker。

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
     a. behavior gate:PR body 填 Change lane=S、Behavior contract changed=yes、
        Requirement source=superpowers spec,並連到本次已核准 specPath。不得只因 changed path
        建立 OpenSpec；只有 repo 需求明確要求 OpenSpec artifact 時才建立。
     a.1 base freshness gate:先把 implementation + evidence 的 tracked work commit 完整並確認 worktree clean；
        `git fetch origin +refs/heads/main:refs/remotes/origin/main` 後用 `git merge-base HEAD origin/main`
        與 `git rev-parse origin/main` 比對。不同代表 branch stale：尚無 prNumber 且未發布的 branch MUST
        `git rebase origin/main`；已有 prNumber 或 published PR branch MUST NOT 改寫 history，改用
        `git merge --no-edit origin/main` 以維持 normal push（conflict → HELD）。完成後重跑 affected verify、
        必要 evidence 與 GitNexus detect_changes；不得拿更新 base 前的驗證直接進 P6。
     b. push:git push -u origin <branch>
     c. gh pr create --base main(繁中):body 含 ──
        - Change lane / Behavior contract changed / Requirement source 三個 machine fields
        - user-facing:product-operability §4 的 10 列 Frontend 驗收表(資料來自 P4.evidence 的
          screenshots/runtimeIds/engine + **Read 其 summaryJson 檔**補齊 route/buttons/fixture/
          backend API/E2E command/manual steps)
        - P1.impact HIGH 的補強策略、P3.highRiskNotes
        - P3.detectFallbackTasks / detectFailTasks / fixDetectVerdicts(非 pass 項)的 GitNexus fallback 揭露
        - 若 impact 曾走 codebase-memory fallback(GitNexus UNKNOWN/crash)或有 `[xref]` 雙圖譜分歧 → 揭露「impact 由 codebase-memory 佐證;分歧 symbol(若有):…」(informational,非 gate)
        - 動 runtime/deploy 時附 Deploy Path 表;純 tooling/docs 註明不適用
        記下 prNumber
     d. local preflight（進入持 merge authority 的 workflow 前）：在目前已 push 的乾淨 head 上執行
        `.\scripts\dev\check-pr-local-preflight.ps1 -PrNumber <prNumber>`；通過後立即比對
        `git rev-parse HEAD` 與 `gh pr view <prNumber> --json headRefOid --jq .headRefOid` 完全相同。
        任一失敗或 head 改變都 HELD；不得把舊 head 的 preflight 當成 P6 證據。
P6 = Workflow({name:'ship-item', args:{branch, prNumber:<前置 c 的號碼>, userFacing}})
     P6 內部由 workflow coordinator 用固定命令收集即時 diff/checks/三處 reviews 與精確 base/head；唯一 child 是
       無 shell/write capability 的 apex arbiter。只有 identity-bound allow verdict 才能 merge；治理 gate 自我修改、
       缺 verdict、base/head 改變一律 HELD，merge command 必須帶 --match-head-commit。
     consume:
       P6===null → 對話回報 ship agent 失敗,重呼一次;仍 null → HELD
       P6.merged===true → P7
       P6.heldReason 屬 production P1/P2 → fix 迴圈(同 P5 的 mode:'fix',fixFindings=該 P1/P2)
         → 重呼 ship-item 帶同一 prNumber(沿用 PR 重跑 buffer cycle)
       P6.heldReason === 'review_required' → HELD；使用者須自行完成 CODEOWNER/manual approval，
         或由使用者自行執行 branch-protection admin override，再以同一 prNumber resume。agent MUST NOT run
         `gh pr merge --admin`，也不得把 required review 當成一般 CI 重試。
       P6.heldReason === 'cyber_safeguard_payload' → 僅當 reviewer/test 的目的只需階層 separator、
         不依賴 traversal/exploit 語意時，將 test-only payload 改成安全等價 `a/b` 或 `seg/seg/id`；
         對本次 payload-bearing test/fixture paths 跑 `rg -n 'passwd' <paths>`，必須無輸出才 resume
         原 P5/P6 phase。若替換會削弱 security regression，維持 HELD 並請使用者裁決。
       P6.heldReason 屬 consent carve-out(revert-*/release/hotfix/破壞性對外)→ HELD(須使用者明確同意)
       其他(CI 持續紅、merge conflict、report generation failed 類工具故障)→ 對話回報 +
         依 ship-item.md 判斷層次處置;不可只看 check 狀態 merge
P7 = 主對話回報四項:改了哪些 tracked files / 跑了哪些最小驗證 / 哪些測試沒跑及原因 / 已知風險
     + mergeCommit + evidence 路徑 + AGENTS.md 7 欄 Frontend 表(回報用;PR body 已用 10 列表)
     宣告前先對帳:OpenSpec/plan 的 task 勾選 ↔ state 檔 + task#N commits;不一致 → held='ledger_mismatch'
```

P1 內含 plan 四軸 review(Completeness/Spec Alignment/Task Decomposition/Buildability);P3 內含每 task 兩階段 review(spec 先 quality 後)— 都在 workflow 內自動修迴圈,不回主對話。

## held 對照表(workflow 回傳的全部 held 值與處置)

| held | 來源 | 指揮官處置 |
|---|---|---|
| `bad_args` | 任一 std-* / fu-generic(必填 args 缺或被字串化) | 修正 args 為正確 object 後重呼(非流程問題) |
| `plan_author_failed` / `plan_parse_failed` / `reviewer_agent_failed` | P1/P3 infra(agent 回 null) | 重呼該 workflow 一次(resumeFromRunId);再失敗 → HELD |
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
| `review_required` | P6 branch protection | HELD；使用者自行完成 manual/CODEOWNER approval 或 admin override 後，以同一 prNumber resume；agent 禁止 `gh pr merge --admin` |
| `cyber_safeguard_payload` | P5/P6 reviewer safeguard | separator-only fixture 才可換成 `a/b` / `seg/seg/id`，確認 payload paths 的 `passwd` grep 無結果後 resume；涉及 security 語意則 HELD |
| `ship_blocked` 類(由 heldReason 文字) | P6 | 見編排 P6 consume |

## 強制停下點(repo 規範明文,不可自動繞)

spec 矛盾(P0/P1)、GitNexus CRITICAL(未 ack)、browser evidence not observed、真 P1/P2 修不閉合、ship consent carve-out、工具反覆故障(detect 3 次 / GitNexus 不可復原)。
HIGH 不是停下點:在對話中明確回報 blast radius 後繼續,PR body 必寫補強策略(P6 前置 c 是執行通道)。

**Hold block 固定格式**(輸出後停;同時 append 到 state 檔):

```
HELD@P<n> | reason=<held 值> | spec=<specPath> | slug=<slug> | userFacing=<bool> | dateStamp=<..>
| branch=<..> | worktree=<絕對路徑> | planPath=<..> | taskIndex=<..> | prNumber=<..>
| runIds=<P1:wf_.. P3:wf_.. ...> | 診斷=<specConflict/gaps/blockedDetail 摘要> | 需要使用者決定=<具體選項>
```

## Resume(使用者一句話重入;支援跨 session)

- **State 檔(durable,跨 session 唯一座標)**:每個 phase 完成或 HELD 時,把上方 hold block 格式的一行 append 到主工作區 `artifacts/spec-to-done/<slug>-state.md`(TodoWrite 與 transcript 不跨 session,不可依賴)。
- 「繼續 spec-to-done」→ 讀 state 檔最後一行還原全部 args → 只重跑該 phase:`Workflow({name:<phase>, args:{...還原}, resumeFromRunId:<該 phase runId>})`(resumeFromRunId 讓已完成的 agent 呼叫吃 cache,只重跑未完成段)。
- 前序產物(plan 檔、commits、evidence)都在 git/磁碟,不重做;P3 錨點 = startTaskIndex(per-task commit 訊息規定前綴 `task#N:`,崩潰時可從 git log 重建);P6 帶同一 prNumber(ship-item 沿用既有 PR,不重複 create)。
- 時間戳一律由主對話經 args 注入(dateStamp);workflow 內禁時鐘/亂數 API。

## State 行詞彙與簽核委派(跨 CLI resume 契約;Claude 與 Codex 共用)

state 檔是跨 session / 跨 CLI 的唯一 resume 座標;自本節加入起,新寫入的行一律遵守下列詞彙(歷史行不回溯改寫,讀取時盡力解析):

- **行首 token 只允許四種**:`HELD@P<n>`(hold block 格式)、`DONE@P<n>`(phase 完成;task 級進度寫進 `taskIndex=`/`commit=` 欄位,不另創行首)、`RESUMED@P<n>`(使用者重入,附 `decision=`)、`AUTHORIZATION@P<n>`(簽核委派,見下)。
- **`reason=` 的 held 值 MUST 取自本檔「held 對照表」**;不得發明表外值、不得把多個值併成複合值(一行一個主因,其餘寫診斷欄)。host/環境層阻斷一律用 `host_env_blocked`。
- **欄位鍵固定 hold block 的中文鍵**(`診斷=`、`需要使用者決定=`);不得混入其他 schema 的同義欄位(`diagnosis=` / `need=` / `stateSchema=`)。歷史檔案中的 `需要使用者決定:` 視為等價舊寫法。
- **phase 編號固定 P0/P1/P3–P7 跳號,不存在 P2**;任何 state 行不得出現 `P2`(全域或他處 skill 的「P2 Test Design」詞彙不得滲入本 repo 的 run;測項設計屬 P1 plan 範圍)。

**簽核委派(delegated sign-off)**:使用者可顯式委派一個獨立 read-only agent 代行本 run 後續 HIGH/CRITICAL sign-off。委派必須由使用者明說(agent 不得自行發起或暗示),記錄為一行:

```
AUTHORIZATION@P<n> | decision=delegate-repo-workflow-signoff | scope=<代簽範圍> | exclusions=<排除項> | 診斷=<使用者授權原文摘要>
```

scope 僅限 repo workflow 的 impact/detect/review sign-off;secrets、credentials、billing、production data、不可逆刪除、未證明 ownership 的程序停止**永遠排除、不可委派**。代簽結果仍走 `acknowledgedCriticalSymbols` 通道並照常記入 state 檔;委派不解除 `critical_impact` 以外的任何 HELD 類別。

## 啟動 / 重建 backend stack 前置:host-native port preflight(防 deploy Read-Host 卡死)

**預設鐵則**:跑 `.\scripts\deploy.ps1` 或 `.\scripts\dev\rebuild-test-deploy.ps1 -Build` **之前**,指揮官(主對話)
MUST 先從主工作區 root 執行第一個存在的 helper。無參數與 `-DetectOnly` 都是 read-only；不得預設停止任何程序。兩份
helper 內容必須維持一致(user 級路徑不存在,勿引用):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\spec-to-done\ensure-host-native-ports-free.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .codex\skills\spec-to-done\ensure-host-native-ports-free.ps1
```

**測試部署區真實驗證授權(放寬但限縮)**:只有明確執行 spec-to-done、目前 spec 的 PR 已 merge 且 commit 可由 freshly
fetched `origin/main` 取得時，才可在 P7 真實驗證前對第一個存在的 helper 執行 explicit stop 模式，接著走唯一 rebuild 入口:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\spec-to-done\ensure-host-native-ports-free.ps1 `
  -StopOwnedRuntime -DeploymentRoot 'D:\Users\deploy\AI-bim-geo'
# 若只有 Codex copy 存在，使用同參數呼叫 .codex\skills\spec-to-done\ensure-host-native-ports-free.ps1
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

## 模型預算與角色路由（Codex）

模型與 reasoning effort 不在本 adapter 內固定。依全域 `C:\Users\IOT\.codex\docs\agents\task-routing.md` 的 task tier 與 capability routing，指揮官使用目前 session 選定的 global profile，並依工作內容派發角色 lane：`explorer` 負責 source discovery，`debugger` 負責 root-cause isolation，`reviewer` 負責 correctness / regression review，`security_auditor` 負責 auth、權限、破壞性操作與部署風險。各 lane 的 effort 由 global task tier 決定，不得在此文件寫死模型 slug。

角色路由不改變本流程的 gate 或升級語意：P4 evidence、P5 verifier/critic 與 P6 ship-item 一律使用 Codex 可用的完整 lane；P6 由 workflow coordinator 用固定命令收集 evidence 並獨占 merge sink，唯一 child 是無 shell/write capability 的獨立 apex arbiter。因為 adapter 运行於 Codex，不得以模型差異刪減、降級或放寬 P4/P5/P6、HELD、resume 或 evidence 條件。平行僅限互不衝突的 review / verification；P3 implementer 維持單一協調流程。

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
3. commit trailer:std-*.js 與 ship-item 內的 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 是 **harness attribution 文字、非 Codex 模型調用**。Codex agent 實際模型分配以本檔「模型預算」表為準;trailer 已於 2026-07-02 與 Claude 側 harness commit 規則同步為單一 trailer,Codex 側 commit 沿用同一字面。
4. GitNexus detect-changes 在 linked worktree 看不到 staged(已知坑)→ implementer fallback `git diff --name-only --cached` 並記 `detectVerdict='fallback'`,PR body 揭露;完全失敗記 `fail`,同 run 3 次 → held。
5. pr-review-agent 會阻擋 behavior=yes 卻缺 formal requirement source，或 behavior=no 但 diff 明顯新增 route/API/schema/外部行為；`report generation failed` 仍是工具整體故障。
6. 本組檔案已 whitelist tracked(`.gitignore:37` `!.claude/skills/spec-to-done/`、`:42` `!.claude/workflows/`、`:55` `!.codex/skills/spec-to-done/`;含 SKILL.md、std-*.js、ship-item、本目錄 `ensure-host-native-ports-free.ps1`),隨 PR 進 git/CI。pr-review-agent 對所有 PR 都會跑(#202 的 paths-ignore 已移除,`pr-review-agent.yml` 現無 paths 過濾),且是 main branch protection 的 required check(11 項之一;2026-07-02 以 gh api 親查)——`.claude/**` / `.codex/**` 變更同樣受 review 與 AI Coding Governance body-evidence 表約束。
7. P1 四軸 review 第二輪起只重審上輪未過的軸(fixer 改 plan 可能影響已過軸)— 由 P3 per-task spec review 與 P5 critic 兜底,屬已知取捨。

## 維運注意事項

1. `routing.json` 改動後須跑 `.venv\Scripts\python.exe scripts/gen_routing.py` 重生各 `std-*.js` 的 ROUTING 區塊,並 re-save 受影響 workflow 讓 harness reload;禁止 workflow run 中途執行 codegen。
2. `.codex/skills/spec-to-done/SKILL.md` 不擁有獨立 workflow runtime;Codex 端只能用 `ultracode`-style discipline / native subagents / artifacts 近似 `.claude/workflows/` 的 canonical runtime contract。若未來新增 `.codex/workflows/`,必須先證明輸出欄位與 HELD / resume semantics 與 `.claude/workflows/` 等價。
3. 更新 `.claude/skills/spec-to-done/SKILL.md` 時必須同步檢查 `.codex/skills/spec-to-done/SKILL.md`;更新 `.codex` adapter 時也必須確認未改變 `.claude` canonical gate。
