import {
  canonicalJson,
  equalText,
  exactKeys,
  fail,
  isPlainObject,
  sha256,
} from './trusted-host-merge-contract.mjs'

export * from './trusted-host-merge-contract.mjs'
export * from './trusted-host-merge-evidence.mjs'


const sensitiveAssignmentSuffixSource = [
  '(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|secret(?:[_-]?(?:access[_-]?key|key))?|',
  'client[_-]?secret|private[_-]?key|password|passwd|pwd|token|',
  'credentials?|',
  'authorization|proxy[_-]?authorization|cookies?|set[_-]?cookie|',
  'database[_-]?(?:url|uri)|connection[_-]?string|dsn|',
  '(?:postgres|mysql|mongodb?|redis)[_-]?(?:url|uri))',
].join('')

const sensitiveAssignmentKey = new RegExp(`(?:^|[_-])${sensitiveAssignmentSuffixSource}$`, 'iu')
const maxAssignmentKeyLength = 128

const normalizedAssignmentKey = (key) => key.replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
const isSensitiveAssignmentKey = (key) => sensitiveAssignmentKey.test(normalizedAssignmentKey(key))
const consumesAssignmentLine = (key) => (
  /(?:^|[_-])(?:authorization|proxy[_-]?authorization|cookies?|set[_-]?cookie)$/iu
    .test(normalizedAssignmentKey(key))
)

const isAsciiAlpha = (code) => (
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
)
const isAssignmentKeyCode = (code) => (
  isAsciiAlpha(code) || (code >= 48 && code <= 57) || code === 45 || code === 95
)
const isUriSchemeCode = (code) => isAssignmentKeyCode(code) || code === 43 || code === 46
const isHorizontalSpace = (char) => char === ' ' || char === '\t'
const isUnquotedValueTerminator = (char) => (
  char === ' ' || char === '\t' || char === '\r' || char === '\n' ||
  char === ',' || char === ';' || char === '"' || char === "'"
)
const isAuthorityTerminator = (char) => (
  char === ' ' || char === '\t' || char === '\r' || char === '\n' ||
  char === '/' || char === '?' || char === '#' || char === ',' || char === ';' ||
  char === '"' || char === "'" || char === ')' || char === ']' || char === '}'
)

const applyRedactionRanges = (value, ranges) => {
  if (ranges.length === 0) return value
  const parts = []
  let copiedUntil = 0
  for (const range of ranges) {
    parts.push(value.slice(copiedUntil, range.start), '[REDACTED]')
    copiedUntil = range.end
  }
  parts.push(value.slice(copiedUntil))
  return parts.join('')
}

const assignmentKeyBefore = (value, delimiterIndex) => {
  let keyEnd = delimiterIndex
  while (keyEnd > 0 && isHorizontalSpace(value[keyEnd - 1])) keyEnd -= 1
  const quote = value[keyEnd - 1] === '"' || value[keyEnd - 1] === "'"
    ? value[--keyEnd]
    : null
  let keyStart = keyEnd
  while (
    keyStart > 0 && keyEnd - keyStart <= maxAssignmentKeyLength &&
    isAssignmentKeyCode(value.charCodeAt(keyStart - 1))
  ) keyStart -= 1
  if (keyStart === keyEnd || keyEnd - keyStart > maxAssignmentKeyLength) return null
  if (quote !== null && (keyStart === 0 || value[keyStart - 1] !== quote)) return null
  return value.slice(keyStart, keyEnd)
}

const assignmentValueRange = (value, delimiterIndex) => {
  let start = delimiterIndex + 1
  while (start < value.length && isHorizontalSpace(value[start])) start += 1
  if (start === value.length) return null
  const quote = value[start]
  if (quote === '|' || quote === '>') {
    const lineStart = value.lastIndexOf('\n', delimiterIndex - 1) + 1
    const diffPrefix = value[lineStart] === '+' || value[lineStart] === '-' ? value[lineStart] : null
    let contentStart = diffPrefix === null ? lineStart : lineStart + 1
    let baseIndent = 0
    while (contentStart + baseIndent < value.length && isHorizontalSpace(value[contentStart + baseIndent])) {
      baseIndent += 1
    }
    let end = value.indexOf('\n', start)
    if (end === -1) return { start, end: value.length }
    while (end < value.length) {
      const nextLineStart = end + 1
      let nextLineEnd = value.indexOf('\n', nextLineStart)
      if (nextLineEnd === -1) nextLineEnd = value.length
      let nextContentStart = nextLineStart
      if (diffPrefix !== null) {
        if (value[nextContentStart] !== diffPrefix) break
        nextContentStart += 1
      }
      let indentation = 0
      while (nextContentStart + indentation < nextLineEnd && isHorizontalSpace(value[nextContentStart + indentation])) {
        indentation += 1
      }
      if (nextContentStart + indentation < nextLineEnd && indentation <= baseIndent) break
      end = nextLineEnd
    }
    return { start, end }
  }
  if (quote !== '"' && quote !== "'") {
    let end = start
    while (end < value.length && !isUnquotedValueTerminator(value[end])) end += 1
    return end === start ? null : { start, end }
  }
  let end = start + 1
  while (end < value.length && value[end] !== '\r' && value[end] !== '\n') {
    if (value[end] === '\\' && end + 1 < value.length && value[end + 1] !== '\r' && value[end + 1] !== '\n') {
      end += 2
    } else if (value[end] === quote) {
      return { start, end: end + 1 }
    } else {
      end += 1
    }
  }
  return { start, end }
}

const redactSensitiveAssignments = (value) => {
  const ranges = []
  let cursor = 0
  while (cursor < value.length) {
    if (value[cursor] !== ':' && value[cursor] !== '=') {
      cursor += 1
      continue
    }
    const key = assignmentKeyBefore(value, cursor)
    if (key === null || !isSensitiveAssignmentKey(key)) {
      cursor += 1
      continue
    }
    const range = consumesAssignmentLine(key)
      ? {
          start: cursor + 1,
          end: (() => {
            const lineEnd = value.indexOf('\n', cursor + 1)
            return lineEnd === -1 ? value.length : lineEnd
          })(),
        }
      : assignmentValueRange(value, cursor)
    if (range === null) {
      cursor += 1
      continue
    }
    ranges.push(range)
    cursor = range.end
  }
  return applyRedactionRanges(value, ranges)
}

const redactCredentialUriUserinfo = (value) => {
  const ranges = []
  let searchFrom = 0
  while (searchFrom < value.length) {
    const separator = value.indexOf('://', searchFrom)
    if (separator === -1) break
    let schemeStart = separator
    while (
      schemeStart > 0 && separator - schemeStart < 32 &&
      isUriSchemeCode(value.charCodeAt(schemeStart - 1))
    ) schemeStart -= 1
    const schemeLength = separator - schemeStart
    const validScheme = schemeLength > 0 && schemeLength <= 32 &&
      isAsciiAlpha(value.charCodeAt(schemeStart)) &&
      (schemeStart === 0 || !isUriSchemeCode(value.charCodeAt(schemeStart - 1)))
    const authorityStart = separator + 3
    let authorityEnd = authorityStart
    while (authorityEnd < value.length && !isAuthorityTerminator(value[authorityEnd])) authorityEnd += 1
    if (validScheme) {
      let at = -1
      for (let index = authorityStart; index < authorityEnd; index += 1) {
        if (value[index] === '@') at = index
      }
      if (at > authorityStart) ranges.push({ start: authorityStart, end: at })
    }
    searchFrom = Math.max(authorityStart, authorityEnd)
  }
  return applyRedactionRanges(value, ranges)
}

const secretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/gu,
  /\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{20,})\b/gu,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu,
  /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/giu,
]

export function sanitizeUntrustedText(value) {
  let output = String(value)
  for (const pattern of secretPatterns) output = output.replace(pattern, '[REDACTED]')
  output = redactSensitiveAssignments(output)
  return redactCredentialUriUserinfo(output)
}

const sanitizeValue = (value) => {
  if (typeof value === 'string') return sanitizeUntrustedText(value)
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    isSensitiveAssignmentKey(key) ? '[REDACTED]' : sanitizeValue(item),
  ]))
}

export function buildBoundedEvidence(value, maxBytes) {
  const raw = canonicalJson(value)
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    fail('evidence_too_large_for_arbiter', 'raw_evidence_exceeds_limit')
  }
  const sanitized = sanitizeValue(value)
  const serialized = canonicalJson(sanitized)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    fail('evidence_too_large_for_arbiter', 'sanitized_evidence_exceeds_limit')
  }
  return { sanitized, serialized, sha256: sha256(serialized) }
}

export const apexVerdictSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'allowMerge', 'prNumber', 'headOid', 'baseOid', 'approvalReviewId',
    'approvalReviewNodeId', 'approvalBody', 'approvalCommitId', 'heldReason', 'evidence',
  ],
  properties: {
    allowMerge: { type: 'boolean' },
    prNumber: { type: 'integer', minimum: 1 },
    headOid: { type: 'string', pattern: '^[0-9a-f]{40}$' },
    baseOid: { type: 'string', pattern: '^[0-9a-f]{40}$' },
    approvalReviewId: { type: 'integer', minimum: 1 },
    approvalReviewNodeId: { type: 'string', minLength: 1 },
    approvalBody: { type: 'string', minLength: 1 },
    approvalCommitId: { type: 'string', pattern: '^[0-9a-f]{40}$' },
    heldReason: { type: ['string', 'null'] },
    evidence: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 500 }
    }
  }
}

export function verifyApexVerdict(verdict, invocation, approval) {
  if (!exactKeys(verdict, apexVerdictSchema.required)) {
    fail('arbiter_denied', 'apex_verdict_shape_invalid')
  }
  if (
    verdict.allowMerge !== true || verdict.heldReason !== null ||
    verdict.prNumber !== invocation.prNumber || verdict.headOid !== invocation.headOid ||
    verdict.baseOid !== invocation.baseOid || verdict.approvalReviewId !== approval.id ||
    verdict.approvalReviewNodeId !== approval.nodeId || !equalText(verdict.approvalBody, approval.body) ||
    verdict.approvalCommitId !== approval.commitId || !Array.isArray(verdict.evidence) ||
    verdict.evidence.length < 1 || verdict.evidence.length > 20 ||
    verdict.evidence.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 500)
  ) {
    fail('arbiter_denied', 'apex_verdict_not_exactly_bound')
  }
}

export function heldResult(invocation, reason, detail) {
  return {
    schemaVersion: 'trusted-host-merge-result/v1',
    status: 'held',
    merged: false,
    prNumber: invocation?.prNumber ?? null,
    headOid: invocation?.headOid ?? null,
    baseOid: invocation?.baseOid ?? null,
    mergeCommit: null,
    heldReason: reason,
    heldDetail: detail,
  }
}

export function mergeOutcomeUnverifiedResult(invocation, detail) {
  return {
    schemaVersion: 'trusted-host-merge-result/v1',
    status: 'merge_outcome_unverified',
    merged: null,
    prNumber: invocation.prNumber,
    headOid: invocation.headOid,
    baseOid: invocation.baseOid,
    mergeCommit: null,
    heldReason: 'merge_command_failed_unverified',
    heldDetail: detail,
  }
}

export function mergedResult(invocation, mergeCommit, closeoutHeld = null) {
  const held = closeoutHeld === null || closeoutHeld === undefined ? null : String(closeoutHeld)
  if (held !== null && held.length === 0) {
    fail('host_env_blocked', 'closeout_detail_empty')
  }
  return {
    schemaVersion: 'trusted-host-merge-result/v1',
    status: held !== null ? 'merged_but_closeout_held' : 'merged',
    merged: true,
    prNumber: invocation.prNumber,
    headOid: invocation.headOid,
    baseOid: invocation.baseOid,
    mergeCommit,
    heldReason: held !== null ? 'merge_verification_failed' : null,
    heldDetail: held,
  }
}
