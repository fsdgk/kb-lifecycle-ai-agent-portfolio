const LARGE_FUNDING_GAP_KRW = 30_000_000;

const SEVERITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const IMMEDIACY_RANK = { IMMEDIATE: 0, BEFORE_COMMITMENT: 1, NEXT_7_DAYS: 2, MONITOR: 3 };
const EXPERT_RANK = { MARKET: 0, OPERATIONS: 1, FINANCE: 2, POLICY: 3 };

function safeIdSegment(value, fallback) {
  const normalized = String(value ?? '').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return normalized || fallback;
}

function marketConfidence(market = {}) {
  return String(
    market.siteConfidence?.level ?? market.confidence?.level ?? market.confidence ?? 'LOW',
  ).toUpperCase();
}

function marketEvidenceRecords(market = {}) {
  if (Array.isArray(market.siteEvidence) && market.siteEvidence.length > 0) {
    return market.siteEvidence.map((item, index) => {
      const siteId = market.siteComparison?.[index]?.siteId ?? item.siteId;
      return {
        id: `evidence.market.site.${index + 1}.${safeIdSegment(siteId, 'unknown')}`,
        source: 'MARKET',
        producerEvidenceId: item.id,
        producerSource: item.source,
        signalId: item.signalId,
        scenarioId: item.scenarioId,
        synthetic: item.synthetic,
        asOf: item.asOf,
        refreshTier: item.refreshTier,
        maxAgeHours: item.maxAgeHours,
        score: item.score,
        disclosure: market.dataDisclosure,
      };
    });
  }

  if (Array.isArray(market.evidence) && market.evidence.length > 0) {
    return market.evidence.map((item, index) => ({
      id: `evidence.market.input.${index + 1}`,
      source: 'MARKET',
      producerEvidenceId: typeof item === 'string' ? item : item.id,
      disclosure: market.dataDisclosure,
    }));
  }

  if (Array.isArray(market.drivers) && market.drivers.length > 0) {
    return market.drivers.map((driver, index) => ({
      id: `evidence.market.driver.${index + 1}`,
      source: 'MARKET',
      producerSource: driver.source,
      metric: driver.metric,
      asOf: driver.asOf,
      disclosure: market.dataDisclosure,
    }));
  }

  return [{ id: 'evidence.market.analysis', source: 'MARKET', status: 'INSUFFICIENT' }];
}

function profileEvidenceRecords(profile = {}) {
  return [{
    id: 'evidence.profile.stage',
    source: 'PROFILE',
    value: profile.stage ?? profile.business?.lifecycleStage ?? 'UNKNOWN',
  }];
}

function financeEvidenceRecords(finance = {}) {
  const records = [];
  if (finance.mode === 'OPERATING_CASHFLOW' && Number.isFinite(finance.forecast?.minimumBalance)) {
    records.push({
      id: 'evidence.finance.cashflow.minimumBalance',
      source: 'FINANCE',
      kind: 'DETERMINISTIC_CASHFLOW_FORECAST',
      value: finance.forecast.minimumBalance,
      unit: 'KRW',
      asOf: finance.asOf,
    });
    return records;
  }
  if (Number.isFinite(finance.fundingGap)) {
    records.push({
      id: 'evidence.finance.fundingGap',
      source: 'FINANCE',
      kind: 'DETERMINISTIC_CALCULATION',
      value: finance.fundingGap,
      unit: 'KRW',
    });
  }
  if (Number.isFinite(finance.recommendedBuffer)) {
    records.push({
      id: 'evidence.finance.recommendedBuffer',
      source: 'FINANCE',
      kind: 'DETERMINISTIC_CALCULATION',
      value: finance.recommendedBuffer,
      unit: 'KRW',
    });
  }
  return records.length > 0
    ? records
    : [{ id: 'evidence.finance.inputs', source: 'FINANCE', status: 'INSUFFICIENT' }];
}

function policyEvidenceRecords(policies = []) {
  if (policies.length === 0) {
    return [{ id: 'evidence.policy.matches', source: 'POLICY', status: 'NO_MATCHES' }];
  }

  return policies.map((policy, index) => {
    const cited = policy.evidence?.[0] ?? {};
    return {
      id: `evidence.policy.match.${index + 1}.${safeIdSegment(policy.policyId, 'unknown')}`,
      source: 'POLICY',
      policyId: policy.policyId,
      eligibility: policy.eligibility,
      officialUrl: policy.officialUrl ?? cited.officialUrl,
      verifiedAt: policy.verifiedAt ?? cited.verifiedAt,
    };
  });
}

const evidenceIds = (records) => records.map((item) => item.id);

export function marketExpert(market = {}) {
  const confidence = marketConfidence(market);
  const marketEvidenceIds = evidenceIds(marketEvidenceRecords(market));
  const preferredSite = market.preferredSite;

  return {
    expert: 'MARKET',
    claims: [{
      code: preferredSite ? 'PREFERRED_SITE_IDENTIFIED' : 'MARKET_OUTLOOK_AVAILABLE',
      statement: preferredSite
        ? `Synthetic comparison currently ranks site ${preferredSite} first; field validation remains required.`
        : 'Available market evidence supports scenario validation, not a certain site outcome.',
    }],
    evidenceIds: marketEvidenceIds,
    assumptions: [{
      code: 'MARKET_INPUTS_REMAIN_RELEVANT',
      detail: 'The dated synthetic inputs are assumed to remain relevant until field validation.',
    }],
    uncertainty: confidence === 'HIGH'
      ? []
      : [{
        code: `MARKET_CONFIDENCE_${confidence}`,
        detail: 'The site comparison does not establish a certain market outcome.',
      }],
    actions: [{
      code: 'VALIDATE_PREFERRED_SITE',
      title: preferredSite ? `Validate site ${preferredSite} in the field` : 'Validate market scenarios',
      severity: confidence === 'LOW' ? 'HIGH' : 'MEDIUM',
      immediacy: 'NEXT_7_DAYS',
      expert: 'MARKET',
      evidenceIds: marketEvidenceIds,
    }],
    escalation: confidence === 'LOW',
  };
}

export function operationsExpert(profile = {}, market = {}) {
  const stage = profile.stage ?? profile.business?.lifecycleStage ?? 'UNKNOWN';
  const operationsEvidenceIds = [
    ...evidenceIds(profileEvidenceRecords(profile)),
    ...evidenceIds(marketEvidenceRecords(market)),
  ];

  const operating = stage === 'OPERATING';
  const crisis = stage === 'CRISIS';
  return {
    expert: 'OPERATIONS',
    claims: [{
      code: crisis ? 'CRISIS_OPERATIONS_REVIEW_REQUIRED' : operating ? 'OPERATING_PERFORMANCE_REVIEW_REQUIRED' : 'OPERATING_READINESS_NOT_PROVEN',
      statement: crisis
        ? 'A reported crisis stage requires immediate operating stabilisation review.'
        : operating
          ? 'Operating performance requires review of sales, costs, and cashflow inputs.'
          : 'Site preference and operating readiness require separate verification.',
    }],
    evidenceIds: operationsEvidenceIds,
    assumptions: [{
      code: 'LIFECYCLE_STAGE_REPORTED',
      detail: `The reported lifecycle stage is ${stage}.`,
    }],
    uncertainty: [{
      code: crisis ? 'CRISIS_OPERATING_INPUTS_INCOMPLETE' : operating ? 'OPERATING_INPUTS_INCOMPLETE' : 'OPERATING_INPUTS_INCOMPLETE',
      detail: crisis
        ? 'The available inputs do not establish the cause or duration of the crisis.'
        : operating
          ? 'Staffing, supply, and operating-cost timing are not established by the provided inputs.'
          : 'Staffing, supply, and permit timing are not established by the provided inputs.',
    }],
    actions: [{
      code: crisis ? 'STABILIZE_OPERATIONS' : operating ? 'REVIEW_OPERATING_PERFORMANCE' : 'CHECK_OPERATING_READINESS',
      title: crisis ? 'Stabilize immediate operating risks' : operating ? 'Review sales, costs, and cashflow' : 'Check staffing, supply, and permit readiness',
      severity: crisis ? 'HIGH' : 'MEDIUM',
      immediacy: crisis ? 'IMMEDIATE' : operating ? 'NEXT_7_DAYS' : 'BEFORE_COMMITMENT',
      expert: 'OPERATIONS',
      evidenceIds: operationsEvidenceIds,
    }],
    escalation: crisis,
  };
}

export function financeExpert(finance = {}) {
  if (finance.mode === 'OPERATING_CASHFLOW' && Number.isFinite(finance.forecast?.minimumBalance)) {
    const hasShortfall = Boolean(finance.forecast.shortfallDate);
    const financeEvidenceIds = evidenceIds(financeEvidenceRecords(finance));
    return {
      expert: 'FINANCE',
      claims: [{
        code: 'OPERATING_CASHFLOW_FORECAST_AVAILABLE',
        statement: `A deterministic 28-day cashflow forecast reaches a minimum balance of KRW ${finance.forecast.minimumBalance.toLocaleString('ko-KR')}.`,
      }],
      evidenceIds: financeEvidenceIds,
      assumptions: [{ code: 'OPERATING_SALES_OBSERVATION_USED', detail: 'The synthetic monthly sales observation is placed at the first forecast day; operating costs are not provided.' }],
      uncertainty: hasShortfall ? [] : [{ code: 'OPERATING_COSTS_NOT_PROVIDED', detail: 'The projection does not establish future operating costs.' }],
      actions: [{
        code: hasShortfall ? 'ADDRESS_CASH_SHORTFALL' : 'MONITOR_OPERATING_CASHFLOW',
        title: hasShortfall ? 'Address the forecast cash shortfall' : 'Monitor sales, costs, and cashflow',
        severity: hasShortfall ? 'HIGH' : 'MEDIUM',
        immediacy: hasShortfall ? 'IMMEDIATE' : 'NEXT_7_DAYS',
        expert: 'FINANCE',
        evidenceIds: financeEvidenceIds,
      }],
      escalation: hasShortfall,
    };
  }
  const hasFundingGap = Number.isFinite(finance.fundingGap);
  const fundingGap = hasFundingGap ? finance.fundingGap : null;
  const largeGap = hasFundingGap && fundingGap >= LARGE_FUNDING_GAP_KRW;
  const financeEvidenceIds = evidenceIds(financeEvidenceRecords(finance));
  const actions = !hasFundingGap
    ? []
    : [{
      code: fundingGap > 0 ? 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT' : 'RESERVE_RECOMMENDED_BUFFER',
      title: fundingGap > 0 ? 'Confirm funding plan before commitment' : 'Reserve the recommended buffer',
      severity: largeGap ? 'HIGH' : 'MEDIUM',
      immediacy: fundingGap > 0 ? 'BEFORE_COMMITMENT' : 'NEXT_7_DAYS',
      expert: 'FINANCE',
      evidenceIds: financeEvidenceIds,
    }];

  return {
    expert: 'FINANCE',
    claims: [{
      code: !hasFundingGap
        ? 'FINANCE_EVIDENCE_INSUFFICIENT'
        : fundingGap > 0 ? 'FUNDING_GAP_EXISTS' : 'NO_FUNDING_GAP_IDENTIFIED',
      statement: !hasFundingGap
        ? 'The provided evidence is insufficient to determine a funding gap.'
        : `Deterministic arithmetic identifies a funding gap of KRW ${fundingGap.toLocaleString('ko-KR')}.`,
    }],
    evidenceIds: financeEvidenceIds,
    assumptions: hasFundingGap
      ? [{
        code: 'FINANCE_INPUTS_COMPLETE',
        detail: 'The inputs used for the deterministic funding calculation are assumed current.',
      }]
      : [],
    uncertainty: hasFundingGap
      ? []
      : [{ code: 'FUNDING_GAP_UNKNOWN', detail: 'No finite funding gap was provided.' }],
    actions,
    escalation: largeGap,
  };
}

export function policyExpert(policies = []) {
  const policyEvidenceIds = evidenceIds(policyEvidenceRecords(policies));
  const checkRequired = policies.some((policy) => policy.eligibility === 'CHECK_REQUIRED');

  return {
    expert: 'POLICY',
    claims: [{
      code: checkRequired ? 'ELIGIBILITY_CHECK_REQUIRED' : 'POLICY_MATCHES_NOT_APPROVALS',
      statement: checkRequired
        ? 'A policy candidate exists, but eligibility must be verified before any approval claim.'
        : 'Policy search results do not establish approval or receipt of support.',
    }],
    evidenceIds: policyEvidenceIds,
    assumptions: [{
      code: 'OFFICIAL_SOURCE_CONTROLS',
      detail: 'The linked official notice controls final eligibility and timing.',
    }],
    uncertainty: checkRequired
      ? [{ code: 'POLICY_ELIGIBILITY_CHECK_REQUIRED', detail: 'Required eligibility checks remain.' }]
      : [],
    actions: [{
      code: checkRequired ? 'VERIFY_POLICY_ELIGIBILITY' : 'REVIEW_POLICY_MATCHES',
      title: checkRequired ? 'Verify eligibility in the official notice' : 'Review official policy notices',
      severity: checkRequired ? 'HIGH' : 'LOW',
      immediacy: checkRequired ? 'BEFORE_COMMITMENT' : 'MONITOR',
      expert: 'POLICY',
      evidenceIds: policyEvidenceIds,
    }],
    escalation: checkRequired,
  };
}

function priorityActions(opinions) {
  return opinions
    .flatMap((opinion) => opinion.actions)
    .sort((left, right) => (
      (SEVERITY_RANK[left.severity] ?? Number.MAX_SAFE_INTEGER)
        - (SEVERITY_RANK[right.severity] ?? Number.MAX_SAFE_INTEGER)
      || (IMMEDIACY_RANK[left.immediacy] ?? Number.MAX_SAFE_INTEGER)
        - (IMMEDIACY_RANK[right.immediacy] ?? Number.MAX_SAFE_INTEGER)
      || (EXPERT_RANK[left.expert] ?? Number.MAX_SAFE_INTEGER)
        - (EXPERT_RANK[right.expert] ?? Number.MAX_SAFE_INTEGER)
    ))
    .slice(0, 3);
}

function visibleConflicts({ finance = {}, market = {}, policies = [] }) {
  const conflicts = [];
  const marketIds = evidenceIds(marketEvidenceRecords(market));

  if (market.preferredSite && Number.isFinite(finance.fundingGap) && finance.fundingGap > 0) {
    conflicts.push({
      code: 'SITE_COMMITMENT_VS_FUNDING_GAP',
      experts: ['MARKET', 'FINANCE'],
      actions: ['VALIDATE_PREFERRED_SITE', 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT'],
      evidenceIds: [...marketIds, 'evidence.finance.fundingGap'],
      detail: 'Site validation can proceed, while financial evidence requires commitment to wait for a funding plan.',
    });
  }

  if (market.preferredSite && policies.some((policy) => policy.eligibility === 'CHECK_REQUIRED')) {
    conflicts.push({
      code: 'SITE_TIMING_VS_POLICY_VERIFICATION',
      experts: ['MARKET', 'POLICY'],
      actions: ['VALIDATE_PREFERRED_SITE', 'VERIFY_POLICY_ELIGIBILITY'],
      evidenceIds: [...marketIds, ...evidenceIds(policyEvidenceRecords(policies))],
      detail: 'Site validation can proceed, but commitment cannot assume policy eligibility before verification.',
    });
  }

  return conflicts;
}

function taggedItems(opinions, field) {
  return opinions.flatMap((opinion) => (
    opinion[field].map((item) => ({ expert: opinion.expert, ...item }))
  ));
}

function summarize(conflicts) {
  if (conflicts.length === 0) {
    return 'No cross-expert conflict is identified from the supplied evidence; unresolved uncertainty remains visible.';
  }
  return `Conflicts requiring resolution: ${conflicts.map((item) => item.code).join(', ')}.`;
}

function buildEvidence({ profile = {}, finance = {}, market = {}, policies = [] }) {
  return [
    ...marketEvidenceRecords(market),
    ...profileEvidenceRecords(profile),
    ...financeEvidenceRecords(finance),
    ...policyEvidenceRecords(policies),
  ];
}

export function runStoredDemoCouncil({ profile = {}, finance = {}, market = {}, policies = [] } = {}) {
  const opinions = [
    marketExpert(market),
    operationsExpert(profile, market),
    financeExpert(finance),
    policyExpert(policies),
  ];
  const conflicts = visibleConflicts({ finance, market, policies });
  const fundingHandoff = Number.isFinite(finance.fundingGap)
    && finance.fundingGap >= LARGE_FUNDING_GAP_KRW;
  const policyHandoff = policies.some((policy) => policy.eligibility === 'CHECK_REQUIRED');

  return {
    summary: summarize(conflicts),
    priorityActions: priorityActions(opinions),
    opinions,
    conflicts,
    evidence: buildEvidence({ profile, finance, market, policies }),
    assumptions: taggedItems(opinions, 'assumptions'),
    uncertainty: taggedItems(opinions, 'uncertainty'),
    handoffRecommended: fundingHandoff || policyHandoff || opinions.some((opinion) => opinion.escalation),
  };
}
