import { isDeepStrictEqual } from 'node:util';
import { validateSupervisorProposal } from '../agents/agent-schema.mjs';
import { marketAgent } from '../agents/market-agent.mjs';
import { operationsAgent } from '../agents/operations-agent.mjs';
import { financeAgent } from '../agents/finance-agent.mjs';
import { policyAgent } from '../agents/policy-agent.mjs';
import { supervisorAgent } from '../agents/supervisor-agent.mjs';
import { buildDynamicEvidenceRegistry } from './evidence-registry.mjs';
import { deepFreeze } from './deep-freeze.mjs';
import {
  buildTrustedDynamicExpertOpinion,
  verifyDynamicExpertOpinion,
} from './opinion-verifier.mjs';

const AGENTS = Object.freeze([marketAgent, operationsAgent, financeAgent, policyAgent]);
const PRIORITY_ORDER = Object.freeze([
  'ADDRESS_CASH_SHORTFALL',
  'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT',
  'VERIFY_POLICY_ELIGIBILITY',
  'STABILIZE_OPERATIONS',
  'CHECK_OPERATING_READINESS',
  'REFRESH_MARKET_DATA',
  'REVIEW_OPERATING_PERFORMANCE',
  'RESERVE_RECOMMENDED_BUFFER',
  'REVIEW_POLICY_MATCHES',
  'CHECK_OFFICIAL_NOTICE',
  'MONITOR_OPERATING_CASHFLOW',
  'REQUEST_FINANCE_COUNSEL',
]);

const ownedImmutableCopy = (value) => deepFreeze(structuredClone(value));

function evidenceMap(registry) {
  return new Map(registry.evidence.map((item) => [item.id, item]));
}

function selectCodes(expert, registry) {
  const byId = evidenceMap(registry);
  const stage = registry.stage;
  if (expert === 'MARKET') {
    const uncertain = registry.marketStatus !== 'CURRENT' || registry.marketConfidence !== 'HIGH';
    return {
      claimCodes: [uncertain ? 'MARKET_DATA_UNCERTAIN' : 'MARKET_DATA_AVAILABLE'],
      actionCodes: uncertain ? ['REFRESH_MARKET_DATA'] : [],
      uncertainty: uncertain ? [{
        code: registry.marketStatus === 'PLANNED_INTEGRATION'
          ? 'MARKET_DATA_PLANNED_INTEGRATION'
          : 'MARKET_CONFIDENCE_LIMITED',
        detail: 'Market evidence remains incomplete for a confident decision.',
        evidenceIds: ['market.provider-status', 'market.confidence'],
      }] : [],
      escalation: uncertain,
    };
  }
  if (expert === 'OPERATIONS' && stage === 'STARTUP') {
    const warnings = byId.get('operations.startup.analysis-status').value.warningCodes;
    return {
      claimCodes: [warnings.includes('DECLARED_BUDGET_MISMATCH')
        ? 'STARTUP_BUDGET_MISMATCH'
        : 'STARTUP_COST_PLAN_RECONCILED'],
      actionCodes: ['CHECK_OPERATING_READINESS'],
      uncertainty: [],
      escalation: false,
    };
  }
  if (expert === 'OPERATIONS') {
    const warnings = byId.get('operations.operating.analysis-status').value.warningCodes;
    const claims = [];
    if (warnings.includes('DECLARED_PROFIT_MISMATCH')) claims.push('DECLARED_PROFIT_MISMATCH');
    for (const [code, id] of [
      ['LABOR_RATIO_HIGH', 'operations.operating.benchmark.labor'],
      ['RENT_RATIO_HIGH', 'operations.operating.benchmark.rent'],
      ['MATERIAL_RATIO_HIGH', 'operations.operating.benchmark.materials-purchases'],
      ['OTHER_CUSTOM_RATIO_HIGH', 'operations.operating.benchmark.other-custom-costs'],
    ]) {
      if (byId.get(id)?.value?.status === 'HIGH') claims.push(code);
    }
    if (warnings.includes('ZERO_SALES_REVIEW')) claims.push('ZERO_SALES_REVIEW');
    if (claims.length === 0) claims.push('OPERATING_COSTS_REQUIRE_REVIEW');
    const urgent = warnings.includes('NEGATIVE_CALCULATED_PROFIT') || warnings.includes('ZERO_SALES_REVIEW');
    return {
      claimCodes: claims,
      actionCodes: [urgent ? 'STABILIZE_OPERATIONS' : 'REVIEW_OPERATING_PERFORMANCE'],
      uncertainty: [],
      escalation: urgent,
    };
  }
  if (expert === 'FINANCE' && stage === 'STARTUP') {
    const gapStatus = byId.get('finance.startup.funding-gap').value.status;
    const bufferStatus = byId.get('finance.startup.recommended-buffer').value.status;
    const hasGap = ['PRESENT', 'LARGE'].includes(gapStatus);
    const hasBuffer = bufferStatus === 'RECOMMENDED';
    return {
      claimCodes: [hasGap ? 'FUNDING_GAP_EXISTS' : 'STARTUP_CAPITAL_COVERS_COSTS', ...(hasBuffer ? ['BUFFER_RECOMMENDED'] : [])],
      actionCodes: [...(hasGap ? ['CLOSE_FUNDING_GAP_BEFORE_COMMITMENT'] : []), ...(hasBuffer ? ['RESERVE_RECOMMENDED_BUFFER'] : [])],
      uncertainty: [],
      escalation: gapStatus === 'LARGE',
    };
  }
  if (expert === 'FINANCE') {
    const salesStatus = byId.get('finance.operating.sales').value.status;
    const resultStatus = byId.get('finance.operating.calculated-result').value.status;
    const isLoss = resultStatus === 'LOSS';
    const zeroSales = salesStatus === 'ZERO';
    const claims = [isLoss ? 'NEGATIVE_CALCULATED_PROFIT' : 'OPERATING_RESULT_AVAILABLE'];
    if (zeroSales) claims.push('ZERO_SALES_FINANCE_RISK');
    return {
      claimCodes: claims,
      actionCodes: [isLoss ? 'ADDRESS_CASH_SHORTFALL' : 'MONITOR_OPERATING_CASHFLOW'],
      uncertainty: zeroSales ? [{
        code: 'OPERATING_MARGIN_NOT_APPLICABLE',
        detail: 'Operating margin is not applicable while sales are zero.',
        evidenceIds: ['finance.operating.sales'],
      }] : [],
      escalation: isLoss || zeroSales,
    };
  }
  const matchStatus = byId.get('policy.match-status').value;
  if (matchStatus.status === 'NO_MATCH') {
    return {
      claimCodes: ['POLICY_NO_MATCH'],
      actionCodes: [],
      uncertainty: [{
        code: 'NO_CURRENT_POLICY_MATCH',
        detail: 'No current candidate is available from the official policy query.',
        evidenceIds: ['policy.match-status'],
      }],
      escalation: false,
    };
  }
  const requiresCheck = matchStatus.eligibility === 'CHECK_REQUIRED';
  return {
    claimCodes: [requiresCheck ? 'POLICY_MATCH_REQUIRES_VERIFICATION' : 'POLICY_MATCH_FOUND'],
    actionCodes: [requiresCheck ? 'VERIFY_POLICY_ELIGIBILITY' : 'REVIEW_POLICY_MATCHES'],
    uncertainty: requiresCheck ? [{
      code: 'POLICY_ELIGIBILITY_CHECK_REQUIRED',
      detail: 'Eligibility remains subject to the official notice and required checks.',
      evidenceIds: ['policy.match-status'],
    }] : [],
    escalation: requiresCheck,
  };
}

function deterministicOpinion(agent, registry) {
  return ownedImmutableCopy(buildTrustedDynamicExpertOpinion({
    registry,
    expert: agent.expert,
    ...selectCodes(agent.expert, registry),
  }));
}

async function runExpertAgent(agent, registry, modelGateway) {
  const fallback = deterministicOpinion(agent, registry);
  if (modelGateway == null) {
    return { opinion: fallback, state: 'DETERMINISTIC_TRUSTED_TEMPLATE' };
  }
  try {
    const requestId = `dynamic-${registry.stage.toLowerCase()}-${agent.expert.toLowerCase()}`;
    const response = await modelGateway.generate({
      requestId,
      role: agent.expert,
      prompt: agent.buildInput({ registry }),
    });
    if (response?.requestId !== requestId || response.output == null || typeof response.output !== 'object') {
      throw new TypeError('model gateway response does not match the request');
    }
    const verified = verifyDynamicExpertOpinion({ proposal: response.output, registry, expectedExpert: agent.expert });
    if (!isDeepStrictEqual(verified, fallback)) {
      throw new TypeError('model proposal must preserve the full deterministic opinion');
    }
    return {
      opinion: ownedImmutableCopy(verified),
      state: 'MODEL_VERIFIED',
    };
  } catch {
    return { opinion: fallback, state: 'MODEL_REJECTED_FALLBACK' };
  }
}

function collectUncertainty(opinions) {
  const seen = new Set();
  return opinions.flatMap((opinion) => opinion.uncertainty).filter((item) => {
    if (seen.has(item.code)) return false;
    seen.add(item.code);
    return true;
  });
}

function priorityActions(opinions) {
  const rank = new Map(PRIORITY_ORDER.map((code, index) => [code, index]));
  const unique = new Map();
  for (const action of opinions.flatMap((opinion) => opinion.actions)) {
    if (!unique.has(action.code)) unique.set(action.code, action);
  }
  return [...unique.values()]
    .sort((left, right) => (rank.get(left.code) ?? 999) - (rank.get(right.code) ?? 999))
    .slice(0, 3);
}

function conflictsFor(registry, opinions) {
  const byId = evidenceMap(registry);
  const actionCodes = new Set(opinions.flatMap((opinion) => opinion.actions.map((action) => action.code)));
  const conflicts = [];
  if (['PRESENT', 'LARGE'].includes(byId.get('finance.startup.funding-gap')?.value?.status)
    && byId.get('policy.match-status')?.value?.eligibility === 'CHECK_REQUIRED') {
    conflicts.push({
      code: 'FUNDING_PLAN_VS_POLICY_VERIFICATION',
      experts: ['FINANCE', 'POLICY'],
      actionCodes: ['CLOSE_FUNDING_GAP_BEFORE_COMMITMENT', 'VERIFY_POLICY_ELIGIBILITY']
        .filter((code) => actionCodes.has(code)),
      evidenceIds: ['finance.startup.funding-gap', 'policy.match-status'],
      resolution: 'Keep the funding plan conditional until policy eligibility is verified.',
    });
  }
  if (byId.get('operations.operating.analysis-status')?.value?.warningCodes?.includes('DECLARED_PROFIT_MISMATCH')) {
    conflicts.push({
      code: 'DECLARED_VS_CALCULATED_OPERATING_RESULT',
      experts: ['OPERATIONS', 'FINANCE'],
      actionCodes: opinions.flatMap((opinion) => opinion.actions.map((action) => action.code))
        .filter((code) => ['STABILIZE_OPERATIONS', 'REVIEW_OPERATING_PERFORMANCE', 'ADDRESS_CASH_SHORTFALL', 'MONITOR_OPERATING_CASHFLOW'].includes(code)),
      evidenceIds: ['operations.operating.analysis-status', 'finance.operating.declared-difference'],
      resolution: 'Use the deterministic calculation while the declaration is reconciled.',
    });
  }
  return conflicts;
}

function handoffFor({ input, registry, consultationRequested }) {
  const byId = evidenceMap(registry);
  const reasons = [];
  const fundingGapStatus = byId.get('finance.startup.funding-gap')?.value?.status;
  const calculatedStatus = byId.get('finance.operating.calculated-result')?.value?.status;
  const salesStatus = byId.get('finance.operating.sales')?.value?.status;
  const purpose = input[input.path === 'STARTUP' ? 'startup' : 'operating']?.fundingPurpose;
  if (fundingGapStatus === 'LARGE') reasons.push('LARGE_FUNDING_GAP');
  if (byId.get('policy.match-status')?.value?.eligibility === 'CHECK_REQUIRED') reasons.push('POLICY_CHECK_REQUIRED');
  if (registry.marketStatus !== 'CURRENT' || registry.marketConfidence === 'LOW') reasons.push('LOW_OR_INCOMPLETE_MARKET_DATA');
  if (purpose === 'LOAN_EXECUTION') reasons.push('LOAN_EXECUTION_PURPOSE');
  if (consultationRequested === true) reasons.push('CONSULTATION_REQUESTED');
  if (calculatedStatus === 'LOSS') reasons.push('OPERATING_LOSS');
  if (salesStatus === 'ZERO') reasons.push('ZERO_SALES_CASH_RISK');
  return { recommended: reasons.length > 0, reasons };
}

function deterministicSupervisor({ registry, opinions, handoff }) {
  const proposal = {
    summary: handoff.recommended
      ? 'Verified evidence indicates that specialist handoff should accompany the priority actions.'
      : 'Verified evidence supports the selected priority actions without mandatory specialist handoff.',
    priorityActions: priorityActions(opinions),
    conflicts: conflictsFor(registry, opinions),
    assumptions: [{
      code: 'PROTOTYPE_REFERENCE_RANGES',
      detail: 'Cost benchmarks are disclosed prototype reference ranges rather than official averages.',
    }],
    uncertainty: collectUncertainty(opinions),
    handoff,
  };
  return ownedImmutableCopy(validateSupervisorProposal(
    proposal,
    registry.evidence.map((item) => item.id),
    opinions.flatMap((opinion) => opinion.actions.map((action) => action.code)),
  ));
}

function verifySupervisorProposal(proposal, registry, opinions, fallback) {
  const allowedActions = opinions.flatMap((opinion) => opinion.actions);
  const verified = validateSupervisorProposal(
    proposal,
    registry.evidence.map((item) => item.id),
    allowedActions.map((action) => action.code),
  );
  for (const action of verified.priorityActions) {
    if (!allowedActions.some((allowed) => (
      allowed.code === action.code
      && allowed.title === action.title
      && JSON.stringify(allowed.evidenceIds) === JSON.stringify(action.evidenceIds)
    ))) {
      throw new TypeError('supervisor action must equal a verified specialist action');
    }
  }
  if (!isDeepStrictEqual(verified, fallback)) {
    throw new TypeError('supervisor must preserve the full deterministic proposal');
  }
  return ownedImmutableCopy(verified);
}

async function runSupervisor(registry, opinions, handoff, modelGateway) {
  const fallback = deterministicSupervisor({ registry, opinions, handoff });
  if (modelGateway == null) return { proposal: fallback, state: 'DETERMINISTIC_TRUSTED_TEMPLATE' };
  try {
    const requestId = `dynamic-${registry.stage.toLowerCase()}-supervisor`;
    const response = await modelGateway.generate({
      requestId,
      role: 'SUPERVISOR',
      prompt: supervisorAgent.buildInput({ verifiedOpinions: opinions, evidence: registry.evidence }),
    });
    if (response?.requestId !== requestId || response.output == null || typeof response.output !== 'object') {
      throw new TypeError('model gateway response does not match the request');
    }
    return { proposal: verifySupervisorProposal(response.output, registry, opinions, fallback), state: 'MODEL_VERIFIED' };
  } catch {
    return { proposal: fallback, state: 'MODEL_REJECTED_FALLBACK' };
  }
}

export async function runDynamicExpertCouncil({
  input,
  analysis,
  market,
  policyResult,
  modelGateway,
  consultationRequested = false,
}) {
  if (modelGateway != null && (typeof modelGateway !== 'object' || typeof modelGateway.generate !== 'function')) {
    throw new TypeError('modelGateway must implement generate(request)');
  }
  if (typeof consultationRequested !== 'boolean') throw new TypeError('consultationRequested must be a boolean');
  const registry = buildDynamicEvidenceRegistry({ input, analysis, market, policyResult });
  const runs = [];
  for (const agent of AGENTS) runs.push(await runExpertAgent(agent, registry, modelGateway));
  const opinions = ownedImmutableCopy(runs.map(({ opinion, state }) => ({
    ...structuredClone(opinion),
    verification: { verified: true, agentState: state },
  })));
  const handoff = handoffFor({ input, registry, consultationRequested });
  const supervisor = await runSupervisor(registry, opinions, handoff, modelGateway);

  return {
    ...supervisor.proposal,
    opinions,
    evidence: structuredClone(registry.evidence),
    policyMatches: structuredClone(policyResult.authority.policies),
    metadata: {
      generator: 'DETERMINISTIC_TRUSTED_TEMPLATES',
      stage: registry.stage,
      promptVersions: { expert: marketAgent.promptVersion, supervisor: supervisorAgent.promptVersion },
      marketStatus: registry.marketStatus,
      marketConfidence: registry.marketConfidence,
      agentStates: ownedImmutableCopy({
        ...Object.fromEntries(runs.map((run, index) => [AGENTS[index].expert, run.state])),
        SUPERVISOR: supervisor.state,
      }),
    },
  };
}
