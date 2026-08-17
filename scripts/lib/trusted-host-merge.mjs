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
  char === '/' || char === '?' || char === '#' || char === '"' || char === "'"
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

const lineEndFrom = (value, start) => {
  let end = start
  while (end < value.length && value[end] !== '\r' && value[end] !== '\n') end += 1
  return end
}

const nextLineStart = (value, lineEnd) => (
  value[lineEnd] === '\r' && value[lineEnd + 1] === '\n' ? lineEnd + 2 : lineEnd + 1
)

const lineLayoutAt = (value, index) => {
  const lineStart = value.lastIndexOf('\n', Math.max(0, index - 1)) + 1
  let contentStart = lineStart
  if (value[contentStart] === '+' || value[contentStart] === '-') contentStart += 1
  let indentation = 0
  while (contentStart + indentation < value.length && isHorizontalSpace(value[contentStart + indentation])) {
    indentation += 1
  }
  return { lineStart, contentStart, indentation }
}

const assignmentValueStart = (value, delimiterIndex) => {
  const baseLayout = lineLayoutAt(value, delimiterIndex)
  const diffPrefix = value[baseLayout.lineStart] === '+' || value[baseLayout.lineStart] === '-'
    ? value[baseLayout.lineStart]
    : null
  let cursor = delimiterIndex + 1
  let crossedLine = false
  while (cursor < value.length) {
    while (cursor < value.length && isHorizontalSpace(value[cursor])) cursor += 1
    if (value[cursor] !== '\r' && value[cursor] !== '\n') break
    crossedLine = true
    cursor = nextLineStart(value, cursor)
    if (diffPrefix !== null) {
      if (value[cursor] !== diffPrefix) return null
      cursor += 1
    } else if (value[cursor] === '+' || value[cursor] === '-') return null
  }
  if (cursor >= value.length) return null
  const valueLayout = lineLayoutAt(value, cursor)
  if (crossedLine && valueLayout.indentation <= baseLayout.indentation) return null
  return { start: cursor, crossedLine }
}

const hereStringRange = (value, start) => {
  if (value[start] !== '@' || (value[start + 1] !== '"' && value[start + 1] !== "'")) return null
  const closing = `${value[start + 1]}@`
  let lineEnd = lineEndFrom(value, start + 2)
  while (lineEnd < value.length) {
    const candidateLineStart = nextLineStart(value, lineEnd)
    let candidateStart = candidateLineStart
    if (value[candidateStart] === '+' || value[candidateStart] === '-') candidateStart += 1
    if (value.startsWith(closing, candidateStart)) return { start, end: candidateStart + closing.length }
    lineEnd = lineEndFrom(value, candidateLineStart)
  }
  return { start, end: value.length }
}

const balancedContainerRange = (value, start) => {
  const closingFor = { '{': '}', '[': ']', '(': ')' }
  const firstClosing = closingFor[value[start]]
  if (firstClosing === undefined) return null
  const stack = [firstClosing]
  let quote = null
  let cursor = start + 1
  while (cursor < value.length) {
    const char = value[cursor]
    if (quote !== null) {
      if (char === '\\' && cursor + 1 < value.length) cursor += 2
      else {
        if (char === quote) quote = null
        cursor += 1
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      cursor += 1
      continue
    }
    const nestedClosing = closingFor[char]
    if (nestedClosing !== undefined) stack.push(nestedClosing)
    else if (char === stack[stack.length - 1]) {
      stack.pop()
      if (stack.length === 0) return { start, end: cursor + 1 }
    }
    cursor += 1
  }
  return { start, end: value.length }
}

const quotedValueRange = (value, start) => {
  let quoteStart = start
  let prefixLength = 0
  while (
    prefixLength < 2 && quoteStart < value.length &&
    (value[quoteStart] === 'r' || value[quoteStart] === 'R' ||
      value[quoteStart] === 'b' || value[quoteStart] === 'B' ||
      value[quoteStart] === 'u' || value[quoteStart] === 'U' ||
      value[quoteStart] === 'f' || value[quoteStart] === 'F')
  ) {
    prefixLength += 1
    quoteStart += 1
  }
  const quote = value[quoteStart]
  if (quote !== '"' && quote !== "'") return null
  const triple = value.startsWith(quote.repeat(3), quoteStart)
  const closing = triple ? quote.repeat(3) : quote
  let cursor = quoteStart + closing.length
  while (cursor < value.length) {
    if (value[cursor] === '\\' && cursor + 1 < value.length) cursor += 2
    else if (value.startsWith(closing, cursor)) return { start, end: cursor + closing.length }
    else cursor += 1
  }
  return { start, end: value.length }
}

const assignmentValueRange = (value, delimiterIndex) => {
  const located = assignmentValueStart(value, delimiterIndex)
  if (located === null) return null
  const { start, crossedLine } = located
  const hereString = hereStringRange(value, start)
  if (hereString !== null) return hereString
  const container = balancedContainerRange(value, start)
  if (container !== null) return container
  const quoted = quotedValueRange(value, start)
  if (quoted !== null) return quoted
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
  let end = start
  if (crossedLine) end = lineEndFrom(value, start)
  else while (end < value.length && !isUnquotedValueTerminator(value[end])) end += 1
  return end === start ? null : { start, end }
}

const assignmentLineRange = (value, delimiterIndex) => {
  const start = delimiterIndex + 1
  const headerLayout = lineLayoutAt(value, delimiterIndex)
  const diffPrefix = value[headerLayout.lineStart] === '+' || value[headerLayout.lineStart] === '-'
    ? value[headerLayout.lineStart]
    : null
  let end = lineEndFrom(value, start)
  while (end < value.length) {
    const followingLineStart = nextLineStart(value, end)
    const followingLineEnd = lineEndFrom(value, followingLineStart)
    let contentStart = followingLineStart
    if (diffPrefix !== null) {
      if (value[contentStart] !== diffPrefix) break
      contentStart += 1
    }
    let indentation = 0
    while (contentStart + indentation < followingLineEnd && isHorizontalSpace(value[contentStart + indentation])) {
      indentation += 1
    }
    const isBlank = contentStart + indentation === followingLineEnd
    if (isBlank || indentation <= headerLayout.indentation) break
    end = followingLineEnd
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
      ? assignmentLineRange(value, cursor)
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
    const lineStart = value.lastIndexOf('\n', Math.max(0, separator - 1)) + 1
    const hasDiffPrefix = (
      schemeStart === lineStart && (value[schemeStart] === '+' || value[schemeStart] === '-') &&
      schemeStart + 1 < separator
    )
    if (hasDiffPrefix) schemeStart += 1
    const schemeLength = separator - schemeStart
    const validScheme = schemeLength > 0 && schemeLength <= 32 &&
      isAsciiAlpha(value.charCodeAt(schemeStart)) &&
      (hasDiffPrefix || schemeStart === 0 || !isUriSchemeCode(value.charCodeAt(schemeStart - 1)))
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

export function terminalResultExitCode(result) {
  return result?.status === 'merged' ? 0 : 2
}
