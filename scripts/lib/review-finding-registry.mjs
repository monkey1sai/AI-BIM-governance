// Review-finding join registry.
//
// The repo already has two exact-key-pinned finding shapes that must NOT be extended:
//   - FINDING_KEYS (autonomous-delivery-finalization.mjs, 14 keys, exactKeys-enforced)
//   - REVIEW_DISPOSITION_METADATA_KEYS (16 keys, the posted-comment idempotency tuple)
// This registry is a SEPARATE small join record keyed (head_sha, finding_id) that carries the
// cross-round identity (fingerprint, round, evidence_fingerprint) neither existing shape has.
// It never mutates either existing key set and embeds nothing from them.
//
// The fingerprint is stable across heads and rounds (no SHA, no line number) and changes only
// when the finding's material content changes — so "same fingerprint + no new evidence" can be
// refused mechanically.

import { REVIEW_DISPOSITIONS } from './autonomous-delivery-finalization.mjs';
import { sha256Value, stableStringify } from './risk-proportional-review.mjs';

export const REVIEW_FINDING_JOIN_VERSION = 'review-finding-join/v1';
export const FINDING_ORIGINS = Object.freeze(['ci', 'reviewer', 'human', 'deterministic']);
export const FINDING_RESOLUTIONS = Object.freeze(['open', 'fixed', 'refuted', 'deferred', 'escalated', 'superseded']);
export const STALENESS = Object.freeze(['current', 'head_moved_recheck', 'superseded']);

const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MAX_ROUND = 2;

export class ReviewFindingRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReviewFindingRegistryError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReviewFindingRegistryError(code, message);
}

const JOIN_KEYS = Object.freeze([
  'schema_version', 'repository', 'pr_number', 'base_sha', 'head_sha', 'finding_id', 'fingerprint',
  'origin', 'round', 'evidence_fingerprint', 'disposition', 'severity', 'risk_class', 'follow_up',
  'resolution', 'touched_paths', 'superseded_by',
]);

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('join_shape_invalid', `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('join_shape_invalid', `${label} must have exactly the keys ${expected.join(', ')}.`);
  }
}

function normalizeText(value) {
  return String(value).normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

// Material identity of a finding: where it is (path + optional symbol), which rule raised it, and
// its normalized title. Deliberately excludes head_sha, line numbers, timestamps and prose so the
// same defect reported again at a different line still collides.
export function computeFindingFingerprint({ origin, path, symbol = null, rule, title }) {
  if (!FINDING_ORIGINS.includes(origin)) fail('fingerprint_input_invalid', 'origin must be ci, reviewer, human, or deterministic.');
  if (typeof path !== 'string' || path.length === 0 || path.includes('\\')) fail('fingerprint_input_invalid', 'path must be a non-empty forward-slash repository path.');
  if (symbol !== null && (typeof symbol !== 'string' || symbol.length === 0)) fail('fingerprint_input_invalid', 'symbol must be null or a non-empty string.');
  if (typeof rule !== 'string' || rule.length === 0) fail('fingerprint_input_invalid', 'rule must be a non-empty string.');
  if (typeof title !== 'string' || title.length === 0) fail('fingerprint_input_invalid', 'title must be a non-empty string.');
  return sha256Value(stableStringify({ v: 1, origin, path, symbol, rule: normalizeText(rule), title: normalizeText(title) }));
}

export function validateJoinRecord(candidate, label = 'record') {
  const record = JSON.parse(JSON.stringify(candidate));
  exactKeys(record, JOIN_KEYS, label);
  if (record.schema_version !== REVIEW_FINDING_JOIN_VERSION) fail('join_invalid', `${label}.schema_version is unsupported.`);
  if (!REPOSITORY.test(record.repository)) fail('join_invalid', `${label}.repository must be owner/name.`);
  if (!Number.isSafeInteger(record.pr_number) || record.pr_number < 1) fail('join_invalid', `${label}.pr_number must be a positive integer.`);
  if (!COMMIT.test(record.base_sha) || !COMMIT.test(record.head_sha)) fail('join_invalid', `${label} base/head must be lowercase full commit ids.`);
  if (!IDENTIFIER.test(record.finding_id)) fail('join_invalid', `${label}.finding_id must be an identifier.`);
  if (!SHA256.test(record.fingerprint) || !SHA256.test(record.evidence_fingerprint)) fail('join_invalid', `${label} fingerprints must be sha256 hex.`);
  if (!FINDING_ORIGINS.includes(record.origin)) fail('join_invalid', `${label}.origin is not closed.`);
  if (!Number.isSafeInteger(record.round) || record.round < 1 || record.round > MAX_ROUND) fail('join_invalid', `${label}.round must be 1..${MAX_ROUND} (bounded retry).`);
  // The disposition field is bound to the delivery layer's closed vocabulary, not merely to
  // "some non-empty string": the executable validator and the JSON schema must agree.
  if (record.disposition !== null && !REVIEW_DISPOSITIONS.includes(record.disposition)) {
    fail('join_invalid', `${label}.disposition must be null or one of ${REVIEW_DISPOSITIONS.join(', ')}.`);
  }
  for (const field of ['severity', 'risk_class']) {
    if (record[field] !== null && (typeof record[field] !== 'string' || record[field].length === 0)) fail('join_invalid', `${label}.${field} must be null or a non-empty string.`);
  }
  if (record.follow_up !== null && (typeof record.follow_up !== 'string' || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(issues|pull)\/[1-9][0-9]*$/u.test(record.follow_up))) {
    fail('join_invalid', `${label}.follow_up must be null or a GitHub issue/PR URL.`);
  }
  if (!FINDING_RESOLUTIONS.includes(record.resolution)) fail('join_invalid', `${label}.resolution is not closed.`);
  if (!Array.isArray(record.touched_paths) || record.touched_paths.some((item) => typeof item !== 'string' || item.length === 0)) {
    fail('join_invalid', `${label}.touched_paths must be an array of paths.`);
  }
  if (record.superseded_by !== null && !IDENTIFIER.test(record.superseded_by)) fail('join_invalid', `${label}.superseded_by must be null or an identifier.`);
  if (record.disposition === 'DEFERRED' && record.follow_up === null) fail('join_invalid', `${label}: DEFERRED requires a durable follow_up identity.`);
  if (record.resolution === 'superseded' && record.superseded_by === null) fail('join_invalid', `${label}: superseded requires superseded_by.`);
  return record;
}

export function createJoinRecord(fields) {
  return validateJoinRecord({
    schema_version: REVIEW_FINDING_JOIN_VERSION,
    disposition: null, severity: null, risk_class: null, follow_up: null,
    resolution: 'open', touched_paths: [], superseded_by: null,
    ...fields,
  });
}

export function joinKey(record) {
  return `${record.head_sha}:${record.finding_id}`;
}

export function indexRegistry(records) {
  const index = new Map();
  for (const [position, candidate] of records.entries()) {
    const record = validateJoinRecord(candidate, `records[${position}]`);
    const key = joinKey(record);
    if (index.has(key)) fail('join_duplicate', `duplicate join record for ${key}.`);
    index.set(key, record);
  }
  return index;
}

// Same finding (fingerprint) with the same evidence fingerprint may not be automatically
// re-resolved: changing agent, model, or re-running the identical command produces no new
// information and must not consume a round.
export function sameFingerprintNoNewEvidence(previous, next) {
  const a = validateJoinRecord(previous, 'previous');
  const b = validateJoinRecord(next, 'next');
  return a.fingerprint === b.fingerprint && a.evidence_fingerprint === b.evidence_fingerprint;
}

export function assertRoundAdvance(previous, next) {
  const a = validateJoinRecord(previous, 'previous');
  const b = validateJoinRecord(next, 'next');
  // A fingerprint is deliberately stable across heads and PRs, so identity must be checked too:
  // otherwise a round-1 record from one PR could consume a round of another PR's retry budget.
  for (const field of ['repository', 'pr_number', 'finding_id', 'origin', 'base_sha']) {
    if (a[field] !== b[field]) fail('round_advance_invalid', `round advance must stay within one finding: ${field} changed.`);
  }
  if (a.fingerprint !== b.fingerprint) fail('round_advance_invalid', 'round advance must keep the same finding fingerprint.');
  if (b.round !== a.round + 1) fail('round_advance_invalid', `round must advance by exactly one (got ${a.round} -> ${b.round}).`);
  if (b.round > MAX_ROUND) fail('attempt_budget_exhausted', `round ${b.round} exceeds the bounded retry budget of ${MAX_ROUND}.`);
  if (a.evidence_fingerprint === b.evidence_fingerprint) fail('same_evidence_fingerprint_no_retry', 'a retry must carry new evidence.');
  return b;
}

// Staleness after HEAD moves. A record bound to an older head is never merge authority; whether
// it still applies is decided by whether the new head touched the finding's paths.
export function classifyStaleness(record, { currentHeadSha, changedPathsSinceRecord }) {
  const join = validateJoinRecord(record, 'record');
  if (!COMMIT.test(currentHeadSha)) fail('staleness_input_invalid', 'currentHeadSha must be a lowercase full commit id.');
  if (!Array.isArray(changedPathsSinceRecord)) fail('staleness_input_invalid', 'changedPathsSinceRecord must be an array.');
  if (join.head_sha === currentHeadSha) return { staleness: 'current', reason: 'exact_head_match', authority: 'evidence_at_head' };
  if (join.resolution === 'superseded') return { staleness: 'superseded', reason: 'explicitly_superseded', authority: 'none' };
  const touched = join.touched_paths.filter((filePath) => changedPathsSinceRecord.includes(filePath));
  if (touched.length > 0) return { staleness: 'superseded', reason: 'touched_paths_changed', authority: 'none', touched };
  return { staleness: 'head_moved_recheck', reason: 'head_moved_paths_untouched', authority: 'none' };
}
