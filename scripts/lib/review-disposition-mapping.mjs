// Bidirectional mapping between the repository's two review-disposition vocabularies.
//
// Reviewer layer  (scripts/lib/risk-proportional-review.mjs:47):
//   FINDING_DISPOSITIONS = {fix_now, external_blocker, known_gap, follow_up, refuted, unverified}
//   FINDING_SEVERITIES   = {info, low, medium, high, blocker}
//   FINDING_CATEGORIES   = {correctness, security, architecture, data_recovery, runtime, evidence}
//
// Delivery layer  (scripts/lib/autonomous-delivery-finalization.mjs:1027):
//   REVIEW_DISPOSITIONS  = [ACCEPTED, FIX_REQUIRED, FALSE_POSITIVE, DEFERRED, ESCALATE]
//   severities           = P0..P3 | BLOCKER | CRITICAL | HIGH | MEDIUM | LOW | ADVISORY
//   FINDING_RISK_CLASSES = 12 classes, 7 of which are HIGH_RISK
//
// This module introduces NO third vocabulary. It joins the two that exist and enforces the
// delivery layer's forced rules (unverified -> ESCALATE; high-risk -> ESCALATE or refuted
// FALSE_POSITIVE) so a promotion can never route a security finding to DEFERRED.

import {
  FINDING_RISK_CLASSES,
  HIGH_RISK_FINDING_CLASSES,
  REVIEW_DISPOSITIONS,
} from './autonomous-delivery-finalization.mjs';

export const REVIEWER_DISPOSITIONS = Object.freeze(['fix_now', 'external_blocker', 'known_gap', 'follow_up', 'refuted', 'unverified']);
export const REVIEWER_SEVERITIES = Object.freeze(['info', 'low', 'medium', 'high', 'blocker']);
export const REVIEWER_CATEGORIES = Object.freeze(['correctness', 'security', 'architecture', 'data_recovery', 'runtime', 'evidence']);
export const REVIEWER_STATUSES = Object.freeze(['confirmed', 'unverified', 'refuted']);

// reviewer disposition -> delivery disposition. Not total in reverse: ACCEPTED has no source.
export const DISPOSITION_PROMOTION = Object.freeze({
  fix_now: 'FIX_REQUIRED',
  refuted: 'FALSE_POSITIVE',
  external_blocker: 'DEFERRED',
  known_gap: 'DEFERRED',
  follow_up: 'DEFERRED',
  unverified: 'ESCALATE',
});

export const SEVERITY_PROMOTION = Object.freeze({
  info: 'ADVISORY',
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  blocker: 'BLOCKER',
});

// reviewer category -> delivery risk class. data_recovery has no exact peer; it is mapped to
// the high-risk `production` class on purpose so a data-loss finding can never be auto-closed.
export const CATEGORY_TO_RISK_CLASS = Object.freeze({
  correctness: 'correctness',
  security: 'security',
  architecture: 'architecture',
  data_recovery: 'production',
  runtime: 'operability',
  evidence: 'test_coverage',
});

export const DISPOSITION_DEMOTION = Object.freeze({
  FIX_REQUIRED: ['fix_now'],
  FALSE_POSITIVE: ['refuted'],
  DEFERRED: ['external_blocker', 'known_gap', 'follow_up'],
  ESCALATE: ['unverified'],
  ACCEPTED: [],
});

export class ReviewDispositionMappingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReviewDispositionMappingError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReviewDispositionMappingError(code, message);
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label}_invalid`, `${label} must be one of ${allowed.join(', ')}; got ${JSON.stringify(value)}.`);
}

// Promote one reviewer-layer finding into the delivery-layer shape, applying the delivery
// layer's forced rules so the result is admissible to validateFindingDisposition.
export function promoteFindingDisposition({ disposition, status, severity, category }) {
  assertEnum(disposition, REVIEWER_DISPOSITIONS, 'reviewer_disposition');
  assertEnum(status, REVIEWER_STATUSES, 'reviewer_status');
  assertEnum(severity, REVIEWER_SEVERITIES, 'reviewer_severity');
  assertEnum(category, REVIEWER_CATEGORIES, 'reviewer_category');

  const riskClass = CATEGORY_TO_RISK_CLASS[category];
  if (!FINDING_RISK_CLASSES.includes(riskClass)) fail('risk_class_unmapped', `category ${category} maps to an unknown risk class.`);
  const highRisk = HIGH_RISK_FINDING_CLASSES.includes(riskClass);
  const forced = [];

  let promoted = DISPOSITION_PROMOTION[disposition];
  // Delivery layer: verification === 'unverified' may ONLY be ESCALATE.
  if (status === 'unverified' && promoted !== 'ESCALATE') {
    forced.push('unverified_forces_escalate');
    promoted = 'ESCALATE';
  }
  // Delivery layer: high-risk classes may only be ESCALATE, or FALSE_POSITIVE when refuted.
  if (highRisk && promoted !== 'ESCALATE' && !(promoted === 'FALSE_POSITIVE' && status === 'refuted')) {
    forced.push('high_risk_class_forces_escalate');
    promoted = 'ESCALATE';
  }
  // A refuted status can only carry FALSE_POSITIVE; anything else is contradictory input.
  if (status === 'refuted' && promoted !== 'FALSE_POSITIVE' && promoted !== 'ESCALATE') {
    fail('refuted_status_contradicts_disposition', `status refuted cannot promote to ${promoted}.`);
  }
  if (!REVIEW_DISPOSITIONS.includes(promoted)) fail('promotion_not_closed', `promotion produced ${promoted}, outside REVIEW_DISPOSITIONS.`);

  return Object.freeze({
    disposition: promoted,
    verification: status,
    severity: SEVERITY_PROMOTION[severity],
    riskClass,
    highRisk,
    forced: Object.freeze(forced),
    source_disposition: disposition,
  });
}

// Demote a delivery-layer disposition back to the reviewer-layer candidates. ACCEPTED has no
// reviewer-layer source: the reviewer never "accepts", only the delivery gate does.
export function demoteReviewDisposition(disposition) {
  assertEnum(disposition, REVIEW_DISPOSITIONS, 'review_disposition');
  const candidates = DISPOSITION_DEMOTION[disposition];
  return Object.freeze({ disposition, candidates: Object.freeze([...candidates]), total: candidates.length > 0 });
}

// The join is consistent iff every promotion lands in the closed set and every demotion of a
// promoted value contains the original source. Exposed so a test can pin the tables.
export function assertMappingConsistency() {
  for (const reviewer of REVIEWER_DISPOSITIONS) {
    const promoted = DISPOSITION_PROMOTION[reviewer];
    if (!REVIEW_DISPOSITIONS.includes(promoted)) fail('mapping_inconsistent', `${reviewer} promotes outside REVIEW_DISPOSITIONS.`);
    if (!DISPOSITION_DEMOTION[promoted].includes(reviewer)) fail('mapping_inconsistent', `${promoted} does not demote back to ${reviewer}.`);
  }
  for (const category of REVIEWER_CATEGORIES) {
    if (!FINDING_RISK_CLASSES.includes(CATEGORY_TO_RISK_CLASS[category])) fail('mapping_inconsistent', `${category} maps outside FINDING_RISK_CLASSES.`);
  }
  return true;
}
