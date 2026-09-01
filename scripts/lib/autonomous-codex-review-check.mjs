import { createHash } from 'node:crypto'
import { closeSync, existsSync, fstatSync, lstatSync, openSync, opendirSync, readSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const AUTONOMOUS_CODEX_REVIEW_POLICY_VERSION = 'autonomous-codex-review-policy/v1'
export const AUTONOMOUS_CODEX_REVIEW_PHASES = Object.freeze([
  'LEGACY_GUARDED', 'SHADOW_DUAL', 'CUTOVER_ARMED', 'CANARY_ACTIVE', 'AUTONOMOUS_ACTIVE',
])

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const POLICY_RELATIVE = 'scripts/autonomous-codex-review-policy.json'
const SCHEMA_RELATIVE = 'scripts/tests/autonomous-codex-review-policy.schema.json'
const OPEN_SPEC_RELATIVE = 'openspec/changes/parallel-delivery-fabric/specs/parallel-delivery-fabric/spec.md'
const BASE_SHA = '9e2bd849465b7b7b2d6b8866f1227dfb3edb60db'
const OPEN_SPEC_SHA256 = 'fb3d378d17688721238516061ac8fe9d8e45d2d6d8566adb083269518367a0ae'
const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const SECRET_KEY = /(?:secret|token|password|credential|private|cookie|authorization|bearer|\benv\b|_env$|^env_|\bsid\b|\bpid\b|transcript)/iu
const SECRET_VALUE = /(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|bearer\s+|-----BEGIN|eyJ[A-Za-z0-9_-]{10,})/iu
const PRIVATE_RUNTIME_VALUE = /(?:[a-z]:[\\/]|\\\\|\/(?:etc|home|opt|private|root|tmp|users|var)(?:\/|$)|\bS-\d-\d+(?:-\d+){2,}\b|\b(?:pid|ppid|process(?:[_ -]?id)?)\s*[:=#-]\s*(?:\d+|[a-z0-9_.-]+\.exe)\b|\b(?:host|hostname|machine|computer)\s*[:=]\s*[a-z0-9_.-]+\b|\bDESKTOP-[A-Z0-9-]+\b)/iu
const EXECUTION_ID = /^execution:[a-z0-9](?:[a-z0-9._-]{0,127})$/u
const EXTERNAL_REFS = ['external:settings-lease', 'external:rollback-snapshot', 'external:authoritative-reread', 'external:activation-canary']
const REVIEW_FIELDS = ['pr_number', 'base_sha', 'head_sha', 'changed_files_sha256', 'reviewer_engine', 'evidence_sha256']
const IDENTITY_FIELDS = ['writer_execution_id', 'fixer_execution_id', 'reviewer_execution_id']
const PACKET_VERSION = 'autonomous-codex-review-check-packet/v1'
const REPOSITORY = 'monkey1sai/AI-BIM-governance'
const ENGINE = 'monkey1sai-codex'
const SCHEMA_ID = 'https://ai-bim-governance.local/schemas/autonomous-codex-review-policy/v1'
const DRAFT = 'https://json-schema.org/draft/2020-12/schema'
const POLICY_INVENTORY_SUBTREES = Object.freeze(['scripts'])
const POLICY_INVENTORY_IGNORED_DIRECTORIES = Object.freeze(['.generated', '.git', 'generated', 'node_modules'])
const POLICY_INVENTORY_MAX_DEPTH = 12
const POLICY_INVENTORY_MAX_ENTRIES = 512
const POLICY_FILE_MAX_BYTES = 8 * 1024

export class AutonomousCodexReviewPolicyError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'AutonomousCodexReviewPolicyError'
    this.code = code
  }
}

const fail = (code, detail) => { throw new AutonomousCodexReviewPolicyError(code, detail) }

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && (
  Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null
)
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested)
    Object.freeze(value)
  }
  return value
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sameArray = (left, right) => Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index])

const snapshot = (input, label) => {
  const seen = new WeakSet()
  const copy = (value, context) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('policy_hostile_input', `${context}_number`)
      return value
    }
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') fail('policy_hostile_input', `${context}_type`)
    if (typeof value !== 'object' || seen.has(value)) fail('policy_hostile_input', `${context}_object_or_cycle`)
    seen.add(value)
    const prototype = Object.getPrototypeOf(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Array.isArray(value)) {
      const length = descriptors.length?.value
      if (prototype !== Array.prototype || !Number.isSafeInteger(length) || length < 0) fail('policy_hostile_input', `${context}_array`)
      const result = []
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)]
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || descriptor.get !== undefined || descriptor.set !== undefined) fail('policy_hostile_input', `${context}_array_accessor`)
        result.push(copy(descriptor.value, `${context}[${index}]`))
      }
      for (const key of Reflect.ownKeys(descriptors)) if (key !== 'length' && (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length)) fail('policy_hostile_input', `${context}_array_key`)
      seen.delete(value)
      return freeze(result)
    }
    if (prototype !== Object.prototype && prototype !== null) fail('policy_hostile_input', `${context}_prototype`)
    const result = {}
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('policy_hostile_input', `${context}_key`)
      const descriptor = descriptors[key]
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get !== undefined || descriptor.set !== undefined) fail('policy_hostile_input', `${context}.${key}_accessor`)
      result[key] = copy(descriptor.value, `${context}.${key}`)
    }
    seen.delete(value)
    return freeze(result)
  }
  try { return copy(input, label) } catch (error) {
    if (error instanceof AutonomousCodexReviewPolicyError) throw error
    fail('policy_hostile_input', `${label}_trap`)
  }
}

const keys = (value, expected, context, unknownCode = 'policy_unknown_key') => {
  if (!plain(value)) fail('policy_wrong_type', `${context}_object`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (same(actual, wanted)) return
  const unknown = actual.find((key) => !wanted.includes(key))
  if (unknown !== undefined) fail(unknownCode, `${context}.${unknown}`)
  fail('policy_missing_key', `${context}.${wanted.find((key) => !actual.includes(key))}`)
}

const secretFree = (value, context = '$') => {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail('policy_secret_material', context)
    return
  }
  if (Array.isArray(value)) return value.forEach((item, index) => secretFree(item, `${context}[${index}]`))
  if (!plain(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) fail('policy_secret_material', `${context}.${key}`)
    secretFree(nested, `${context}.${key}`)
  }
}
const privateRuntimeValueFree = (value, context = '$') => {
  if (typeof value === 'string') {
    if (PRIVATE_RUNTIME_VALUE.test(value)) fail('policy_private_runtime_value', context)
    return
  }
  if (Array.isArray(value)) return value.forEach((item, index) => privateRuntimeValueFree(item, `${context}[${index}]`))
  if (!plain(value)) return
  for (const [key, nested] of Object.entries(value)) privateRuntimeValueFree(nested, `${context}.${key}`)
}
const parse = (raw, label) => {
  try { return snapshot(JSON.parse(raw), label) } catch (error) {
    if (error instanceof AutonomousCodexReviewPolicyError) throw error
    fail('policy_unparsed', label)
  }
}

const primitive = (type, constant) => ({ kind: 'primitive', type, constant })
const array = (constant) => ({ kind: 'array', constant })
const object = (properties) => ({ kind: 'object', properties })
const CONTRACT = object({
  schema_version: primitive('string', AUTONOMOUS_CODEX_REVIEW_POLICY_VERSION),
  phase: primitive('string', 'LEGACY_GUARDED'),
  phase_order: array(AUTONOMOUS_CODEX_REVIEW_PHASES),
  open_spec: object({ source_kind: primitive('string', 'base_pinned_openspec'), source_path: primitive('string', OPEN_SPEC_RELATIVE), base_sha: primitive('string', BASE_SHA), source_sha256: primitive('string', OPEN_SPEC_SHA256) }),
  external_check: object({ source_kind: primitive('string', 'github_app'), source_ref: primitive('string', 'base:monkey1sai-codex'), app_slug: primitive('string', 'monkey1sai-codex'), app_id: primitive('integer', 481516), check_name: primitive('string', 'monkey1sai-codex/ready'), required: primitive('boolean', true) }),
  external_activation: object({ evidence_refs: array(EXTERNAL_REFS), machine_sink_enabled: primitive('boolean', false), candidate_inaccessible_authenticity: primitive('string', 'HELD_EXTERNAL_ACTIVATION') }),
  legacy_gate: object({ counted_review_required: primitive('boolean', true), direct_stack: primitive('string', 'HELD') }),
  publisher_capabilities: object({ can_checks: primitive('boolean', true), can_contents: primitive('boolean', false), can_approve: primitive('boolean', false), can_merge: primitive('boolean', false) }),
  role_separation: object({ writer_or_fixer: primitive('string', 'candidate_writer_or_fixer'), reviewer: primitive('string', 'monkey1sai-codex-reviewer'), self_review: primitive('string', 'ADVISORY_ONLY') }),
  review_binding: object({ repository: primitive('string', REPOSITORY), reviewer_engine: primitive('string', ENGINE), packet_schema_version: primitive('string', PACKET_VERSION), required_fields: array(REVIEW_FIELDS), identity_fields: array(IDENTITY_FIELDS) }),
})

const schemaNode = (schema, contract, context) => {
  if (contract.kind === 'object') {
    keys(schema, ['type', 'additionalProperties', 'required', 'properties'], context, 'policy_schema_invalid')
    if (schema.type !== 'object' || schema.additionalProperties !== false || !sameArray(schema.required, Object.keys(contract.properties))) fail('policy_schema_invalid', context)
    keys(schema.properties, Object.keys(contract.properties), `${context}.properties`, 'policy_schema_invalid')
    for (const [key, child] of Object.entries(contract.properties)) schemaNode(schema.properties[key], child, `${context}.${key}`)
    return
  }
  keys(schema, ['type', 'const'], context, 'policy_schema_invalid')
  if (schema.type !== (contract.kind === 'array' ? 'array' : contract.type) || !same(schema.const, contract.constant)) fail('policy_schema_invalid', context)
}
const schemaContract = (schema) => {
  keys(schema, ['$schema', '$id', 'title', 'type', 'additionalProperties', 'required', 'properties'], '$schema', 'policy_schema_invalid')
  if (schema.$schema !== DRAFT || schema.$id !== SCHEMA_ID || schema.title !== 'Base-owned autonomous Codex review policy') fail('policy_schema_invalid', '$schema.identity')
  schemaNode({ type: schema.type, additionalProperties: schema.additionalProperties, required: schema.required, properties: schema.properties }, CONTRACT, '$schema')
}
const type = (value, expected) => (
  (expected === 'object' && plain(value)) || (expected === 'array' && Array.isArray(value)) ||
  (expected === 'string' && typeof value === 'string') || (expected === 'boolean' && typeof value === 'boolean') ||
  (expected === 'integer' && Number.isSafeInteger(value))
)
const evaluate = (schema, value, context = '$') => {
  if (!type(value, schema.type) || (schema.type !== 'object' && !same(value, schema.const))) fail('policy_schema_validation_failed', context)
  if (schema.type !== 'object') return
  for (const required of schema.required) if (!Object.hasOwn(value, required)) fail('policy_schema_validation_failed', `${context}.${required}`)
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(schema.properties, key)) fail('policy_schema_validation_failed', `${context}.${key}`)
    evaluate(schema.properties[key], value[key], `${context}.${key}`)
  }
}

export function validatePolicySchemaDocument(schemaDocument, policyDocument) {
  const schema = snapshot(schemaDocument, 'policy_schema')
  const policy = snapshot(policyDocument, 'policy_document')
  schemaContract(schema)
  evaluate(schema, policy)
  return policy
}

export function validateAutonomousCodexReviewPolicy(document) {
  const policy = snapshot(document, 'policy')
  secretFree(policy)
  keys(policy, Object.keys(CONTRACT.properties), '$')
  if (policy.schema_version !== AUTONOMOUS_CODEX_REVIEW_POLICY_VERSION) fail('policy_schema_version_invalid', 'schema_version')
  if (policy.phase !== 'LEGACY_GUARDED') fail('policy_phase_invalid', 'phase')
  if (!sameArray(policy.phase_order, AUTONOMOUS_CODEX_REVIEW_PHASES)) fail('policy_phase_order_invalid', 'phase_order')
  keys(policy.open_spec, Object.keys(CONTRACT.properties.open_spec.properties), 'open_spec')
  if (policy.open_spec.source_kind !== 'base_pinned_openspec') fail('policy_source_untrusted', 'open_spec.source_kind')
  if (policy.open_spec.source_path !== OPEN_SPEC_RELATIVE || policy.open_spec.base_sha !== BASE_SHA || !SHA1.test(policy.open_spec.base_sha) ||
      policy.open_spec.source_sha256 !== OPEN_SPEC_SHA256 || !SHA256.test(policy.open_spec.source_sha256)) fail('policy_source_pin_invalid', 'open_spec')
  keys(policy.external_check, Object.keys(CONTRACT.properties.external_check.properties), 'external_check')
  if (policy.external_check.source_kind !== 'github_app' || policy.external_check.source_ref !== 'base:monkey1sai-codex' ||
      policy.external_check.app_slug !== 'monkey1sai-codex' || policy.external_check.app_id !== 481516 ||
      policy.external_check.check_name !== 'monkey1sai-codex/ready' || policy.external_check.required !== true) fail('policy_check_pin_invalid', 'external_check')
  keys(policy.external_activation, Object.keys(CONTRACT.properties.external_activation.properties), 'external_activation')
  if (!sameArray(policy.external_activation.evidence_refs, EXTERNAL_REFS) || policy.external_activation.machine_sink_enabled !== false ||
      policy.external_activation.candidate_inaccessible_authenticity !== 'HELD_EXTERNAL_ACTIVATION') fail('policy_external_evidence_invalid', 'external_activation')
  keys(policy.legacy_gate, Object.keys(CONTRACT.properties.legacy_gate.properties), 'legacy_gate')
  if (policy.legacy_gate.counted_review_required !== true || policy.legacy_gate.direct_stack !== 'HELD') fail('policy_legacy_gate_invalid', 'legacy_gate')
  keys(policy.publisher_capabilities, Object.keys(CONTRACT.properties.publisher_capabilities.properties), 'publisher_capabilities')
  if (policy.publisher_capabilities.can_checks !== true || policy.publisher_capabilities.can_contents !== false ||
      policy.publisher_capabilities.can_approve !== false || policy.publisher_capabilities.can_merge !== false) fail('policy_capability_invalid', 'publisher_capabilities')
  keys(policy.role_separation, Object.keys(CONTRACT.properties.role_separation.properties), 'role_separation')
  if (policy.role_separation.writer_or_fixer !== 'candidate_writer_or_fixer' || policy.role_separation.reviewer !== 'monkey1sai-codex-reviewer' ||
      policy.role_separation.self_review !== 'ADVISORY_ONLY') fail('policy_role_separation_invalid', 'role_separation')
  keys(policy.review_binding, Object.keys(CONTRACT.properties.review_binding.properties), 'review_binding')
  if (policy.review_binding.repository !== REPOSITORY || policy.review_binding.reviewer_engine !== ENGINE ||
      policy.review_binding.packet_schema_version !== PACKET_VERSION || !sameArray(policy.review_binding.required_fields, REVIEW_FIELDS) ||
      !sameArray(policy.review_binding.identity_fields, IDENTITY_FIELDS)) fail('policy_review_binding_invalid', 'review_binding')
  return policy
}

export function inspectPolicyFileInventory(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) fail('policy_hostile_input', 'repository_root')
  const root = path.resolve(repositoryRoot)
  if (!existsSync(root)) fail('policy_missing', 'inventory_root_missing')
  const candidates = []
  const stack = []
  for (const subtree of POLICY_INVENTORY_SUBTREES) {
    const absolute = path.join(root, subtree)
    if (!existsSync(absolute)) fail('policy_missing', 'inventory_subtree_missing')
    let expected
    try { expected = lstatSync(absolute, { bigint: true }) } catch { fail('policy_inventory_io_race', 'inventory_io') }
    if (expected.isSymbolicLink()) fail('policy_inventory_symlink', 'inventory_symlink')
    if (!expected.isDirectory()) fail('policy_inventory_unknown_entry', 'inventory_unknown_entry')
    stack.push({ absolute, relative: subtree, depth: 0, expected })
  }
  let entriesSeen = 0
  while (stack.length > 0) {
    const current = stack.pop()
    let directoryBefore
    try { directoryBefore = lstatSync(current.absolute, { bigint: true }) } catch { fail('policy_inventory_io_race', 'inventory_io') }
    if (directoryBefore.isSymbolicLink()) fail('policy_inventory_symlink', 'inventory_symlink')
    if (!directoryBefore.isDirectory()) fail('policy_inventory_unknown_entry', 'inventory_unknown_entry')
    if (directoryBefore.dev !== current.expected.dev || directoryBefore.ino !== current.expected.ino ||
        directoryBefore.mtimeNs !== current.expected.mtimeNs || directoryBefore.ctimeNs !== current.expected.ctimeNs) {
      fail('policy_inventory_io_race', 'inventory_io')
    }
    let directory
    try { directory = opendirSync(current.absolute) } catch { fail('policy_inventory_io_race', 'inventory_io') }
    let pendingError
    try {
      while (true) {
        let entry
        try { entry = directory.readSync() } catch { fail('policy_inventory_io_race', 'inventory_io') }
        if (entry === null) break
        entriesSeen += 1
        if (entriesSeen > POLICY_INVENTORY_MAX_ENTRIES) fail('policy_inventory_budget_exceeded', 'max_entries')
        const childRelative = `${current.relative}/${entry.name}`.replaceAll('\\', '/')
        const childAbsolute = path.join(current.absolute, entry.name)
        let child
        try { child = lstatSync(childAbsolute, { bigint: true }) } catch { fail('policy_inventory_io_race', 'inventory_io') }
        if (child.isSymbolicLink()) fail('policy_inventory_symlink', 'inventory_symlink')
        if (child.isDirectory()) {
          if (POLICY_INVENTORY_IGNORED_DIRECTORIES.includes(entry.name.toLowerCase())) continue
          if (current.depth >= POLICY_INVENTORY_MAX_DEPTH) fail('policy_inventory_budget_exceeded', 'max_depth')
          stack.push({ absolute: childAbsolute, relative: childRelative, depth: current.depth + 1, expected: child })
        } else if (child.isFile()) {
          if (/autonomous-codex-review-policy.*\.json(?:[.~_-].*)?$/iu.test(entry.name)) candidates.push(childRelative)
        } else {
          fail('policy_inventory_unknown_entry', 'inventory_unknown_entry')
        }
      }
    } catch (error) {
      pendingError = error
    }
    try { directory.closeSync() } catch {
      if (pendingError === undefined) fail('policy_inventory_io_race', 'inventory_io')
    }
    if (pendingError !== undefined) throw pendingError
    let directoryAfter
    try { directoryAfter = lstatSync(current.absolute, { bigint: true }) } catch { fail('policy_inventory_io_race', 'inventory_io') }
    if (directoryAfter.isSymbolicLink() || !directoryAfter.isDirectory() ||
        directoryAfter.dev !== directoryBefore.dev || directoryAfter.ino !== directoryBefore.ino ||
        directoryAfter.mtimeNs !== directoryBefore.mtimeNs || directoryAfter.ctimeNs !== directoryBefore.ctimeNs) {
      fail('policy_inventory_io_race', 'inventory_io')
    }
  }
  const canonical = POLICY_RELATIVE
  const schema = SCHEMA_RELATIVE
  const canonicalCount = candidates.filter((entry) => entry === canonical).length
  const schemaCount = candidates.filter((entry) => entry === schema).length
  const unexpected = candidates.filter((entry) => entry !== canonical && entry !== schema)
  if (canonicalCount !== 1) fail('policy_missing', canonical)
  if (schemaCount !== 1 || unexpected.length !== 0) fail('policy_source_duplicate', `inventory_candidates=${unexpected.length + Math.max(0, schemaCount - 1)}`)
  return freeze({ canonical_policy_count: canonicalCount, scanned_policy_names: candidates.sort() })
}

const sameFileState = (left, right) => (
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs
)

const sameFileIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino && left.mode === right.mode

const readCanonicalFile = (filePath, missingCode, label) => {
  const resolved = path.resolve(filePath)
  const relative = path.relative(ROOT, resolved)
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('policy_source_untrusted', label)
  let cursor = ROOT
  const componentStates = []
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment)
    let component
    try { component = lstatSync(cursor, { bigint: true }) } catch { fail(missingCode, label) }
    if (component.isSymbolicLink()) fail('policy_source_untrusted', label)
    componentStates.push([cursor, component])
  }

  let pathBefore
  try { pathBefore = lstatSync(resolved, { bigint: true }) } catch { fail(missingCode, label) }
  if (!pathBefore.isFile()) fail('policy_source_untrusted', label)
  if (pathBefore.size > BigInt(POLICY_FILE_MAX_BYTES)) fail('policy_file_budget_exceeded', label)

  let descriptor
  try { descriptor = openSync(resolved, 'r') } catch { fail('policy_file_io_race', label) }
  try {
    let before
    try { before = fstatSync(descriptor, { bigint: true }) } catch { fail('policy_file_io_race', label) }
    if (!before.isFile() || !sameFileState(pathBefore, before)) fail('policy_file_io_race', label)
    if (before.size > BigInt(POLICY_FILE_MAX_BYTES)) fail('policy_file_budget_exceeded', label)

    const buffer = Buffer.alloc(POLICY_FILE_MAX_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      let bytesRead
      try { bytesRead = readSync(descriptor, buffer, length, buffer.length - length, null) } catch { fail('policy_file_io_race', label) }
      if (bytesRead === 0) break
      length += bytesRead
    }

    let after
    let pathAfter
    try {
      after = fstatSync(descriptor, { bigint: true })
      pathAfter = lstatSync(resolved, { bigint: true })
    } catch { fail('policy_file_io_race', label) }
    for (const [componentPath, componentBefore] of componentStates) {
      let componentAfter
      try { componentAfter = lstatSync(componentPath, { bigint: true }) } catch { fail('policy_file_io_race', label) }
      if (componentAfter.isSymbolicLink() || !sameFileIdentity(componentBefore, componentAfter)) fail('policy_file_io_race', label)
    }
    if (length > POLICY_FILE_MAX_BYTES) fail('policy_file_budget_exceeded', label)
    if (BigInt(length) !== before.size || !sameFileState(before, after) || !sameFileState(after, pathAfter)) {
      fail('policy_file_io_race', label)
    }
    return buffer.subarray(0, length)
  } finally {
    closeSync(descriptor)
  }
}

const decodeUtf8 = (bytes, label) => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { fail('policy_json_invalid', label) }
}

const loadCanonical = () => {
  const inventoryBefore = inspectPolicyFileInventory(ROOT)
  const policyPath = path.join(ROOT, POLICY_RELATIVE)
  const schemaPath = path.join(ROOT, SCHEMA_RELATIVE)
  const policy = validateAutonomousCodexReviewPolicy(validatePolicySchemaDocument(
    parse(decodeUtf8(readCanonicalFile(schemaPath, 'policy_schema_missing', SCHEMA_RELATIVE), SCHEMA_RELATIVE), SCHEMA_RELATIVE),
    parse(decodeUtf8(readCanonicalFile(policyPath, 'policy_missing', POLICY_RELATIVE), POLICY_RELATIVE), POLICY_RELATIVE),
  ))
  const sourcePath = path.resolve(ROOT, policy.open_spec.source_path)
  if (sourcePath !== path.resolve(ROOT, OPEN_SPEC_RELATIVE)) fail('policy_source_untrusted', 'open_spec_path')
  const sourceBytes = readCanonicalFile(sourcePath, 'policy_source_untrusted', OPEN_SPEC_RELATIVE)
  const sourceText = decodeUtf8(sourceBytes, OPEN_SPEC_RELATIVE)
  if (/\r(?!\n)/u.test(sourceText)) fail('policy_source_digest_mismatch', policy.open_spec.source_path)
  const canonicalSourceBytes = Buffer.from(sourceText.replace(/\r\n/gu, '\n'), 'utf8')
  if (createHash('sha256').update(canonicalSourceBytes).digest('hex') !== policy.open_spec.source_sha256) fail('policy_source_digest_mismatch', policy.open_spec.source_path)
  const inventoryAfter = inspectPolicyFileInventory(ROOT)
  if (!same(inventoryBefore, inventoryAfter)) fail('policy_inventory_io_race', 'inventory_io')
  return policy
}

export function loadAutonomousCodexReviewPolicy(...callerArguments) {
  if (callerArguments.length !== 0) fail('policy_source_untrusted', 'caller_policy_override_forbidden')
  return loadCanonical()
}

export function assertDistinctReviewIdentity(identities) {
  const value = snapshot(identities, 'review_identities')
  secretFree(value, 'review_identities')
  privateRuntimeValueFree(value, 'review_identities')
  keys(value, IDENTITY_FIELDS, 'review_identities')
  for (const key of IDENTITY_FIELDS) if (typeof value[key] !== 'string' || !EXECUTION_ID.test(value[key])) fail('review_identity_invalid', key)
  if (value.writer_execution_id === value.reviewer_execution_id || value.fixer_execution_id === value.reviewer_execution_id) {
    fail('reviewer_identity_conflict', 'writer_or_fixer_equals_reviewer')
  }
  return true
}

const validateCheckRun = (checkRun, packet, policy) => {
  keys(checkRun, ['source', 'head_sha', 'status', 'conclusion', 'required', 'pagination_complete'], 'check_run')
  keys(checkRun.source, ['source_kind', 'source_ref', 'app_slug', 'app_id', 'check_name'], 'check_run.source')
  const expected = policy.external_check
  const source = checkRun.source
  if (source.source_kind !== expected.source_kind || source.source_ref !== expected.source_ref || source.app_slug !== expected.app_slug ||
      source.app_id !== expected.app_id || source.check_name !== expected.check_name) fail('check_source_invalid', 'check_run.source')
  if (checkRun.head_sha !== packet.head_sha || !SHA1.test(checkRun.head_sha)) fail('check_head_invalid', 'check_run.head_sha')
  if (checkRun.status !== 'completed' || checkRun.conclusion !== 'success' || checkRun.required !== true) fail('check_conclusion_invalid', 'check_run.conclusion')
  if (checkRun.pagination_complete !== true) fail('check_pagination_incomplete', 'check_run.pagination_complete')
}

export function validateReviewCheckPacket(...callerArguments) {
  if (callerArguments.length !== 1) fail('policy_call_override_forbidden', 'review_packet_requires_one_argument')
  const packet = snapshot(callerArguments[0], 'review_packet')
  secretFree(packet, 'review_packet')
  privateRuntimeValueFree(packet, 'review_packet')
  keys(packet, ['schema_version', 'repository', 'pr_number', 'base_sha', 'head_sha', 'changed_files_sha256', 'reviewer_engine', 'evidence_sha256', 'identities', 'check_run'], 'review_packet')
  const policy = loadCanonical()
  if (packet.schema_version !== PACKET_VERSION || packet.repository !== policy.review_binding.repository || packet.reviewer_engine !== policy.review_binding.reviewer_engine ||
      !Number.isSafeInteger(packet.pr_number) || packet.pr_number < 1 || !SHA1.test(packet.base_sha) || !SHA1.test(packet.head_sha) ||
      !SHA256.test(packet.changed_files_sha256) || !SHA256.test(packet.evidence_sha256)) fail('review_packet_binding_invalid', 'review_packet')
  assertDistinctReviewIdentity(packet.identities)
  validateCheckRun(packet.check_run, packet, policy)
  return freeze({
    decision: 'HELD',
    status: 'HELD_EXTERNAL_ACTIVATION',
    disposition: 'SHADOW_ADVISORY',
    dependency: 'Task9-D2 candidate-inaccessible authenticity is required before activation',
    phase: policy.phase,
    packet,
  })
}
