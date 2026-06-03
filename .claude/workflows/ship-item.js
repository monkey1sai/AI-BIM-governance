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

const result = await agent(`你是 AI-BIM-governance 的 ship-cycle 執行 agent。請對一個已完成的 work item 走 .claude/workflows/ship-item.md 定義的完整 buffered ship-cycle。

context：
- repo：${REPO}
- branch：${BRANCH || '(用當前 feature branch)'}
- 既有 PR 號：${PR_NUMBER === null ? '(尚未開，需 gh pr create --base main)' : PR_NUMBER}
- 是否 user-facing capability：${USER_FACING ? '是，PR body 需附 Frontend Verification table（見 AGENTS.md §0.1）' : '否（若動 runtime/deploy 仍需 Deploy Path Verification table；純 tooling/docs/spec 需在 body 註明不適用兩表）'}

你 MUST 親手用 git / gh 跑（本腳本只是包裝，不替你等 CI、不替你 merge）：
1. commit 前 git diff --cached --check（擋 trailing whitespace / EOF blank），有就先修。
2. commit，訊息繁中，結尾附 Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>。
3. git push -u origin <branch>（遇 force-push deny 改用新 commit 取代 amend）。
4. 回報 git diff --stat 與 git log。
5. 開 PR（gh pr create --base main，繁中），依上面 user-facing 規則附對應驗收表或註明不適用。
6. gh pr checks <n> --watch 等官方 checks。
7. CI 變綠後再等 ~90-120s reviewer buffer。
8. gh api repos/${REPO}/pulls/<n>/comments | jq 'group_by(.original_commit_id)'，只看當前 head 上的新 inline comment。
9. GATE：官方 checks 全綠（pr-review-agent + CodeRabbit）且當前 head 無新 substantive P1/P2 → gh pr merge <n> --squash --delete-branch → closeout（git worktree remove、git fetch --prune、本地 main --ff-only 對齊 origin/main）。
10. 有新 substantive 發現 → 修 → push → 對每一次 push 各自重跑 step 6-9 的 buffer cycle，SHALL NOT 只看 check 狀態就 merge。

誠實鐵律：絕不 merge 過 production code 的真 P1/P2，絕不偽裝 CI 綠。production code 的 P1/P2 一律 hold 修到好；非 production 產物（evidence / docs scaffolding）的 advisory nit 在官方 gate 全綠時 MAY judgment-merge，不無限迴圈。

回傳 StructuredOutput：merged（是否已 squash-merge）、prNumber、mergeCommit（merge commit sha，未 merge 為 null）、heldReason（若未 merge，說明 hold 原因；已 merge 為 null）。`,
  { label: `ship:${BRANCH || 'work-item'}`, phase: 'Ship', schema: RESULT_SCHEMA })

log(`ship-item 結果：merged=${result ? result.merged : 'null'} pr=${result ? result.prNumber : 'null'} held=${result ? result.heldReason : 'null'}`)
return result
