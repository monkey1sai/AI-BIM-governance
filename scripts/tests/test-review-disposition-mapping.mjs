import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HIGH_RISK_FINDING_CLASSES,
  REVIEW_DISPOSITIONS,
} from '../lib/autonomous-delivery-finalization.mjs';
import {
  CATEGORY_TO_RISK_CLASS,
  DISPOSITION_PROMOTION,
  REVIEWER_DISPOSITIONS,
  ReviewDispositionMappingError,
  assertMappingConsistency,
  demoteReviewDisposition,
  promoteFindingDisposition,
} from '../lib/review-disposition-mapping.mjs';

test('the two vocabularies are joined without a third', () => {
  assert.equal(assertMappingConsistency(), true);
  assert.deepEqual([...REVIEW_DISPOSITIONS], ['ACCEPTED', 'FIX_REQUIRED', 'FALSE_POSITIVE', 'DEFERRED', 'ESCALATE']);
  assert.deepEqual(new Set(Object.values(DISPOSITION_PROMOTION)), new Set(['FIX_REQUIRED', 'FALSE_POSITIVE', 'DEFERRED', 'ESCALATE']));
  assert.equal(REVIEWER_DISPOSITIONS.length, 6);
});

test('fix_now promotes to FIX_REQUIRED on a confirmed correctness finding', () => {
  const promoted = promoteFindingDisposition({ disposition: 'fix_now', status: 'confirmed', severity: 'high', category: 'correctness' });
  assert.equal(promoted.disposition, 'FIX_REQUIRED');
  assert.equal(promoted.severity, 'HIGH');
  assert.equal(promoted.riskClass, 'correctness');
  assert.deepEqual([...promoted.forced], []);
});

test('refuted promotes to FALSE_POSITIVE even on a security finding', () => {
  const promoted = promoteFindingDisposition({ disposition: 'refuted', status: 'refuted', severity: 'blocker', category: 'security' });
  assert.equal(promoted.disposition, 'FALSE_POSITIVE');
  assert.equal(promoted.highRisk, true);
  assert.deepEqual([...promoted.forced], []);
});

test('unverified forces ESCALATE regardless of the reviewer disposition', () => {
  const promoted = promoteFindingDisposition({ disposition: 'fix_now', status: 'unverified', severity: 'low', category: 'runtime' });
  assert.equal(promoted.disposition, 'ESCALATE');
  assert.ok(promoted.forced.includes('unverified_forces_escalate'));
});

test('known_gap on a security finding cannot become DEFERRED', () => {
  const promoted = promoteFindingDisposition({ disposition: 'known_gap', status: 'confirmed', severity: 'medium', category: 'security' });
  assert.equal(promoted.disposition, 'ESCALATE');
  assert.ok(promoted.forced.includes('high_risk_class_forces_escalate'));
});

test('data_recovery lands on a high-risk class by design', () => {
  assert.ok(HIGH_RISK_FINDING_CLASSES.includes(CATEGORY_TO_RISK_CLASS.data_recovery));
  const promoted = promoteFindingDisposition({ disposition: 'follow_up', status: 'confirmed', severity: 'high', category: 'data_recovery' });
  assert.equal(promoted.disposition, 'ESCALATE');
});

test('a refuted status contradicting a fix disposition is rejected', () => {
  assert.throws(() => promoteFindingDisposition({ disposition: 'fix_now', status: 'refuted', severity: 'low', category: 'correctness' }),
    (error) => error instanceof ReviewDispositionMappingError && error.code === 'refuted_status_contradicts_disposition');
});

test('unknown reviewer values fail closed', () => {
  assert.throws(() => promoteFindingDisposition({ disposition: 'maybe', status: 'confirmed', severity: 'low', category: 'correctness' }),
    (error) => error.code === 'reviewer_disposition_invalid');
  assert.throws(() => promoteFindingDisposition({ disposition: 'fix_now', status: 'confirmed', severity: 'urgent', category: 'correctness' }),
    (error) => error.code === 'reviewer_severity_invalid');
});

test('demotion is not total: ACCEPTED has no reviewer-layer source', () => {
  assert.deepEqual([...demoteReviewDisposition('DEFERRED').candidates], ['external_blocker', 'known_gap', 'follow_up']);
  const accepted = demoteReviewDisposition('ACCEPTED');
  assert.equal(accepted.total, false);
  assert.deepEqual([...accepted.candidates], []);
  assert.throws(() => demoteReviewDisposition('MAYBE'), (error) => error.code === 'review_disposition_invalid');
});
