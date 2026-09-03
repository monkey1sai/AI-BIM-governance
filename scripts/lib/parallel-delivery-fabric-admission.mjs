import { createPublicKey, verify as verifyEd25519 } from 'node:crypto'

import {
  canonicalize,
  digestCanonical,
  isCanonicalNonce,
  isCanonicalOpaqueId,
  isCanonicalUtcMillisecondTimestamp,
  normalizeScopeResource,
  parseExecutionEnvelope,
} from './parallel-delivery-fabric-contract.mjs'
import { parseSessionLeaseRegistry } from './parallel-delivery-fabric-registry.mjs'

// This module is deliberately a pure policy kernel.  It accepts already
// collected observations and returns immutable intents; it never reads the
// host, touches Git, starts a process, or talks to a remote service.

const EXECUTION_LEVELS = Object.freeze([
  'plan_only',
  'implement_local',
  'push_owned_branch',
  'open_draft_pr',
  'submit_delivery',
])

const RUNTIME_KINDS = Object.freeze({
  writer: 'writer',
  integration_train: 'integration_train',
  computer_use: 'computer_use',
})

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const RAW_ENV_ALIAS = /(?:^|[/:\\])(?:env|environment):[A-Za-z_][A-Za-z0-9_]*(?=$|[/:\\.])/iu
const DOLLAR_ENV_ALIAS = /(?:^|[/:\\])\$env:[A-Za-z_][A-Za-z0-9_]*(?=$|[/:\\.])/iu
const PERCENT_ENV_ALIAS = /(?:^|[/:\\])%[A-Za-z_][A-Za-z0-9_]*%(?=$|[/:\\.])/iu
const MAX_SAFE_DEPTH = 32
const MAX_SAFE_NODES = 4096
const MAX_SAFE_KEYS = 4096
const MAX_SAFE_ARRAY_LENGTH = 512
const MAX_EVIDENCE_BYTES = 64 * 1024
const MAX_EVIDENCE_RECORDS = 256
const MAX_EVIDENCE_FIELDS = 1024
const MAX_GLOB_WORK = 64 * 1024

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isPlainObject = (value) => {
  if (!isObject(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone)
  if (!isPlainObject(value)) return value
  const result = {}
  for (const [key, nested] of Object.entries(value)) result[key] = clone(nested)
  return result
}

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

const own = (value, key) => isObject(value) && Object.hasOwn(value, key)
const sha1 = (value) => typeof value === 'string' && SHA1.test(value)
const sha256 = (value) => typeof value === 'string' && SHA256.test(value)
const opaque = isCanonicalOpaqueId
const nonce = isCanonicalNonce
const timestamp = isCanonicalUtcMillisecondTimestamp

const resourceIdentity = (resource) => {
  if (resource.kind === 'path') return `path:${resource.path}`
  if (resource.kind === 'glob') return `glob:${resource.pattern}`
  if (resource.kind === 'rename') return `rename:${resource.old_path}:${resource.new_path}`
  return `${resource.kind}:${resource.resource_key}`
}

class AdmissionError extends Error {
  constructor(code, detail = code) {
    super(`${code}: ${detail}`)
    this.name = 'AdmissionError'
    this.code = code
    this.detail = detail
  }
}

const fail = (code, detail = code) => { throw new AdmissionError(code, detail) }

// The input to this policy kernel is a durable record.  Reject sensitive
// fields even when they are nested in a caller-provided extension object.
const secretKey = (raw) => {
  const key = raw.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase().replaceAll('-', '_')
  return key.includes('token') || key.includes('cookie') || key.includes('authorization') ||
    key.includes('private_key') || key === 'sid' || key.endsWith('_sid') || key === 'pid' ||
    key.endsWith('_pid') || key === 'process_id' || key.includes('transcript') || key === 'env' ||
    key.startsWith('env_') || key.endsWith('_env') || key.includes('raw_env') ||
    key.includes('environment_values') || key.includes('absolute_path') ||
    (key.endsWith('_path') && !['old_path', 'new_path', 'public_entrypoint', 'worktree_path'].includes(key))
}

const secretValue = (value) => {
  if (typeof value !== 'string') return false
  if (sha1(value) || sha256(value) || timestamp(value)) return false
  return RAW_ENV_ALIAS.test(value) || DOLLAR_ENV_ALIAS.test(value) || PERCENT_ENV_ALIAS.test(value) ||
    /(?:bearer|token|cookie|authorization|private[-_]?key|gh[pousr]_|github_pat_|eyJ[A-Za-z0-9_-]{10,})/iu.test(value) ||
    /(?:^|[/:])S-\d+(?:-\d+){2,}(?=$|[/:])/iu.test(value)
}

const assertSafe = (value, context = '$', seen = new Set(), budget = { nodes: 0, keys: 0 }, depth = 0) => {
  if (depth > MAX_SAFE_DEPTH) fail('INPUT_COMPLEXITY_LIMIT', `${context}_depth`)
  if (typeof value === 'string') {
    if (secretValue(value)) fail('SECRET_MATERIAL_FORBIDDEN', `${context}_secret_marker`)
    return
  }
  if (!value || typeof value !== 'object') return
  budget.nodes += 1
  if (budget.nodes > MAX_SAFE_NODES) fail('INPUT_COMPLEXITY_LIMIT', `${context}_nodes`)
  if (seen.has(value)) fail('INVALID_CYCLIC_INPUT', context)
  seen.add(value)
  if (Array.isArray(value)) {
    if (value.length > MAX_SAFE_ARRAY_LENGTH) fail('INPUT_COMPLEXITY_LIMIT', `${context}_array`)
    value.forEach((entry, index) => assertSafe(entry, `${context}[${index}]`, seen, budget, depth + 1))
  } else {
    for (const [key, nested] of Object.entries(value)) {
      budget.keys += 1
      if (budget.keys > MAX_SAFE_KEYS) fail('INPUT_COMPLEXITY_LIMIT', `${context}_keys`)
      if (secretKey(key)) fail('SECRET_MATERIAL_FORBIDDEN', `${context}.${key}`)
      assertSafe(nested, `${context}.${key}`, seen, budget, depth + 1)
    }
  }
  seen.delete(value)
}

const normalizeScope = (resources) => {
  if (!Array.isArray(resources) || resources.length === 0) fail('SCOPE_REQUIRED')
  const normalized = resources.map((resource, index) => {
    try {
      return normalizeScopeResource(resource)
    } catch (error) {
      throw new AdmissionError(error.code || 'SCOPE_INVALID', `resource_${index}`)
    }
  })
  const identities = normalized.map(resourceIdentity)
  if (new Set(identities).size !== identities.length) fail('SCOPE_DUPLICATE')
  normalized.sort((left, right) => resourceIdentity(left).localeCompare(resourceIdentity(right)))
  return deepFreeze(normalized)
}

export { normalizeScope }

const canonicalScope = (resources) => normalizeScope(resources)

const pathOf = (resource) => resource.kind === 'path' ? resource.path : resource.kind === 'glob' ? resource.pattern : null
const renameEndpoints = (resource) => resource.kind === 'rename' ? [resource.old_path, resource.new_path] : []

const globChoices = (pattern, depth = 0) => {
  if (depth > 8) return null
  const start = pattern.indexOf('{')
  if (start < 0) return [pattern]
  const end = pattern.indexOf('}', start + 1)
  if (end < 0) return null
  const choices = pattern.slice(start + 1, end).split(',')
  if (choices.length < 2 || choices.some((choice) => choice.length === 0 || choice.includes('/'))) return null
  const expanded = []
  for (const choice of choices) {
    const nested = globChoices(`${pattern.slice(0, start)}${choice}${pattern.slice(end + 1)}`, depth + 1)
    if (!nested) return null
    expanded.push(...nested)
    if (expanded.length > 32) return null
  }
  return expanded
}

const globTokens = (pattern) => {
  const tokens = []
  for (let index = 0; index < pattern.length;) {
    const character = pattern[index]
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        tokens.push({ kind: 'globstar_slash' })
        index += 3
      } else {
        tokens.push({ kind: 'globstar' })
        index += 2
      }
      continue
    }
    if (character === '*') { tokens.push({ kind: 'star' }); index += 1; continue }
    if (character === '?') { tokens.push({ kind: 'question' }); index += 1; continue }
    if (character === '[') {
      const end = pattern.indexOf(']', index + 1)
      if (end < 0) return null
      const content = pattern.slice(index + 1, end)
      if (!content || content.includes('/') || content.includes('[')) return null
      const negated = content[0] === '!' || content[0] === '^'
      tokens.push({ kind: 'class', content: negated ? content.slice(1) : content, negated })
      index = end + 1
      continue
    }
    if (character === '}' || character === '{') return null
    tokens.push({ kind: 'literal', value: character })
    index += 1
  }
  return tokens
}

const classMatches = (token, character) => {
  let matched = false
  for (let index = 0; index < token.content.length; index += 1) {
    const current = token.content[index]
    if (index + 2 < token.content.length && token.content[index + 1] === '-') {
      const end = token.content[index + 2]
      if (current <= character && character <= end) matched = true
      index += 2
    } else if (current === character) matched = true
  }
  return token.negated ? !matched : matched
}

const globAlternativeMatches = (tokens, path) => {
  const work = (tokens.length + 1) * (path.length + 1)
  if (work > MAX_GLOB_WORK) return null
  let states = new Set([0])
  let steps = 0
  for (const token of tokens) {
    const next = new Set()
    for (const position of states) {
      steps += 1
      if (steps > MAX_GLOB_WORK) return null
      if (token.kind === 'literal' && position < path.length && path[position] === token.value) next.add(position + 1)
      else if (token.kind === 'question' && position < path.length && path[position] !== '/') next.add(position + 1)
      else if (token.kind === 'class' && position < path.length && path[position] !== '/' && classMatches(token, path[position])) next.add(position + 1)
      else if (token.kind === 'star') {
        next.add(position)
        for (let cursor = position; cursor < path.length && path[cursor] !== '/'; cursor += 1) next.add(cursor + 1)
      } else if (token.kind === 'globstar') {
        const minimum = Math.min(...states)
        for (let cursor = minimum; cursor <= path.length; cursor += 1) next.add(cursor)
        break
      } else if (token.kind === 'globstar_slash') {
        next.add(position)
        for (let cursor = position; cursor < path.length; cursor += 1) {
          if (path[cursor] === '/') next.add(cursor + 1)
        }
      }
    }
    states = next
    if (states.size === 0) return false
  }
  return states.has(path.length)
}

const globMatches = (pattern, path) => {
  if (typeof pattern !== 'string' || typeof path !== 'string' || pattern.length > 512 || path.length > 512) return null
  const choices = globChoices(pattern)
  if (!choices) return null
  let unknown = false
  for (const choice of choices) {
    const tokens = globTokens(choice)
    if (!tokens) return null
    const matched = globAlternativeMatches(tokens, path)
    if (matched === true) return true
    if (matched === null) unknown = true
  }
  return unknown ? null : false
}

const staticPrefix = (pattern) => {
  const wildcard = pattern.search(/[\*?\[\{]/u)
  if (wildcard < 0) return pattern
  const slash = pattern.slice(0, wildcard).lastIndexOf('/')
  return slash < 0 ? '' : pattern.slice(0, slash)
}
const pathOverlaps = (left, right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)

const pathLikeOverlap = (left, right) => {
  const leftPath = pathOf(left)
  const rightPath = pathOf(right)
  if (leftPath && rightPath) {
    if (left.kind === 'path' && right.kind === 'path') return pathOverlaps(leftPath, rightPath)
    if (left.kind === 'glob' && right.kind === 'path') {
      const matched = globMatches(leftPath, rightPath)
      if (matched === true) return true
      if (matched === null) return null
      const prefix = staticPrefix(leftPath)
      if (!prefix) return true
      return rightPath === prefix || rightPath.startsWith(`${prefix}/`) || prefix.startsWith(`${rightPath}/`)
    }
    if (left.kind === 'path' && right.kind === 'glob') {
      const matched = globMatches(rightPath, leftPath)
      if (matched === true) return true
      if (matched === null) return null
      const prefix = staticPrefix(rightPath)
      if (!prefix) return true
      return leftPath === prefix || leftPath.startsWith(`${prefix}/`) || prefix.startsWith(`${leftPath}/`)
    }
    const leftPrefix = staticPrefix(leftPath)
    const rightPrefix = staticPrefix(rightPath)
    if (leftPrefix && rightPrefix && !pathOverlaps(leftPrefix, rightPrefix)) return false
    // Two non-trivial patterns with no provable disjoint prefix are held.
    return true
  }
  return false
}

const resourcesOverlap = (left, right) => {
  if (left.kind === 'rename' || right.kind === 'rename') {
    const leftPoints = left.kind === 'rename' ? renameEndpoints(left) : [pathOf(left)].filter(Boolean)
    const rightPoints = right.kind === 'rename' ? renameEndpoints(right) : [pathOf(right)].filter(Boolean)
    let unknown = false
    for (const leftPoint of leftPoints) {
      for (const rightPoint of rightPoints) {
        const comparisons = [
          pathLikeOverlap({ kind: 'path', path: leftPoint }, { kind: 'path', path: rightPoint }),
          ...(left.kind !== 'rename' ? [pathLikeOverlap(left, { kind: 'path', path: rightPoint })] : []),
          ...(right.kind !== 'rename' ? [pathLikeOverlap(right, { kind: 'path', path: leftPoint })] : []),
        ]
        if (comparisons.some((comparison) => comparison === true)) return true
        if (comparisons.some((comparison) => comparison === null)) unknown = true
      }
    }
    return unknown ? null : false
  }
  if (['shared_contract', 'exported_symbol', 'schema', 'event', 'migration', 'runtime'].includes(left.kind) ||
      ['shared_contract', 'exported_symbol', 'schema', 'event', 'migration', 'runtime'].includes(right.kind)) {
    return left.resource_key === right.resource_key
  }
  return pathLikeOverlap(left, right)
}

export const findScopeConflicts = (leftResources, rightResources) => {
  try {
    const left = canonicalScope(leftResources)
    const right = canonicalScope(rightResources)
    const conflicts = []
    let unknown = false
    for (const leftResource of left) {
      for (const rightResource of right) {
        const overlap = resourcesOverlap(leftResource, rightResource)
        if (overlap === true) conflicts.push({ left: leftResource, right: rightResource })
        else if (overlap === null) unknown = true
      }
    }
    return deepFreeze(conflicts.length > 0
      ? { status: 'CONFLICT', reason: 'SCOPE_OVERLAP', conflicts }
      : unknown
        ? { status: 'UNKNOWN', reason: 'SCOPE_OVERLAP_UNKNOWN', conflicts: [] }
        : { status: 'DISJOINT', reason: 'SCOPE_DISJOINT', conflicts: [] })
  } catch {
    return deepFreeze({ status: 'UNKNOWN', reason: 'SCOPE_OVERLAP_UNKNOWN', conflicts: [] })
  }
}

const canonicalParent = (path) => {
  const separator = path.lastIndexOf('/')
  return separator > 0 ? path.slice(0, separator) : null
}

const changedPathResource = (path, context) => {
  try {
    return normalizeScopeResource({ kind: 'path', path })
  } catch (error) {
    throw new AdmissionError(error.code || 'EVIDENCE_PATH_INVALID', `${context}_invalid`)
  }
}

const changedEvidenceResourceKey = (resource) => resourceIdentity(resource)

/**
 * Parse a small, closed, Git-like NUL framed change stream.
 *
 * Each record is `status\0path\0`, `Rxxx\0old\0new\0`, or
 * `S\0resource-key\0`.  Newline is never a record delimiter.  The returned
 * `resources` includes the canonical parent for added files and both parents
 * for renames so callers can use one immutable scope predicate at every gate.
 */
export const parseChangedScopeEvidence = (raw) => {
  let text
  if (typeof raw === 'string') text = raw
  else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
    text = raw.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(raw)) fail('EVIDENCE_INVALID', 'non_utf8')
  } else fail('EVIDENCE_INVALID', 'nul_frame_required')
  const byteLength = typeof Buffer !== 'undefined' ? Buffer.byteLength(text, 'utf8') : text.length
  if (byteLength > MAX_EVIDENCE_BYTES) fail('EVIDENCE_LIMIT', 'byte_limit')
  if (!text.endsWith('\0')) fail('EVIDENCE_INVALID', 'missing_nul_terminator')
  let fieldStart = 0
  let expectedFields = 0
  let recordCount = 0
  let fieldCount = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\0') continue
    const field = text.slice(fieldStart, index)
    fieldStart = index + 1
    fieldCount += 1
    if (fieldCount > MAX_EVIDENCE_FIELDS) fail('EVIDENCE_LIMIT', 'field_limit')
    if (expectedFields === 0) {
      recordCount += 1
      if (recordCount > MAX_EVIDENCE_RECORDS) fail('EVIDENCE_LIMIT', 'record_limit')
      expectedFields = field === 'S' ? 1 : /^[RC]/u.test(field) ? 2 : 1
    } else expectedFields -= 1
  }
  const fields = text.split('\0')
  fields.pop()
  if (fields.length === 0 || fields.some((field) => field.length === 0)) fail('EVIDENCE_INVALID', 'empty_nul_field')

  const entries = []
  const resources = []
  const identities = new Set()
  const addResource = (resource) => {
    const identity = changedEvidenceResourceKey(resource)
    if (!identities.has(identity)) {
      identities.add(identity)
      resources.push(resource)
    }
  }
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    if (status === 'S') {
      if (index >= fields.length) fail('EVIDENCE_INVALID', 'symbol_missing')
      const resourceKey = fields[index++]
      const resource = normalizeScopeResource({ kind: 'exported_symbol', resource_key: resourceKey })
      const identity = changedEvidenceResourceKey(resource)
      if (identities.has(identity)) fail('EVIDENCE_DUPLICATE', identity)
      addResource(resource)
      entries.push({ status, resource_key: resource.resource_key })
      continue
    }
    if (!/^(?:[ACDMRTUXB]|R\d{1,3}|C\d{1,3})$/u.test(status)) fail('EVIDENCE_INVALID', 'status_invalid')
    if (/^[RC]/u.test(status)) {
      if (index + 1 >= fields.length) fail('EVIDENCE_INVALID', 'rename_pair_missing')
      const oldPath = changedPathResource(fields[index++], 'old_path')
      const path = changedPathResource(fields[index++], 'path')
      if (oldPath.path === path.path) fail('EVIDENCE_INVALID', 'rename_identity')
      addResource(normalizeScopeResource({ kind: 'rename', old_path: oldPath.path, new_path: path.path }))
      for (const endpoint of [oldPath, path]) {
        if (identities.has(changedEvidenceResourceKey(endpoint))) fail('EVIDENCE_DUPLICATE', endpoint.path)
        addResource(endpoint)
        const parent = canonicalParent(endpoint.path)
        if (parent) addResource(changedPathResource(parent, 'rename_parent'))
      }
      entries.push({ status, old_path: oldPath.path, path: path.path })
      continue
    }
    if (index >= fields.length) fail('EVIDENCE_INVALID', 'path_missing')
    const path = changedPathResource(fields[index++], 'path')
    if (identities.has(changedEvidenceResourceKey(path))) fail('EVIDENCE_DUPLICATE', path.path)
    addResource(path)
    if (status === 'A') {
      const parent = canonicalParent(path.path)
      if (parent) addResource(changedPathResource(parent, 'added_parent'))
    }
    entries.push({ status, path: path.path })
  }
  if (entries.length === 0) fail('EVIDENCE_INVALID', 'empty_change_set')
  entries.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  resources.sort((left, right) => resourceIdentity(left).localeCompare(resourceIdentity(right)))
  return deepFreeze({
    schema_version: 'changed-scope-evidence/v1',
    framing: 'nul',
    entries,
    resources,
    evidence_digest: digestCanonical(entries),
  })
}

const evidenceEntries = (evidence) => {
  if (isPlainObject(evidence) && evidence.schema_version === 'changed-scope-evidence/v1') {
    const expectedKeys = ['schema_version', 'framing', 'entries', 'resources', 'evidence_digest']
    if (Object.keys(evidence).sort().join('|') !== expectedKeys.sort().join('|') || evidence.framing !== 'nul' ||
        !Array.isArray(evidence.entries) || evidence.entries.length === 0 || !Array.isArray(evidence.resources) ||
        !sha256(evidence.evidence_digest) || evidence.evidence_digest !== digestCanonical(evidence.entries)) {
      fail('EVIDENCE_INVALID', 'canonical_record_invalid')
    }
    canonicalScope(evidence.resources)
    return evidence.entries
  }
  return parseChangedScopeEvidence(evidence).entries
}

const evidenceEntryResources = (entries) => entries.map((entry) => {
  if (entry.status === 'S') return normalizeScopeResource({ kind: 'exported_symbol', resource_key: entry.resource_key })
  if (/^[RC]/u.test(entry.status)) return normalizeScopeResource({ kind: 'rename', old_path: entry.old_path, new_path: entry.path })
  return normalizeScopeResource({ kind: 'path', path: entry.path })
})

const declaredCoversPath = (declared, path) => {
  if (declared.kind === 'path') return path === declared.path || path.startsWith(`${declared.path}/`)
  if (declared.kind === 'glob') return globMatches(declared.pattern, path) === true
  return false
}

const declaredCovers = (declared, observed) => {
  if (observed.kind === 'path') return declaredCoversPath(declared, observed.path)
  if (observed.kind === 'rename') {
    if (declared.kind === 'rename') return declaredCoversPath({ kind: 'path', path: declared.old_path }, observed.old_path) && declaredCoversPath({ kind: 'path', path: declared.new_path }, observed.new_path)
    return declaredCoversPath(declared, observed.old_path) && declaredCoversPath(declared, observed.new_path)
  }
  return declared.kind === observed.kind && declared.resource_key === observed.resource_key
}

/**
 * Reusable commit/push/handoff scope predicate.  A changed record is valid only
 * when every primary path/symbol is covered by the declared scope.  Evidence
 * parsing failures and unprovable overlap are typed holds, never passes.
 */
export const evaluateScopeDrift = (declaredResources, rawEvidence) => {
  try {
    assertSafe(declaredResources, 'declared_scope')
    assertSafe(rawEvidence, 'changed_evidence')
    const declared = canonicalScope(declaredResources)
    const entries = evidenceEntries(rawEvidence)
    const observed = evidenceEntryResources(entries)
    const uncovered = observed.filter((resource) => !declared.some((candidate) => declaredCovers(candidate, resource)))
    const evidenceDigest = isPlainObject(rawEvidence) && rawEvidence.evidence_digest
      ? rawEvidence.evidence_digest
      : digestCanonical(entries)
    if (!sha256(evidenceDigest)) return held('HELD_SCOPE_DRIFT', 'EVIDENCE_DIGEST_INVALID')
    if (uncovered.length > 0) return held('HELD_SCOPE_DRIFT', 'SCOPE_DRIFT', { uncovered, evidence_digest: evidenceDigest })
    return result('SCOPE_EVIDENCE_ACCEPTED', 'SCOPE_COVERED', {
      scope_digest: digestCanonical(declared),
      evidence_digest: evidenceDigest,
    })
  } catch (error) {
    return held('HELD_SCOPE_DRIFT', error.code || 'EVIDENCE_INVALID')
  }
}

export const parseChangedEvidence = parseChangedScopeEvidence
export const validateChangedScopeEvidence = evaluateScopeDrift

const result = (status, reason, extra = {}) => deepFreeze({ status, reason, ...extra })
const queued = (reason, extra) => result('QUEUED_FOR_LEASE', reason, extra)
const held = (status, reason, extra) => result(status, reason, extra)

const normalizedRuntime = (value) => RUNTIME_KINDS[String(value || '').toLowerCase()] || null
const same = (left, right) => left !== undefined && left !== null && right !== undefined && right !== null && left === right
const managedBranch = (branch) => {
  if (branch === 'develop') return true
  return typeof branch === 'string' && /^(?:release|hotfix)\/[^/]+$/u.test(branch)
}
const branchClass = (branch) => branch === 'develop' ? 'develop' : typeof branch === 'string' && branch.startsWith('release/') ? 'release' : typeof branch === 'string' && branch.startsWith('hotfix/') ? 'hotfix' : null
const safeCandidateBranch = (branch) => {
  if (typeof branch !== 'string' || branch === 'main' || branch === 'master' || managedBranch(branch)) return false
  const segments = branch.split('/')
  return segments.length >= 2 && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && /^[A-Za-z0-9._-]+$/u.test(segment))
}

const REQUEST_REQUIRED_KEYS = Object.freeze([
  'schema_version', 'lease_kind', 'lease_id', 'plan_id', 'generation', 'task_id', 'provider', 'owner_session',
  'provider_session_id', 'execution_context_id', 'repo_identity_digest', 'common_dir_digest', 'worktree_id',
  'worktree_path_digest', 'branch', 'scope', 'scope_digest', 'baseline_sha', 'head_sha', 'base_ref', 'base_sha',
  'expected_remote_sha', 'action', 'runtime_kind',
])
const REQUEST_OPTIONAL_KEYS = Object.freeze([
  'resources', 'resource_keys', 'target_branch', 'promotion_mode', 'bulk', 'parent_base_sha', 'evidence',
  'now', 'runtime_role', 'expected_remote_ref', 'remote_ref', 'force', 'force_mode', 'force_push', 'force_with_lease',
  'changed_evidence', 'scope_evidence', 'protection_profile_digest', 'managed_base_registry_oid',
  'managed_base_lease_id', 'managed_base_generation', 'managed_base_head_sha', 'managed_base_ref',
  'managed_allowed_merge_targets',
])
const SCOPE_REVALIDATION_REQUIRED_KEYS = Object.freeze([
  'schema_version', 'phase', 'evidence_id', 'changed_evidence_ref', 'plan_id', 'generation', 'task_id',
  'lease_id', 'execution_context_id', 'worktree_id', 'branch', 'head_sha', 'scope_digest',
  'declared_resources', 'changed_evidence', 'changed_evidence_digest', 'observed_at', 'expires_at',
])
const SCOPE_REVALIDATION_CONTEXT_KEYS = Object.freeze([
  'phase', 'plan_id', 'generation', 'task_id', 'lease_id', 'execution_context_id', 'worktree_id',
  'branch', 'head_sha', 'scope_digest', 'declared_resources', 'now',
])
const SCOPE_REVALIDATION_PHASES = Object.freeze(['commit', 'push', 'handoff'])

const deriveTask3AdmissionView = (record) => {
  let parsed
  try {
    parsed = parseSessionLeaseRegistry(record)
  } catch {
    return null
  }
  const liveLeases = Object.values(parsed.leases)
  const commonDirs = new Set(liveLeases.map((leaseRecord) => leaseRecord.common_dir_digest))
  if (commonDirs.size > 1) return null
  // Compacted retained-resource stubs are holders too: the registry treats them as
  // blocking, so the local projection must see the same conflict set.
  const retainedHolders = Object.values(parsed.retained_resources ?? {}).map((stub) => ({
    ...stub, state: 'RELEASED', retention_state: 'RETAINED_FOR_REVIEW',
  }))
  return deepFreeze({
    __task3_registry: true,
    generation: parsed.generation,
    common_dir_digest: commonDirs.size === 1 ? liveLeases[0].common_dir_digest : undefined,
    writer_cap: 2,
    leases: [...liveLeases, ...retainedHolders],
    registry_record: parsed,
  })
}

const closedShapeReason = (value, required, optional, prefix) => {
  if (!isPlainObject(value)) return `${prefix}_SHAPE_INVALID`
  const allowed = new Set([...required, ...optional])
  if (Object.keys(value).some((key) => !allowed.has(key))) return `${prefix}_UNKNOWN_FIELD`
  if (required.some((key) => !own(value, key) || value[key] === undefined)) return `${prefix}_INVALID`
  return null
}

const validateAdmissionRequestShape = (request) => {
  const requestShape = closedShapeReason(request, REQUEST_REQUIRED_KEYS, REQUEST_OPTIONAL_KEYS, 'REQUEST_SCHEMA')
  if (requestShape) return requestShape
  if (request.schema_version !== 'admission-request/v1' || !['writer_seat', 'runtime'].includes(request.lease_kind) ||
      !['codex', 'claude'].includes(request.provider) || !opaque(request.lease_id) || !opaque(request.plan_id) ||
      !opaque(request.task_id) || !opaque(request.owner_session) || !opaque(request.provider_session_id) ||
      !opaque(request.execution_context_id) || !sha256(request.repo_identity_digest) || !sha256(request.common_dir_digest) ||
      !opaque(request.worktree_id) || !sha256(request.worktree_path_digest) || !sha256(request.scope_digest) ||
      !sha1(request.baseline_sha) || !sha1(request.head_sha) || !opaque(request.base_ref) || !sha1(request.base_sha) ||
      !sha1(request.expected_remote_sha) || !Array.isArray(request.scope) || request.scope.length === 0 ||
      !Number.isSafeInteger(request.generation) || request.generation < 1 || typeof request.action !== 'string') return 'REQUEST_SCHEMA_INVALID'
  if (request.lease_kind === 'runtime'
    ? !normalizedRuntime(request.runtime_kind)
    : (request.runtime_kind !== null && !normalizedRuntime(request.runtime_kind))) return 'RUNTIME_KIND_UNKNOWN'
  return null
}

const scopeRevalidationBindingKeys = Object.freeze([
  'plan_id', 'generation', 'task_id', 'lease_id', 'execution_context_id', 'worktree_id', 'branch',
  'head_sha', 'scope_digest', 'declared_resources',
])

const scopeRevalidationBindingMatches = (evidence, context) => {
  for (const key of scopeRevalidationBindingKeys) {
    if (key === 'declared_resources') {
      if (digestCanonical(evidence[key]) !== digestCanonical(context[key])) return 'SCOPE_BINDING_MISMATCH'
    } else if (evidence[key] !== context[key]) return key === 'head_sha' ? 'HEAD_BINDING_MISMATCH' : key === 'scope_digest' ? 'SCOPE_BINDING_MISMATCH' : 'SCOPE_REVALIDATION_BINDING_MISMATCH'
  }
  return null
}

/**
 * Re-run the immutable changed-scope predicate immediately before a candidate
 * commit, push, or handoff.  This is deliberately a pure gate: it accepts
 * only an exact, fresh evidence packet and never creates or mutates a lease.
 */
export const evaluateScopeRevalidation = (rawEvidence, rawContext) => {
  try {
    if (rawEvidence === undefined || rawEvidence === null) return held('HELD_SCOPE_DRIFT', 'SCOPE_REVALIDATION_REQUIRED')
    assertSafe(rawEvidence, 'scope_revalidation')
    assertSafe(rawContext, 'scope_revalidation_context')
    const evidence = deepFreeze(clone(rawEvidence))
    const context = deepFreeze(clone(rawContext))
    const evidenceShape = closedShapeReason(evidence, SCOPE_REVALIDATION_REQUIRED_KEYS, [], 'SCOPE_REVALIDATION')
    if (evidenceShape) return held('HELD_SCOPE_DRIFT', evidenceShape)
    const contextShape = closedShapeReason(context, SCOPE_REVALIDATION_CONTEXT_KEYS, [], 'SCOPE_REVALIDATION_CONTEXT')
    if (contextShape) return held('HELD_SCOPE_DRIFT', contextShape)
    if (evidence.schema_version !== 'scope-revalidation/v1' || !SCOPE_REVALIDATION_PHASES.includes(evidence.phase) ||
        !opaque(evidence.evidence_id) || !opaque(evidence.changed_evidence_ref) || !opaque(evidence.plan_id) ||
        !Number.isSafeInteger(evidence.generation) || evidence.generation < 1 || !opaque(evidence.task_id) ||
        !opaque(evidence.lease_id) || !opaque(evidence.execution_context_id) || !opaque(evidence.worktree_id) ||
        !safeCandidateBranch(evidence.branch) || !sha1(evidence.head_sha) || !sha256(evidence.scope_digest) ||
        !Array.isArray(evidence.declared_resources) || evidence.declared_resources.length === 0 || evidence.declared_resources.length > 256 ||
        typeof evidence.changed_evidence !== 'string' || !sha256(evidence.changed_evidence_digest) ||
        !timestamp(evidence.observed_at) || !timestamp(evidence.expires_at) || evidence.expires_at <= evidence.observed_at) {
      return held('HELD_SCOPE_DRIFT', 'SCOPE_REVALIDATION_INVALID')
    }
    if (context.phase !== evidence.phase || !opaque(context.plan_id) || !Number.isSafeInteger(context.generation) || context.generation < 1 ||
        !opaque(context.task_id) || !opaque(context.lease_id) || !opaque(context.execution_context_id) || !opaque(context.worktree_id) ||
        !safeCandidateBranch(context.branch) || !sha1(context.head_sha) || !sha256(context.scope_digest) ||
        !Array.isArray(context.declared_resources) || context.declared_resources.length === 0 || context.declared_resources.length > 256 ||
        !timestamp(context.now)) return held('HELD_SCOPE_DRIFT', 'SCOPE_REVALIDATION_CONTEXT_INVALID')
    if (context.now < evidence.observed_at || context.now >= evidence.expires_at) return held('HELD_SCOPE_DRIFT', 'SCOPE_REVALIDATION_EXPIRED')
    const declared = canonicalScope(evidence.declared_resources)
    const expectedDeclared = canonicalScope(context.declared_resources)
    if (digestCanonical(declared) !== evidence.scope_digest || digestCanonical(expectedDeclared) !== context.scope_digest) return held('HELD_SCOPE_DRIFT', 'SCOPE_BINDING_MISMATCH')
    const bindingReason = scopeRevalidationBindingMatches({ ...evidence, declared_resources: declared }, { ...context, declared_resources: expectedDeclared })
    if (bindingReason) return held('HELD_SCOPE_DRIFT', bindingReason)
    const changed = parseChangedScopeEvidence(evidence.changed_evidence)
    if (changed.evidence_digest !== evidence.changed_evidence_digest) return held('HELD_SCOPE_DRIFT', 'EVIDENCE_DIGEST_MISMATCH')
    const drift = evaluateScopeDrift(declared, changed)
    if (drift.status !== 'SCOPE_EVIDENCE_ACCEPTED') return held('HELD_SCOPE_DRIFT', drift.reason)
    return result('SCOPE_REVALIDATION_ACCEPTED', 'SCOPE_REVALIDATION_FRESH', {
      phase: evidence.phase,
      evidence_id: evidence.evidence_id,
      changed_evidence_ref: evidence.changed_evidence_ref,
      changed_evidence_digest: evidence.changed_evidence_digest,
      scope_digest: evidence.scope_digest,
    })
  } catch (error) {
    return held('HELD_SCOPE_DRIFT', error.code || 'SCOPE_REVALIDATION_INVALID')
  }
}

const requestScope = (request) => {
  const resources = request.scope || request.resources || (request.resource_keys || []).map((resource_key) => ({ kind: 'shared_contract', resource_key }))
  const scope = canonicalScope(resources)
  if (request.scope_digest && request.scope_digest !== digestCanonical(scope)) fail('SCOPE_DIGEST_MISMATCH')
  return scope
}

const task3ResourceScope = (resourceKey) => {
  if (resourceKey.startsWith('path:')) return { kind: 'path', path: resourceKey.slice(5) }
  if (resourceKey.startsWith('glob:')) return { kind: 'glob', pattern: resourceKey.slice(5) }
  if (resourceKey.startsWith('rename:')) {
    const parts = resourceKey.slice(7).split(':')
    if (parts.length === 2) return { kind: 'rename', old_path: parts[0], new_path: parts[1] }
  }
  return { kind: 'shared_contract', resource_key: resourceKey }
}

const scopeForLease = (lease) => lease.scope || lease.resources ||
  (lease.resource_keys || []).map((resourceKey) => task3ResourceScope(resourceKey))

const task3SeatOccupied = (leaseRecord) => leaseRecord.lease_kind === 'writer_seat' && leaseRecord.state !== 'RELEASED'
const task3ResourceHeld = (leaseRecord) => leaseRecord.state !== 'RELEASED' || leaseRecord.retention_state === 'RETAINED_FOR_REVIEW'

const tupleKeys = [
  'lease_id', 'worktree_id', 'worktree_path_digest', 'execution_context_id', 'provider_session_id', 'owner_session',
]

const tupleDuplicate = (left, right) => tupleKeys.some((key) => same(left[key], right[key]))

// v1 has no live signer or activation path.  This is a deliberately
// base-pinned shadow verifier: it can prove that a detached reservation was
// signed by the pinned public key, but it never grants a mutation authority.
// The private half of this key is intentionally absent from the repository.
const SHADOW_PINSET = Object.freeze({
  schema_version: 'fabric-shadow-pinset/v1',
  issuer_id: 'issuer:shadow-control-plane',
  issuer_version: 'fabric-shadow/v1',
  source_digest: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  authority_reference: 'authority:shadow-reservation',
  key_id: 'ed25519:shadow-vector-1',
  revocation_epoch: 0,
  revoked: false,
  mode: 'shadow',
  public_key_spki: 'MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=',
})

const SHADOW_PUBLIC_KEY = createPublicKey({
  key: Buffer.from(SHADOW_PINSET.public_key_spki, 'base64'),
  format: 'der',
  type: 'spki',
})

const SHADOW_RESERVATION_KEYS = Object.freeze([
  'schema_version', 'reservation_id', 'reservation_kind', 'mode', 'key_id',
  'issuer_id', 'issuer_version', 'source_digest', 'authority_reference',
  'revocation_epoch', 'issued_at', 'expires_at', 'nonce', 'sequence', 'status',
  'revoked', 'payload_digest', 'payload', 'signature',
])
const SHADOW_RESERVATION_KINDS = Object.freeze(['execution', 'managed'])
const SHADOW_RESERVATION_STATUS = 'ISSUED'

const EXECUTION_RESERVATION_PAYLOAD_KEYS = Object.freeze([
  'schema_version', 'reservation_id', 'status', 'observed_at', 'expires_at',
  'reservation_nonce', 'reservation_sequence', 'plan_id', 'generation', 'task_id',
  'owner_session', 'provider', 'provider_session_id', 'execution_context_id',
  'context_attestation_digest', 'repo_identity_digest', 'common_dir_digest',
  'worktree_id', 'worktree_path_digest', 'branch', 'baseline_sha', 'current_head_sha',
  'next_head_sha', 'scope_digest', 'lease_id', 'current_envelope_oid',
  'expected_lease_registry_oid', 'command_id', 'command_nonce', 'next_command_nonce',
  'from_level', 'to_level', 'transition_sequence', 'side_effect_class',
  'side_effect_digest', 'scope_evidence_digest', 'next_envelope_digest',
])
const MANAGED_RESERVATION_PAYLOAD_KEYS = Object.freeze([
  'schema_version', 'reservation_id', 'status', 'observed_at', 'expires_at',
  'reservation_nonce', 'reservation_sequence', 'record_digest', 'expected_registry_oid',
  'transition_sequence', 'operation', 'owner_authority', 'managed_base_lease_id',
  'base_ref', 'base_sha', 'current_head_sha', 'protection_profile_digest',
  'generation', 'new_expiry', 'candidate_branch', 'candidate_base_sha',
  'candidate_old_head_sha', 'candidate_new_head_sha', 'expected_remote_ref',
  'expected_remote_sha', 'new_generation', 'commit_range_start', 'commit_range_end',
  'evidence_invalidation', 'candidate_lineage',
])
const exactKeys = (value, required) => isPlainObject(value) &&
  required.length === Object.keys(value).length && required.every((key) => own(value, key))

const shadowReservationFailure = (reason) => ({ ok: false, reason })

const verifyShadowReservation = (rawReservation, kind, payloadKeys, now, payloadCheck) => {
  try {
    if (rawReservation === undefined || rawReservation === null) return shadowReservationFailure('RESERVATION_REQUIRED')
    assertSafe(rawReservation, 'reservation')
    const reservation = deepFreeze(clone(rawReservation))
    if (!exactKeys(reservation, SHADOW_RESERVATION_KEYS)) return shadowReservationFailure('RESERVATION_SCHEMA_INVALID')
    if (reservation.schema_version !== 'fabric-shadow-reservation/v1' || reservation.reservation_kind !== kind ||
        reservation.mode !== SHADOW_PINSET.mode || reservation.key_id !== SHADOW_PINSET.key_id ||
        reservation.issuer_id !== SHADOW_PINSET.issuer_id || reservation.issuer_version !== SHADOW_PINSET.issuer_version ||
        reservation.source_digest !== SHADOW_PINSET.source_digest || reservation.authority_reference !== SHADOW_PINSET.authority_reference ||
        reservation.revocation_epoch !== SHADOW_PINSET.revocation_epoch || reservation.revoked !== false ||
        reservation.status !== SHADOW_RESERVATION_STATUS || !SHADOW_RESERVATION_KINDS.includes(kind) ||
        !opaque(reservation.reservation_id) || !timestamp(reservation.issued_at) || !timestamp(reservation.expires_at) ||
        reservation.expires_at <= reservation.issued_at || !nonce(reservation.nonce) ||
        !Number.isSafeInteger(reservation.sequence) || reservation.sequence < 1 ||
        !sha256(reservation.payload_digest) || typeof reservation.signature !== 'string' || reservation.signature.length === 0) {
      return shadowReservationFailure('RESERVATION_SCHEMA_INVALID')
    }
    if (SHADOW_PINSET.revoked) return shadowReservationFailure('SHADOW_PIN_REVOKED')
    if (!timestamp(now) || now < reservation.issued_at || now >= reservation.expires_at) return shadowReservationFailure('RESERVATION_EXPIRED')
    if (!exactKeys(reservation.payload, payloadKeys) || reservation.payload.schema_version !== `fabric-shadow-${kind}-payload/v1` ||
        reservation.payload.reservation_id !== reservation.reservation_id || reservation.payload.status !== reservation.status ||
        reservation.payload.observed_at !== reservation.issued_at || reservation.payload.expires_at !== reservation.expires_at ||
        reservation.payload.reservation_nonce !== reservation.nonce || reservation.payload.reservation_sequence !== reservation.sequence) {
      return shadowReservationFailure('RESERVATION_PAYLOAD_INVALID')
    }
    if (digestCanonical(reservation.payload) !== reservation.payload_digest) return shadowReservationFailure('RESERVATION_PAYLOAD_DIGEST_MISMATCH')
    const bindingReason = payloadCheck(reservation.payload)
    if (bindingReason) return shadowReservationFailure(bindingReason)
    const signature = Buffer.from(reservation.signature, 'base64')
    if (signature.length !== 64 || signature.toString('base64') !== reservation.signature) return shadowReservationFailure('RESERVATION_SIGNATURE_INVALID')
    const signedPayload = Buffer.from(JSON.stringify(canonicalize(reservation.payload)), 'utf8')
    if (!verifyEd25519(null, signedPayload, SHADOW_PUBLIC_KEY, signature)) return shadowReservationFailure('RESERVATION_SIGNATURE_INVALID')
    return {
      ok: true,
      reservation,
      payload: reservation.payload,
      reservation_digest: digestCanonical(reservation),
      shadow_validation: 'VALID',
    }
  } catch (error) {
    return shadowReservationFailure(error.code || 'RESERVATION_INVALID')
  }
}

const shadowHeld = (check, kind) => check.ok
  ? held('HELD_EXTERNAL_ACTIVATION', `SHADOW_${kind.toUpperCase()}_VALID_BUT_NOT_ACTIVATED`, {
    shadow_validation: check.shadow_validation,
    reservation_digest: check.reservation_digest,
    requires_durable_consumption: true,
  })
  : held('HELD_EXTERNAL_ACTIVATION', check.reason)

const MANAGED_RECORD_REQUIRED_KEYS = Object.freeze([
  'schema_version', 'branch', 'branch_class', 'owner_authority', 'protection_profile_digest', 'base_ref', 'base_sha',
  'generation', 'scope_digest', 'allowed_merge_targets', 'created_at', 'renewed_at', 'expires_at', 'current_head_sha',
  'registry_oid', 'managed_base_lease_id', 'transition_sequence', 'state',
])

const validateManagedRecord = (record) => {
  if (!isPlainObject(record) || Object.keys(record).some((key) => !MANAGED_RECORD_REQUIRED_KEYS.includes(key)) ||
      MANAGED_RECORD_REQUIRED_KEYS.some((key) => !own(record, key))) return false
  if (record.schema_version !== 'managed-branch/v1' || !managedBranch(record.branch) || branchClass(record.branch) !== record.branch_class ||
      !opaque(record.owner_authority) || !sha256(record.protection_profile_digest) || !opaque(record.base_ref) || !sha1(record.base_sha) ||
      !Number.isSafeInteger(record.generation) || record.generation < 1 || !sha256(record.scope_digest) || !Array.isArray(record.allowed_merge_targets) ||
      record.allowed_merge_targets.length === 0 || record.allowed_merge_targets.some((target) => !opaque(target)) ||
      new Set(record.allowed_merge_targets).size !== record.allowed_merge_targets.length ||
      !timestamp(record.created_at) || !timestamp(record.renewed_at) || !timestamp(record.expires_at) ||
      !sha1(record.current_head_sha) || !sha1(record.registry_oid) || !opaque(record.managed_base_lease_id) ||
      !Number.isSafeInteger(record.transition_sequence) || record.transition_sequence < 0 ||
      !['ACTIVE', 'FROZEN', 'REBASE_REQUIRED'].includes(record.state)) return false
  return true
}

export const evaluateAdmission = (rawSnapshot, rawRequest) => {
  try {
    assertSafe(rawSnapshot, 'snapshot')
    assertSafe(rawRequest, 'request')
    if (!isPlainObject(rawSnapshot) || !isPlainObject(rawRequest)) return held('HELD_EXECUTION_CONTEXT', 'REQUEST_SHAPE_INVALID')
    if (rawSnapshot.schema_version !== 'session-lease-registry/v1') return held('HELD_EXECUTION_CONTEXT', 'SNAPSHOT_REGISTRY_INVALID')
    const snapshot = deriveTask3AdmissionView(rawSnapshot)
    const request = rawRequest
    if (!snapshot) return held('HELD_EXECUTION_CONTEXT', 'SNAPSHOT_REGISTRY_INVALID')
    const shapeReason = validateAdmissionRequestShape(request)
    if (shapeReason === 'RUNTIME_KIND_UNKNOWN') return held('HELD_RUNTIME', shapeReason)
    if (shapeReason) return held('HELD_EXECUTION_CONTEXT', shapeReason)
    // `snapshot.generation` is the registry's CAS revision, not plan authority. The
    // request's plan generation is compared with the live leases of the same plan:
    // an older generation still holding a seat must drain before the next admits.
    if (request.generation && snapshot.leases.some((leaseRecord) => leaseRecord.plan_id === request.plan_id &&
        leaseRecord.state !== 'RELEASED' && leaseRecord.generation !== request.generation)) return held('HELD_EVIDENCE_BINDING', 'GENERATION_MISMATCH')
    if (request.common_dir_digest && snapshot.common_dir_digest && request.common_dir_digest !== snapshot.common_dir_digest) return held('HELD_TOPOLOGY_UNSUPPORTED', 'COMMON_DIR_MISMATCH')
    if (!request.branch || request.branch === 'main' || request.branch === 'master') return held('HELD_EXECUTION_CONTEXT', 'IDENTITY_BINDING_INVALID')
    if (!safeCandidateBranch(request.branch) && !managedBranch(request.branch)) return held('HELD_EXECUTION_CONTEXT', 'IDENTITY_BINDING_INVALID')
    if (request.worktree_id && request.worktree_path_digest && request.worktree_id === request.worktree_path_digest) return held('HELD_CONFLICT', 'DUPLICATE_EXECUTION_TUPLE')
    const scope = requestScope(request)
    const changedEvidence = request.changed_evidence ?? request.scope_evidence
    if (changedEvidence !== undefined) {
      const drift = evaluateScopeDrift(scope, changedEvidence)
      if (drift.status !== 'SCOPE_EVIDENCE_ACCEPTED') return drift
    }
    const runtime = normalizedRuntime(request.runtime_kind || request.runtime_role)
    if (runtime) return held('HELD_RUNTIME', 'RUNTIME_REGISTRY_REQUIRED')
    if (own(request, 'parent_base_sha') || (isPlainObject(request.evidence) && own(request.evidence, 'parent_base_sha'))) {
      return held('HELD_SCOPE_DRIFT', 'PARENT_AUTHORITY_REQUIRED')
    }
    const managedRef = request.base_ref && managedBranch(request.base_ref) ? request.base_ref : managedBranch(request.branch) ? request.branch : null
    if (managedRef || managedBranch(request.branch) || request.target_branch && managedBranch(request.target_branch)) {
      return held('HELD_MANAGED_BRANCH', 'MANAGED_REGISTRY_REQUIRED')
    }
    const leases = snapshot.leases
    let occupiedSeats = 0
    let retainedResources = 0
    for (const existing of leases) {
      const resourcesHeld = task3ResourceHeld(existing)
      const seatOccupied = task3SeatOccupied(existing)
      if (resourcesHeld) retainedResources += 1
      if (seatOccupied) occupiedSeats += 1
      if (!resourcesHeld) continue
      if (existing.branch && request.branch && existing.branch === request.branch) {
        return queued('BRANCH_CONTENTION', { seat_occupied: occupiedSeats, resources_retained: retainedResources })
      }
      if (tupleDuplicate(existing, request)) return held('HELD_CONFLICT', 'DUPLICATE_EXECUTION_TUPLE', { seat_occupied: seatOccupied, resources_retained: retainedResources })
      const conflict = findScopeConflicts(scope, scopeForLease(existing))
      if (conflict.status === 'UNKNOWN') return queued('SCOPE_OVERLAP_UNKNOWN')
      if (conflict.status === 'CONFLICT') return queued('RESOURCE_CONFLICT', { conflict, seat_occupied: occupiedSeats, resources_retained: retainedResources })
    }

    return result('ADMITTED', 'ADMISSION_ALLOWED', {
      scope_digest: digestCanonical(scope),
      resources: scope,
      runtime_kind: runtime,
      writer_seat: request.lease_kind === 'writer_seat' || !runtime,
      seat_occupied: occupiedSeats,
      resources_retained: retainedResources,
    })
  } catch (error) {
    if (error instanceof AdmissionError && error.code === 'SCOPE_DIGEST_MISMATCH') return held('HELD_SCOPE_DRIFT', error.code)
    if (error instanceof AdmissionError && error.code === 'SECRET_MATERIAL_FORBIDDEN') return held('HELD_EXECUTION_CONTEXT', error.code)
    return held('HELD_EXECUTION_CONTEXT', error.code || 'REQUEST_INVALID')
  }
}

const MANAGED_COMMAND_REQUIRED_KEYS = Object.freeze([
  'schema_version', 'action', 'operation_id', 'owner_authority', 'managed_base_lease_id', 'current_generation',
  'expected_registry_oid', 'expected_base_sha', 'expected_head_sha', 'expected_protection_profile_digest',
  'transition_sequence', 'nonce', 'now',
])
const MANAGED_COMMAND_OPTIONAL_KEYS = Object.freeze([
  'requested_expires_at', 'candidate_branch', 'candidate_base_sha', 'candidate_old_head_sha', 'candidate_new_head_sha',
  'expected_remote_ref', 'expected_remote_sha', 'new_generation', 'commit_range_start', 'commit_range_end',
  'evidence_invalidation', 'candidate_lineage', 'registry_cas_status', 'cas_decision', 'reservation_receipt',
])
const MANAGED_EVIDENCE_INVALIDATION = Object.freeze(['checks', 'review', 'train', 'e2e'])

const managedCommandShape = (command) => {
  if (!isPlainObject(command) || Object.keys(command).some((key) => !MANAGED_COMMAND_REQUIRED_KEYS.includes(key) && !MANAGED_COMMAND_OPTIONAL_KEYS.includes(key)) ||
      MANAGED_COMMAND_REQUIRED_KEYS.some((key) => !own(command, key))) return 'MANAGED_COMMAND_INVALID'
  if (command.schema_version !== 'managed-branch-command/v1' || !['renew', 'advance', 'rebase'].includes(command.action)) return 'MANAGED_OPERATION_INVALID'
  if (!opaque(command.operation_id) || !opaque(command.owner_authority) || !opaque(command.managed_base_lease_id) ||
      !Number.isSafeInteger(command.current_generation) || command.current_generation < 1 || !sha1(command.expected_registry_oid) ||
      !sha1(command.expected_base_sha) || !sha1(command.expected_head_sha) || !sha256(command.expected_protection_profile_digest) ||
      !Number.isSafeInteger(command.transition_sequence) || command.transition_sequence < 0 || !timestamp(command.now)) return 'MANAGED_COMMAND_INVALID'
  if (!nonce(command.nonce)) return 'NONCE_INVALID'
  // The legacy boolean/CAS echo is deliberately non-authoritative.  A false
  // echo may explain a typed hold, but a true echo can never grant access.
  if (own(command, 'cas_decision') && (!isPlainObject(command.cas_decision) || command.cas_decision.winner === false)) return 'REGISTRY_CAS_LOST'
  if (command.registry_cas_status !== undefined && command.registry_cas_status !== 'READY') return 'REGISTRY_CAS_CONFLICT'
  return null
}

const managedCommandCommon = (record, command) => {
  const shape = managedCommandShape(command)
  if (shape) return shape
  if (record.state !== 'ACTIVE') return 'MANAGED_BRANCH_NOT_ACTIVE'
  if (record.expires_at <= command.now) return 'MANAGED_BRANCH_EXPIRED'
  if (command.owner_authority !== record.owner_authority) return 'OWNER_MISMATCH'
  if (command.managed_base_lease_id !== record.managed_base_lease_id) return 'MANAGED_BASE_LEASE_REQUIRED'
  if (command.current_generation !== record.generation) return 'GENERATION_MISMATCH'
  if (command.expected_registry_oid !== record.registry_oid) return 'REGISTRY_OID_REQUIRED'
  if (command.expected_base_sha !== record.base_sha) return 'EXPECTED_BASE_MISMATCH'
  if (command.expected_head_sha !== record.current_head_sha) return 'EXPECTED_HEAD_MISMATCH'
  if (command.expected_protection_profile_digest !== record.protection_profile_digest) return 'PROTECTION_PROFILE_DRIFT'
  if (command.transition_sequence !== record.transition_sequence) return 'TRANSITION_SEQUENCE_MISMATCH'
  if (own(command, 'cas_decision') && isPlainObject(command.cas_decision) &&
      (command.cas_decision.operation_id !== undefined && command.cas_decision.operation_id !== command.operation_id ||
       command.cas_decision.expected_registry_oid !== undefined && command.cas_decision.expected_registry_oid !== command.expected_registry_oid ||
       command.cas_decision.expected_transition_sequence !== undefined && command.cas_decision.expected_transition_sequence !== command.transition_sequence ||
       command.cas_decision.nonce !== undefined && command.cas_decision.nonce !== command.nonce)) return 'REGISTRY_CAS_DECISION_MISMATCH'
  return null
}

const managedReservationPayloadCheck = (payload, record, command) => {
  const expected = {
    schema_version: 'fabric-shadow-managed-payload/v1',
    reservation_id: payload.reservation_id,
    status: payload.status,
    observed_at: payload.observed_at,
    expires_at: payload.expires_at,
    reservation_nonce: payload.reservation_nonce,
    reservation_sequence: payload.reservation_sequence,
    record_digest: digestCanonical(record),
    expected_registry_oid: command.expected_registry_oid,
    transition_sequence: command.transition_sequence,
    operation: command.action,
    owner_authority: record.owner_authority,
    managed_base_lease_id: record.managed_base_lease_id,
    base_ref: record.branch,
    base_sha: record.base_sha,
    current_head_sha: record.current_head_sha,
    protection_profile_digest: record.protection_profile_digest,
    generation: record.generation,
    new_expiry: command.action === 'renew' ? command.requested_expires_at : null,
    candidate_branch: command.action === 'renew' ? null : command.candidate_branch,
    candidate_base_sha: command.action === 'renew' ? null : command.candidate_base_sha,
    candidate_old_head_sha: command.action === 'renew' ? null : command.candidate_old_head_sha,
    candidate_new_head_sha: command.action === 'renew' ? null : command.candidate_new_head_sha,
    expected_remote_ref: command.action === 'renew' ? null : command.expected_remote_ref,
    expected_remote_sha: command.action === 'renew' ? null : command.expected_remote_sha,
    new_generation: command.action === 'renew' ? null : command.new_generation,
    commit_range_start: command.action === 'renew' ? null : command.commit_range_start,
    commit_range_end: command.action === 'renew' ? null : command.commit_range_end,
    evidence_invalidation: command.action === 'renew' ? [] : command.evidence_invalidation,
    candidate_lineage: command.action === 'renew' ? [] : command.candidate_lineage,
  }
  return digestCanonical(payload) === digestCanonical(expected) ? null : 'MANAGED_RESERVATION_BINDING_MISMATCH'
}

const managedReservation = (record, command, reservation) => verifyShadowReservation(
  reservation,
  'managed',
  MANAGED_RESERVATION_PAYLOAD_KEYS,
  command.now,
  (payload) => managedReservationPayloadCheck(payload, record, command),
)

const managedOperation = (rawRecord, rawCommand, rawReservation = undefined) => {
  try {
    assertSafe(rawRecord, 'managed_record')
    assertSafe(rawCommand, 'managed_command')
    if (!validateManagedRecord(rawRecord)) return held('HELD_MANAGED_BRANCH', 'MANAGED_BRANCH_INVALID')
    const record = deepFreeze(clone(rawRecord))
    const command = deepFreeze(clone(rawCommand))
    const reservation = rawReservation === undefined ? command.reservation_receipt : rawReservation
    const commonReason = managedCommandCommon(record, command)
    if (commonReason) return held('HELD_MANAGED_BRANCH', commonReason)

    if (command.action === 'renew') {
      if (!own(command, 'requested_expires_at') || !timestamp(command.requested_expires_at) || command.requested_expires_at <= record.expires_at ||
          ['candidate_branch', 'candidate_base_sha', 'candidate_old_head_sha', 'candidate_new_head_sha', 'expected_remote_ref', 'expected_remote_sha',
            'new_generation', 'commit_range_start', 'commit_range_end', 'evidence_invalidation', 'candidate_lineage'].some((key) => own(command, key))) {
        return held('HELD_MANAGED_BRANCH', command.requested_expires_at && command.requested_expires_at <= record.expires_at ? 'EXPIRY_NOT_EXTENDED' : 'MANAGED_OPERATION_INVALID')
      }
      const shadow = managedReservation(record, command, reservation)
      return shadowHeld(shadow, 'managed')
    }

    const requiredLineage = ['candidate_branch', 'candidate_base_sha', 'candidate_old_head_sha', 'candidate_new_head_sha',
      'expected_remote_ref', 'expected_remote_sha', 'new_generation', 'commit_range_start', 'commit_range_end', 'evidence_invalidation', 'candidate_lineage']
    if (requiredLineage.some((key) => !own(command, key)) || own(command, 'requested_expires_at') || !safeCandidateBranch(command.candidate_branch) ||
        !sha1(command.candidate_base_sha) || command.candidate_base_sha !== record.current_head_sha || !sha1(command.candidate_old_head_sha) ||
        !sha1(command.candidate_new_head_sha) || command.candidate_old_head_sha === command.candidate_new_head_sha ||
        command.expected_remote_ref !== command.candidate_branch || !sha1(command.expected_remote_sha) ||
        command.expected_remote_sha !== command.candidate_old_head_sha || !Number.isSafeInteger(command.new_generation) ||
        command.new_generation !== record.generation + 1 || !sha1(command.commit_range_start) || !sha1(command.commit_range_end) ||
        !Array.isArray(command.evidence_invalidation) || command.evidence_invalidation.join('|') !== MANAGED_EVIDENCE_INVALIDATION.join('|') ||
        !Array.isArray(command.candidate_lineage) || command.candidate_lineage.length === 0 || command.candidate_lineage.some((entry) => !opaque(entry))) {
      return held('HELD_MANAGED_BRANCH', own(command, 'new_generation') && command.new_generation !== record.generation + 1 ? 'MANAGED_GENERATION_REQUIRED' : 'MANAGED_OPERATION_INVALID')
    }
    const shadow = managedReservation(record, command, reservation)
    return shadowHeld(shadow, 'managed')
  } catch (error) {
    return held('HELD_MANAGED_BRANCH', error.code || 'MANAGED_COMMAND_INVALID')
  }
}

export const renewManagedBranch = (record, command, reservation = undefined) => managedOperation(record, command, reservation)
export const advanceManagedBranch = (record, command, reservation = undefined) => managedOperation(record, { ...command, action: 'advance' }, reservation)
export const rebaseManagedBranch = (record, command, reservation = undefined) => managedOperation(record, { ...command, action: 'rebase' }, reservation)

const EXECUTION_SIDE_EFFECT_BY_LEVEL = Object.freeze({
  plan_only: 'CONTROL_METADATA',
  implement_local: 'CANDIDATE_FILESYSTEM',
  push_owned_branch: 'REMOTE_GIT_GITHUB',
  open_draft_pr: 'REMOTE_GIT_GITHUB',
  submit_delivery: 'REMOTE_GIT_GITHUB',
})
const EXECUTION_SIDE_EFFECTS = Object.freeze([
  'CONTROL_METADATA', 'CANDIDATE_FILESYSTEM', 'REMOTE_GIT_GITHUB',
  'HOST_RUNTIME_SECURITY', 'EXTERNAL_ENVIRONMENT',
])
const EXECUTION_COMMAND_REQUIRED_KEYS = Object.freeze([
  'type', 'command_id', 'next_level', 'expected_envelope_id', 'expected_transition_sequence',
  'expected_envelope_oid', 'expected_lease_registry_oid', 'command_nonce', 'now', 'authority', 'next_envelope',
])
const EXECUTION_COMMAND_OPTIONAL_KEYS = Object.freeze([
  'action', 'approve', 'draft_pr', 'evidence_refs', 'external_capability_reference', 'force', 'force_mode',
  'force_push', 'force_with_lease', 'merge', 'merge_credential', 'non_draft_pr', 'open_draft_pr', 'replayed',
  'self_approval', 'deploy', 'direct_deploy', 'direct_merge', 'bulk_promotion', 'scope_revalidation', 'reservation_receipt',
])
const EXECUTION_AUTHORITY_REQUIRED_KEYS = Object.freeze([
  'authority_issued', 'plan_id', 'issuer_id', 'issuer_version', 'issuer_source_digest', 'authority_reference',
  'authority_digest', 'expected_envelope_oid', 'expected_lease_registry_oid', 'generation', 'task_id', 'owner_session',
  'provider', 'provider_session_id', 'execution_context_id', 'context_attestation_digest', 'repo_identity_digest',
  'common_dir_digest', 'worktree_id', 'worktree_path_digest', 'branch', 'baseline_sha', 'head_sha', 'scope_digest',
  'lease_id', 'allowed_remote', 'allowed_repository', 'allowed_base', 'expected_remote_ref', 'expected_remote_sha',
  'promotion_mode', 'command_nonce', 'current_level', 'side_effect_class', 'authorized_highest_level', 'issued_at',
  'expires_at', 'revocation_epoch', 'revoked',
])
const EXECUTION_AUTHORITY_OPTIONAL_KEYS = Object.freeze(['next_lease_id', 'next_scope_digest'])
const EXECUTION_RECEIPT_REQUIRED_KEYS = Object.freeze([
  'schema_version', 'receipt_id', 'issuer_id', 'issuer_version', 'source_digest', 'authority_reference',
  'authority_digest', 'revocation_epoch', 'plan_id', 'generation', 'task_id', 'observed_at', 'expires_at',
  'current_envelope_oid', 'expected_lease_registry_oid', 'command_id', 'command_nonce', 'next_command_nonce',
  'transition_sequence', 'from_level', 'to_level', 'owner_session', 'provider', 'provider_session_id',
  'execution_context_id', 'context_attestation_digest', 'repo_identity_digest', 'common_dir_digest', 'worktree_id',
  'worktree_path_digest', 'branch', 'baseline_sha', 'head_sha', 'scope_digest', 'lease_id', 'allowed_remote',
  'allowed_repository', 'allowed_base', 'expected_remote_ref', 'expected_remote_sha', 'promotion_mode',
  'side_effect_class', 'side_effect_digest',
])
const EXECUTION_RECEIPT_OPTIONAL_KEYS = Object.freeze(['external_capability_reference'])

const scopeRevalidationPhase = (current, next) => {
  if (current.current_level === 'plan_only') return null
  if (next.current_level === 'push_owned_branch') return 'push'
  if (next.current_level === 'open_draft_pr' || next.current_level === 'submit_delivery') return 'handoff'
  return null
}

const scopeRevalidationContext = (current, phase, declaredResources, now) => ({
  phase,
  plan_id: current.plan_id,
  generation: current.generation,
  task_id: current.task_id,
  lease_id: current.lease_id,
  execution_context_id: current.execution_context_id,
  worktree_id: current.worktree_id,
  branch: current.branch,
  head_sha: current.head_sha,
  scope_digest: current.scope_digest,
  declared_resources: declaredResources,
  now,
})

const hasOnlyKeys = (value, required, optional = []) => {
  if (!isPlainObject(value)) return false
  const allowed = new Set([...required, ...optional])
  return required.every((key) => own(value, key)) && Object.keys(value).every((key) => allowed.has(key))
}

const nullable = (value, predicate) => value === null || predicate(value)
const executionLevel = (value) => EXECUTION_LEVELS.includes(value)
const sideEffect = (value) => EXECUTION_SIDE_EFFECTS.includes(value)

const validateCommandShape = (command) => {
  if (!isPlainObject(command)) return 'COMMAND_SCHEMA_INVALID'
  if (!hasOnlyKeys(command, EXECUTION_COMMAND_REQUIRED_KEYS, EXECUTION_COMMAND_OPTIONAL_KEYS)) return 'COMMAND_SCHEMA_INVALID'
  if (command.type !== 'advance' || !opaque(command.command_id) || !executionLevel(command.next_level) ||
      !opaque(command.expected_envelope_id) || !Number.isSafeInteger(command.expected_transition_sequence) ||
      command.expected_transition_sequence < 0 || !sha1(command.expected_envelope_oid) ||
      !sha1(command.expected_lease_registry_oid) || !nonce(command.command_nonce) || !timestamp(command.now) ||
      !isPlainObject(command.authority) || !isPlainObject(command.next_envelope)) return 'COMMAND_SCHEMA_INVALID'
  for (const key of ['approve', 'draft_pr', 'force', 'force_push', 'force_with_lease', 'merge', 'non_draft_pr', 'open_draft_pr', 'replayed', 'self_approval', 'deploy', 'direct_deploy', 'direct_merge', 'bulk_promotion']) {
    if (own(command, key) && typeof command[key] !== 'boolean') return 'COMMAND_SCHEMA_INVALID'
  }
  if (own(command, 'merge_credential') && command.merge_credential !== false) return 'MERGE_CREDENTIAL_FORBIDDEN'
  if (own(command, 'force_mode') && command.force_mode !== 'force' && command.force_mode !== 'force_with_lease') return 'COMMAND_SCHEMA_INVALID'
  if (own(command, 'action') && (typeof command.action !== 'string' || command.action.length === 0 || command.action.length > 64)) return 'COMMAND_SCHEMA_INVALID'
  if (own(command, 'external_capability_reference') && !nullable(command.external_capability_reference, opaque)) return 'COMMAND_SCHEMA_INVALID'
  if (own(command, 'evidence_refs') && command.evidence_refs !== undefined && !isPlainObject(command.evidence_refs)) return 'SUBMIT_EVIDENCE_REQUIRED'
  if (own(command, 'scope_revalidation') && !isPlainObject(command.scope_revalidation)) return 'SCOPE_REVALIDATION_INVALID'
  return null
}

const validateAuthority = (authority, current, next, command) => {
  if (!isPlainObject(authority) || !hasOnlyKeys(authority, EXECUTION_AUTHORITY_REQUIRED_KEYS, EXECUTION_AUTHORITY_OPTIONAL_KEYS)) return 'AUTHORITY_SCHEMA_INVALID'
  if (authority.authority_issued !== true) return 'AUTHORITY_REQUIRED'
  if (authority.issuer_id === current.owner_session || authority.issuer_id === current.provider_session_id) return 'SELF_ISSUED'
  for (const key of ['plan_id', 'issuer_id', 'issuer_version', 'authority_reference', 'authority_digest', 'task_id', 'owner_session', 'provider_session_id', 'execution_context_id', 'allowed_remote', 'allowed_repository', 'allowed_base', 'promotion_mode', 'current_level', 'side_effect_class', 'authorized_highest_level']) {
    if (authority[key] !== ({
      plan_id: current.plan_id,
      issuer_id: current.issuer_id,
      issuer_version: current.issuer_version,
      authority_reference: current.authority_reference,
      authority_digest: current.authority_digest,
      task_id: current.task_id,
      owner_session: current.owner_session,
      provider_session_id: current.provider_session_id,
      execution_context_id: current.execution_context_id,
      allowed_remote: current.allowed_remote,
      allowed_repository: current.allowed_repository,
      allowed_base: current.allowed_base,
      promotion_mode: current.promotion_mode,
      current_level: current.current_level,
      side_effect_class: current.side_effect_class,
      authorized_highest_level: current.authorized_highest_level,
    })[key]) return key === 'allowed_base' ? 'TARGET_BINDING_MISMATCH' : key === 'side_effect_class' ? 'SIDE_EFFECT_CLASS_MISMATCH' : key === 'current_level' ? 'LEVEL_BINDING_MISMATCH' : `${key.toUpperCase()}_BINDING_MISMATCH`
  }
  if (authority.revoked !== false) return authority.revoked === true ? 'ENVELOPE_REVOKED' : 'AUTHORITY_SCHEMA_INVALID'
  if (authority.generation !== current.generation) return 'GENERATION_MISMATCH'
  if (authority.expected_envelope_oid !== command.expected_envelope_oid) return 'ENVELOPE_OID_MISMATCH'
  if (authority.expected_lease_registry_oid !== command.expected_lease_registry_oid || authority.expected_lease_registry_oid !== current.expected_lease_registry_oid) return 'LEASE_REGISTRY_OID_MISMATCH'
  if (authority.command_nonce !== current.command_nonce) return 'NONCE_BINDING_MISMATCH'
  if (authority.issued_at !== current.issued_at || authority.expires_at !== current.expires_at ||
      authority.issued_at > command.now || command.now >= authority.expires_at) return 'ENVELOPE_EXPIRED'
  const exactCurrent = [
    ['context_attestation_digest', 'CONTEXT_BINDING_MISMATCH'], ['repo_identity_digest', 'REPOSITORY_BINDING_MISMATCH'],
    ['common_dir_digest', 'COMMON_DIR_BINDING_MISMATCH'], ['worktree_id', 'WORKTREE_BINDING_MISMATCH'],
    ['worktree_path_digest', 'WORKTREE_PATH_BINDING_MISMATCH'], ['branch', 'BRANCH_BINDING_MISMATCH'],
    ['baseline_sha', 'BASELINE_BINDING_MISMATCH'], ['head_sha', 'HEAD_BINDING_MISMATCH'],
    ['scope_digest', 'SCOPE_BINDING_MISMATCH'], ['lease_id', 'LEASE_BINDING_MISMATCH'],
    ['expected_remote_ref', 'REMOTE_REF_BINDING_MISMATCH'], ['expected_remote_sha', 'EXPECTED_REMOTE_SHA_MISMATCH'],
  ]
  for (const [key, reason] of exactCurrent) {
    const expectedValue = key === 'expected_remote_ref' || key === 'expected_remote_sha'
      ? (EXECUTION_LEVELS.indexOf(next.current_level) >= EXECUTION_LEVELS.indexOf('push_owned_branch') ? next[key] : current[key])
      : current[key]
    if (authority[key] !== expectedValue) return reason
  }
  if (authority.provider !== current.provider || authority.task_id !== current.task_id || authority.generation !== current.generation) return 'ENVELOPE_BINDING_MISMATCH'
  if (authority.next_lease_id !== undefined && authority.next_lease_id !== next.lease_id) return 'LEASE_BINDING_MISMATCH'
  if (authority.next_scope_digest !== undefined && authority.next_scope_digest !== next.scope_digest) return 'SCOPE_BINDING_MISMATCH'
  return null
}

const transitionBindings = (current, next, command) => {
  if (next.envelope_id === current.envelope_id) return 'NONCE_REPLAY'
  if (next.expected_previous_envelope_oid !== command.expected_envelope_oid) return 'PREVIOUS_ENVELOPE_BINDING_MISMATCH'
  if (next.expected_lease_registry_oid !== command.expected_lease_registry_oid) return 'LEASE_REGISTRY_OID_MISMATCH'
  const immutableKeys = [
    'plan_id', 'generation', 'task_id', 'owner_session', 'provider', 'provider_session_id', 'execution_context_id',
    'context_attestation_digest', 'issuer_id', 'issuer_version', 'authority_reference', 'authority_digest',
    'issued_at', 'expires_at', 'revocation_epoch', 'repo_identity_digest', 'common_dir_digest', 'baseline_sha',
    'scope_digest', 'allowed_remote', 'allowed_repository', 'allowed_base', 'promotion_mode', 'authorized_highest_level',
  ]
  const changedImmutableKey = immutableKeys.find((key) => next[key] !== current[key])
  if (changedImmutableKey) {
    if (changedImmutableKey === 'authorized_highest_level') return 'AUTHORITY_LEVEL_MUTATION'
    if (changedImmutableKey === 'allowed_base') return 'TARGET_BINDING_MISMATCH'
    if (changedImmutableKey === 'scope_digest') return 'SCOPE_BINDING_MISMATCH'
    return 'ENVELOPE_BINDING_MISMATCH'
  }
  if (EXECUTION_LEVELS.indexOf(next.current_level) !== current.transition_sequence + 1 || next.transition_sequence !== current.transition_sequence + 1) return 'NON_ADJACENT_TRANSITION'
  return null
}

const validateEvidenceRefs = (value) => {
  const keys = ['independent_review', 'e2e', 'train', 'drift', 'packet']
  if (!hasOnlyKeys(value, keys) || keys.some((key) => !opaque(value[key]))) return false
  return true
}

const nextLevelBindings = (current, next, command) => {
  const level = next.current_level
  if (!executionLevel(level)) return 'LEVEL_BINDING_MISMATCH'
  if (next.side_effect_class !== EXECUTION_SIDE_EFFECT_BY_LEVEL[level] || current.side_effect_class !== EXECUTION_SIDE_EFFECT_BY_LEVEL[current.current_level]) return 'SIDE_EFFECT_CLASS_MISMATCH'
  if (next.side_effect_class === 'HOST_RUNTIME_SECURITY' || next.side_effect_class === 'EXTERNAL_ENVIRONMENT') return 'SIDE_EFFECT_CLASS_FORBIDDEN'
  if (next.branch === 'main' || next.branch === 'master' || managedBranch(next.branch)) return 'PROTECTED_BRANCH_FORBIDDEN'
  if (next.branch !== null && !safeCandidateBranch(next.branch)) return 'BRANCH_BINDING_INVALID'
  if (next.branch !== null && current.branch !== null && next.branch !== current.branch) return 'BRANCH_BINDING_MISMATCH'
  if (level === 'implement_local') {
    if (!next.worktree_id || !next.worktree_path_digest || !next.branch || !next.head_sha || !next.lease_id) return 'BOUND_NEXT_ENVELOPE_REQUIRED'
    if (next.expected_remote_ref !== null || next.expected_remote_sha !== null || next.external_capability_reference !== null) return 'IMPLEMENT_REMOTE_BINDING_FORBIDDEN'
    if (own(command, 'external_capability_reference') && command.external_capability_reference !== null) return 'IMPLEMENT_CAPABILITY_FORBIDDEN'
    if (own(command, 'evidence_refs') && command.evidence_refs !== undefined) return 'EVIDENCE_BINDING_FORBIDDEN'
  }
  if (level === 'push_owned_branch' || level === 'open_draft_pr' || level === 'submit_delivery') {
    if (!next.worktree_id || !next.worktree_path_digest || !next.branch || !next.head_sha || !next.lease_id) return 'BOUND_NEXT_ENVELOPE_REQUIRED'
    if (current.branch === null || next.branch !== current.branch || next.worktree_id !== current.worktree_id || next.worktree_path_digest !== current.worktree_path_digest || next.lease_id !== current.lease_id) return 'BRANCH_BINDING_MISMATCH'
    if (next.head_sha !== current.head_sha) return 'HEAD_BINDING_MISMATCH'
    if (next.expected_remote_ref !== current.expected_remote_ref && level !== 'push_owned_branch') return 'REMOTE_REF_BINDING_MISMATCH'
    if (next.expected_remote_sha !== current.expected_remote_sha && level !== 'push_owned_branch') return 'EXPECTED_REMOTE_SHA_MISMATCH'
  }
  if (level === 'push_owned_branch') {
    if (!next.expected_remote_ref || next.expected_remote_ref !== next.branch) return 'REMOTE_REF_BINDING_MISMATCH'
    if (!sha1(next.expected_remote_sha) || !current.head_sha || next.expected_remote_sha !== current.head_sha) return 'EXPECTED_REMOTE_SHA_MISMATCH'
    if (command.force === true || command.force_mode === 'force' || command.force_push === true || command.force_with_lease !== true) return 'FORCE_WITH_LEASE_REQUIRED'
    if (next.external_capability_reference !== null) return 'PUSH_CAPABILITY_FORBIDDEN'
  }
  if (level === 'open_draft_pr') {
    if (command.non_draft_pr === true || command.draft_pr === false) return 'DRAFT_PR_REQUIRED'
    if (next.promotion_mode !== 'single_pr' || !next.expected_remote_ref || !next.expected_remote_sha || next.expected_remote_ref !== next.branch || next.expected_remote_sha !== current.head_sha) return 'DRAFT_BINDING_MISMATCH'
    if (next.external_capability_reference !== null) return 'DRAFT_CAPABILITY_FORBIDDEN'
    if (own(command, 'external_capability_reference') && command.external_capability_reference !== null) return 'DRAFT_CAPABILITY_FORBIDDEN'
    if (own(command, 'evidence_refs') && command.evidence_refs !== undefined) return 'EVIDENCE_BINDING_FORBIDDEN'
  }
  if (level === 'submit_delivery') {
    if (command.non_draft_pr === true || command.draft_pr === false) return 'DRAFT_PR_REQUIRED'
    if (next.promotion_mode !== 'single_pr' || !next.external_capability_reference) return 'SUBMIT_CAPABILITY_REQUIRED'
    if (own(command, 'external_capability_reference') && command.external_capability_reference !== next.external_capability_reference) return 'SUBMIT_CAPABILITY_MISMATCH'
    if (!validateEvidenceRefs(command.evidence_refs)) return 'SUBMIT_EVIDENCE_REQUIRED'
    if (!next.expected_remote_ref || !next.expected_remote_sha || next.expected_remote_ref !== next.branch || next.expected_remote_sha !== current.head_sha) return 'SUBMIT_BINDING_MISMATCH'
    if (next.side_effect_class !== 'REMOTE_GIT_GITHUB') return 'SIDE_EFFECT_CLASS_MISMATCH'
  }
  if (command.force === true || command.force_mode === 'force' || command.force_push === true) return 'FORCE_WITH_LEASE_REQUIRED'
  if (EXECUTION_LEVELS.indexOf(command.next_level) !== current.transition_sequence + 1) return 'NON_ADJACENT_TRANSITION'
  if (level !== command.next_level) return 'LEVEL_BINDING_MISMATCH'
  return null
}

const executionReservationPayloadCheck = (payload, current, next, command) => {
  const scopeEvidenceDigest = command.scope_revalidation?.changed_evidence_digest || digestCanonical({ scope_digest: current.scope_digest })
  const expected = {
    schema_version: 'fabric-shadow-execution-payload/v1',
    reservation_id: payload.reservation_id,
    status: payload.status,
    observed_at: payload.observed_at,
    expires_at: payload.expires_at,
    reservation_nonce: payload.reservation_nonce,
    reservation_sequence: payload.reservation_sequence,
    plan_id: current.plan_id,
    generation: current.generation,
    task_id: current.task_id,
    owner_session: current.owner_session,
    provider: current.provider,
    provider_session_id: current.provider_session_id,
    execution_context_id: current.execution_context_id,
    context_attestation_digest: current.context_attestation_digest,
    repo_identity_digest: current.repo_identity_digest,
    common_dir_digest: current.common_dir_digest,
    worktree_id: next.worktree_id,
    worktree_path_digest: next.worktree_path_digest,
    branch: next.branch,
    baseline_sha: current.baseline_sha,
    current_head_sha: current.head_sha,
    next_head_sha: next.head_sha,
    scope_digest: current.scope_digest,
    lease_id: next.lease_id,
    current_envelope_oid: command.expected_envelope_oid,
    expected_lease_registry_oid: command.expected_lease_registry_oid,
    command_id: command.command_id,
    command_nonce: command.command_nonce,
    next_command_nonce: next.command_nonce,
    from_level: current.current_level,
    to_level: next.current_level,
    transition_sequence: next.transition_sequence,
    side_effect_class: next.side_effect_class,
    side_effect_digest: digestCanonical({ side_effect_class: next.side_effect_class, to_level: next.current_level }),
    scope_evidence_digest: scopeEvidenceDigest,
    next_envelope_digest: digestCanonical(next),
  }
  return digestCanonical(payload) === digestCanonical(expected) ? null : 'EXECUTION_RESERVATION_BINDING_MISMATCH'
}

const executionReservation = (current, next, command, reservation) => verifyShadowReservation(
  reservation,
  'execution',
  EXECUTION_RESERVATION_PAYLOAD_KEYS,
  command.now,
  (payload) => executionReservationPayloadCheck(payload, current, next, command),
)

export const advanceExecutionEnvelope = (rawEnvelope, rawCommand, rawReservation = undefined) => {
  try {
    assertSafe(rawEnvelope, 'envelope')
    assertSafe(rawCommand, 'advance_command')
    const envelope = deepFreeze(clone(rawEnvelope))
    const command = deepFreeze(clone(rawCommand))
    const reservation = rawReservation === undefined ? command.reservation_receipt : rawReservation
    let current
    try { current = parseExecutionEnvelope(envelope) } catch (error) { return held('HELD_EXECUTION_AUTHORITY', error.code || 'ENVELOPE_INVALID') }
    if (!isPlainObject(command) || !isPlainObject(command.next_envelope)) return held('HELD_EXECUTION_AUTHORITY', 'BOUND_NEXT_ENVELOPE_REQUIRED')
    const commandShape = validateCommandShape(command)
    if (commandShape) return held('HELD_EXECUTION_AUTHORITY', commandShape)
    if (command.force === true || command.force_mode === 'force' || command.force_push === true) return held('HELD_EXECUTION_AUTHORITY', 'FORCE_WITH_LEASE_REQUIRED')
    const earlyAction = String(command.action || '').toLowerCase()
    if (['deploy', 'direct_deploy', 'bulk_promotion'].includes(earlyAction) || command.deploy === true) return held('HELD_EXECUTION_AUTHORITY', 'FORBIDDEN_DELIVERY_SINK')
    if (command.self_approval === true) return held('HELD_EXECUTION_AUTHORITY', 'SELF_APPROVAL_FORBIDDEN')
    if (command.non_draft_pr === true || command.draft_pr === false) return held('HELD_EXECUTION_AUTHORITY', 'DRAFT_PR_REQUIRED')
    if (command.merge_credential !== undefined && command.merge_credential !== false) return held('HELD_EXECUTION_AUTHORITY', 'MERGE_CREDENTIAL_FORBIDDEN')
    if (command.expected_envelope_id !== current.envelope_id || command.expected_transition_sequence !== current.transition_sequence) return held('HELD_EXECUTION_AUTHORITY', 'ENVELOPE_CAS_MISMATCH')
    if (command.expected_lease_registry_oid !== current.expected_lease_registry_oid) return held('HELD_EXECUTION_AUTHORITY', 'LEASE_REGISTRY_OID_MISMATCH')
    if (isPlainObject(command.authority) && own(command.authority, 'expected_envelope_oid') && command.authority.expected_envelope_oid !== command.expected_envelope_oid) return held('HELD_EXECUTION_AUTHORITY', 'ENVELOPE_OID_MISMATCH')
    if (command.command_nonce !== current.command_nonce || command.replayed === true) return held('HELD_EXECUTION_AUTHORITY', 'NONCE_REPLAY')
    if (current.expires_at <= command.now) return held('HELD_EXECUTION_AUTHORITY', 'ENVELOPE_EXPIRED')
    if (command.now < current.issued_at) return held('HELD_EXECUTION_AUTHORITY', 'ENVELOPE_NOT_YET_VALID')
    let next
    try { next = parseExecutionEnvelope(command.next_envelope) } catch (error) { return held('HELD_EXECUTION_AUTHORITY', error.code || 'NEXT_ENVELOPE_INVALID') }
    if (next.expires_at <= command.now) return held('HELD_EXECUTION_AUTHORITY', 'NEXT_ENVELOPE_EXPIRED')
    if (command.now < next.issued_at) return held('HELD_EXECUTION_AUTHORITY', 'NEXT_ENVELOPE_NOT_YET_VALID')
    const transitionReason = transitionBindings(current, next, command)
    if (transitionReason) return held('HELD_EXECUTION_AUTHORITY', transitionReason)
    if (next.authorized_highest_level !== current.authorized_highest_level) return held('HELD_EXECUTION_AUTHORITY', 'AUTHORITY_LEVEL_MUTATION')
    if (EXECUTION_LEVELS.indexOf(next.current_level) > EXECUTION_LEVELS.indexOf(current.authorized_highest_level)) return held('HELD_EXECUTION_AUTHORITY', 'AUTHORITY_LEVEL_EXCEEDED')
    const bindingReason = nextLevelBindings(current, next, command)
    if (bindingReason) return held('HELD_EXECUTION_AUTHORITY', bindingReason)
    const revalidationPhase = scopeRevalidationPhase(current, next)
    if (revalidationPhase) {
      if (!isPlainObject(command.scope_revalidation)) return held('HELD_SCOPE_DRIFT', 'SCOPE_REVALIDATION_REQUIRED')
      const revalidation = evaluateScopeRevalidation(
        command.scope_revalidation,
        scopeRevalidationContext(current, revalidationPhase, command.scope_revalidation.declared_resources, command.now),
      )
      if (revalidation.status !== 'SCOPE_REVALIDATION_ACCEPTED') return revalidation
    }
    if (next.command_nonce === current.command_nonce) return held('HELD_EXECUTION_AUTHORITY', 'NONCE_REPLAY')
    const action = String(command.action || '').toLowerCase()
    if (['merge', 'direct_merge', 'deploy', 'direct_deploy', 'bulk_promotion', 'approve'].includes(action) || command.merge === true || command.direct_merge === true || command.deploy === true || command.direct_deploy === true || command.bulk_promotion === true || command.approve === true) return held('HELD_EXECUTION_AUTHORITY', 'FORBIDDEN_DELIVERY_SINK')
    const authorityReason = validateAuthority(command.authority, current, next, command)
    if (authorityReason) return held('HELD_EXECUTION_AUTHORITY', authorityReason)
    const shadow = executionReservation(current, next, command, reservation)
    return shadowHeld(shadow, 'execution')
  } catch (error) {
    return held('HELD_EXECUTION_AUTHORITY', error.code || 'ENVELOPE_INVALID')
  }
}

export const _internal = Object.freeze({
  EXECUTION_LEVELS,
  managedBranch,
  validateManagedRecord,
  globMatches,
})
