import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { calculateStartupFunding, forecastCashflow } from '../src/domain/finance-engine.mjs';
import { analyzeMarket } from '../src/domain/market-engine.mjs';
import { openPolicyDatabase } from '../src/policy-db/database.mjs';
import {
  initializePolicySchema,
  searchPolicyDatabase,
  upsertPolicySnapshot,
} from '../src/policy-db/policy-repository.mjs';
import {
  buildEvidenceRegistry,
  createSqlitePolicyEvidenceAuthority,
  projectEvidenceForExpert,
} from '../src/orchestration/evidence-registry.mjs';
import { verifyExpertOpinion } from '../src/orchestration/opinion-verifier.mjs';
import seedPolicies from '../database/seed-policies.json' with { type: 'json' };

const scenario = JSON.parse(readFileSync(new URL('../data/demo-scenario.json', import.meta.url), 'utf8'));

function policyContext(stage) {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  seedPolicies.forEach((policy) => upsertPolicySnapshot(database, policy, '2026-08-02T00:00:00.000Z'));
  const matches = searchPolicyDatabase(database, {
    query: 'STARTUP FINANCE CONSULTING',
    regionCode: 'SEOUL',
    lifecycleStage: stage === 'OPERATING_CRISIS' ? 'CRISIS' : stage,
    now: new Date('2026-08-02T00:00:00.000Z'),
    freshnessDays: 30,
  });
  const policyAuthority = createSqlitePolicyEvidenceAuthority({
    database,
    policies: matches,
    regionCode: 'SEOUL',
    stage,
    now: new Date('2026-08-02T00:00:00.000Z'),
    freshnessDays: 30,
  });
  database.close();
  return { matches, policyAuthority };
}

const policyMatches = (stage) => policyContext(stage).matches;

function registryFor(stage) {
  const snapshot = scenario.snapshots.find((item) => item.stage === stage);
  const finance = stage === 'PRE_START'
    ? calculateStartupFunding(scenario)
    : forecastCashflow(
      snapshot.finance.openingBalanceKrw,
      snapshot.finance.dailyFlowsKrw,
      snapshot.finance.days,
    );
  const market = analyzeMarket(snapshot.marketSignals, new Date(snapshot.asOf));

  return buildEvidenceRegistry({
    profile: scenario,
    snapshot,
    finance,
    market,
    policyAuthority: policyContext(stage).policyAuthority,
  });
}

function financeOpinion(overrides = {}) {
  return {
    expert: 'FINANCE',
    claims: [{
      code: 'FUNDING_GAP_EXISTS',
      statement: '개점 계약 전에 확인된 자금 공백을 먼저 해소해야 합니다.',
      evidenceIds: ['finance.startup.funding-gap'],
      confidence: 'HIGH',
    }],
    assumptions: [],
    uncertainty: [],
    actions: [{
      code: 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT',
      title: '자금 조달 계획을 확정합니다.',
      evidenceIds: ['finance.startup.funding-gap'],
    }],
    escalation: true,
    ...overrides,
  };
}

test('canonical registry contains deterministic values and exact SQLite policy provenance', () => {
  const registry = registryFor('PRE_START');
  const fundingGap = registry.evidence.find((item) => item.id === 'finance.startup.funding-gap');
  const policy = registry.evidence.find((item) => item.id === 'policy.policy-mss-2026-integrated');

  assert.equal(registry.scenarioId, 'seoul-croatian-restaurant');
  assert.equal(registry.stage, 'PRE_START');
  assert.deepEqual(fundingGap.value, { amountKrw: 52_000_000 });
  assert.equal(policy.value.policyId, 'policy-mss-2026-integrated');
  assert.equal(policy.value.eligibility, 'CHECK_REQUIRED');
  assert.equal(policy.value.status, 'CHECK_REQUIRED');
  assert.equal(
    policy.value.versionId,
    policyMatches('PRE_START').find((item) => item.policyId === 'policy-mss-2026-integrated').versionId,
  );
  assert.match(policy.value.sourceHash, /^[a-f0-9]{64}$/u);
  assert.equal(policy.value.verifiedAt, '2026-08-01');
  assert.equal(
    policy.value.officialUrl,
    'https://www.mss.go.kr/site/smba/ex/bbs/View.do?bcIdx=1064353&cbIdx=310',
  );
});

test('both lifecycle snapshots build stage-specific deterministic evidence', () => {
  const preStart = registryFor('PRE_START');
  const crisis = registryFor('OPERATING_CRISIS');

  assert.ok(preStart.evidence.some((item) => item.id === 'finance.startup.recommended-buffer'));
  assert.equal(preStart.evidence.some((item) => item.id === 'finance.cashflow.shortfall-range'), false);
  assert.deepEqual(
    crisis.evidence.find((item) => item.id === 'finance.cashflow.shortfall-range').value,
    { lowKrw: 900_000, highKrw: 1_100_000 },
  );
  assert.equal(crisis.evidence.some((item) => item.id === 'finance.startup.funding-gap'), false);
});

test('expert projection exposes only the domains allowed for that specialist', () => {
  const registry = registryFor('PRE_START');
  const market = projectEvidenceForExpert(registry, 'MARKET');
  const finance = projectEvidenceForExpert(registry, 'FINANCE');
  const policy = projectEvidenceForExpert(registry, 'POLICY');

  assert.deepEqual(new Set(market.map((item) => item.domain)), new Set(['CONTEXT', 'MARKET']));
  assert.deepEqual(new Set(finance.map((item) => item.domain)), new Set(['CONTEXT', 'FINANCE']));
  assert.ok(policy.some((item) => item.domain === 'POLICY'));
  assert.ok(policy.some((item) => item.id === 'finance.startup.funding-gap'));
  assert.equal(market.some((item) => item.domain === 'POLICY'), false);
  assert.equal(finance.some((item) => item.domain === 'POLICY'), false);
});

test('opinion verifier accepts a contract-valid opinion tied to its canonical projection', () => {
  const registry = registryFor('PRE_START');
  const opinion = financeOpinion();

  assert.equal(verifyExpertOpinion({
    envelope: {
      metadata: {
        generator: 'ChatGPT',
        generatedAt: '2026-08-02T00:00:00.000Z',
        promptVersion: 'expert-v1',
        scenarioId: scenario.scenarioId,
        stage: 'PRE_START',
        agent: 'FINANCE',
        synthetic: true,
      },
      result: opinion,
    },
    registry,
    expectedExpert: 'FINANCE',
  }), opinion);
});

test('opinion verifier rejects mismatched metadata and cross-specialist evidence', () => {
  const registry = registryFor('PRE_START');
  const baseEnvelope = {
    metadata: {
      generator: 'ChatGPT',
      generatedAt: '2026-08-02T00:00:00.000Z',
      promptVersion: 'expert-v1',
      scenarioId: scenario.scenarioId,
      stage: 'OPERATING_CRISIS',
      agent: 'FINANCE',
      synthetic: true,
    },
    result: financeOpinion(),
  };

  assert.throws(
    () => verifyExpertOpinion({ envelope: baseEnvelope, registry, expectedExpert: 'FINANCE' }),
    /stage/i,
  );

  const crossDomain = structuredClone(baseEnvelope);
  crossDomain.metadata.stage = 'PRE_START';
  crossDomain.result.claims[0].evidenceIds = ['market.outlook.baseline'];
  assert.throws(
    () => verifyExpertOpinion({ envelope: crossDomain, registry, expectedExpert: 'FINANCE' }),
    /evidence/i,
  );
});

test('opinion verifier requires action evidence from the action domain', () => {
  const registry = registryFor('PRE_START');
  const opinion = financeOpinion();
  opinion.actions[0].evidenceIds = ['context.lifecycle-stage'];

  assert.throws(
    () => verifyExpertOpinion({
      envelope: {
        metadata: {
          generator: 'ChatGPT',
          generatedAt: '2026-08-02T00:00:00.000Z',
          promptVersion: 'expert-v1',
          scenarioId: scenario.scenarioId,
          stage: 'PRE_START',
          agent: 'FINANCE',
          synthetic: true,
        },
        result: opinion,
      },
      registry,
      expectedExpert: 'FINANCE',
    }),
    /action.*finance|finance.*evidence/i,
  );
});

test('registry rejects incomplete or non-official policy provenance', () => {
  const snapshot = scenario.snapshots.find((item) => item.stage === 'PRE_START');
  const finance = calculateStartupFunding(scenario);
  const market = analyzeMarket(snapshot.marketSignals, new Date(snapshot.asOf));
  const invalidPolicy = { ...policyMatches('PRE_START')[0], officialUrl: 'http://example.test/policy' };

  assert.throws(
    () => buildEvidenceRegistry({ profile: scenario, snapshot, finance, market, policies: [invalidPolicy] }),
    /authority|official.*https|policy.*url/i,
  );
});

test('registry rejects finance output altered after deterministic calculation', () => {
  const snapshot = scenario.snapshots.find((item) => item.stage === 'PRE_START');
  const finance = { ...calculateStartupFunding(scenario), fundingGap: 1 };
  const market = analyzeMarket(snapshot.marketSignals, new Date(snapshot.asOf));

  assert.throws(
    () => buildEvidenceRegistry({ profile: scenario, snapshot, finance, market, policies: [] }),
    /finance.*deterministic/i,
  );
});

test('SQLite policy authority rejects a caller-forged official policy object', () => {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  seedPolicies.forEach((policy) => upsertPolicySnapshot(database, policy, '2026-08-02T00:00:00.000Z'));
  const realMatches = searchPolicyDatabase(database, {
    query: 'STARTUP FINANCE CONSULTING',
    regionCode: 'SEOUL',
    lifecycleStage: 'PRE_START',
    now: new Date('2026-08-02T00:00:00.000Z'),
    freshnessDays: 30,
  });
  const forged = {
    ...realMatches[0],
    policyId: 'policy-attacker-special-loan',
    officialUrl: 'https://attacker.example/special-loan',
    versionId: 'forged-version',
    evidence: [{
      policyId: 'policy-attacker-special-loan',
      officialUrl: 'https://attacker.example/special-loan',
      versionId: 'forged-version',
      verifiedAt: realMatches[0].verifiedAt,
    }],
  };

  assert.throws(
    () => createSqlitePolicyEvidenceAuthority({
      database,
      policies: [forged],
      regionCode: 'SEOUL',
      stage: 'PRE_START',
      now: new Date('2026-08-02T00:00:00.000Z'),
      freshnessDays: 30,
    }),
    /allowlist|official|database/i,
  );
  database.close();
});

test('SQLite policy authority rejects mismatched version, region, stage, and freshness', () => {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  seedPolicies.forEach((policy) => upsertPolicySnapshot(database, policy, '2026-08-02T00:00:00.000Z'));
  const preStartMatches = searchPolicyDatabase(database, {
    query: 'STARTUP FINANCE CONSULTING',
    regionCode: 'SEOUL',
    lifecycleStage: 'PRE_START',
    now: new Date('2026-08-02T00:00:00.000Z'),
    freshnessDays: 30,
  });
  const national = preStartMatches.find((item) => item.policyId === 'policy-mss-2026-integrated');

  assert.throws(() => createSqlitePolicyEvidenceAuthority({
    database,
    policies: [{ ...national, versionId: 'wrong-version' }],
    regionCode: 'SEOUL',
    stage: 'PRE_START',
    now: new Date('2026-08-02T00:00:00.000Z'),
    freshnessDays: 30,
  }), /version|database/i);

  const seoulOnly = preStartMatches.find((item) => item.policyId === 'policy-seoul-2026-support');
  assert.throws(() => createSqlitePolicyEvidenceAuthority({
    database,
    policies: [seoulOnly],
    regionCode: 'GYEONGGI',
    stage: 'PRE_START',
    now: new Date('2026-08-02T00:00:00.000Z'),
    freshnessDays: 30,
  }), /region/i);

  assert.throws(() => createSqlitePolicyEvidenceAuthority({
    database,
    policies: [seoulOnly],
    regionCode: 'SEOUL',
    stage: 'EXIT',
    now: new Date('2026-08-02T00:00:00.000Z'),
    freshnessDays: 30,
  }), /stage/i);

  assert.throws(() => createSqlitePolicyEvidenceAuthority({
    database,
    policies: [national],
    regionCode: 'SEOUL',
    stage: 'PRE_START',
    now: new Date('2027-02-01T00:00:00.000Z'),
    freshnessDays: 30,
  }), /fresh|verified/i);
  database.close();
});

test('registry accepts policy evidence only through a DB-issued authority', () => {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  seedPolicies.forEach((policy) => upsertPolicySnapshot(database, policy, '2026-08-02T00:00:00.000Z'));
  const policies = searchPolicyDatabase(database, {
    query: 'STARTUP FINANCE CONSULTING',
    regionCode: 'SEOUL',
    lifecycleStage: 'PRE_START',
    now: new Date('2026-08-02T00:00:00.000Z'),
    freshnessDays: 30,
  });
  const snapshot = scenario.snapshots.find((item) => item.stage === 'PRE_START');
  const inputs = {
    profile: scenario,
    snapshot,
    finance: calculateStartupFunding(scenario),
    market: analyzeMarket(snapshot.marketSignals, new Date(snapshot.asOf)),
  };

  assert.throws(
    () => buildEvidenceRegistry({ ...inputs, policies }),
    /DB-issued policy authority/i,
  );

  const policyAuthority = createSqlitePolicyEvidenceAuthority({
    database,
    policies,
    regionCode: 'SEOUL',
    stage: 'PRE_START',
    now: new Date('2026-08-02T00:00:00.000Z'),
    freshnessDays: 30,
  });
  const registry = buildEvidenceRegistry({ ...inputs, policyAuthority });
  const policy = registry.evidence.find((item) => item.id === 'policy.policy-mss-2026-integrated');

  assert.match(policy.value.sourceHash, /^[a-f0-9]{64}$/u);
  database.close();
});

test('opinion verifier rejects an unregistered policy claim code and invented program text', () => {
  const registry = registryFor('PRE_START');
  const policyEvidenceId = registry.evidence.find((item) => item.domain === 'POLICY').id;
  const metadata = {
    generator: 'ChatGPT',
    generatedAt: '2026-08-02T00:00:00.000Z',
    promptVersion: 'expert-v1',
    scenarioId: scenario.scenarioId,
    stage: 'PRE_START',
    agent: 'POLICY',
    synthetic: true,
  };
  const baseResult = {
    expert: 'POLICY',
    claims: [{
      code: 'YOUTH_SPECIAL_LOAN_AVAILABLE',
      statement: '정책 후보를 공식 공고에서 확인해야 합니다.',
      evidenceIds: [policyEvidenceId],
      confidence: 'MEDIUM',
    }],
    assumptions: [],
    uncertainty: [],
    actions: [{
      code: 'CHECK_OFFICIAL_NOTICE',
      title: '공식 공고를 확인합니다.',
      evidenceIds: [policyEvidenceId],
    }],
    escalation: false,
  };

  assert.throws(
    () => verifyExpertOpinion({ envelope: { metadata, result: baseResult }, registry, expectedExpert: 'POLICY' }),
    /claim code/i,
  );

  const inventedText = structuredClone(baseResult);
  inventedText.claims[0].code = 'POLICY_MATCH_REQUIRES_VERIFICATION';
  inventedText.claims[0].statement = '청년 창업 특별대출은 자격 확인이 필요합니다.';
  assert.throws(
    () => verifyExpertOpinion({ envelope: { metadata, result: inventedText }, registry, expectedExpert: 'POLICY' }),
    /trusted claim template/i,
  );
});

test('opinion verifier rejects a false funding-gap comparison despite valid evidence IDs', () => {
  const registry = registryFor('PRE_START');
  const result = financeOpinion();
  result.claims[0] = {
    code: 'FUNDING_GAP_EXCEEDS_OWN_CAPITAL',
    statement: '자금 공백이 자기자본보다 큽니다.',
    evidenceIds: ['finance.startup.funding-gap', 'finance.startup.own-capital'],
    confidence: 'HIGH',
  };

  assert.throws(
    () => verifyExpertOpinion({
      envelope: {
        metadata: {
          generator: 'ChatGPT',
          generatedAt: '2026-08-02T00:00:00.000Z',
          promptVersion: 'expert-v1',
          scenarioId: scenario.scenarioId,
          stage: 'PRE_START',
          agent: 'FINANCE',
          synthetic: true,
        },
        result,
      },
      registry,
      expectedExpert: 'FINANCE',
    }),
    /claim.*semantic|evidence.*relation/i,
  );
});

test('trusted claim templates reject a false statement under FUNDING_GAP_EXISTS', () => {
  const registry = registryFor('PRE_START');
  const result = financeOpinion();
  result.claims[0].statement = '자금 공백이 자기자본보다 큽니다.';

  assert.throws(
    () => verifyExpertOpinion({
      envelope: {
        metadata: {
          generator: 'ChatGPT',
          generatedAt: '2026-08-02T00:00:00.000Z',
          promptVersion: 'expert-v1',
          scenarioId: scenario.scenarioId,
          stage: 'PRE_START',
          agent: 'FINANCE',
          synthetic: true,
        },
        result,
      },
      registry,
      expectedExpert: 'FINANCE',
    }),
    /trusted claim template/i,
  );
});

test('trusted policy template rejects a fabricated program name under a valid claim code', () => {
  const registry = registryFor('PRE_START');
  const policyEvidenceId = registry.evidence.find((item) => item.domain === 'POLICY').id;
  const result = {
    expert: 'POLICY',
    claims: [{
      code: 'POLICY_MATCH_REQUIRES_VERIFICATION',
      statement: '희망성장 프로그램은 자격 확인 후 신청할 수 있습니다.',
      evidenceIds: [policyEvidenceId],
      confidence: 'MEDIUM',
    }],
    assumptions: [],
    uncertainty: [],
    actions: [{
      code: 'CHECK_OFFICIAL_NOTICE',
      title: '공식 공고를 확인합니다.',
      evidenceIds: [policyEvidenceId],
    }],
    escalation: false,
  };

  assert.throws(
    () => verifyExpertOpinion({
      envelope: {
        metadata: {
          generator: 'ChatGPT',
          generatedAt: '2026-08-02T00:00:00.000Z',
          promptVersion: 'expert-v1',
          scenarioId: scenario.scenarioId,
          stage: 'PRE_START',
          agent: 'POLICY',
          synthetic: true,
        },
        result,
      },
      registry,
      expectedExpert: 'POLICY',
    }),
    /trusted claim template/i,
  );
});

test('PRE_START rejects ADDRESS_CASH_SHORTFALL even with valid startup finance evidence', () => {
  const registry = registryFor('PRE_START');
  const result = financeOpinion();
  result.actions[0] = {
    code: 'ADDRESS_CASH_SHORTFALL',
    title: '예상 현금 부족 대응안을 마련합니다.',
    evidenceIds: ['finance.startup.funding-gap'],
  };

  assert.throws(
    () => verifyExpertOpinion({
      envelope: {
        metadata: {
          generator: 'ChatGPT',
          generatedAt: '2026-08-02T00:00:00.000Z',
          promptVersion: 'expert-v1',
          scenarioId: scenario.scenarioId,
          stage: 'PRE_START',
          agent: 'FINANCE',
          synthetic: true,
        },
        result,
      },
      registry,
      expectedExpert: 'FINANCE',
    }),
    /action code.*stage|unregistered action code/i,
  );
});

test('trusted action templates reject a free-form action title under a valid code', () => {
  const registry = registryFor('PRE_START');
  const result = financeOpinion();
  result.actions[0].title = '원하는 은행에서 바로 대출을 신청합니다.';

  assert.throws(
    () => verifyExpertOpinion({
      envelope: {
        metadata: {
          generator: 'ChatGPT',
          generatedAt: '2026-08-02T00:00:00.000Z',
          promptVersion: 'expert-v1',
          scenarioId: scenario.scenarioId,
          stage: 'PRE_START',
          agent: 'FINANCE',
          synthetic: true,
        },
        result,
      },
      registry,
      expectedExpert: 'FINANCE',
    }),
    /trusted action template/i,
  );
});

test('trusted policy claim and action templates pass with canonical policy evidence', () => {
  const registry = registryFor('PRE_START');
  const policyEvidenceId = registry.evidence.find((item) => item.domain === 'POLICY').id;
  const result = {
    expert: 'POLICY',
    claims: [{
      code: 'POLICY_MATCH_REQUIRES_VERIFICATION',
      statement: '정책 후보의 신청 자격은 공식 공고에서 다시 확인해야 합니다.',
      evidenceIds: [policyEvidenceId],
      confidence: 'MEDIUM',
    }],
    assumptions: [],
    uncertainty: [],
    actions: [{
      code: 'CHECK_OFFICIAL_NOTICE',
      title: '공식 공고를 확인합니다.',
      evidenceIds: [policyEvidenceId],
    }],
    escalation: false,
  };

  assert.equal(verifyExpertOpinion({
    envelope: {
      metadata: {
        generator: 'ChatGPT',
        generatedAt: '2026-08-02T00:00:00.000Z',
        promptVersion: 'expert-v1',
        scenarioId: scenario.scenarioId,
        stage: 'PRE_START',
        agent: 'POLICY',
        synthetic: true,
      },
      result,
    },
    registry,
    expectedExpert: 'POLICY',
  }), result);
});
