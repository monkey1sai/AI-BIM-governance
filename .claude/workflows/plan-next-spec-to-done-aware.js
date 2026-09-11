// Retired compatibility entrypoint: no dispatch, filesystem, runtime, or merge effects.
export const meta = {
  name: 'plan-next-spec-to-done-aware',
  description: 'RETIRED: spec-to-done 已退役，請依既有需求逐刀 PR 交付。',
  phases: [{ title: 'Retired', detail: 'No workflow execution' }],
}

return {
  ok: false,
  held: 'retired_workflow',
  workflow: 'plan-next-spec-to-done-aware',
  agentCallsUsed: 0,
  detail: 'spec-to-done retired; use the authorized sequential PR scope and normal repository checks.',
}
