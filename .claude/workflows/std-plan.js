// Retired compatibility entrypoint: no dispatch, filesystem, runtime, or merge effects.
export const meta = {
  name: 'std-plan',
  description: 'RETIRED: spec-to-done 已退役，請依既有需求逐刀 PR 交付。',
  phases: [{ title: 'Retired', detail: 'No workflow execution' }],
}

return {
  ok: false,
  held: 'retired_workflow',
  workflow: 'std-plan',
  agentCallsUsed: 0,
  detail: 'spec-to-done retired; use the authorized sequential PR scope and normal repository checks.',
}
