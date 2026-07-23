# AI-BIM Governance Domain Context

Canonical project language for BIM review sessions, runtime mutation policy, and the boundary between coordinator decisions and Kit execution.

## Language

**Runtime Mutation Authority**:
The coordinator-owned, session-scoped policy state machine covering stage-binding preauthorization, Kit command authorization, rollback, and confirmation. It does not execute Kit mutations or own the viewer lease lifecycle.
_Avoid_: Runtime command service, Kit mutation service

**Stage Binding Transaction**:
The coordinator-owned lifecycle record created by browser preauthorization for one resolved stage composition. It may remain pending, become executing, active, or failed, or be superseded without a Kit execution attempt.
_Avoid_: Stage request, Binding job

**Stage Binding Attempt**:
The immutable identity of one proposed Kit stage-load execution tied to a Stage Binding Transaction. Its base tuple is authorization and revision IDs, session, lease, source client, and full stage composition; once claimed, request ID and event type also become part of equality.
_Avoid_: Stage request, Runtime attempt
