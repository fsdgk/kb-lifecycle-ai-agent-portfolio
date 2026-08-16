import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyBriefing, processBusinessEvent } from '../src/domain/event-engine.mjs';
import { buildAdvisorHandoff } from '../src/domain/advisor-handoff.mjs';

test('cost spike creates an immediate evidence-backed alert', () => {
  const [alert] = processBusinessEvent({
    type: 'INGREDIENT_COST_SPIKE',
    changeRate: 0.14,
    source: 'SUPPLIER_FEED',
    asOf: '2026-08-01T15:05:00+09:00',
  }, {});

  assert.equal(alert.channel, 'IMMEDIATE');
  assert.equal(alert.severity, 'HIGH');
  assert.deepEqual(alert.evidence, [{
    id: 'event.INGREDIENT_COST_SPIKE',
    source: 'SUPPLIER_FEED',
    asOf: '2026-08-01T15:05:00+09:00',
  }]);
  assert.ok(alert.evidenceIds.includes('event.INGREDIENT_COST_SPIKE'));
});

test('only the declared urgent event types create immediate alerts', () => {
  const immediateTypes = [
    'CASH_SHORTFALL',
    'SALES_DROP',
    'INGREDIENT_COST_SPIKE',
    'POLICY_DEADLINE',
    'DATA_LINK_FAILURE',
  ];

  for (const type of immediateTypes) {
    assert.equal(processBusinessEvent({ type }, {})[0].channel, 'IMMEDIATE');
  }
  assert.equal(processBusinessEvent({ type: 'STAFFING_NOTE' }, {})[0].channel, 'WEEKLY');
});

test('non-canonical casing does not upgrade an event to an immediate alert', () => {
  assert.equal(processBusinessEvent({ type: 'cash_shortfall' }, {})[0].channel, 'WEEKLY');
});

test('weekly briefing groups only non-immediate events with available evidence metadata', () => {
  const briefing = buildWeeklyBriefing({
    events: [
      { type: 'STAFFING_NOTE', source: 'USER_REPORTED', asOf: '2026-08-01' },
      { type: 'CASH_SHORTFALL', source: 'FINANCE', asOf: '2026-08-01' },
    ],
  });

  assert.deepEqual(briefing.alerts.map((alert) => alert.type), ['STAFFING_NOTE']);
  assert.deepEqual(briefing.alerts[0].evidence, [{
    id: 'event.STAFFING_NOTE',
    source: 'USER_REPORTED',
    asOf: '2026-08-01',
  }]);
});

test('advisor handoff is blocked without explicit transfer consent', () => {
  assert.throws(
    () => buildAdvisorHandoff({ summary: 'Review needed' }, { approved: false }),
    /CONSENT_REQUIRED/,
  );
});

test('advisor handoff is advisory, preserves evidence, and omits sensitive records', () => {
  const handoff = buildAdvisorHandoff({
    summary: 'A funding plan needs review before commitment.',
    dataAsOf: '2026-08-01T15:05:00+09:00',
    opinions: [{ expert: 'FINANCE', claims: [{ code: 'FUNDING_GAP_EXISTS' }] }],
    policyCandidates: [{ policyId: 'policy-seoul-2026', eligibility: 'CHECK_REQUIRED' }],
    evidence: [{ id: 'evidence.finance.fundingGap', source: 'FINANCE', kind: 'DETERMINISTIC_CALCULATION' }],
    uncertainty: [{ code: 'POLICY_ELIGIBILITY_CHECK_REQUIRED' }],
    customerQuestion: 'Can an advisor review the funding options?',
    handoffRecommended: false,
  }, { approved: true });

  assert.deepEqual(Object.keys(handoff), [
    'summary',
    'dataAsOf',
    'expertOpinions',
    'policyCandidates',
    'calculationEvidence',
    'unverifiedItems',
    'customerQuestion',
  ]);
  assert.equal(handoff.dataAsOf, '2026-08-01T15:05:00+09:00');
  assert.deepEqual(handoff.calculationEvidence, [{
    id: 'evidence.finance.fundingGap', source: 'FINANCE', kind: 'DETERMINISTIC_CALCULATION',
  }]);
  assert.equal('accountNumber' in handoff, false);
  assert.equal('transactions' in handoff, false);
});

test('advisor handoff fails closed when council input contains sensitive account data', () => {
  assert.throws(
    () => buildAdvisorHandoff({
      summary: 'Review needed',
      accountNumber: '123-456-789',
    }, { approved: true }),
    /HANDOFF_PAYLOAD_UNSAFE/,
  );
});

test('advisor handoff fails closed when free-text narratives contain sensitive values', () => {
  for (const council of [
    {
      summary: 'Please contact owner@example.com about account 110-123-456789.',
      customerQuestion: 'Can an advisor review the funding options?',
    },
    {
      summary: 'Review needed.',
      customerQuestion: 'Can I repay with card 4111111111111111?',
    },
  ]) {
    assert.throws(
      () => buildAdvisorHandoff(council, { approved: true }),
      /HANDOFF_PAYLOAD_UNSAFE/,
    );
  }
});

test('advisor handoff fails closed for nested payment and identity variants', () => {
  for (const nestedSensitiveValue of [
    { financialInstitution: { iban: 'DE89-3704-0044-0532-0130-00' } },
    { paymentDetails: { method: 'bank-transfer' } },
    { customer: { userId: 'user-123' } },
  ]) {
    assert.throws(
      () => buildAdvisorHandoff({ summary: 'Review needed', opinions: [nestedSensitiveValue] }, { approved: true }),
      /HANDOFF_PAYLOAD_UNSAFE/,
    );
  }
});

test('advisor handoff does not project nested renamed sensitive records', () => {
  for (const nestedSensitiveValue of [
    { claims: [{ code: 'FUNDING_GAP_EXISTS', passport: 'M12345678' }] },
    { evidence: [{ id: 'evidence.finance', source: 'FINANCE', ssn: '123-45-6789' }] },
    { actions: [{ code: 'REVIEW', cardPan: '4111111111111111' }] },
    { uncertainty: [{ code: 'UNKNOWN', txn: { amount: 1000 } }] },
  ]) {
    assert.throws(
      () => buildAdvisorHandoff({ summary: 'Review needed', opinions: [nestedSensitiveValue] }, { approved: true }),
      /HANDOFF_PAYLOAD_UNSAFE/,
    );
  }
});

test('advisor handoff projects useful Task 6 council opinions, policy candidates, and calculations', () => {
  const handoff = buildAdvisorHandoff({
    summary: 'Evidence needs advisor review.',
    dataAsOf: '2026-08-02T09:00:00+09:00',
    opinions: [{
      expert: 'FINANCE',
      claims: [{ code: 'FUNDING_GAP_EXISTS', statement: 'A deterministic gap is available for review.' }],
      evidenceIds: ['evidence.finance.fundingGap'],
      assumptions: [{ code: 'FINANCE_INPUTS_COMPLETE', detail: 'Inputs are current.' }],
      uncertainty: [],
      actions: [{
        code: 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT',
        title: 'Confirm funding plan',
        severity: 'HIGH',
        immediacy: 'BEFORE_COMMITMENT',
        expert: 'FINANCE',
        evidenceIds: ['evidence.finance.fundingGap'],
      }],
      escalation: true,
      ignoredInternalField: { note: 'do not project' },
    }],
    policyCandidates: [{
      policyId: 'policy-seoul-2026-support',
      eligibility: 'CHECK_REQUIRED',
      evidence: [{ officialUrl: 'https://example.invalid/policy', verifiedAt: '2026-08-02' }],
      internalRawField: { note: 'do not project' },
    }],
    evidence: [{
      id: 'evidence.finance.fundingGap',
      source: 'FINANCE',
      kind: 'DETERMINISTIC_CALCULATION',
      value: 52_000_000,
      unit: 'KRW',
      ignoredRawField: { note: 'do not project' },
    }],
    uncertainty: [{ code: 'POLICY_ELIGIBILITY_CHECK_REQUIRED', detail: 'Official verification remains.' }],
    customerQuestion: 'Can an advisor review the funding options?',
  }, { approved: true });

  assert.deepEqual(handoff.expertOpinions, [{
    expert: 'FINANCE',
    claims: [{ code: 'FUNDING_GAP_EXISTS', statement: 'A deterministic gap is available for review.' }],
    evidenceIds: ['evidence.finance.fundingGap'],
    assumptions: [{ code: 'FINANCE_INPUTS_COMPLETE', detail: 'Inputs are current.' }],
    uncertainty: [],
    actions: [{
      code: 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT',
      title: 'Confirm funding plan',
      severity: 'HIGH',
      immediacy: 'BEFORE_COMMITMENT',
      expert: 'FINANCE',
      evidenceIds: ['evidence.finance.fundingGap'],
    }],
    escalation: true,
  }]);
  assert.deepEqual(handoff.policyCandidates, [{
    policyId: 'policy-seoul-2026-support',
    eligibility: 'CHECK_REQUIRED',
    evidence: [{ officialUrl: 'https://example.invalid/policy', verifiedAt: '2026-08-02' }],
  }]);
  assert.deepEqual(handoff.calculationEvidence, [{
    id: 'evidence.finance.fundingGap',
    source: 'FINANCE',
    kind: 'DETERMINISTIC_CALCULATION',
    value: 52_000_000,
    unit: 'KRW',
  }]);
});
