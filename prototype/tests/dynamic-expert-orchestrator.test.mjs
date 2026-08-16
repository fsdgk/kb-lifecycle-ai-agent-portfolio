import test from 'node:test';
import assert from 'node:assert/strict';

import { loadIndustryBenchmark, normalizeBusinessInput } from '../src/domain/business-input.mjs';
import { analyzeOperatingInput, analyzeStartupInput } from '../src/domain/business-analysis.mjs';
import { openPolicyDatabase } from '../src/policy-db/database.mjs';
import { initializePolicySchema, upsertPolicySnapshot } from '../src/policy-db/policy-repository.mjs';
import { matchPoliciesForBusiness } from '../src/orchestration/policy-matcher.mjs';
import { projectEvidenceForExpert } from '../src/orchestration/evidence-registry.mjs';
import { runDynamicExpertCouncil } from '../src/orchestration/dynamic-expert-orchestrator.mjs';
import { marketAgent } from '../src/agents/market-agent.mjs';
import { operationsAgent } from '../src/agents/operations-agent.mjs';
import { financeAgent } from '../src/agents/finance-agent.mjs';
import { policyAgent } from '../src/agents/policy-agent.mjs';
import { supervisorAgent } from '../src/agents/supervisor-agent.mjs';
import seedPolicies from '../database/seed-policies.json' with { type: 'json' };

const now = new Date('2026-08-02T00:00:00.000Z');

function policyDatabase() {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  seedPolicies.forEach((policy) => upsertPolicySnapshot(database, policy, now.toISOString()));
  return database;
}

function startupInput(overrides = {}) {
  const fundingPurpose = overrides.fundingPurpose ?? 'WORKING_CAPITAL';
  return normalizeBusinessInput({
    path: 'STARTUP',
    stage: 'STARTUP',
    regionCode: 'SEOUL',
    industryTemplate: 'FOOD_CAFE',
    registrationStatus: 'NOT_REGISTERED',
    operatingMonths: 0,
    fundingPurpose,
    businessProfile: {
      businessName: 'Private Startup Name',
      ownerEmail: 'owner@example.com',
      registrationStatus: 'NOT_REGISTERED',
    },
    startup: {
      declaredTotalBudgetKrw: 112_000_000,
      ownCapitalKrw: 60_000_000,
      depositKrw: 30_000_000,
      interiorCostKrw: 40_000_000,
      equipmentCostKrw: 30_000_000,
      initialInventoryKrw: 10_000_000,
      customCosts: [{ label: 'Opening permit', amountKrw: 2_000_000 }],
      fundingPurpose,
      ...overrides,
    },
  });
}

function operatingInput(overrides = {}) {
  return normalizeBusinessInput({
    path: 'OPERATING',
    stage: 'OPERATING',
    regionCode: 'SEOUL',
    industryTemplate: 'FOOD_CAFE',
    registrationStatus: 'REGISTERED',
    operatingMonths: 18,
    fundingPurpose: 'WORKING_CAPITAL',
    businessProfile: {
      businessName: 'Private Operating Name',
      accountNumber: '110-123-456789',
      registrationStatus: 'REGISTERED',
    },
    operating: {
      monthlySalesKrw: 20_000_000,
      declaredNetProfitKrw: 2_000_000,
      declaredMarginRate: 0.1,
      laborCostKrw: 8_000_000,
      rentKrw: 5_000_000,
      materialCostKrw: 10_000_000,
      platformFeesKrw: 500_000,
      advertisingKrw: 2_000_000,
      utilitiesAndFeesKrw: 1_000_000,
      customCosts: [{ label: 'Cleaning', amountKrw: 1_000_000 }],
      operatingMonths: 18,
      fundingPurpose: 'WORKING_CAPITAL',
      ...overrides,
    },
  });
}

function market(state = {}) {
  return {
    status: 'CURRENT',
    confidence: { level: 'HIGH' },
    ...state,
  };
}

function contextFor(input, { marketState = market(), emptyPolicies = false } = {}) {
  const database = policyDatabase();
  const analysis = input.path === 'STARTUP'
    ? analyzeStartupInput(input, loadIndustryBenchmark(input.industryTemplate))
    : analyzeOperatingInput(input, loadIndustryBenchmark(input.industryTemplate));
  const matched = matchPoliciesForBusiness({ database, input, now });
  const policyResult = emptyPolicies
    ? matchPoliciesForBusiness({ database, input, now: new Date('2027-08-02T00:00:00.000Z') })
    : matched;
  return { database, input, analysis, market: marketState, policyResult };
}

function closeAfter(context, operation) {
  return Promise.resolve(operation(context)).finally(() => context.database.close());
}

test('startup input produces four verified opinions, canonical funding and policy evidence, and at most three priorities', async () => {
  const context = contextFor(startupInput());
  const result = await closeAfter(context, runDynamicExpertCouncil);

  assert.deepEqual(result.opinions.map((opinion) => opinion.expert), ['MARKET', 'OPERATIONS', 'FINANCE', 'POLICY']);
  assert.equal(result.evidence.find((item) => item.id === 'finance.startup.funding-gap').value.amountKrw, 52_000_000);
  assert.ok(result.evidence.some((item) => item.domain === 'POLICY' && item.kind === 'OFFICIAL_POLICY_RECORD'));
  assert.ok(result.priorityActions.length <= 3);
  assert.ok(result.opinions.every((opinion) => opinion.verification.verified === true));
});

test('operating input selects declaration mismatch and every high cost benchmark warning', async () => {
  const context = contextFor(operatingInput());
  const result = await closeAfter(context, runDynamicExpertCouncil);
  const operations = result.opinions.find((opinion) => opinion.expert === 'OPERATIONS');

  assert.ok(operations.claims.some((claim) => claim.code === 'DECLARED_PROFIT_MISMATCH'));
  assert.deepEqual(
    operations.claims.filter((claim) => claim.code.endsWith('_RATIO_HIGH')).map((claim) => claim.code),
    ['LABOR_RATIO_HIGH', 'RENT_RATIO_HIGH', 'MATERIAL_RATIO_HIGH', 'OTHER_CUSTOM_RATIO_HIGH'],
  );
});

test('negative calculated profit and zero sales produce finite verified facts, actions, and handoff', async () => {
  const context = contextFor(operatingInput({
    monthlySalesKrw: 0,
    declaredNetProfitKrw: -1_000_000,
    declaredMarginRate: -1,
  }));
  const result = await closeAfter(context, runDynamicExpertCouncil);
  const finance = result.opinions.find((opinion) => opinion.expert === 'FINANCE');

  assert.ok(finance.claims.some((claim) => claim.code === 'NEGATIVE_CALCULATED_PROFIT'));
  assert.ok(finance.actions.some((action) => action.code === 'ADDRESS_CASH_SHORTFALL'));
  assert.equal(result.handoff.recommended, true);
  assert.doesNotMatch(JSON.stringify(result), /NaN|Infinity/);
});

test('changing user amounts changes canonical evidence and selected finance codes', async () => {
  const gap = contextFor(startupInput());
  const covered = contextFor(startupInput({ ownCapitalKrw: 120_000_000 }));
  try {
    const gapResult = await runDynamicExpertCouncil(gap);
    const coveredResult = await runDynamicExpertCouncil(covered);
    const financeCodes = (result) => result.opinions.find((item) => item.expert === 'FINANCE').claims.map((item) => item.code);

    assert.equal(gapResult.evidence.find((item) => item.id === 'finance.startup.funding-gap').value.amountKrw, 52_000_000);
    assert.equal(coveredResult.evidence.find((item) => item.id === 'finance.startup.funding-gap').value.amountKrw, 0);
    assert.ok(financeCodes(gapResult).includes('FUNDING_GAP_EXISTS'));
    assert.ok(financeCodes(coveredResult).includes('STARTUP_CAPITAL_COVERS_COSTS'));
    assert.doesNotMatch(JSON.stringify(coveredResult), /Croat|Croatian/i);
  } finally {
    gap.database.close();
    covered.database.close();
  }
});

test('specialist projections enforce finance, policy, URL, and private-data boundaries', async () => {
  const context = contextFor(startupInput());
  const result = await closeAfter(context, runDynamicExpertCouncil);
  const registry = { evidence: result.evidence };
  const marketProjection = JSON.stringify(projectEvidenceForExpert(registry, 'MARKET'));
  const financeProjection = JSON.stringify(projectEvidenceForExpert(registry, 'FINANCE'));
  const policyProjection = projectEvidenceForExpert(registry, 'POLICY');

  assert.doesNotMatch(marketProjection, /FINANCE|POLICY|owner@example.com|Private Startup Name|110-123/);
  assert.doesNotMatch(financeProjection, /officialUrl|https:\/\//);
  assert.deepEqual(new Set(policyProjection.map((item) => item.domain)), new Set(['CONTEXT', 'FINANCE', 'POLICY']));
  for (const definition of [marketAgent, operationsAgent, financeAgent, policyAgent]) {
    const prompt = definition.buildInput({ registry });
    assert.deepEqual(prompt.input.allowedClaimCodes, definition.claimCodes);
    assert.deepEqual(prompt.input.allowedActionCodes, definition.actionCodes);
  }
});

test('missing market provider and absent policy candidates remain explicit without invented facts', async () => {
  const context = contextFor(startupInput(), { marketState: null, emptyPolicies: true });
  const result = await closeAfter(context, runDynamicExpertCouncil);

  assert.equal(result.metadata.marketStatus, 'PLANNED_INTEGRATION');
  assert.ok(result.uncertainty.some((item) => item.code === 'MARKET_DATA_PLANNED_INTEGRATION'));
  assert.deepEqual(result.policyMatches, []);
  assert.ok(result.opinions.find((item) => item.expert === 'POLICY').claims.some((claim) => claim.code === 'POLICY_NO_MATCH'));
  assert.doesNotMatch(JSON.stringify(result), /nearby|near-by|인근\s*매장/i);
});

test('partial market integration is normalized to planned integration uncertainty', async () => {
  const context = contextFor(startupInput(), {
    marketState: { status: 'PARTIAL', confidence: { level: 'MEDIUM' } },
  });
  const result = await closeAfter(context, runDynamicExpertCouncil);

  assert.equal(result.metadata.marketStatus, 'PLANNED_INTEGRATION');
  assert.ok(result.uncertainty.some((item) => item.code === 'MARKET_DATA_PLANNED_INTEGRATION'));
});

test('loan execution purpose and an explicit consultation request independently recommend handoff', async () => {
  const loan = contextFor(startupInput({ fundingPurpose: 'LOAN_EXECUTION' }));
  const consultation = contextFor(startupInput());
  try {
    const loanResult = await runDynamicExpertCouncil(loan);
    const consultationResult = await runDynamicExpertCouncil({ ...consultation, consultationRequested: true });

    assert.ok(loanResult.handoff.reasons.includes('LOAN_EXECUTION_PURPOSE'));
    assert.ok(consultationResult.handoff.reasons.includes('CONSULTATION_REQUESTED'));
  } finally {
    loan.database.close();
    consultation.database.close();
  }
});

test('the established funding-gap boundary is classified as large for handoff', async () => {
  const context = contextFor(startupInput({
    declaredTotalBudgetKrw: 90_000_000,
    ownCapitalKrw: 60_000_000,
    depositKrw: 20_000_000,
    interiorCostKrw: 30_000_000,
    equipmentCostKrw: 25_000_000,
    initialInventoryKrw: 13_000_000,
  }));
  const result = await closeAfter(context, runDynamicExpertCouncil);

  assert.equal(result.evidence.find((item) => item.id === 'finance.startup.funding-gap').value.amountKrw, 30_000_000);
  assert.ok(result.handoff.reasons.includes('LARGE_FUNDING_GAP'));
});

test('a model proposal is used only after full expert verification', async () => {
  const context = contextFor(startupInput());
  const deterministic = await runDynamicExpertCouncil(context);
  const proposedMarket = structuredClone(deterministic.opinions[0]);
  delete proposedMarket.verification;
  const modelGateway = {
    name: 'fake-gateway',
    async generate(request) {
      return {
        requestId: request.requestId,
        output: request.role === 'MARKET' ? proposedMarket : {},
      };
    },
  };
  try {
    const result = await runDynamicExpertCouncil({ ...context, modelGateway });
    assert.equal(result.opinions[0].verification.agentState, 'MODEL_VERIFIED');
    assert.ok(result.opinions.slice(1).every((opinion) => opinion.verification.agentState === 'MODEL_REJECTED_FALLBACK'));
  } finally {
    context.database.close();
  }
});

test('invented evidence, action, numeric, policy, and PII model proposals fall back explicitly', async () => {
  const mutations = [
    (opinion) => { opinion.claims[0].evidenceIds = ['evidence.invented']; },
    (opinion) => {
      opinion.actions[0] = {
        code: 'APPROVE_LOAN_NOW',
        title: 'Approve immediately.',
        evidenceIds: ['market.provider-status'],
      };
    },
    (opinion) => { opinion.claims[0].statement = 'The amount is 999 won.'; },
    (opinion) => { opinion.claims[0].statement = 'POLICY-FAKE is approved.'; },
    (opinion) => { opinion.claims[0].statement = 'Contact owner@example.com.'; },
  ];

  for (const mutate of mutations) {
    const context = contextFor(startupInput());
    try {
      const baseline = await runDynamicExpertCouncil(context);
      const proposal = structuredClone(baseline.opinions[0]);
      delete proposal.verification;
      mutate(proposal);
      const result = await runDynamicExpertCouncil({
        ...context,
        modelGateway: {
          name: 'malicious-fake',
          async generate(request) { return { requestId: request.requestId, output: proposal }; },
        },
      });

      assert.equal(result.opinions[0].verification.agentState, 'MODEL_REJECTED_FALLBACK');
      assert.deepEqual(
        result.opinions[0].claims.map((claim) => claim.code),
        baseline.opinions[0].claims.map((claim) => claim.code),
      );
    } finally {
      context.database.close();
    }
  }
});

test('caller-supplied policy details cannot replace the DB-issued canonical candidate', async () => {
  const context = contextFor(startupInput());
  try {
    context.policyResult = {
      ...context.policyResult,
      matches: context.policyResult.matches.map((match, index) => (
        index === 0 ? { ...match, title: 'Forged same-ID policy' } : match
      )),
    };

    await assert.rejects(() => runDynamicExpertCouncil(context), /policy.*database|authority|canonical/i);
  } finally {
    context.database.close();
  }
});

test('a recovery authority cannot be replayed for a working-capital input at the same stage', async () => {
  const working = contextFor(operatingInput());
  const recoveryInput = operatingInput({ fundingPurpose: 'RECOVERY' });
  const recovery = contextFor(recoveryInput);
  try {
    await assert.rejects(
      () => runDynamicExpertCouncil({ ...working, policyResult: recovery.policyResult }),
      /authority.*input|query.*input|funding purpose/i,
    );
  } finally {
    working.database.close();
    recovery.database.close();
  }
});

test('matching forged nested checks in caller match and authority views cannot become policy evidence', async () => {
  const context = contextFor(startupInput());
  const match = context.policyResult.matches[0];
  const canonical = context.policyResult.authority.policies[0];
  let rejectedMutations = 0;
  for (const target of [match, canonical]) {
    try {
      target.requiredChecks[0] = 'FORGED CHECK';
    } catch {
      rejectedMutations += 1;
    }
  }
  try {
    if (rejectedMutations === 2) {
      assert.notEqual(match.requiredChecks[0], 'FORGED CHECK');
      assert.notEqual(canonical.requiredChecks[0], 'FORGED CHECK');
    } else {
      await assert.rejects(
        () => runDynamicExpertCouncil(context),
        /policy.*database|canonical|authority/i,
      );
    }
  } finally {
    context.database.close();
  }
});

test('a model supervisor cannot suppress a deterministic handoff condition', async () => {
  const context = contextFor(startupInput());
  const baseline = await runDynamicExpertCouncil(context);
  const opinions = Object.fromEntries(baseline.opinions.map((opinion) => {
    const proposal = structuredClone(opinion);
    delete proposal.verification;
    return [opinion.expert, proposal];
  }));
  const supervisorProposal = Object.fromEntries(
    ['summary', 'priorityActions', 'conflicts', 'assumptions', 'uncertainty', 'handoff']
      .map((field) => [field, structuredClone(baseline[field])]),
  );
  supervisorProposal.handoff = { recommended: false, reasons: [] };
  try {
    const result = await runDynamicExpertCouncil({
      ...context,
      modelGateway: {
        name: 'handoff-suppressor',
        async generate(request) {
          return {
            requestId: request.requestId,
            output: request.role === 'SUPERVISOR' ? supervisorProposal : opinions[request.role],
          };
        },
      },
    });

    assert.equal(result.handoff.recommended, true);
    assert.equal(result.metadata.agentStates.SUPERVISOR, 'MODEL_REJECTED_FALLBACK');
  } finally {
    context.database.close();
  }
});

test('a valid-schema model specialist cannot suppress deterministic loss conclusions', async () => {
  const loss = contextFor(operatingInput({ materialCostKrw: 18_000_000 }));
  const healthy = contextFor(operatingInput({
    laborCostKrw: 2_000_000,
    rentKrw: 1_000_000,
    materialCostKrw: 3_000_000,
    advertisingKrw: 0,
    utilitiesAndFeesKrw: 0,
    customCosts: [],
  }));
  try {
    const lossBaseline = await runDynamicExpertCouncil(loss);
    const healthyBaseline = await runDynamicExpertCouncil(healthy);
    const proposals = Object.fromEntries(lossBaseline.opinions.map((opinion) => {
      const proposal = structuredClone(opinion);
      delete proposal.verification;
      return [opinion.expert, proposal];
    }));
    const healthyFinance = structuredClone(healthyBaseline.opinions.find((item) => item.expert === 'FINANCE'));
    delete healthyFinance.verification;
    proposals.FINANCE = healthyFinance;

    const result = await runDynamicExpertCouncil({
      ...loss,
      modelGateway: {
        name: 'risk-suppressor',
        async generate(request) {
          return { requestId: request.requestId, output: proposals[request.role] ?? {} };
        },
      },
    });
    const finance = result.opinions.find((item) => item.expert === 'FINANCE');

    assert.equal(finance.verification.agentState, 'MODEL_REJECTED_FALLBACK');
    assert.ok(finance.claims.some((claim) => claim.code === 'NEGATIVE_CALCULATED_PROFIT'));
    assert.ok(finance.actions.some((action) => action.code === 'ADDRESS_CASH_SHORTFALL'));
  } finally {
    loss.database.close();
    healthy.database.close();
  }
});

test('market uncertainty confidence and detail cannot contradict the deterministic opinion', async () => {
  const context = contextFor(startupInput(), {
    marketState: { status: 'PLANNED_INTEGRATION', confidence: { level: 'LOW' } },
  });
  const baseline = await runDynamicExpertCouncil(context);
  const proposals = Object.fromEntries(baseline.opinions.map((opinion) => {
    const proposal = structuredClone(opinion);
    delete proposal.verification;
    return [opinion.expert, proposal];
  }));
  proposals.MARKET.claims[0].confidence = 'HIGH';
  proposals.MARKET.uncertainty[0].detail = 'Market evidence is complete and requires no review.';
  try {
    const result = await runDynamicExpertCouncil({
      ...context,
      modelGateway: {
        name: 'market-certainty-injector',
        async generate(request) {
          return { requestId: request.requestId, output: proposals[request.role] ?? {} };
        },
      },
    });

    const marketOpinion = result.opinions.find((opinion) => opinion.expert === 'MARKET');
    assert.equal(marketOpinion.verification.agentState, 'MODEL_REJECTED_FALLBACK');
    assert.equal(marketOpinion.claims[0].confidence, 'LOW');
    assert.notEqual(marketOpinion.uncertainty[0].detail, 'Market evidence is complete and requires no review.');
  } finally {
    context.database.close();
  }
});

test('later gateway calls cannot mutate an earlier model-verified specialist opinion', async () => {
  const context = contextFor(startupInput(), {
    marketState: { status: 'PLANNED_INTEGRATION', confidence: { level: 'LOW' } },
  });
  const baseline = await runDynamicExpertCouncil(context);
  const proposals = Object.fromEntries(baseline.opinions.map((opinion) => {
    const proposal = structuredClone(opinion);
    delete proposal.verification;
    return [opinion.expert, proposal];
  }));
  const supervisorProposal = Object.fromEntries(
    ['summary', 'priorityActions', 'conflicts', 'assumptions', 'uncertainty', 'handoff']
      .map((field) => [field, structuredClone(baseline[field])]),
  );
  let retainedMarketProposal;
  try {
    const result = await runDynamicExpertCouncil({
      ...context,
      modelGateway: {
        name: 'deferred-specialist-mutator',
        async generate(request) {
          if (request.role === 'MARKET') retainedMarketProposal = proposals.MARKET;
          if (request.role === 'OPERATIONS') {
            retainedMarketProposal.claims[0].confidence = 'HIGH';
            retainedMarketProposal.uncertainty[0].detail = 'Market evidence is complete and requires no review.';
          }
          return {
            requestId: request.requestId,
            output: request.role === 'SUPERVISOR' ? supervisorProposal : proposals[request.role],
          };
        },
      },
    });
    const marketOpinion = result.opinions.find((opinion) => opinion.expert === 'MARKET');

    assert.equal(marketOpinion.verification.agentState, 'MODEL_VERIFIED');
    assert.equal(marketOpinion.claims[0].confidence, 'LOW');
    assert.notEqual(marketOpinion.uncertainty[0].detail, 'Market evidence is complete and requires no review.');
    for (const ownedValue of [
      marketOpinion,
      marketOpinion.claims,
      marketOpinion.claims[0],
      marketOpinion.uncertainty,
      marketOpinion.uncertainty[0],
      marketOpinion.verification,
    ]) {
      assert.equal(Object.isFrozen(ownedValue), true);
    }
  } finally {
    context.database.close();
  }
});

test('a valid-schema model supervisor cannot delete deterministic conclusions', async () => {
  const context = contextFor(startupInput());
  const baseline = await runDynamicExpertCouncil(context);
  const opinions = Object.fromEntries(baseline.opinions.map((opinion) => {
    const proposal = structuredClone(opinion);
    delete proposal.verification;
    return [opinion.expert, proposal];
  }));
  const supervisorProposal = Object.fromEntries(
    ['summary', 'priorityActions', 'conflicts', 'assumptions', 'uncertainty', 'handoff']
      .map((field) => [field, structuredClone(baseline[field])]),
  );
  supervisorProposal.priorityActions = [];
  supervisorProposal.conflicts = [];
  supervisorProposal.assumptions = [];
  supervisorProposal.uncertainty = [];
  try {
    const result = await runDynamicExpertCouncil({
      ...context,
      modelGateway: {
        name: 'conclusion-suppressor',
        async generate(request) {
          return {
            requestId: request.requestId,
            output: request.role === 'SUPERVISOR' ? supervisorProposal : opinions[request.role],
          };
        },
      },
    });

    assert.equal(result.metadata.agentStates.SUPERVISOR, 'MODEL_REJECTED_FALLBACK');
    assert.deepEqual(result.priorityActions, baseline.priorityActions);
    assert.deepEqual(result.conflicts, baseline.conflicts);
    assert.deepEqual(result.uncertainty, baseline.uncertainty);
  } finally {
    context.database.close();
  }
});

test('a contradictory model supervisor summary cannot replace the deterministic summary', async () => {
  const context = contextFor(startupInput());
  const baseline = await runDynamicExpertCouncil(context);
  const opinions = Object.fromEntries(baseline.opinions.map((opinion) => {
    const proposal = structuredClone(opinion);
    delete proposal.verification;
    return [opinion.expert, proposal];
  }));
  const supervisorProposal = Object.fromEntries(
    ['summary', 'priorityActions', 'conflicts', 'assumptions', 'uncertainty', 'handoff']
      .map((field) => [field, structuredClone(baseline[field])]),
  );
  supervisorProposal.summary = 'No specialist handoff or priority action is needed.';
  try {
    const result = await runDynamicExpertCouncil({
      ...context,
      modelGateway: {
        name: 'summary-contradictor',
        async generate(request) {
          return {
            requestId: request.requestId,
            output: request.role === 'SUPERVISOR' ? supervisorProposal : opinions[request.role],
          };
        },
      },
    });

    assert.equal(result.metadata.agentStates.SUPERVISOR, 'MODEL_REJECTED_FALLBACK');
    assert.equal(result.summary, baseline.summary);
  } finally {
    context.database.close();
  }
});

test('retained model supervisor output cannot mutate the returned council after verification', async () => {
  const context = contextFor(startupInput());
  const baseline = await runDynamicExpertCouncil(context);
  const opinions = Object.fromEntries(baseline.opinions.map((opinion) => {
    const proposal = structuredClone(opinion);
    delete proposal.verification;
    return [opinion.expert, proposal];
  }));
  const supervisorProposal = Object.fromEntries(
    ['summary', 'priorityActions', 'conflicts', 'assumptions', 'uncertainty', 'handoff']
      .map((field) => [field, structuredClone(baseline[field])]),
  );
  try {
    const result = await runDynamicExpertCouncil({
      ...context,
      modelGateway: {
        name: 'retained-supervisor-mutator',
        async generate(request) {
          return {
            requestId: request.requestId,
            output: request.role === 'SUPERVISOR' ? supervisorProposal : opinions[request.role],
          };
        },
      },
    });
    assert.equal(result.metadata.agentStates.SUPERVISOR, 'MODEL_VERIFIED');

    supervisorProposal.priorityActions[0].title = 'Replace the verified action after return.';
    supervisorProposal.conflicts[0].resolution = 'Ignore the verified conflict after return.';

    assert.notEqual(result.priorityActions[0].title, 'Replace the verified action after return.');
    assert.notEqual(result.conflicts[0].resolution, 'Ignore the verified conflict after return.');
    for (const ownedValue of [
      result.priorityActions,
      result.priorityActions[0],
      result.conflicts,
      result.conflicts[0],
      result.handoff,
      result.metadata.agentStates,
    ]) {
      assert.equal(Object.isFrozen(ownedValue), true);
    }
  } finally {
    context.database.close();
  }
});

test('all dynamic role definitions are frozen and expose the required interface', () => {
  for (const definition of [marketAgent, operationsAgent, financeAgent, policyAgent, supervisorAgent]) {
    assert.equal(Object.isFrozen(definition), true);
    assert.deepEqual(Object.keys(definition), [
      'expert', 'promptVersion', 'allowedDomains', 'claimCodes', 'actionCodes', 'buildInput',
    ]);
  }
});
