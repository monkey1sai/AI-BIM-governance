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


const secretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/gu,
  /\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{20,})\b/gu,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu,
  /\b(?:api[_-]?key|token|secret|password|private[_-]?key)\s*[:=]\s*[^\s,;]+/giu,
]

export function sanitizeUntrustedText(value) {
  let output = String(value)
  for (const pattern of secretPatterns) output = output.replace(pattern, '[REDACTED]')
  return output
}

const sanitizeValue = (value) => {
  if (typeof value === 'string') return sanitizeUntrustedText(value)
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]))
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
