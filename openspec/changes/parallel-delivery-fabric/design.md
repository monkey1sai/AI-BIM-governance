# Design: Phase-gated Parallel Delivery Fabric

## Authority boundary

This change owns the activation boundary for the approved Fabric design. The activation order is `shadow -> canary -> active`; a later phase cannot be inferred from documents, a passing local test, or an adapter's own output.

Before a validated activation record exists, the live policy is one writer, the `direct_stack` path is `HELD`, and the existing counted review remains the only review authority. The record is evidence for an external authority; it does not grant an agent permission to push, approve, merge, deploy, stop a process, or alter branch protection.

## One-way review migration

The migration is add-before-remove. A source-pinned external CheckRun is observed in shadow before it can become active, then a disposable canary proves the exact tuple. The counted review cannot be retired until the external CheckRun is active and the canonical record reaches `AUTONOMOUS_ACTIVE`.

The only phase values are `LEGACY_GUARDED`, `SHADOW_DUAL`, `CUTOVER_ARMED`, `CANARY_ACTIVE`, and `AUTONOMOUS_ACTIVE`. Every other spelling, alias, and out-of-order transition is rejected by the future queue, trust-root, and policy fixtures.

## Reconciliation boundary

The autonomous-linux-delivery change remains the owner of its historical lifecycle evidence. Phase 0 does not modify that archive; it replaces future fixpoint or reconciliation closure work with one ordinary protected PR under the normal exact-head, CODEOWNER, branch-protection, and required-check gates.
