// 這是 Workflow-tool 腳本（由 Workflow({name:'ship-item', args}) 執行），非 standalone Node 程式。
// args / phase / log / agent 等 global 由 Workflow runtime 注入；`node --check` 只驗語法、無法獨立 run。
// 權威程序與閘門見 .claude/workflows/ship-item.md。
export const meta = {
  name: 'ship-item',
  description: '每完成一個 work item 自動 ship：commit→push→PR→diff/log→CI watch→+90~120s reviewer buffer→buffered auto-merge→closeout。權威程序見 .claude/workflows/ship-item.md。',
  phases: [{ title: 'Ship', detail: 'commit/push/PR/CI watch/buffer/gate/merge/closeout（不可只看 check 狀態）' }],
}

const BRANCH = args.branch || ''
const PR_NUMBER = args.prNumber || null
const USER_FACING = args.userFacing === true
const REPO = 'monkey1sai/AI-BIM-governance'

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['merged', 'prNumber', 'mergeCommit', 'heldReason'],
  properties: {
    merged: { type: 'boolean' },
    prNumber: { type: ['integer', 'null'] },
    mergeCommit: { type: ['string', 'null'] },
    heldReason: { type: ['string', 'null'] },
  },
}

phase('Ship')
log(`ship-item：branch=${BRANCH || '(未指定)'} pr=${PR_NUMBER || '(待開)'} userFacing=${USER_FACING}`)

const result = await agent(`你是 AI-BIM-governance 的 ship-cycle 執行 agent。請對一個已完成的 work item 走 .claude/workflows/ship-item.md 定義的完整 buffered ship-cycle。（本 prompt 步驟 0-11 與 ship-item.md 為雙份維護：修改任一側 MUST 同步另一側。）

context：
- repo：${REPO}
- branch：${BRANCH || '(用當前 feature branch)'}
- 既有 PR 號：${PR_NUMBER === null ? '(尚未開，需 gh pr create --base main)' : PR_NUMBER}
- 是否 user-facing capability：${USER_FACING ? '是，PR body 需附 Frontend Verification table（見 AGENTS.md §0.1）' : '否（若動 runtime/deploy 仍需 Deploy Path Verification table；純 tooling/docs/spec 需在 body 註明不適用兩表）'}

你 MUST 親手用 git / gh 跑（本腳本只是包裝，不替你等 CI、不替你 merge）：
0. 先確保 checkout / worktree 正確：若上面給定 branch 且當前不在該 branch（git rev-parse --abbrev-ref HEAD 比對），不得在主 repo checkout 直接 git checkout <branch> / git switch <branch>。先 git worktree list，使用既有 dedicated worktree 或建立 sibling worktree 後再 ship；若已在 dedicated worktree 內，才允許切到該 worktree 對應 branch，避免主 checkout dirty files 污染 PR。
1. commit 條件式——**僅在有新 staged 改動時才 commit**：先 git diff --cached --check 擋 trailing whitespace / EOF blank（有就先修乾淨）；若 work item 已 commit 在 branch 上、git diff --cached 為空（無新 staged 改動），**SHALL 跳過 commit**，不要產生空 commit。
2. （承上，有 staged 改動時）commit，訊息繁中，結尾附 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。
3. git push -u origin <branch>（遇 force-push deny 改用新 commit 取代 amend）。
4. 回報這次 ship 的改動面：git diff --stat origin/main...HEAD（已 commit 的 diff）與 git log。
5. 開 PR：branch 尚無 PR 才 gh pr create --base main；已有 PR（上面給定 PR 號）則**沿用、不重複建立**（重複 create 會失敗中斷）。繁中，依上面 user-facing 規則附對應驗收表或註明不適用。
6. gh pr checks <n> --watch 等官方 checks。
7. CI 變綠後再等 ~90-120s reviewer buffer。
8. 查 reviewer P0/P1/P2 發現（三處來源，全部 --paginate）：只偵測 P0/P1/P2 等級關鍵字（P0、P1、P2、Blocker、Critical、High、CHANGES_REQUESTED；P0/Blocker/Critical 視同 P1-equivalent hold，High 視同 P2），避免把 nit / low / medium / style-only 建議升級成自動修復輸入；任一處有未解除 P0/P1/P2 finding 都 hold。HEAD=$(gh pr view <n> --json headRefOid --jq .headRefOid)。(a) inline diff comment：gh api --paginate repos/${REPO}/pulls/<n>/comments | jq -s "add | map(select(.commit_id|startswith(\\"\${HEAD:0:9}\\")))"（用 commit_id「現所在 commit」非 original_commit_id「首次 commit」，後者會漏掉留在當前 head 的新 comment；不用 group_by）。(b) PR-level review（summary / CHANGES_REQUESTED，整體 verdict 常落這）：gh api --paginate repos/${REPO}/pulls/<n>/reviews。(c) PR 對話串 issue comment（pr-review-agent summary 的 Blockers 走 issue endpoint，不在 /pulls/comments 內）：gh api --paginate repos/${REPO}/issues/<n>/comments。對每個 P0/P1/P2 finding，SHALL 建立穩定 key：source + file/path + line/anchor + normalized finding text，作為 carry-forward 與同一處不重複 autofix 的依據。
9. 跨 push carry-forward 與 autofix gate：不可只看「當前 head 是否還有新 comment」就放行。reviewer 在舊 head 提出的 P0/P1/P2，若 push 新 head 但並未真正修復（reviewer 未重貼確認、或只是 commit_id 被推離當前 head），仍視為未解除。SHALL 自行維護一份「已知未解除 P0/P1/P2 finding」清單，跨每次 push 沿用、逐項判斷是否確已修復，不可清空重來；comment 因 commit_id 移出當前 head 而被篩掉，不可據此當已解決。P0/P1/P2 finding 進入 autofix 前 MUST 啟動交叉對抗驗證：builder 提出最小修法與驗證；verifier 反查 source of truth、blast radius、是否已修過同一 key、是否可能是假陽性或產品決策；coordinator 裁定 autofix / hold for user / reject as false positive。同一 finding key 在同一 PR 生命週期內最多只允許一次 autofix 嘗試；若同一處再被 reviewer 重貼或 autofix 後仍失敗，停止第二次自動修補並 hold 回報。
10. GATE：官方 checks 全綠（main branch protection 的全部 required checks，現含 pr-review-agent、agent-governance 與各 build/test；CodeRabbit 非 required check，其發現走 step 8 交叉查看）且 step 8 三處來源無新增 substantive P0/P1/P2、step 9 carry-forward 清單已全數解除 → gh pr merge <n> --squash --delete-branch → closeout。closeout worktree 守衛：git worktree remove 只能用在 linked/disposable worktree（路徑在 .worktrees/ 下）；先判斷 GIT_DIR=$(git rev-parse --git-dir) 與 COMMON=$(git rev-parse --git-common-dir)，若 GIT_DIR==COMMON 且 toplevel 不在 .worktrees/ 下代表是「主 checkout」，**SHALL NOT git worktree remove 主 checkout**（會出錯/危險），只做 git fetch --prune + 本地 main --ff-only 對齊 origin/main；只有 disposable worktree 才 git worktree remove <toplevel>。
11. 有新 P0/P1/P2 finding（或 carry-forward 清單仍有未解項）→ 先做交叉對抗驗證 → 若裁定 autofix，做一次最小修補 → push → 對每一次 push 各自重跑 step 6-10 的 buffer cycle；同一 finding key 不得第二次自動修補，SHALL NOT 只看 check 狀態就 merge。

誠實鐵律：絕不 merge 過 production code 的真 P0/P1/P2，絕不偽裝 CI 綠。production code 的 P0/P1/P2 一律 hold 修到好；非 production 產物（evidence / docs scaffolding）的 advisory nit 在官方 gate 全綠時 MAY judgment-merge，不無限迴圈。

回傳 StructuredOutput：merged（是否已 squash-merge）、prNumber、mergeCommit（merge commit sha，未 merge 為 null）、heldReason（若未 merge，說明 hold 原因；已 merge 為 null）。`,
  { label: `ship:${BRANCH || 'work-item'}`, phase: 'Ship', schema: RESULT_SCHEMA })

log(`ship-item 結果：merged=${result ? result.merged : 'null'} pr=${result ? result.prNumber : 'null'} held=${result ? result.heldReason : 'null'}`)
return result
