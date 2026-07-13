export const meta = {
  name: 'saas-blueprint-tournament',
  description: 'RETIRED：PR #301 一次性 SaaS 文件產生器；輸入封包與舊 11-file contract 已不存在',
  phases: [
    { title: 'Retired', detail: 'Fail closed；改讀 docs/plans current core' },
  ],
}

throw new Error([
  'retired_workflow: saas-blueprint-tournament was a one-time PR #301 generator.',
  'Its research input packet and 11-document rewrite contract no longer exist.',
  'Use docs/plans/docs-plans-README.md, TRUTH.md, TARGET-contracts.md,',
  'TARGET-shell.md, TARGET-viewer.md, BACKLOG.md, and PROCESS.md.',
  'Open a new OpenSpec change instead of generating a parallel docs layer.',
].join(' '))
