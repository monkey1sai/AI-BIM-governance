import assert from 'node:assert/strict'
import test from 'node:test'

import { digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'
import {
  consumeHostInventoryAttestation,
  createProviderAdapter,
  verifyClaudeConfiguration,
  verifyExecutionContextAttestation,
  verifyOwnerEndAttestation,
} from '../../lib/parallel-delivery-fabric-adapters.mjs'

const SHA1_A = 'a'.repeat(40)
const SHA1_B = 'b'.repeat(40)
const SHA256_A = 'c'.repeat(64)
const SHA256_B = 'd'.repeat(64)
const NOW = '2026-08-29T04:00:00.000Z'
const LATER = '2026-08-29T04:05:00.000Z'
const EARLIER = '2026-08-29T03:55:00.000Z'
const NONCE = 'n'.repeat(32)

const TRUSTED_TUPLE = Object.freeze({
  owner_session: 'session:writer-one',
  provider: 'codex',
  provider_session_id: 'provider-session:one',
  execution_context_id: 'execution-context:one',
  lease_id: 'lease:writer-one',
  repo_identity_digest: SHA256_A,
  common_dir_digest: SHA256_B,
  worktree_id: 'worktree:one',
  worktree_path_digest: SHA256_A,
  branch: 'codex/fabric-adapters',
  baseline_sha: SHA1_A,
  head_sha: SHA1_B,
  scope_digest: SHA256_B,
  launcher_lineage_digest: SHA256_A,
})

const EXECUTION_PINS = Object.freeze({
  issuer_id: 'issuer:execution-context',
  issuer_version: 'execution-context-attestor/v1',
  source_digest: SHA256_A,
  revocation_epoch: 7,
  now: NOW,
})

const contextAttestation = (overrides = {}) => ({
  schema_version: 'execution-context-attestation/v1',
  attestation_ref: 'attestation:execution-context-one',
  issuer_id: EXECUTION_PINS.issuer_id,
  issuer_version: EXECUTION_PINS.issuer_version,
  source_digest: EXECUTION_PINS.source_digest,
  observed_at: NOW,
  expires_at: LATER,
  nonce: NONCE,
  revocation_epoch: EXECUTION_PINS.revocation_epoch,
  git_ownership_trust: 'VERIFIED',
  host_local_mapping: 'VERIFIED',
  nested_cli: false,
  nested_worktree: false,
  shared_execution_context: false,
  ...TRUSTED_TUPLE,
  ...overrides,
})

const executionInput = (overrides = {}) => ({
  attestation: contextAttestation(),
  expected: TRUSTED_TUPLE,
  ...overrides,
})

const executionPins = ({ verify = () => true, consume = () => true } = {}) => ({
  execution_context: { ...EXECUTION_PINS, verify, consume_nonce: consume },
})

const SAFE_CLAUDE_SETTINGS = Object.freeze({
  disableAllHooks: true,
  permissions: {
    defaultMode: 'plan',
    disableBypassPermissionsMode: 'disable',
    allow: [
      "Bash(powershell -NoProfile -Command 'Get-Process kit -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '\\\\''C:\\\\Repos\\\\active\\\\iot\\\\AI-BIM-governance\\\\bim-streaming-server\\\\_build\\\\*kit.exe'\\\\'' } | Select-Object Id, Path, StartTime | Format-Table -AutoSize -Wrap')",
      "Bash(powershell -NoProfile -Command \"Write-Host 'pwsh ok'\")",
      'Bash(powershell -NoProfile -Command "Get-Process kit -ErrorAction SilentlyContinue | Select-Object Id, Path, StartTime")',
    ],
  },
  enabledPlugins: { 'superpowers@claude-plugins-official': false },
})

const SAFE_COMMANDS = Object.freeze(['control-metadata:record'])
const POLICY_AUTHORITY = Object.freeze({
  policy_ref: 'policy:provider-command-base',
  issuer_id: 'issuer:provider-policy',
  issuer_version: 'provider-policy-attestor/v1',
  source_digest: SHA256_B,
  revocation_epoch: 7,
  now: NOW,
})
const policyDocument = (overrides = {}) => {
  const { policy_digest: claimedDigest, ...rest } = overrides
  const unsigned = {
    schema_version: 'provider-command-policy-attestation/v1',
    policy_ref: POLICY_AUTHORITY.policy_ref,
    issuer_id: POLICY_AUTHORITY.issuer_id,
    issuer_version: POLICY_AUTHORITY.issuer_version,
    source_digest: POLICY_AUTHORITY.source_digest,
    issued_at: NOW,
    expires_at: LATER,
    nonce: 'p'.repeat(32),
    revocation_epoch: POLICY_AUTHORITY.revocation_epoch,
    commands: [...SAFE_COMMANDS],
    ...rest,
  }
  return { ...unsigned, policy_digest: claimedDigest ?? digestCanonical(unsigned) }
}
const BASE_POLICY = Object.freeze(policyDocument())
const commandPolicy = ({ policy = BASE_POLICY, pin = {}, verify = () => true, consume = () => true } = {}) => ({
  policy,
  trusted_pin: {
    ...POLICY_AUTHORITY,
    policy_digest: BASE_POLICY.policy_digest,
    verify,
    consume_nonce: consume,
    ...pin,
  },
})

const CLAUDE_AUTHORITY = Object.freeze({
  source_ref: 'source:claude-settings-base',
  issuer_id: 'issuer:claude-config',
  issuer_version: 'claude-config-attestor/v1',
  source_digest: SHA256_A,
  revocation_epoch: 7,
  now: NOW,
  settings_digest: digestCanonical(SAFE_CLAUDE_SETTINGS),
  command_policy_digest: BASE_POLICY.policy_digest,
})
const configurationAttestation = (overrides = {}) => ({
  schema_version: 'claude-configuration-attestation/v1',
  attestation_ref: 'attestation:claude-settings-one',
  issuer_id: CLAUDE_AUTHORITY.issuer_id,
  issuer_version: CLAUDE_AUTHORITY.issuer_version,
  source_digest: CLAUDE_AUTHORITY.source_digest,
  observed_at: NOW,
  expires_at: LATER,
  nonce: 'c'.repeat(32),
  revocation_epoch: CLAUDE_AUTHORITY.revocation_epoch,
  settings_digest: CLAUDE_AUTHORITY.settings_digest,
  command_policy_digest: CLAUDE_AUTHORITY.command_policy_digest,
  ...overrides,
})
const claudeInput = (overrides = {}) => {
  const settings = Object.hasOwn(overrides, 'settings') ? overrides.settings : structuredClone(SAFE_CLAUDE_SETTINGS)
  const settingsDigest = Object.hasOwn(overrides, 'settings_digest') ? overrides.settings_digest : digestCanonical(settings)
  const commandPolicyDigest = Object.hasOwn(overrides, 'command_policy_digest')
    ? overrides.command_policy_digest : BASE_POLICY.policy_digest
  const attestation = Object.hasOwn(overrides, 'configuration_attestation')
    ? overrides.configuration_attestation
    : configurationAttestation({ settings_digest: settingsDigest, command_policy_digest: commandPolicyDigest })
  return {
    source_ref: CLAUDE_AUTHORITY.source_ref,
    settings,
    settings_digest: settingsDigest,
    command_policy_digest: commandPolicyDigest,
    configuration_attestation: attestation,
    local_settings: null,
    candidate_settings: null,
    commit_guard: { installed: false, authoritative: false },
    provider_permission_resolution: null,
    ...overrides,
  }
}
const claudePins = ({ verify = () => true, consume = () => true, pin = {} } = {}) => ({
  claude_configuration: { ...CLAUDE_AUTHORITY, verify, consume_nonce: consume, ...pin },
})

const effectSpies = () => {
  const calls = Object.fromEntries([
    'board', 'cleanup', 'detached', 'process', 'listener', 'terminate', 'prune',
    'acl', 'owner', 'sandbox', 'installer', 'file', 'network',
  ].map((name) => [name, 0]))
  return {
    calls,
    effects: Object.fromEntries(Object.keys(calls).map((name) => [name, () => { calls[name] += 1 }])),
  }
}

test('execution-context attestation accepts a fresh prior-pinned top-level tuple exactly once', () => {
  let verifyCalls = 0
  let consumed = null
  const result = verifyExecutionContextAttestation(executionInput(), executionPins({
    verify: (attestation) => {
      verifyCalls += 1
      return attestation.attestation_ref === 'attestation:execution-context-one'
    },
    consume: (input) => {
      consumed = input
      return true
    },
  }))

  assert.equal(result.status, 'VERIFIED_EXECUTION_CONTEXT')
  assert.equal(result.attestation_ref, 'attestation:execution-context-one')
  assert.equal(verifyCalls, 1)
  assert.deepEqual(consumed, {
    purpose: 'execution-context',
    issuer_id: EXECUTION_PINS.issuer_id,
    nonce: NONCE,
    expires_at: LATER,
  })
})

test('execution-context attestation fails closed for forged, replayed, expired, revoked, or wrong-issuer evidence', () => {
  const cases = [
    ['forged', executionInput(), executionPins({ verify: () => false }), 'attestation_verification_failed'],
    ['replayed', executionInput(), executionPins({ consume: () => false }), 'attestation_replayed'],
    ['expired', executionInput({ attestation: contextAttestation({ expires_at: EARLIER }) }), executionPins(), 'attestation_expired'],
    ['revoked', executionInput({ attestation: contextAttestation({ revocation_epoch: 6 }) }), executionPins(), 'attestation_revoked'],
    ['wrong issuer', executionInput({ attestation: contextAttestation({ issuer_id: 'issuer:forged' }) }), executionPins(), 'attestation_issuer_mismatch'],
  ]

  for (const [name, input, pins, reason] of cases) {
    const result = verifyExecutionContextAttestation(input, pins)
    assert.deepEqual(result, { status: 'HELD_EXECUTION_CONTEXT', reason }, name)
  }
})

test('AC-37 — forged execution-context attestation leaves every mutation port at zero calls', () => {
  const { calls, effects } = effectSpies()
  calls.writer = 0
  effects.writer = () => { calls.writer += 1 }
  const adapter = createProviderAdapter({
    provider: 'codex',
    attestor: {
      verify_execution_context: (input) => verifyExecutionContextAttestation(input, executionPins({ verify: () => false })),
    },
    commandPolicy: commandPolicy(),
    effects,
  })

  const result = adapter.preflight({
    execution_context: executionInput(),
    command: 'control-metadata:record',
  })

  assert.deepEqual(result, { status: 'HELD_EXECUTION_CONTEXT', reason: 'execution_context_unverified' })
  assert.deepEqual(
    Object.fromEntries(['writer', 'file', 'network', 'acl', 'sandbox', 'process'].map((name) => [name, calls[name]])),
    { writer: 0, file: 0, network: 0, acl: 0, sandbox: 0, process: 0 },
  )
})

test('execution-context attestation binds every owner and actual-context tuple member', () => {
  const cases = [
    ['owner', { owner_session: 'session:other' }],
    ['provider session', { provider_session_id: 'provider-session:other' }],
    ['execution context', { execution_context_id: 'execution-context:other' }],
    ['lease', { lease_id: 'lease:other' }],
    ['repo identity', { repo_identity_digest: SHA256_B }],
    ['common dir', { common_dir_digest: SHA256_A }],
    ['worktree', { worktree_id: 'worktree:other' }],
    ['worktree path', { worktree_path_digest: SHA256_B }],
    ['branch', { branch: 'codex/other' }],
    ['head', { head_sha: SHA1_A }],
    ['scope', { scope_digest: SHA256_A }],
    ['launcher lineage', { launcher_lineage_digest: SHA256_B }],
  ]

  for (const [name, drift] of cases) {
    const result = verifyExecutionContextAttestation(
      executionInput({ attestation: contextAttestation(drift) }),
      executionPins(),
    )
    assert.deepEqual(result, { status: 'HELD_EXECUTION_CONTEXT', reason: 'attestation_tuple_mismatch' }, name)
  }
})

test('negative execution-context envelopes stay held before every provider mutation port', () => {
  const cases = [
    ['malformed context shape', executionInput({ attestation: { ...contextAttestation(), extension: true } }), executionPins()],
    ['malformed opaque context', executionInput({ attestation: contextAttestation({ attestation_ref: 'opaque' }) }), executionPins()],
    ['forged opaque context', executionInput({ attestation: contextAttestation({ attestation_ref: 'attestation:forged' }) }), executionPins({ verify: () => false })],
    ['expired context', executionInput({ attestation: contextAttestation({ expires_at: EARLIER }) }), executionPins()],
    ['lost host mapping', executionInput({ attestation: contextAttestation({ host_local_mapping: 'LOST' }) }), executionPins()],
    ['replayed context', executionInput(), executionPins({ consume: () => false })],
  ]
  const ports = ['writer', 'file', 'network', 'process', 'acl', 'sandbox']

  for (const [name, executionContext, pins] of cases) {
    const { calls, effects } = effectSpies()
    calls.writer = 0
    effects.writer = () => { calls.writer += 1 }
    const adapter = createProviderAdapter({
      provider: 'codex',
      attestor: {
        verify_execution_context: (input) => verifyExecutionContextAttestation(input, pins),
      },
      commandPolicy: commandPolicy(),
      effects,
    })

    const result = adapter.preflight({ execution_context: executionContext, command: 'control-metadata:record' })

    assert.deepEqual(result, { status: 'HELD_EXECUTION_CONTEXT', reason: 'execution_context_unverified' }, name)
    assert.deepEqual(
      Object.fromEntries(ports.map((port) => [port, calls[port]])),
      { writer: 0, file: 0, network: 0, process: 0, acl: 0, sandbox: 0 },
      name,
    )
  }
})

test('execution-context attestation rejects unknown ownership, lost host mapping, and nested or shared contexts', () => {
  const cases = [
    ['ownership', { git_ownership_trust: 'UNKNOWN' }],
    ['host mapping', { host_local_mapping: 'LOST' }],
    ['nested CLI', { nested_cli: true }],
    ['nested worktree', { nested_worktree: true }],
    ['shared context', { shared_execution_context: true }],
  ]

  for (const [name, unsafe] of cases) {
    const result = verifyExecutionContextAttestation(
      executionInput({ attestation: contextAttestation(unsafe) }),
      executionPins(),
    )
    assert.equal(result.status, 'HELD_EXECUTION_CONTEXT', name)
  }
})

test('AC-09 — nested and shared execution contexts hold before every mutation port', () => {
  const cases = [
    ['nested CLI', { nested_cli: true }],
    ['nested worktree', { nested_worktree: true }],
    ['shared execution context', { shared_execution_context: true }],
    ['shared worktree', { worktree_id: 'worktree:shared' }],
    ['shared branch', { branch: 'codex/shared' }],
  ]
  for (const [name, drift] of cases) {
    const { calls, effects } = effectSpies()
    calls.writer = 0
    effects.writer = () => { calls.writer += 1 }
    const adapter = createProviderAdapter({
      provider: 'codex',
      attestor: {
        verify_execution_context: (input) => verifyExecutionContextAttestation(input, executionPins()),
      },
      commandPolicy: commandPolicy(),
      effects,
    })
    const result = adapter.preflight({
      execution_context: executionInput({ attestation: contextAttestation(drift) }),
      command: 'control-metadata:record',
    })

    assert.deepEqual(result, { status: 'HELD_EXECUTION_CONTEXT', reason: 'execution_context_unverified' }, name)
    assert.deepEqual(
      Object.fromEntries(['writer', 'file', 'network', 'process', 'acl', 'sandbox'].map((port) => [port, calls[port]])),
      { writer: 0, file: 0, network: 0, process: 0, acl: 0, sandbox: 0 },
      name,
    )
  }
})

test('AC-36 — unknown or partial gates, configs, contexts, and inventory fail closed without effects', () => {
  const { calls, effects } = effectSpies()
  const guardedPorts = [
    'sandbox', 'installer', 'acl', 'owner', 'account', 'firewall', 'process', 'cleanup', 'terminate',
    'kill', 'delete', 'prune', 'writer', 'file', 'network', 'host', 'external',
  ]
  for (const port of guardedPorts) {
    if (!Object.hasOwn(calls, port)) calls[port] = 0
    if (!Object.hasOwn(effects, port)) effects[port] = () => { calls[port] += 1 }
  }
  const contextPins = executionPins()
  Object.assign(contextPins.execution_context, effects)
  const inventoryPins = {
    host_inventory: {
      issuer_id: 'issuer:host-inventory', issuer_version: 'host-inventory-authority/v1', source_digest: SHA256_A,
      revocation_epoch: 7, now: NOW, verify: () => true, consume_nonce: () => true, ...effects,
    },
  }
  const cases = [
    ['unknown gate', () => createProviderAdapter({ provider: 'unknown', attestor: {}, commandPolicy: commandPolicy(), effects }).preflight({
      execution_context: executionInput(), command: 'control-metadata:record',
    })],
    ['partial config', () => createProviderAdapter({ provider: 'codex', attestor: {}, commandPolicy: commandPolicy(), effects }).preflight({
      execution_context: executionInput(), command: 'control-metadata:record',
    })],
    ['unknown context', () => verifyExecutionContextAttestation(undefined, contextPins)],
    ['partial context', () => verifyExecutionContextAttestation({ attestation: {}, expected: {} }, contextPins)],
    ['unknown inventory', () => consumeHostInventoryAttestation(undefined, inventoryPins)],
    ['partial inventory', () => consumeHostInventoryAttestation({ attestation: {}, expected: {} }, inventoryPins)],
  ]

  for (const [name, invoke] of cases) {
    const result = invoke()
    assert.ok(result.status === 'UNKNOWN' || result.status.startsWith('HELD_'), name)
    assert.deepEqual(
      Object.fromEntries(guardedPorts.map((port) => [port, calls[port]])),
      Object.fromEntries(guardedPorts.map((port) => [port, 0])),
      name,
    )
  }
})

test('execution-context attestation rejects raw host identity before attestor nonce consumption', () => {
  let consumed = false
  const result = verifyExecutionContextAttestation(
    executionInput({ attestation: { ...contextAttestation(), pid: 42 } }),
    executionPins({ consume: () => { consumed = true; return true } }),
  )

  assert.deepEqual(result, { status: 'HELD_EXECUTION_CONTEXT', reason: 'raw_host_identity_forbidden' })
  assert.equal(consumed, false)
})

test('unavailable attestor ports and malformed Claude configuration fail closed as typed results', () => {
  const unavailable = verifyExecutionContextAttestation(
    executionInput(),
    executionPins({ verify: () => { throw new Error('attestor unavailable') } }),
  )
  const malformed = verifyClaudeConfiguration(
    claudeInput({ settings: undefined, settings_digest: 'not-a-digest' }),
    claudePins(),
  )

  assert.deepEqual(unavailable, { status: 'HELD_EXECUTION_CONTEXT', reason: 'attestation_authority_unavailable' })
  assert.equal(malformed.status, 'HELD_PROVIDER_CONFIGURATION')
})

test('owner-end attestation requires fresh external terminal evidence for the exact tuple', () => {
  const attestation = {
    schema_version: 'owner-end-attestation/v1',
    attestation_ref: 'attestation:owner-end-one',
    issuer_id: 'issuer:owner-end',
    issuer_version: 'owner-end-attestor/v1',
    source_digest: SHA256_A,
    observed_at: NOW,
    expires_at: LATER,
    nonce: NONCE,
    revocation_epoch: 7,
    terminal_event: 'TOP_LEVEL_TERMINAL',
    execution_envelope_state: 'REVOKED',
    in_flight_command: false,
    release_reason: 'handoff',
    ...TRUSTED_TUPLE,
  }
  const pins = {
    owner_end: {
      issuer_id: 'issuer:owner-end', issuer_version: 'owner-end-attestor/v1', source_digest: SHA256_A,
      revocation_epoch: 7, now: NOW, verify: () => true, consume_nonce: () => true,
    },
  }

  assert.equal(verifyOwnerEndAttestation({ attestation, expected: TRUSTED_TUPLE }, pins).status, 'VERIFIED_OWNER_END')
  for (const unsafe of [
    { issuer_id: TRUSTED_TUPLE.owner_session },
    { terminal_event: 'WRITER_SELF_ASSERTION' },
    { in_flight_command: true },
    { head_sha: SHA1_A },
  ]) {
    const result = verifyOwnerEndAttestation({ attestation: { ...attestation, ...unsafe }, expected: TRUSTED_TUPLE }, pins)
    assert.equal(result.status, 'HELD_EXECUTION_AUTHORITY')
  }
})

test('AC-45 — Claude safe baseline satisfies the prior-pinned configuration preflight', () => {
  const result = verifyClaudeConfiguration(claudeInput(), claudePins())

  assert.equal(result.status, 'VERIFIED_PROVIDER_CONFIGURATION')
  assert.equal(result.command_policy_digest, BASE_POLICY.policy_digest)
})

test('Claude config preflight holds semantic drift and any local or provider-derived permission expansion', () => {
  const cases = [
    ['hooks', claudeInput({ settings: { ...structuredClone(SAFE_CLAUDE_SETTINGS), disableAllHooks: false }, settings_digest: digestCanonical({ ...structuredClone(SAFE_CLAUDE_SETTINGS), disableAllHooks: false }) })],
    ['default mode', claudeInput({ settings: { ...structuredClone(SAFE_CLAUDE_SETTINGS), permissions: { ...structuredClone(SAFE_CLAUDE_SETTINGS.permissions), defaultMode: 'acceptEdits' } }, settings_digest: digestCanonical({ ...structuredClone(SAFE_CLAUDE_SETTINGS), permissions: { ...structuredClone(SAFE_CLAUDE_SETTINGS.permissions), defaultMode: 'acceptEdits' } }) })],
    ['bypass', claudeInput({ settings: { ...structuredClone(SAFE_CLAUDE_SETTINGS), permissions: { ...structuredClone(SAFE_CLAUDE_SETTINGS.permissions), disableBypassPermissionsMode: 'enable' } }, settings_digest: digestCanonical({ ...structuredClone(SAFE_CLAUDE_SETTINGS), permissions: { ...structuredClone(SAFE_CLAUDE_SETTINGS.permissions), disableBypassPermissionsMode: 'enable' } }) })],
    ['source drift', claudeInput({ source_ref: 'source:candidate-settings' })],
    ['local allowlist', claudeInput({ local_settings: { permissions: { allow: ['Bash(git push origin main)'] } } })],
    ['candidate allowlist', claudeInput({ candidate_settings: { permissions: { allow: ['Bash(taskkill /pid 42)'] } } })],
    ['commit guard', claudeInput({ commit_guard: { installed: true, authoritative: true } })],
    ['provider permission result', claudeInput({ provider_permission_resolution: { allow: ['Bash(powershell -Command Remove-Item)'] } })],
  ]

  for (const [name, input] of cases) {
    const result = verifyClaudeConfiguration(input, claudePins())
    assert.equal(result.status, 'HELD_PROVIDER_CONFIGURATION', name)
  }
})

test('provider adapter accepts only a top-level provider with the fixed command policy and zero host effects', () => {
  const { calls, effects } = effectSpies()
  const adapter = createProviderAdapter({
    provider: 'codex',
    attestor: { verify_execution_context: (input) => verifyExecutionContextAttestation(input, executionPins()) },
    commandPolicy: commandPolicy(),
    effects,
  })

  const result = adapter.preflight({
    execution_context: executionInput(),
    command: 'control-metadata:record',
  })

  assert.equal(result.status, 'READY_FOR_SHADOW')
  assert.deepEqual(calls, Object.fromEntries(Object.keys(calls).map((name) => [name, 0])))
})

test('provider adapter rejects nested agents and forbidden commands before every effect port', () => {
  const forbidden = [
    'codex exec', 'claude -p', 'agent-cli run', 'powershell -Command Get-ChildItem', 'taskkill /pid 42',
    'git push origin main', 'gh pr merge 1', 'gh pr review --approve 1', 'deploy production',
    'icacls repo', 'installer repair', 'sandbox.exe repair', 'cleanup orphan', 'git worktree add child',
  ]
  for (const command of forbidden) {
    const { calls, effects } = effectSpies()
    const adapter = createProviderAdapter({
      provider: 'codex',
      attestor: { verify_execution_context: (input) => verifyExecutionContextAttestation(input, executionPins()) },
      commandPolicy: commandPolicy(),
      effects,
    })
    const result = adapter.preflight({ execution_context: executionInput(), command })
    assert.deepEqual(result, { status: 'HELD_COMMAND_POLICY', reason: 'command_not_allowlisted' }, command)
    assert.deepEqual(calls, Object.fromEntries(Object.keys(calls).map((name) => [name, 0])), command)
  }
})

test('provider adapter fixed deny list overrides an injected permissive command policy', () => {
  const { calls, effects } = effectSpies()
  const permissivePolicy = policyDocument({ commands: ['git push origin main'] })
  const adapter = createProviderAdapter({
    provider: 'codex',
    attestor: { verify_execution_context: (input) => verifyExecutionContextAttestation(input, executionPins()) },
    commandPolicy: commandPolicy({ policy: permissivePolicy }),
    effects,
  })

  const result = adapter.preflight({ execution_context: executionInput(), command: 'git push origin main' })

  assert.equal(result.status, 'HELD_COMMAND_POLICY')
  assert.deepEqual(calls, Object.fromEntries(Object.keys(calls).map((name) => [name, 0])))
})

test('Claude adapter cannot inherit local settings or provider permission resolution to enlarge policy', () => {
  const { calls, effects } = effectSpies()
  const adapter = createProviderAdapter({
    provider: 'claude',
    attestor: {
      verify_execution_context: (input) => verifyExecutionContextAttestation(input, executionPins()),
      verify_claude_configuration: (input) => verifyClaudeConfiguration(input, claudePins()),
    },
    commandPolicy: commandPolicy(),
    effects,
  })
  const context = executionInput({
    attestation: contextAttestation({ provider: 'claude' }),
    expected: { ...TRUSTED_TUPLE, provider: 'claude' },
  })
  const result = adapter.preflight({
    execution_context: context,
    claude_configuration: claudeInput({ local_settings: { permissions: { allow: ['Bash(gh pr merge 1)'] } } }),
    command: 'control-metadata:record',
  })

  assert.equal(result.status, 'HELD_PROVIDER_CONFIGURATION')
  assert.deepEqual(calls, Object.fromEntries(Object.keys(calls).map((name) => [name, 0])))
})

test('HostInventoryAuthority evidence only yields a sanitized reclaim handoff and unknown evidence stays held', () => {
  const attestation = {
    schema_version: 'host-inventory-attestation/v1',
    attestation_ref: 'attestation:inventory-one',
    issuer_id: 'issuer:host-inventory',
    issuer_version: 'host-inventory-authority/v1',
    source_digest: SHA256_A,
    observed_at: NOW,
    expires_at: LATER,
    nonce: NONCE,
    revocation_epoch: 7,
    target_ref: 'target:worktree-one',
    target_type: 'worktree',
    target_digest: SHA256_B,
    owner_proof_status: 'ENDED',
    lease_id: 'lease:writer-one',
    runtime_correlation: 'runtime:none',
  }
  const pins = {
    host_inventory: {
      issuer_id: 'issuer:host-inventory', issuer_version: 'host-inventory-authority/v1', source_digest: SHA256_A,
      revocation_epoch: 7, now: NOW, verify: () => true, consume_nonce: () => true,
    },
  }
  const ready = consumeHostInventoryAttestation({ attestation, expected: { target_ref: 'target:worktree-one', lease_id: 'lease:writer-one' } }, pins)
  assert.deepEqual(ready, {
    status: 'RECLAIM_HANDOFF_READY',
    handoff: {
      attestation_ref: 'attestation:inventory-one',
      target_ref: 'target:worktree-one', target_type: 'worktree', target_digest: SHA256_B,
      lease_id: 'lease:writer-one', runtime_correlation: 'runtime:none',
    },
  })
  const stale = consumeHostInventoryAttestation({ attestation: { ...attestation, expires_at: EARLIER }, expected: { target_ref: 'target:worktree-one', lease_id: 'lease:writer-one' } }, pins)
  assert.deepEqual(stale, { status: 'HELD_HOST_INVENTORY', reason: 'attestation_expired' })
})

test('AC-40 — HostInventoryAuthority holds unknown or invalid evidence before every host mutation port', () => {
  const attestation = {
    schema_version: 'host-inventory-attestation/v1',
    attestation_ref: 'attestation:inventory-one',
    issuer_id: 'issuer:host-inventory',
    issuer_version: 'host-inventory-authority/v1',
    source_digest: SHA256_A,
    observed_at: NOW,
    expires_at: LATER,
    nonce: NONCE,
    revocation_epoch: 7,
    target_ref: 'target:worktree-one',
    target_type: 'worktree',
    target_digest: SHA256_B,
    owner_proof_status: 'ENDED',
    lease_id: 'lease:writer-one',
    runtime_correlation: 'runtime:none',
  }
  const expected = { target_ref: 'target:worktree-one', lease_id: 'lease:writer-one' }
  const mutationSpies = () => {
    const calls = Object.fromEntries([
      'process_scan', 'listener_scan', 'reclaim', 'kill', 'delete', 'prune', 'acl',
    ].map((name) => [name, 0]))
    return {
      calls,
      effects: Object.fromEntries(Object.keys(calls).map((name) => [name, () => { calls[name] += 1 }])),
    }
  }
  const pins = ({ verify = () => true, consume = () => true, effects } = {}) => ({
    host_inventory: {
      issuer_id: 'issuer:host-inventory', issuer_version: 'host-inventory-authority/v1', source_digest: SHA256_A,
      revocation_epoch: 7, now: NOW, verify, consume_nonce: consume, ...effects,
    },
  })
  const cases = [
    ['unknown authority', attestation, (effects) => ({ host_inventory: { ...effects } }), 'attestation_authority_unavailable'],
    ['malformed', { ...attestation, extension: true }, (effects) => pins({ effects }), 'attestation_shape_invalid'],
    ['replayed', attestation, (effects) => pins({ consume: () => false, effects }), 'attestation_replayed'],
    ['wrong issuer', { ...attestation, issuer_id: 'issuer:other' }, (effects) => pins({ effects }), 'attestation_issuer_mismatch'],
  ]

  for (const [name, candidate, makePins, reason] of cases) {
    const { calls, effects } = mutationSpies()
    const result = consumeHostInventoryAttestation({ attestation: candidate, expected }, makePins(effects))

    assert.ok(result.status === 'UNKNOWN' || result.status.startsWith('HELD_'), name)
    assert.deepEqual(result, { status: 'HELD_HOST_INVENTORY', reason }, name)
    assert.deepEqual(calls, {
      process_scan: 0, listener_scan: 0, reclaim: 0, kill: 0, delete: 0, prune: 0, acl: 0,
    }, name)
  }
})

test('RED: self-digested permissive policy cannot authorize destructive Git before context or effects', () => {
  const { calls, effects } = effectSpies()
  let contextCalls = 0
  const selfDigested = policyDocument({ commands: ['git reset --hard'] })
  const adapter = createProviderAdapter({
    provider: 'codex',
    attestor: { verify_execution_context: () => { contextCalls += 1; return { status: 'VERIFIED_EXECUTION_CONTEXT' } } },
    commandPolicy: commandPolicy({ policy: selfDigested, pin: { policy_digest: selfDigested.policy_digest } }),
    effects,
  })
  const result = adapter.preflight({ execution_context: executionInput(), command: 'git reset --hard' })

  assert.equal(result.status, 'HELD_COMMAND_POLICY')
  assert.equal(contextCalls, 0)
  assert.deepEqual(calls, Object.fromEntries(Object.keys(calls).map((name) => [name, 0])))
})

test('RED: recursive value sanitizer rejects raw opaque SID before pin verification or nonce consumption', () => {
  const counters = { verify: 0, consume: 0 }
  const result = verifyExecutionContextAttestation(
    executionInput({ attestation: contextAttestation({ attestation_ref: 'attestation:s-1-5-21-1-2-3' }) }),
    executionPins({
      verify: () => { counters.verify += 1; return true },
      consume: () => { counters.consume += 1; return true },
    }),
  )

  assert.equal(result.status, 'HELD_EXECUTION_CONTEXT')
  assert.deepEqual(counters, { verify: 0, consume: 0 })
})

test('RED: Task2 bare bearer matcher holds adapter authority boundaries before injected ports', () => {
  for (const attestationRef of ['attestation:bearer', 'authority:bearer']) {
    const counters = { verify: 0, consume: 0 }
    const result = verifyExecutionContextAttestation(
      executionInput({ attestation: contextAttestation({ attestation_ref: attestationRef }) }),
      executionPins({
        verify: () => { counters.verify += 1; return true },
        consume: () => { counters.consume += 1; return true },
      }),
    )
    assert.deepEqual(result, { status: 'HELD_EXECUTION_CONTEXT', reason: 'raw_host_identity_forbidden' }, attestationRef)
    assert.deepEqual(counters, { verify: 0, consume: 0 }, attestationRef)
  }

  const configurationCounters = { verify: 0, consume: 0 }
  const nestedBearerSettings = structuredClone(SAFE_CLAUDE_SETTINGS)
  nestedBearerSettings.permissions.allow = ['authority:bearer']
  const configuration = verifyClaudeConfiguration(
    claudeInput({ settings: nestedBearerSettings }),
    claudePins({
      verify: () => { configurationCounters.verify += 1; return true },
      consume: () => { configurationCounters.consume += 1; return true },
    }),
  )
  assert.deepEqual(configuration, { status: 'HELD_PROVIDER_CONFIGURATION', reason: 'raw_configuration_identity_forbidden' })
  assert.deepEqual(configurationCounters, { verify: 0, consume: 0 })

  const nearMatchCounters = { verify: 0, consume: 0 }
  const nearMatch = verifyExecutionContextAttestation(
    executionInput({ attestation: contextAttestation({ attestation_ref: 'authority:bearing' }) }),
    executionPins({
      verify: () => { nearMatchCounters.verify += 1; return true },
      consume: () => { nearMatchCounters.consume += 1; return true },
    }),
  )
  assert.equal(nearMatch.status, 'VERIFIED_EXECUTION_CONTEXT')
  assert.deepEqual(nearMatchCounters, { verify: 1, consume: 1 })

  const trustedFixture = verifyExecutionContextAttestation(executionInput(), executionPins())
  assert.equal(trustedFixture.status, 'VERIFIED_EXECUTION_CONTEXT')
})

test('RED: thrown provider context verifier becomes a typed hold without effects', () => {
  const { calls, effects } = effectSpies()
  const adapter = createProviderAdapter({
    provider: 'codex',
    attestor: { verify_execution_context: () => { throw new Error('token=untrusted') } },
    commandPolicy: commandPolicy(),
    effects,
  })

  const result = adapter.preflight({ execution_context: executionInput(), command: 'control-metadata:record' })
  assert.deepEqual(result, { status: 'HELD_EXECUTION_CONTEXT', reason: 'execution_context_evidence_gap' })
  assert.deepEqual(calls, Object.fromEntries(Object.keys(calls).map((name) => [name, 0])))
})

test('Claude configuration requires an exact fresh authority attestation rather than only its pinned digest', () => {
  const withoutAttestation = claudeInput()
  delete withoutAttestation.configuration_attestation
  const result = verifyClaudeConfiguration(withoutAttestation, claudePins())
  assert.equal(result.status, 'HELD_PROVIDER_CONFIGURATION')
})

test('closed policy vocabulary and defense-in-depth table every hostile command with zero effect calls', () => {
  const hostileCommands = [
    'git reset --hard', 'git update-ref refs/ai-bim/x deadbeef', 'git config core.hooksPath x', 'git clean -fdx',
    'git branch -D feature', 'git rebase origin/main', 'Remove-Item -Recurse C:/tmp', 'Start-Process powershell',
    'git -c core.hooksPath=x status', 'control-metadata:record; git reset --hard', 'control-metadata:record > out',
    '../control-metadata:record', 'codex exec', 'claude -p', 'agent-cli run', 'git worktree add child',
  ]
  for (const command of hostileCommands) {
    const { calls, effects } = effectSpies()
    const adapter = createProviderAdapter({
      provider: 'codex',
      attestor: { verify_execution_context: (input) => verifyExecutionContextAttestation(input, executionPins()) },
      commandPolicy: commandPolicy(),
      effects,
    })
    assert.equal(adapter.preflight({ execution_context: executionInput(), command }).status, 'HELD_COMMAND_POLICY', command)
    assert.deepEqual(calls, Object.fromEntries(Object.keys(calls).map((name) => [name, 0])), command)
  }
})

test('command-policy authority rejects duplicate, unknown, self-digested, and stale envelopes before context', () => {
  const selfDigested = policyDocument({ commands: ['git reset --hard'] })
  const cases = [
    ['duplicate', policyDocument({ commands: ['control-metadata:record', 'control-metadata:record'] }), {}],
    ['unknown', policyDocument({ commands: ['control-metadata:record', 'control-metadata:write'] }), {}],
    ['self digest', selfDigested, { policy_digest: selfDigested.policy_digest }],
    ['expired', policyDocument({ expires_at: EARLIER }), {}],
    ['revoked', policyDocument({ revocation_epoch: 6 }), {}],
    ['source drift', policyDocument({ source_digest: SHA256_A }), {}],
  ]
  for (const [name, policy, pin] of cases) {
    let contextCalls = 0
    const { calls, effects } = effectSpies()
    const adapter = createProviderAdapter({
      provider: 'codex',
      attestor: { verify_execution_context: () => { contextCalls += 1; return { status: 'VERIFIED_EXECUTION_CONTEXT' } } },
      commandPolicy: commandPolicy({ policy, pin }),
      effects,
    })
    assert.equal(adapter.preflight({ execution_context: executionInput(), command: policy.commands[0] }).status, 'HELD_COMMAND_POLICY', name)
    assert.equal(contextCalls, 0, name)
    assert.deepEqual(calls, Object.fromEntries(Object.keys(calls).map((effect) => [effect, 0])), name)
  }
})

test('recursive Task2 sanitizer blocks sensitive values from all adapter authority ports', () => {
  const sensitiveValues = [
    'attestation:s-1-5-21-1-2-3', 'attestation:ghp_unsafe', 'attestation:42',
    'attestation:c:/private', 'attestation:$env:SECRET',
  ]
  for (const value of sensitiveValues) {
    const counters = { verify: 0, consume: 0 }
    const result = verifyExecutionContextAttestation(
      executionInput({ attestation: contextAttestation({ attestation_ref: value }) }),
      executionPins({
        verify: () => { counters.verify += 1; return true },
        consume: () => { counters.consume += 1; return true },
      }),
    )
    assert.equal(result.status, 'HELD_EXECUTION_CONTEXT', value)
    assert.deepEqual(counters, { verify: 0, consume: 0 }, value)
  }

  const { calls, effects } = effectSpies()
  const adapter = createProviderAdapter({
    provider: 'codex',
    attestor: { verify_execution_context: () => ({ status: 'VERIFIED_EXECUTION_CONTEXT', token: 'untrusted' }) },
    commandPolicy: commandPolicy(),
    effects,
  })
  assert.deepEqual(adapter.preflight({ execution_context: executionInput(), command: 'control-metadata:record' }), {
    status: 'HELD_EXECUTION_CONTEXT', reason: 'execution_context_unverified',
  })
  assert.deepEqual(calls, Object.fromEntries(Object.keys(calls).map((effect) => [effect, 0])))
})

test('Claude authority requires exact metadata and catches configuration verifier failure without effects', () => {
  const noAttestation = claudeInput()
  delete noAttestation.configuration_attestation
  const cases = [
    ['missing', noAttestation, claudePins()],
    ['attestation extra key', claudeInput({ configuration_attestation: { ...configurationAttestation(), extension: true } }), claudePins()],
    ['attestation source drift', claudeInput({ configuration_attestation: configurationAttestation({ source_digest: SHA256_B }) }), claudePins()],
    ['attestation expired', claudeInput({ configuration_attestation: configurationAttestation({ expires_at: EARLIER }) }), claudePins()],
    ['attestation revoked', claudeInput({ configuration_attestation: configurationAttestation({ revocation_epoch: 6 }) }), claudePins()],
    ['pin extra key', claudeInput(), claudePins({ pin: { expansion: true } })],
    ['authority bundle extra key', claudeInput(), { ...claudePins(), expansion: true }],
    ['replayed', claudeInput(), claudePins({ consume: () => false })],
  ]
  for (const [name, input, pins] of cases) assert.equal(verifyClaudeConfiguration(input, pins).status, 'HELD_PROVIDER_CONFIGURATION', name)

  const { calls, effects } = effectSpies()
  const adapter = createProviderAdapter({
    provider: 'claude',
    attestor: {
      verify_execution_context: (input) => verifyExecutionContextAttestation(input, executionPins()),
      verify_claude_configuration: () => { throw new Error('cookie=untrusted') },
    },
    commandPolicy: commandPolicy(),
    effects,
  })
  const context = executionInput({
    attestation: contextAttestation({ provider: 'claude' }),
    expected: { ...TRUSTED_TUPLE, provider: 'claude' },
  })
  assert.deepEqual(adapter.preflight({
    execution_context: context, claude_configuration: claudeInput(), command: 'control-metadata:record',
  }), { status: 'HELD_PROVIDER_CONFIGURATION', reason: 'provider_configuration_evidence_gap' })
  assert.deepEqual(calls, Object.fromEntries(Object.keys(calls).map((effect) => [effect, 0])))
})
