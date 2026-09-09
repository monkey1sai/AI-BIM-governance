# P1/P3 — concise planning and implementation

P1 的產物是需求對應、明確 touch-set、相依順序、風險與驗證命令。
已有核准 spec 時沿用它；不再建立另一份完整 code 計畫、不要求 2–5 分鐘微步驟。
一個 task 是可獨立驗收的切片；四個規劃軸由一次獨立 review 同時覆蓋。
P1.planReview 的 completeness/spec-alignment/task-decomposition/buildability 都必須 approved。

## Deterministic plan format

````markdown
# Feature implementation plan
Goal: ...
Requirement source: ...

### Task 1: Read-only history
```spec-task
{"files":["src/history.ts","tests/history.test.ts"],"symbols":["readHistory"],"userFacingTouch":false,"securitySensitive":true}
```
Acceptance: authorized callers can read history; denied callers get no data.
Dependency: existing authorization adapter.
Verify: the affected authorization/history tests.
````

Task numbers 從 1 連續；metadata 四個鍵固定。files 是 repo-relative paths；
symbols 只列會修改的既有 symbols；新 symbol 不冒充已索引。
securitySensitive 涵蓋 auth、permission、secrets、injection、migration、destructive data；
不確定為 true。舊計畫缺 metadata 時只補有 source 證據的欄位，保留需求；無法判斷則 HELD。

Host 執行：
```text
node .claude/skills/spec-to-done/parse-plan.mjs --root <worktreeRoot> --plan <repo-relative-plan.md>
```

Parser 驗 fence、連續 task、closed metadata、路徑與大小；拒絕 root 外 realpath。
P1 完成與每次修 plan 後保存 parser 的 planSha256。P3 前重跑 parser 並比對該 digest；
變更需求/計畫必須回 P1，只改 metadata 格式也需重新驗證，不接受 stale packet。
取得當前 git HEAD 作本次 P3 的 baseSha（full 40 hex）。
packet 只是 coordinator-attested input；不是簽章、工具/檔案授權或 runtime evidence。

## Host with Workflow runtime

```text
P1 = Workflow({name:'std-plan', args:{specPath,slug,dateStamp,branch,worktreeRoot,userFacing,
  acknowledgedCriticalSymbols:[],remainingAgentCalls}})
gate: P1.ok===true；HIGH 明確回報補強，CRITICAL/UNKNOWN 依 repo gate。

P3 = Workflow({name:'std-implement', args:{planPath:P1.planPath,planSha256:P1.planSha256,
  planPacket:<fresh parser JSON>,baseSha:<current HEAD>,worktreeRoot,branch,specPath,userFacing,
  startTaskIndex:0,maxFixRounds:2,acknowledgedCriticalSymbols:[],mode:'tasks',
  fixFindings:[],remainingAgentCalls}})
gate: P3.held 停止；P3.ok 才進 P4；finalReview findings 仍交 P5。
```

P3 維持一個 writer。每個切片一次整合 review，涵蓋 spec、correctness、測試和所有 fix commit scope。
securitySensitive 或 HIGH 另加獨立安全 review；CRITICAL sign-off 仍在改前。
spec gaps、critical/important findings 未閉合不能宣告切片完成。
修後只審 findings 與受影響相依面；沒有新 commit/evidence 不重審。
單切片沿用這次 review 作 finalReview；多切片才加一次整合接點 review。P5 始終保留。

## Native Codex/Grok host

主代理可直接規劃、寫碼與執行驗證；使用同一 parser、review criteria、state validator。
只有需要獨立判斷的 plan/task/security/P5 review 才委派，不為模擬 Claude runtime 額外派 implementer。
按目前 host 取得實際 phase output；未執行 Workflow 不宣稱執行過。
原生 reviewer 使用有界需求、精確 diff、測試結果與未閉合 findings；
Codex 使用 fork_turns:"none"，runIds 記 codex:<actual-session-or-agent-id>。
每次實際 spawn/follow-up 都計數；不用虛構 workflow IDs 或補造 calls。

## Evidence-only closeout

executionMode=evidence-closeout 僅適用已核准的 closeoutTaskIds。
P1 scope lock；P3 使用 std-evidence-closeout，不能呼叫 std-implement 或改 production。
productionFilesChanged 非空、HEAD 漂移、task IDs 不完整均 HELD。
P4 skipped reason=evidence-closeout；P5 仍以 closeout findings 執行 critic。
所有重試計入原本 maxEvidenceAttempts 與 maxAgentCalls。
