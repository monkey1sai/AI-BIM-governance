import { types } from 'node:util'
import { digestCanonical } from './parallel-delivery-fabric-contract.mjs'

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const OPAQUE_REFERENCE = /^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._:/-]{0,119}$/u
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/u
const NONCE = /^[A-Za-z0-9_-]{32,128}$/u
const RAW_WINDOWS_SID = /(?:^|[/:])S-\d+(?:-\d+){2,}(?=$|[/:])/iu
const TERMINAL_PROCESS_ID = /(?:^|[/:])\d+$/u
const SECRET_VALUE = /(?:bearer|token|cookie|authorization|private[-_]?key|gh[pousr]_|github_pat_|eyJ[A-Za-z0-9_-]{10,})/iu
const ABSOLUTE_PATH = /(?:^|:)[A-Za-z]:[\\/]|(?:^|:)\/(?:home|users|tmp)(?:\/|$)/iu
const RAW_ENVIRONMENT = /(?:^|[:/])(?:\$env:|%[A-Za-z_][A-Za-z0-9_]*%)/u

const EXECUTION_TUPLE_KEYS = Object.freeze([
  'owner_session', 'provider', 'provider_session_id', 'execution_context_id', 'lease_id',
  'repo_identity_digest', 'common_dir_digest', 'worktree_id', 'worktree_path_digest',
  'branch', 'baseline_sha', 'head_sha', 'scope_digest', 'launcher_lineage_digest',
])
const SAFE_COMMANDS = Object.freeze(['control-metadata:record'])

const held = (status, reason) => Object.freeze({ status, reason })
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isSha1 = (value) => typeof value === 'string' && SHA1.test(value)
const isSha256 = (value) => typeof value === 'string' && SHA256.test(value)
const isOpaqueReference = (value) => typeof value === 'string' && OPAQUE_REFERENCE.test(value)
const isOpaqueId = (value) => typeof value === 'string' && OPAQUE_ID.test(value)
const isTimestamp = (value) => typeof value === 'string' && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const timestampMs = (value) => isTimestamp(value) ? Date.parse(value) : Number.NaN

const hasExactKeys = (value, keys) => {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

const hasSensitiveKey = (rawKey) => {
  const key = rawKey.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase().replaceAll('-', '_')
  return key.includes('token') || key.includes('cookie') || key.includes('authorization') ||
    key.includes('private_key') || key === 'sid' || key.endsWith('_sid') || key === 'pid' ||
    key.endsWith('_pid') || key === 'process_id' || key.includes('transcript') || key === 'env' ||
    key.startsWith('env_') || key.endsWith('_env') || key.includes('raw_env') ||
    key.includes('environment_values') || key.includes('absolute_path') ||
    (key.endsWith('_path') && !['old_path', 'new_path', 'public_entrypoint'].includes(key))
}

// Caller objects are inspected through a bounded, descriptor-only walk: cycles,
// excessive depth, accessor properties and proxies are all "unsafe" rather than
// something to traverse, so a public authority boundary never runs caller code or
// overflows the stack before it can return a typed hold.
const UNSAFE_MAX_DEPTH = 64
const unsafeValue = (value, path = new Set(), depth = 0) => {
  if (typeof value === 'string') return RAW_WINDOWS_SID.test(value) || TERMINAL_PROCESS_ID.test(value) ||
    SECRET_VALUE.test(value) || ABSOLUTE_PATH.test(value) || RAW_ENVIRONMENT.test(value)
  if (value === null || typeof value !== 'object') return false
  if (depth > UNSAFE_MAX_DEPTH || types.isProxy(value) || path.has(value)) return true
  path.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index)
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return true
        if (unsafeValue(descriptor.value, path, depth + 1)) return true
      }
      return false
    }
    if (!isPlainObject(value)) return false
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return true
      if (hasSensitiveKey(key) || unsafeValue(descriptor.value, path, depth + 1)) return true
    }
    return false
  } finally {
    path.delete(value)
  }
}

const safeDigest = (value) => {
  try {
    return unsafeValue(value) ? null : digestCanonical(value)
  } catch {
    return null
  }
}

const safeResult = (value, status, reason) => unsafeValue(value) ? held(status, reason) : Object.freeze(value)

const validTuple = (value) => (
  isPlainObject(value) && isOpaqueReference(value.owner_session) && ['codex', 'claude'].includes(value.provider) &&
  isOpaqueReference(value.provider_session_id) && isOpaqueReference(value.execution_context_id) &&
  isOpaqueReference(value.lease_id) && isSha256(value.repo_identity_digest) && isSha256(value.common_dir_digest) &&
  isOpaqueReference(value.worktree_id) && isSha256(value.worktree_path_digest) && isOpaqueId(value.branch) &&
  isSha1(value.baseline_sha) && isSha1(value.head_sha) && isSha256(value.scope_digest) && isSha256(value.launcher_lineage_digest)
)

const sameTuple = (actual, expected) => isPlainObject(expected) && hasExactKeys(expected, EXECUTION_TUPLE_KEYS) &&
  EXECUTION_TUPLE_KEYS.every((key) => actual[key] === expected[key])

const authorityMetadata = (value) => isPlainObject(value) && isOpaqueReference(value.issuer_id) &&
  isOpaqueId(value.issuer_version) && isSha256(value.source_digest) && Number.isSafeInteger(value.revocation_epoch) &&
  value.revocation_epoch >= 0 && isTimestamp(value.now) && typeof value.verify === 'function' && typeof value.consume_nonce === 'function'

const freshAndPinned = (attestation, pin, purpose) => {
  if (!authorityMetadata(pin)) return 'attestation_authority_unavailable'
  if (attestation.issuer_id !== pin.issuer_id || attestation.issuer_version !== pin.issuer_version) return 'attestation_issuer_mismatch'
  if (attestation.source_digest !== pin.source_digest) return 'attestation_source_mismatch'
  if (!isTimestamp(attestation.observed_at) || !isTimestamp(attestation.expires_at) || !NONCE.test(attestation.nonce)) return 'attestation_timestamp_invalid'
  const observedAt = timestampMs(attestation.observed_at)
  const expiresAt = timestampMs(attestation.expires_at)
  const now = timestampMs(pin.now)
  if (expiresAt <= observedAt || expiresAt - observedAt > 900_000 || observedAt > now + 60_000 || expiresAt <= now) return 'attestation_expired'
  if (attestation.revocation_epoch !== pin.revocation_epoch) return 'attestation_revoked'
  try {
    if (pin.verify(attestation) !== true) return 'attestation_verification_failed'
    if (pin.consume_nonce({ purpose, issuer_id: attestation.issuer_id, nonce: attestation.nonce, expires_at: attestation.expires_at }) !== true) return 'attestation_replayed'
  } catch {
    return 'attestation_authority_unavailable'
  }
  return null
}

const EXECUTION_KEYS = Object.freeze([
  'schema_version', 'attestation_ref', 'issuer_id', 'issuer_version', 'source_digest', 'observed_at', 'expires_at',
  'nonce', 'revocation_epoch', 'git_ownership_trust', 'host_local_mapping', 'nested_cli', 'nested_worktree',
  'shared_execution_context', ...EXECUTION_TUPLE_KEYS,
])

export function verifyExecutionContextAttestation(input, trustedPins) {
  if (unsafeValue(input) || unsafeValue(trustedPins)) return held('HELD_EXECUTION_CONTEXT', 'raw_host_identity_forbidden')
  const pin = isPlainObject(trustedPins) ? trustedPins.execution_context : null
  if (!isPlainObject(input) || !hasExactKeys(input, ['attestation', 'expected'])) return held('HELD_EXECUTION_CONTEXT', 'attestation_input_invalid')
  const { attestation, expected } = input
  if (!hasExactKeys(attestation, EXECUTION_KEYS) || attestation.schema_version !== 'execution-context-attestation/v1') return held('HELD_EXECUTION_CONTEXT', 'attestation_shape_invalid')
  if (!isOpaqueReference(attestation.attestation_ref) || !validTuple(attestation)) return held('HELD_EXECUTION_CONTEXT', 'attestation_value_invalid')
  if (!sameTuple(attestation, expected)) return held('HELD_EXECUTION_CONTEXT', 'attestation_tuple_mismatch')
  if (attestation.git_ownership_trust !== 'VERIFIED' || attestation.host_local_mapping !== 'VERIFIED') return held('HELD_EXECUTION_CONTEXT', 'host_context_unverified')
  if (attestation.nested_cli || attestation.nested_worktree || attestation.shared_execution_context) return held('HELD_EXECUTION_CONTEXT', 'execution_context_not_top_level')
  const issue = freshAndPinned(attestation, pin, 'execution-context')
  if (issue) return held('HELD_EXECUTION_CONTEXT', issue)
  return safeResult({
    status: 'VERIFIED_EXECUTION_CONTEXT', attestation_ref: attestation.attestation_ref,
    tuple_digest: safeDigest(Object.fromEntries(EXECUTION_TUPLE_KEYS.map((key) => [key, attestation[key]]))),
  }, 'HELD_EXECUTION_CONTEXT', 'attestation_output_unsafe')
}

const OWNER_END_KEYS = Object.freeze([
  'schema_version', 'attestation_ref', 'issuer_id', 'issuer_version', 'source_digest', 'observed_at', 'expires_at',
  'nonce', 'revocation_epoch', 'terminal_event', 'execution_envelope_state', 'in_flight_command', 'release_reason',
  ...EXECUTION_TUPLE_KEYS,
])

export function verifyOwnerEndAttestation(input, trustedPins) {
  if (unsafeValue(input) || unsafeValue(trustedPins)) return held('HELD_EXECUTION_AUTHORITY', 'raw_host_identity_forbidden')
  const pin = isPlainObject(trustedPins) ? trustedPins.owner_end : null
  if (!isPlainObject(input) || !hasExactKeys(input, ['attestation', 'expected'])) return held('HELD_EXECUTION_AUTHORITY', 'owner_end_input_invalid')
  const { attestation, expected } = input
  if (!hasExactKeys(attestation, OWNER_END_KEYS) || attestation.schema_version !== 'owner-end-attestation/v1') return held('HELD_EXECUTION_AUTHORITY', 'owner_end_shape_invalid')
  if (!isOpaqueReference(attestation.attestation_ref) || !validTuple(attestation)) return held('HELD_EXECUTION_AUTHORITY', 'owner_end_value_invalid')
  if (!sameTuple(attestation, expected)) return held('HELD_EXECUTION_AUTHORITY', 'owner_end_tuple_mismatch')
  if (attestation.issuer_id === attestation.owner_session) return held('HELD_EXECUTION_AUTHORITY', 'owner_end_self_issued')
  if (attestation.terminal_event !== 'TOP_LEVEL_TERMINAL' || attestation.execution_envelope_state !== 'REVOKED' ||
    attestation.in_flight_command !== false || !['handoff', 'failed', 'aborted'].includes(attestation.release_reason)) return held('HELD_EXECUTION_AUTHORITY', 'owner_end_terminal_unverified')
  const issue = freshAndPinned(attestation, pin, 'owner-end')
  if (issue) return held('HELD_EXECUTION_AUTHORITY', issue)
  return safeResult({ status: 'VERIFIED_OWNER_END', attestation_ref: attestation.attestation_ref }, 'HELD_EXECUTION_AUTHORITY', 'owner_end_output_unsafe')
}

const CLAUDE_SETTINGS_KEYS = Object.freeze(['disableAllHooks', 'permissions', 'enabledPlugins'])
const CLAUDE_PERMISSION_KEYS = Object.freeze(['defaultMode', 'disableBypassPermissionsMode', 'allow'])
const CLAUDE_PLUGIN_KEYS = Object.freeze(['superpowers@claude-plugins-official'])
const CLAUDE_INPUT_KEYS = Object.freeze([
  'source_ref', 'settings', 'settings_digest', 'command_policy_digest', 'configuration_attestation',
  'local_settings', 'candidate_settings', 'commit_guard', 'provider_permission_resolution',
])
const CLAUDE_ATTESTATION_KEYS = Object.freeze([
  'schema_version', 'attestation_ref', 'issuer_id', 'issuer_version', 'source_digest', 'observed_at', 'expires_at',
  'nonce', 'revocation_epoch', 'settings_digest', 'command_policy_digest',
])
const CLAUDE_PIN_KEYS = Object.freeze([
  'source_ref', 'issuer_id', 'issuer_version', 'source_digest', 'revocation_epoch', 'now',
  'settings_digest', 'command_policy_digest', 'verify', 'consume_nonce',
])

const safeClaudeSettings = (settings) => isPlainObject(settings) && hasExactKeys(settings, CLAUDE_SETTINGS_KEYS) &&
  settings.disableAllHooks === true && isPlainObject(settings.permissions) &&
  hasExactKeys(settings.permissions, CLAUDE_PERMISSION_KEYS) && settings.permissions.defaultMode === 'plan' &&
  settings.permissions.disableBypassPermissionsMode === 'disable' && Array.isArray(settings.permissions.allow) &&
  settings.permissions.allow.every((entry) => typeof entry === 'string') && isPlainObject(settings.enabledPlugins) &&
  hasExactKeys(settings.enabledPlugins, CLAUDE_PLUGIN_KEYS) && settings.enabledPlugins['superpowers@claude-plugins-official'] === false

const claudePin = (pin) => authorityMetadata(pin) && hasExactKeys(pin, CLAUDE_PIN_KEYS) && isOpaqueReference(pin.source_ref) &&
  isSha256(pin.settings_digest) && isSha256(pin.command_policy_digest)

export function verifyClaudeConfiguration(input, trustedPins) {
  if (unsafeValue(input) || unsafeValue(trustedPins)) return held('HELD_PROVIDER_CONFIGURATION', 'raw_configuration_identity_forbidden')
  const pin = isPlainObject(trustedPins) ? trustedPins.claude_configuration : null
  if (!isPlainObject(input) || !hasExactKeys(input, CLAUDE_INPUT_KEYS) ||
    !hasExactKeys(trustedPins, ['claude_configuration']) || !claudePin(pin)) return held('HELD_PROVIDER_CONFIGURATION', 'configuration_input_invalid')
  if (!safeClaudeSettings(input.settings) || input.local_settings !== null || input.candidate_settings !== null ||
    !hasExactKeys(input.commit_guard, ['authoritative', 'installed']) || input.commit_guard.installed !== false ||
    input.commit_guard.authoritative !== false || input.provider_permission_resolution !== null) return held('HELD_PROVIDER_CONFIGURATION', 'configuration_policy_invalid')
  const settingsDigest = safeDigest(input.settings)
  const attestation = input.configuration_attestation
  if (!isOpaqueReference(input.source_ref) || !isSha256(input.settings_digest) || !isSha256(input.command_policy_digest) ||
    !hasExactKeys(attestation, CLAUDE_ATTESTATION_KEYS) || attestation.schema_version !== 'claude-configuration-attestation/v1' ||
    !isOpaqueReference(attestation.attestation_ref) || !isSha256(attestation.settings_digest) || !isSha256(attestation.command_policy_digest)) return held('HELD_PROVIDER_CONFIGURATION', 'configuration_shape_invalid')
  if (input.source_ref !== pin.source_ref || input.settings_digest !== settingsDigest || input.settings_digest !== pin.settings_digest ||
    input.command_policy_digest !== pin.command_policy_digest || attestation.settings_digest !== input.settings_digest ||
    attestation.command_policy_digest !== input.command_policy_digest) return held('HELD_PROVIDER_CONFIGURATION', 'configuration_pin_mismatch')
  const issue = freshAndPinned(attestation, pin, 'claude-configuration')
  if (issue) return held('HELD_PROVIDER_CONFIGURATION', issue)
  return safeResult({
    status: 'VERIFIED_PROVIDER_CONFIGURATION', source_ref: input.source_ref,
    command_policy_digest: input.command_policy_digest,
  }, 'HELD_PROVIDER_CONFIGURATION', 'configuration_output_unsafe')
}

const INVENTORY_KEYS = Object.freeze([
  'schema_version', 'attestation_ref', 'issuer_id', 'issuer_version', 'source_digest', 'observed_at', 'expires_at',
  'nonce', 'revocation_epoch', 'target_ref', 'target_type', 'target_digest', 'owner_proof_status', 'lease_id', 'runtime_correlation',
])

export function consumeHostInventoryAttestation(input, trustedPins) {
  if (unsafeValue(input) || unsafeValue(trustedPins)) return held('HELD_HOST_INVENTORY', 'raw_host_identity_forbidden')
  const pin = isPlainObject(trustedPins) ? trustedPins.host_inventory : null
  if (!isPlainObject(input) || !hasExactKeys(input, ['attestation', 'expected'])) return held('HELD_HOST_INVENTORY', 'attestation_input_invalid')
  const { attestation, expected } = input
  if (!hasExactKeys(attestation, INVENTORY_KEYS) || attestation.schema_version !== 'host-inventory-attestation/v1' ||
    !isPlainObject(expected) || !hasExactKeys(expected, ['lease_id', 'target_ref'])) return held('HELD_HOST_INVENTORY', 'attestation_shape_invalid')
  if (!isOpaqueReference(attestation.attestation_ref) || !isOpaqueReference(attestation.target_ref) || !isSha256(attestation.target_digest) ||
    !isOpaqueReference(attestation.lease_id) || !isOpaqueReference(attestation.runtime_correlation) ||
    !['worktree', 'branch', 'runtime'].includes(attestation.target_type) || attestation.owner_proof_status !== 'ENDED') return held('HELD_HOST_INVENTORY', 'attestation_value_invalid')
  if (attestation.target_ref !== expected.target_ref || attestation.lease_id !== expected.lease_id) return held('HELD_HOST_INVENTORY', 'attestation_tuple_mismatch')
  const issue = freshAndPinned(attestation, pin, 'host-inventory')
  if (issue) return held('HELD_HOST_INVENTORY', issue)
  return safeResult({
    status: 'RECLAIM_HANDOFF_READY', handoff: {
      attestation_ref: attestation.attestation_ref, target_ref: attestation.target_ref, target_type: attestation.target_type,
      target_digest: attestation.target_digest, lease_id: attestation.lease_id, runtime_correlation: attestation.runtime_correlation,
    },
  }, 'HELD_HOST_INVENTORY', 'inventory_output_unsafe')
}

const POLICY_KEYS = Object.freeze([
  'schema_version', 'policy_ref', 'issuer_id', 'issuer_version', 'source_digest', 'issued_at', 'expires_at',
  'nonce', 'revocation_epoch', 'commands', 'policy_digest',
])
const POLICY_PIN_KEYS = Object.freeze([
  'policy_ref', 'issuer_id', 'issuer_version', 'source_digest', 'revocation_epoch', 'now', 'policy_digest', 'verify', 'consume_nonce',
])
const policyWithoutDigest = (policy) => Object.fromEntries(Object.entries(policy).filter(([key]) => key !== 'policy_digest'))
const exactSafeCommands = (commands) => Array.isArray(commands) && commands.length === SAFE_COMMANDS.length &&
  new Set(commands).size === commands.length && commands.every((command, index) => command === SAFE_COMMANDS[index])
const policyPin = (pin) => authorityMetadata(pin) && hasExactKeys(pin, POLICY_PIN_KEYS) &&
  isOpaqueReference(pin.policy_ref) && isSha256(pin.policy_digest)

const validateCommandPolicy = (bundle) => {
  if (unsafeValue(bundle) || !isPlainObject(bundle) || !hasExactKeys(bundle, ['policy', 'trusted_pin'])) return { issue: 'policy_bundle_invalid' }
  const { policy, trusted_pin: pin } = bundle
  if (!hasExactKeys(policy, POLICY_KEYS) || policy.schema_version !== 'provider-command-policy-attestation/v1' ||
    !isOpaqueReference(policy.policy_ref) || !isSha256(policy.policy_digest) || !exactSafeCommands(policy.commands) || !policyPin(pin)) return { issue: 'policy_shape_invalid' }
  const digest = safeDigest(policyWithoutDigest(policy))
  if (digest === null || policy.policy_digest !== digest || policy.policy_digest !== pin.policy_digest || policy.policy_ref !== pin.policy_ref) return { issue: 'policy_digest_mismatch' }
  const issue = freshAndPinned({ ...policy, observed_at: policy.issued_at }, pin, 'provider-command-policy')
  return issue ? { issue } : { policyDigest: policy.policy_digest, commands: policy.commands }
}

const forbiddenCommand = (command) => /(?:^|\s)(?:codex|claude|agent(?:-cli)?|powershell|pwsh|taskkill|icacls|takeown|installer|sandbox\.exe|cleanup|remove-item|start-process)(?:\s|$)|\bgit(?:\s+-c)?\s+(?:push|worktree|reset|update-ref|config|clean|branch|rebase)\b|\bgh\s+pr\s+(?:merge|review)\b|[;&|><`]|(?:^|\s)(?:\.\.?[\\/])/iu.test(command)

export function createProviderAdapter({ provider, attestor, commandPolicy, effects = {} } = {}) {
  const configured = ['codex', 'claude'].includes(provider) && isPlainObject(attestor) && isPlainObject(effects)
  let cachedPolicy
  const commandPolicyForAdapter = () => {
    if (cachedPolicy !== undefined) return cachedPolicy
    const validated = validateCommandPolicy(commandPolicy)
    cachedPolicy = validated.issue
      ? Object.freeze({ issue: validated.issue })
      : Object.freeze({ policyDigest: validated.policyDigest, commands: Object.freeze([...validated.commands]) })
    return cachedPolicy
  }
  const preflight = (request) => {
    if (!configured) return held('HELD_COMMAND_POLICY', 'adapter_configuration_invalid')
    if (unsafeValue(request)) return held('HELD_COMMAND_POLICY', 'adapter_input_unsafe')
    const keys = provider === 'claude' ? ['claude_configuration', 'command', 'execution_context'] : ['command', 'execution_context']
    if (!isPlainObject(request) || !hasExactKeys(request, keys) || !isPlainObject(request.execution_context) || !isPlainObject(request.execution_context.expected)) return held('HELD_EXECUTION_CONTEXT', 'adapter_request_invalid')
    if (typeof request.command !== 'string' || forbiddenCommand(request.command)) return held('HELD_COMMAND_POLICY', 'command_not_allowlisted')
    if (unsafeValue(commandPolicy)) return held('HELD_COMMAND_POLICY', 'adapter_input_unsafe')
    const policy = commandPolicyForAdapter()
    if (policy.issue) return held('HELD_COMMAND_POLICY', policy.issue)
    if (typeof attestor.verify_execution_context !== 'function') return held('HELD_EXECUTION_CONTEXT', 'attestation_authority_unavailable')
    let context
    try {
      context = attestor.verify_execution_context(request.execution_context)
    } catch {
      return held('HELD_EXECUTION_CONTEXT', 'execution_context_evidence_gap')
    }
    if (!isPlainObject(context) || context.status !== 'VERIFIED_EXECUTION_CONTEXT' || unsafeValue(context)) return held('HELD_EXECUTION_CONTEXT', 'execution_context_unverified')
    if (request.execution_context.expected.provider !== provider) return held('HELD_EXECUTION_CONTEXT', 'provider_tuple_mismatch')
    if (provider === 'claude') {
      if (typeof attestor.verify_claude_configuration !== 'function') return held('HELD_PROVIDER_CONFIGURATION', 'configuration_authority_unavailable')
      let configuration
      try {
        configuration = attestor.verify_claude_configuration(request.claude_configuration)
      } catch {
        return held('HELD_PROVIDER_CONFIGURATION', 'provider_configuration_evidence_gap')
      }
      if (!isPlainObject(configuration) || configuration.status !== 'VERIFIED_PROVIDER_CONFIGURATION' || unsafeValue(configuration)) return held('HELD_PROVIDER_CONFIGURATION', 'configuration_unverified')
      if (configuration.command_policy_digest !== policy.policyDigest) return held('HELD_PROVIDER_CONFIGURATION', 'command_policy_digest_mismatch')
    }
    if (!policy.commands.includes(request.command)) return held('HELD_COMMAND_POLICY', 'command_not_allowlisted')
    return safeResult({ status: 'READY_FOR_SHADOW', provider, command: request.command }, 'HELD_COMMAND_POLICY', 'adapter_output_unsafe')
  }
  return Object.freeze({ provider, preflight })
}
