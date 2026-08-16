import test from 'node:test';
import assert from 'node:assert/strict';
import { runStoredDemoCouncil } from '../src/domain/expert-council.mjs';
import { analyzeMarket } from '../src/domain/market-engine.mjs';
import { loadMarketSignals } from '../src/data/repository.mjs';

const market = analyzeMarket(
  loadMarketSignals(),
  new Date('2026-08-01T15:00:00+09:00'),
);
const input = {
  question: '후보지와 자금 계획을 함께 비교해줘',
  profile: { stage: 'PRE_START' },
  finance: { fundingGap: 52_000_000, recommendedBuffer: 16_800_000 },
  market,
  policies: [{
    policyId: 'policy-seoul-2026-support',
    eligibility: 'CHECK_REQUIRED',
    evidence: [{
      officialUrl: 'https://news.seoul.go.kr/economy/small-business-supports',
      verifiedAt: '2026-08-01',
    }],
  }],
};

const expectedSources = {
  MARKET: new Set(['MARKET']),
  OPERATIONS: new Set(['PROFILE', 'MARKET']),
  FINANCE: new Set(['FINANCE']),
  POLICY: new Set(['POLICY']),
};

function assertReferencesResolve(result) {
  const evidenceById = new Map(result.evidence.map((item) => [item.id, item]));
  assert.equal(evidenceById.size, result.evidence.length);

  for (const opinion of result.opinions) {
    for (const evidenceId of opinion.evidenceIds) {
      assert.ok(evidenceById.has(evidenceId));
      assert.ok(expectedSources[opinion.expert].has(evidenceById.get(evidenceId).source));
    }
    for (const action of opinion.actions) {
      for (const evidenceId of action.evidenceIds) {
        assert.ok(evidenceById.has(evidenceId));
        assert.ok(expectedSources[opinion.expert].has(evidenceById.get(evidenceId).source));
      }
    }
  }

  const sourceByConflict = {
    SITE_COMMITMENT_VS_FUNDING_GAP: ['MARKET', 'FINANCE'],
    SITE_TIMING_VS_POLICY_VERIFICATION: ['MARKET', 'POLICY'],
  };
  for (const conflict of result.conflicts) {
    assert.deepEqual(
      [...new Set(conflict.evidenceIds.map((id) => evidenceById.get(id)?.source))].sort(),
      [...sourceByConflict[conflict.code]].sort(),
    );
  }
}

test('council consumes the market producer and preserves both traceable site conflicts', () => {
  const result = runStoredDemoCouncil(input);

  assert.deepEqual(Object.keys(result), [
    'summary',
    'priorityActions',
    'opinions',
    'conflicts',
    'evidence',
    'assumptions',
    'uncertainty',
    'handoffRecommended',
  ]);
  assert.deepEqual(
    result.opinions.map((item) => item.expert),
    ['MARKET', 'OPERATIONS', 'FINANCE', 'POLICY'],
  );
  assert.ok(result.opinions.every((item) => (
    Object.keys(item).join(',')
      === 'expert,claims,evidenceIds,assumptions,uncertainty,actions,escalation'
  )));
  assert.ok(result.priorityActions.length <= 3);
  assert.deepEqual(
    result.conflicts.map((item) => item.code),
    ['SITE_COMMITMENT_VS_FUNDING_GAP', 'SITE_TIMING_VS_POLICY_VERIFICATION'],
  );
  const opinionActionCodes = new Set(
    result.opinions.flatMap((opinion) => opinion.actions.map((action) => action.code)),
  );
  assert.ok(result.conflicts.every((conflict) => (
    conflict.actions.every((actionCode) => opinionActionCodes.has(actionCode))
  )));
  assert.deepEqual(
    result.priorityActions.map(({ code, severity, immediacy }) => ({
      code,
      severity,
      immediacy,
    })),
    [
      {
        code: 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT',
        severity: 'HIGH',
        immediacy: 'BEFORE_COMMITMENT',
      },
      {
        code: 'VERIFY_POLICY_ELIGIBILITY',
        severity: 'HIGH',
        immediacy: 'BEFORE_COMMITMENT',
      },
      {
        code: 'CHECK_OPERATING_READINESS',
        severity: 'MEDIUM',
        immediacy: 'BEFORE_COMMITMENT',
      },
    ],
  );
  assertReferencesResolve(result);
});

test('site confidence and large funding gap remain visible and recommend handoff', () => {
  const result = runStoredDemoCouncil(input);

  assert.equal(result.handoffRecommended, true);
  assert.ok(result.uncertainty.some((item) => item.code === 'MARKET_CONFIDENCE_MEDIUM'));
});

test('summary names only conflict codes that are actually present', () => {
  const result = runStoredDemoCouncil({
    ...input,
    policies: [{ policyId: 'likely-match', eligibility: 'LIKELY_MATCH', evidence: [] }],
  });

  assert.deepEqual(result.conflicts.map((item) => item.code), ['SITE_COMMITMENT_VS_FUNDING_GAP']);
  assert.match(result.summary, /SITE_COMMITMENT_VS_FUNDING_GAP/);
  assert.doesNotMatch(result.summary, /SITE_TIMING_VS_POLICY_VERIFICATION/);
});

test('missing finance inputs remain unknown and produce no reserve recommendation', () => {
  const result = runStoredDemoCouncil({ ...input, finance: {}, policies: [] });
  const financeOpinion = result.opinions.find((item) => item.expert === 'FINANCE');

  assert.deepEqual(financeOpinion.claims.map((item) => item.code), ['FINANCE_EVIDENCE_INSUFFICIENT']);
  assert.deepEqual(financeOpinion.actions, []);
  assert.ok(financeOpinion.uncertainty.some((item) => item.code === 'FUNDING_GAP_UNKNOWN'));
  assert.equal(result.conflicts.some((item) => item.code === 'SITE_COMMITMENT_VS_FUNDING_GAP'), false);
});

test('caller evidence IDs cannot substitute evidence across sources', () => {
  const result = runStoredDemoCouncil({
    ...input,
    market: {
      ...market,
      evidence: ['finance.fundingGap'],
      siteEvidence: market.siteEvidence.map((item, index) => ({
        ...item,
        id: index === 0 ? 'finance.fundingGap' : 'profile.stage',
      })),
    },
    policies: [{
      policyId: 'finance.fundingGap',
      eligibility: 'CHECK_REQUIRED',
      evidence: [{ officialUrl: 'https://example.invalid/official', verifiedAt: '2026-08-01' }],
    }],
  });

  assertReferencesResolve(result);
  assert.ok(result.evidence.every((item) => item.id.startsWith('evidence.')));
});
