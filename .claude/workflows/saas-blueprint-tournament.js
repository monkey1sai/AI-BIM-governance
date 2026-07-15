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
  'Use docs/plans/docs-plans-README.md and the canonical design doc',
  '"AI-BIM 前後端設計文件.dc.html" (§01–§08); the old TRUTH/TARGET-*/BACKLOG/PROCESS docs were removed on 2026-07-15 (#342).',
  'Open a new OpenSpec change instead of generating a parallel docs layer.',
].join(' '))
