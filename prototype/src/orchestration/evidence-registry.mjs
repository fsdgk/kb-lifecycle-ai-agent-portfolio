import { calculateStartupFunding, forecastCashflow } from '../domain/finance-engine.mjs';
import { analyzeMarket } from '../domain/market-engine.mjs';
import { analyzeOperatingInput, analyzeStartupInput } from '../domain/business-analysis.mjs';
import { loadIndustryBenchmark } from '../domain/business-input.mjs';
import {
  resolveMatcherPolicyLifecycleDescriptor,
  resolveMatcherQueryDescriptor,
} from './policy-matcher.mjs';
import officialSources from '../../database/sources.json' with { type: 'json' };
import { deepFreeze } from './deep-freeze.mjs';

const STAGES = new Set(['PRE_START', 'OPERATING_CRISIS', 'STARTUP', 'OPERATING']);
const EXPERT_DOMAINS = Object.freeze({
  MARKET: new Set(['CONTEXT', 'MARKET']),
  OPERATIONS: new Set(['CONTEXT', 'OPERATIONS', 'MARKET']),
  FINANCE: new Set(['CONTEXT', 'FINANCE']),
  POLICY: new Set(['CONTEXT', 'FINANCE', 'POLICY']),
});
const OPERATION_FIELDS = Object.freeze([
  'leaseCommitmentStatus',
  'foodServicePermitStatus',
  'supplierResilienceStatus',
  'menuCostingStatus',
]);
const SENSITIVE_TEXT = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?82[-\s]?)?0?1[016789][-\s]?\d{3,4}[-\s]?\d{4}|\b\d{6}[-\s]?[1-4]\d{6}\b|\b\d{2,4}[-\s]\d{2,6}[-\s]\d{4,8}\b)/iu;
const POLICY_AUTHORITY_INSTANCES = new WeakSet();
const POLICY_AUTHORITY_QUERY_CONTEXTS = new WeakMap();
const POLICY_AUTHORITY_CANONICAL_POLICIES = new WeakMap();
const OFFICIAL_POLICY_URLS = new Set(officialSources.map((source) => new URL(source.officialUrl).href));
const POLICY_LIFECYCLE_BY_AUTHORITY_STAGE = Object.freeze({
  PRE_START: 'PRE_START',
  STARTUP: 'PRE_START',
  OPERATING_CRISIS: 'CRISIS',
  OPERATING: 'EARLY_OPERATION',
});
const LARGE_FUNDING_GAP_KRW = 30_000_000;

function assertRecord(value, fieldName) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
}

function assertExactKeys(value, allowed, fieldName) {
  assertRecord(value, fieldName);
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new TypeError(`${fieldName} must contain only approved fields; found ${unknown}`);
  const missing = allowed.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new TypeError(`${fieldName} is missing approved field ${missing}`);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function policyLifecycleStage(stage) {
  return POLICY_LIFECYCLE_BY_AUTHORITY_STAGE[stage];
}

function lifecycleStageForAuthority(stage, requestedStage, lifecycleDescriptor) {
  const standardLifecycleStage = policyLifecycleStage(stage);
  if (!standardLifecycleStage) throw new TypeError('policy stage is not an allowed authority stage');

  if (lifecycleDescriptor == null) {
    if (requestedStage != null && requestedStage !== standardLifecycleStage) {
      throw new TypeError('policy lifecycle stage does not match the authority stage');
    }
    return standardLifecycleStage;
  }
  if (requestedStage != null) {
    throw new TypeError('matcher lifecycle proof cannot be combined with a caller lifecycle stage');
  }
  const context = resolveMatcherPolicyLifecycleDescriptor(lifecycleDescriptor);
  if (!context) {
    throw new TypeError('crisis policy lifecycle requires matcher-issued proof');
  }

  if (stage !== 'OPERATING'
    || context.path !== 'OPERATING'
    || context.stage !== 'OPERATING'
    || context.fundingPurpose !== 'RECOVERY'
    || context.authorityStage !== 'OPERATING'
    || context.policyLifecycleStage !== 'CRISIS'
    || context.derivedLifecycleReason !== 'FUNDING_PURPOSE_RECOVERY') {
    throw new TypeError('matcher lifecycle proof does not authorize the requested stage');
  }
  return 'CRISIS';
}

const isStartupStage = (stage) => stage === 'PRE_START' || stage === 'STARTUP';

function canonicalPolicyFromDatabase(database, policyId) {
  const row = database.prepare(`
    SELECT
      p.policy_id AS policyId, p.title, p.organization AS institution, p.official_url AS officialUrl,
      p.region_code AS regionCode, p.lifecycle_stages AS lifecycleStages, p.support_types AS supportTypes,
      p.status, p.application_start AS applicationStart, p.application_end AS applicationEnd,
      p.verified_at AS verifiedAt, p.current_version_id AS versionId,
      v.source_hash AS sourceHash,
      (SELECT COUNT(*) FROM eligibility_rules r WHERE r.policy_id = p.policy_id) AS ruleCount
    FROM policies p
    JOIN policy_versions v ON v.version_id = p.current_version_id
    WHERE p.policy_id = ?
  `).get(policyId);
  if (!row) throw new TypeError(`policy ${String(policyId)} is not present in the policy database`);
  const requiredChecks = database.prepare(`
    SELECT evidence_text AS evidenceText
    FROM eligibility_rules WHERE policy_id = ? ORDER BY rule_id
  `).all(policyId).map((rule) => rule.evidenceText);
  return {
    ...row,
    lifecycleStages: JSON.parse(row.lifecycleStages),
    supportTypes: JSON.parse(row.supportTypes),
    eligibility: 'CHECK_REQUIRED',
    requiredChecks,
  };
}

function assertPolicyContext(policy, { regionCode, lifecycleStage, now, freshnessDays }) {
  if (!OFFICIAL_POLICY_URLS.has(new URL(policy.officialUrl).href)) {
    throw new TypeError('policy official URL is absent from the checked-in source allowlist');
  }
  if (policy.regionCode !== 'NATIONAL' && policy.regionCode !== regionCode) {
    throw new TypeError('policy region does not match the requested region');
  }
  if (!policy.lifecycleStages.includes(lifecycleStage)) {
    throw new TypeError('policy stage does not match the requested lifecycle stage');
  }
  const date = now.toISOString().slice(0, 10);
  if (policy.applicationStart && policy.applicationStart > date) throw new TypeError('policy application period has not started');
  if (policy.applicationEnd && policy.applicationEnd < date) throw new TypeError('policy application period has ended');
  if (!['ACTIVE', 'CHECK_REQUIRED', 'UPCOMING'].includes(policy.status)) {
    throw new TypeError('policy status is not eligible for evidence');
  }
  const threshold = new Date(now.getTime() - freshnessDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (policy.verifiedAt < threshold) throw new TypeError('policy verified date is outside the freshness window');
}

function assertPolicyMatchEqualsCanonical(match, canonical) {
  for (const field of ['policyId', 'title', 'institution', 'officialUrl', 'versionId', 'sourceHash', 'status', 'eligibility', 'verifiedAt', 'regionCode']) {
    if (match[field] !== canonical[field]) {
      throw new TypeError(`policy ${field} does not match the policy database`);
    }
  }
  if (!sameValue(match.requiredChecks, canonical.requiredChecks)) {
    throw new TypeError('policy requiredChecks do not match the policy database');
  }
}

export function createSqlitePolicyEvidenceAuthority({
  database,
  policies,
  regionCode,
  stage,
  policyLifecycleStage: requestedPolicyStage,
  lifecycleDescriptor,
  queryDescriptor,
  now = new Date(),
  freshnessDays = 30,
}) {
  if (!database?.prepare) throw new TypeError('policy database is required');
  if (!Array.isArray(policies)) throw new TypeError('policies must be an array');
  if (typeof regionCode !== 'string' || !regionCode) throw new TypeError('policy region is required');
  if (typeof stage !== 'string' || !stage) throw new TypeError('policy stage is required');
  if (requestedPolicyStage != null && (typeof requestedPolicyStage !== 'string' || !requestedPolicyStage)) {
    throw new TypeError('policy lifecycle stage must be a non-empty string');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('policy verification time must be valid');
  if (!Number.isInteger(freshnessDays) || freshnessDays < 0) throw new TypeError('freshnessDays must be a non-negative integer');
  const policyStage = lifecycleStageForAuthority(stage, requestedPolicyStage, lifecycleDescriptor);
  const matcherQuery = queryDescriptor == null ? null : resolveMatcherQueryDescriptor(queryDescriptor);
  if (queryDescriptor != null && matcherQuery == null) {
    throw new TypeError('policy query context requires a matcher-issued descriptor');
  }

  const canonicalPolicies = policies.map((match) => {
    assertRecord(match, 'policy match');
    const canonical = canonicalPolicyFromDatabase(database, match.policyId);
    assertPolicyMatchEqualsCanonical(match, canonical);
    assertPolicyContext(canonical, { regionCode, lifecycleStage: policyStage, now, freshnessDays });
    return deepFreeze(canonical);
  });
  const authority = deepFreeze({
    regionCode,
    stage,
    policyLifecycleStage: policyStage,
    verifiedAt: now.toISOString(),
    freshnessDays,
    policies: canonicalPolicies,
  });
  POLICY_AUTHORITY_INSTANCES.add(authority);
  POLICY_AUTHORITY_CANONICAL_POLICIES.set(authority, canonicalPolicies);
  if (matcherQuery != null) POLICY_AUTHORITY_QUERY_CONTEXTS.set(authority, matcherQuery);
  return authority;
}

function assertDeterministicOutputs(profile, snapshot, finance, market) {
  const expectedFinance = isStartupStage(snapshot.stage)
    ? calculateStartupFunding(profile)
    : forecastCashflow(
      snapshot.finance.openingBalanceKrw,
      snapshot.finance.dailyFlowsKrw,
      snapshot.finance.days,
    );
  const expectedMarket = analyzeMarket(snapshot.marketSignals, new Date(snapshot.asOf));
  if (!sameValue(finance, expectedFinance)) throw new TypeError('finance output must match the deterministic engine');
  if (!sameValue(market, expectedMarket)) throw new TypeError('market output must match the deterministic engine');
}

function evidence(id, domain, kind, value, provenance, synthetic = true) {
  return { id, domain, kind, value, provenance, synthetic };
}

function assertEvidenceDlpSafe(value, path = 'evidence') {
  if (typeof value === 'string') {
    if (SENSITIVE_TEXT.test(value)) throw new TypeError(`sensitive evidence value at ${path}`);
    return;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`invalid evidence value at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertEvidenceDlpSafe(item, `${path}[${index}]`));
    return;
  }
  if (value != null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assertEvidenceDlpSafe(nested, `${path}.${key}`);
    }
  }
}

function dynamicAnalysisEvidence(input, analysis) {
  const benchmark = loadIndustryBenchmark(input.industryTemplate);
  const expected = input.path === 'STARTUP'
    ? analyzeStartupInput(input, benchmark)
    : analyzeOperatingInput(input, benchmark);
  if (!sameValue(analysis, expected)) {
    throw new TypeError('analysis must match the deterministic business analysis');
  }
  const provenance = { source: 'deterministic-business-analysis', disclosure: analysis.benchmarkDisclosure };

  if (input.path === 'STARTUP') {
    return [
      evidence('operations.startup.analysis-status', 'OPERATIONS', 'DETERMINISTIC_ANALYSIS', {
        warningCodes: [...analysis.warnings],
      }, provenance, false),
      evidence('finance.startup.declared-budget', 'FINANCE', 'DETERMINISTIC_CALCULATION', {
        amountKrw: analysis.declaredTotalBudgetKrw,
      }, provenance, false),
      evidence('finance.startup.detail-cost-total', 'FINANCE', 'DETERMINISTIC_CALCULATION', {
        amountKrw: analysis.detailCostTotalKrw,
      }, provenance, false),
      evidence('finance.startup.own-capital', 'FINANCE', 'DETERMINISTIC_CALCULATION', {
        amountKrw: analysis.ownCapitalKrw,
      }, provenance, false),
      evidence('finance.startup.funding-gap', 'FINANCE', 'DETERMINISTIC_CALCULATION', {
        amountKrw: analysis.fundingGapKrw,
        status: analysis.fundingGapKrw >= LARGE_FUNDING_GAP_KRW
          ? 'LARGE'
          : (analysis.fundingGapKrw > 0 ? 'PRESENT' : 'NONE'),
      }, provenance, false),
      evidence('finance.startup.budget-difference', 'FINANCE', 'DETERMINISTIC_CALCULATION', {
        amountKrw: analysis.declaredBudgetDifferenceKrw,
      }, provenance, false),
      evidence('finance.startup.recommended-buffer', 'FINANCE', 'DETERMINISTIC_CALCULATION', {
        amountKrw: analysis.recommendedBufferKrw,
        status: analysis.recommendedBufferKrw > 0 ? 'RECOMMENDED' : 'NONE',
      }, provenance, false),
    ];
  }

  const records = [
    evidence('operations.operating.analysis-status', 'OPERATIONS', 'DETERMINISTIC_ANALYSIS', {
      warningCodes: [...analysis.warnings],
    }, provenance, false),
    evidence('finance.operating.sales', 'FINANCE', 'DECLARED_INPUT', {
      amountKrw: analysis.salesKrw,
      status: analysis.salesKrw === 0 ? 'ZERO' : 'NON_ZERO',
    }, provenance, false),
    evidence('finance.operating.cost-total', 'FINANCE', 'DETERMINISTIC_CALCULATION', { amountKrw: analysis.costTotalKrw }, provenance, false),
    evidence('finance.operating.declared-result', 'FINANCE', 'DECLARED_INPUT', {
      netProfitKrw: analysis.declared.netProfitKrw,
      marginRate: analysis.declared.marginRate,
    }, provenance, false),
    evidence('finance.operating.calculated-result', 'FINANCE', 'DETERMINISTIC_CALCULATION', {
      netProfitKrw: analysis.calculated.netProfitKrw,
      marginRate: analysis.calculated.marginRate,
      status: analysis.calculated.netProfitKrw < 0 ? 'LOSS' : 'NON_NEGATIVE',
    }, provenance, false),
    evidence('finance.operating.declared-difference', 'FINANCE', 'DETERMINISTIC_CALCULATION', {
      netProfitKrw: analysis.differences.netProfitKrw,
      marginRate: analysis.differences.marginRate,
    }, provenance, false),
  ];
  for (const [name, benchmarkResult] of Object.entries(analysis.benchmarks)) {
    if (benchmarkResult == null) continue;
    records.push(evidence(
      `operations.operating.benchmark.${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`,
      'OPERATIONS',
      'PROTOTYPE_REFERENCE_RANGE',
      { status: benchmarkResult.status, range: { ...benchmarkResult.range } },
      provenance,
      false,
    ));
  }
  return records;
}

function dynamicMarketEvidence(market) {
  const providerStatus = market?.status ?? (market?.usableSignals?.length ? 'CURRENT' : 'PLANNED_INTEGRATION');
  const confidence = market?.confidence?.level ?? market?.confidence ?? 'LOW';
  if (!['CURRENT', 'PARTIAL', 'PLANNED_INTEGRATION'].includes(providerStatus)) {
    throw new TypeError('market status must be CURRENT, PARTIAL, or PLANNED_INTEGRATION');
  }
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(confidence)) {
    throw new TypeError('market confidence must be HIGH, MEDIUM, or LOW');
  }
  const status = providerStatus === 'CURRENT' ? 'CURRENT' : 'PLANNED_INTEGRATION';
  return [
    evidence('market.provider-status', 'MARKET', 'DATA_QUALITY', { status }, { source: 'market-provider-state' }, false),
    evidence('market.confidence', 'MARKET', 'DATA_QUALITY', { level: confidence }, { source: 'market-provider-state' }, false),
  ];
}

function dynamicPolicyEvidence(input, policyResult) {
  assertRecord(policyResult, 'policyResult');
  if (!Array.isArray(policyResult.matches)) throw new TypeError('policyResult.matches must be an array');
  const authority = policyResult.authority;
  if (!POLICY_AUTHORITY_INSTANCES.has(authority)) {
    throw new TypeError('dynamic policy evidence requires a DB-issued policy authority');
  }
  if (authority.regionCode !== input.regionCode || authority.stage !== input.stage) {
    throw new TypeError('DB-issued policy authority does not match normalized input');
  }
  const matcherQuery = POLICY_AUTHORITY_QUERY_CONTEXTS.get(authority);
  if (matcherQuery == null) {
    throw new TypeError('dynamic policy authority requires matcher-issued query context');
  }
  const details = input[input.path === 'STARTUP' ? 'startup' : 'operating'];
  const inputQueryContext = {
    path: input.path,
    stage: input.stage,
    regionCode: input.regionCode,
    industryTemplate: input.industryTemplate,
    registrationStatus: input.registrationStatus ?? input.businessProfile?.registrationStatus,
    operatingMonths: input.operatingMonths ?? details?.operatingMonths ?? (input.path === 'STARTUP' ? 0 : undefined),
    fundingPurpose: input.fundingPurpose ?? details?.fundingPurpose,
  };
  for (const [field, value] of Object.entries(inputQueryContext)) {
    if (matcherQuery[field] !== value) {
      throw new TypeError(`policy authority query does not match input ${field}`);
    }
  }
  const canonicalPolicies = POLICY_AUTHORITY_CANONICAL_POLICIES.get(authority);
  if (!canonicalPolicies) throw new TypeError('dynamic policy authority has no canonical proof');
  if (policyResult.matches.length !== canonicalPolicies.length) {
    throw new TypeError('policyResult matches must equal the DB-issued authority policies');
  }
  policyResult.matches.forEach((match, index) => assertPolicyMatchEqualsCanonical(match, canonicalPolicies[index]));
  const statusRecord = evidence('policy.match-status', 'POLICY', 'POLICY_MATCH_STATUS', {
    status: canonicalPolicies.length === 0 ? 'NO_MATCH' : 'MATCHES_FOUND',
    matchCount: canonicalPolicies.length,
    eligibility: canonicalPolicies.some((policy) => policy.eligibility === 'CHECK_REQUIRED')
      ? 'CHECK_REQUIRED'
      : 'VERIFIED_CANDIDATE',
  }, { source: 'sqlite-policy-database', verifiedAt: authority.verifiedAt }, false);

  return [statusRecord, ...canonicalPolicies.map((policy) => {
    validatePolicy(policy);
    return evidence(
      `policy.${policy.policyId}`,
      'POLICY',
      'OFFICIAL_POLICY_RECORD',
      {
        policyId: policy.policyId,
        title: policy.title,
        institution: policy.institution,
        eligibility: policy.eligibility,
        status: policy.status,
        versionId: policy.versionId,
        sourceHash: policy.sourceHash,
        verifiedAt: policy.verifiedAt,
        officialUrl: policy.officialUrl,
        requiredChecks: [...policy.requiredChecks],
      },
      { source: 'sqlite-policy-database', verifiedAt: policy.verifiedAt },
      false,
    );
  })];
}

export function buildDynamicEvidenceRegistry({ input, analysis, market, policyResult }) {
  assertRecord(input, 'input');
  assertRecord(analysis, 'analysis');
  if (!['STARTUP', 'OPERATING'].includes(input.path) || input.stage !== input.path) {
    throw new TypeError('input must use a normalized STARTUP or OPERATING path and stage');
  }
  const records = [
    evidence('context.lifecycle-stage', 'CONTEXT', 'NORMALIZED_CONTEXT', { stage: input.stage }, { source: 'normalized-user-input' }, false),
    evidence('context.industry-template', 'CONTEXT', 'NORMALIZED_CONTEXT', {
      industryTemplate: input.industryTemplate,
    }, { source: 'normalized-user-input' }, false),
    ...dynamicAnalysisEvidence(input, analysis),
    ...dynamicMarketEvidence(market),
    ...dynamicPolicyEvidence(input, policyResult),
  ];
  const ids = new Set(records.map((item) => item.id));
  if (ids.size !== records.length) throw new TypeError('evidence IDs must be unique');
  assertEvidenceDlpSafe(records);
  const frozenRecords = records.map((record) => Object.freeze(record));

  return Object.freeze({
    scenarioId: `dynamic-${input.stage.toLowerCase()}`,
    stage: input.stage,
    synthetic: false,
    dynamic: true,
    evidence: Object.freeze(frozenRecords),
    marketStatus: frozenRecords.find((item) => item.id === 'market.provider-status').value.status,
    marketConfidence: frozenRecords.find((item) => item.id === 'market.confidence').value.level,
  });
}

function operationEvidence(snapshot) {
  assertExactKeys(snapshot.operations, OPERATION_FIELDS, 'operations');
  if (Object.values(snapshot.operations).some((value) => typeof value !== 'string' || SENSITIVE_TEXT.test(value))) {
    throw new TypeError('operations contains sensitive or invalid text');
  }
  return OPERATION_FIELDS.map((field) => evidence(
    `operations.${field.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`,
    'OPERATIONS',
    'STRUCTURED_SCENARIO_FACT',
    { status: snapshot.operations[field] },
    { source: 'synthetic-demo-scenario', asOf: snapshot.asOf },
  ));
}

function financeEvidence(stage, finance, asOf) {
  const provenance = { source: 'deterministic-finance-engine', asOf };
  if (isStartupStage(stage)) {
    return [
      evidence('finance.startup.planned-cost', 'FINANCE', 'DETERMINISTIC_CALCULATION', { amountKrw: finance.plannedCost }, provenance),
      evidence('finance.startup.own-capital', 'FINANCE', 'DETERMINISTIC_CALCULATION', { amountKrw: finance.ownCapital }, provenance),
      evidence('finance.startup.funding-gap', 'FINANCE', 'DETERMINISTIC_CALCULATION', { amountKrw: finance.fundingGap }, provenance),
      evidence('finance.startup.recommended-buffer', 'FINANCE', 'DETERMINISTIC_CALCULATION', { amountKrw: finance.recommendedBuffer }, provenance),
    ];
  }
  return [
    evidence('finance.cashflow.minimum-balance', 'FINANCE', 'DETERMINISTIC_CALCULATION', { amountKrw: finance.minimumBalance }, provenance),
    evidence('finance.cashflow.shortfall-date', 'FINANCE', 'DETERMINISTIC_CALCULATION', { day: finance.shortfallDate }, provenance),
    evidence('finance.cashflow.shortfall-range', 'FINANCE', 'DETERMINISTIC_CALCULATION', {
      lowKrw: finance.shortfallRange.low,
      highKrw: finance.shortfallRange.high,
    }, provenance),
  ];
}

function marketEvidence(market, asOf) {
  const provenance = { source: 'deterministic-market-engine', asOf };
  const records = [
    evidence('market.outlook.downside', 'MARKET', 'DETERMINISTIC_CALCULATION', { index: market.scenarios.downside.index }, provenance),
    evidence('market.outlook.baseline', 'MARKET', 'DETERMINISTIC_CALCULATION', { index: market.scenarios.baseline.index }, provenance),
    evidence('market.outlook.upside', 'MARKET', 'DETERMINISTIC_CALCULATION', { index: market.scenarios.upside.index }, provenance),
    evidence('market.confidence', 'MARKET', 'DATA_QUALITY', { level: market.confidence.level }, provenance),
  ];
  for (const signal of market.usableSignals) {
    if (signal.metric === 'SITE_CANDIDATE_SCORE_INPUT') continue;
    records.push(evidence(
      `market.signal.${signal.signalId}`,
      'MARKET',
      'CURRENT_MARKET_SIGNAL',
      { metric: signal.metric, value: signal.value, unit: signal.unit },
      { source: signal.source, asOf: signal.asOf, maxAgeHours: signal.maxAgeHours },
    ));
  }
  if (market.preferredSite) {
    records.push(evidence(
      'market.site.preferred',
      'MARKET',
      'DETERMINISTIC_CALCULATION',
      { siteId: market.preferredSite, confidence: market.siteConfidence.level },
      provenance,
    ));
  }
  return records;
}

function validatePolicy(policy) {
  assertRecord(policy, 'canonical policy');
  for (const field of ['policyId', 'versionId', 'sourceHash', 'eligibility', 'status', 'verifiedAt', 'officialUrl']) {
    if (typeof policy[field] !== 'string' || policy[field].length === 0) {
      throw new TypeError(`policy ${field} must be a non-empty string`);
    }
  }
  let url;
  try {
    url = new URL(policy.officialUrl);
  } catch {
    throw new TypeError('policy official URL must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:') throw new TypeError('policy official URL must use HTTPS');
}

function policyEvidence(authority, profile, snapshot, legacyPolicies) {
  if (Array.isArray(legacyPolicies) && legacyPolicies.length > 0) {
    throw new TypeError('official policy evidence requires a DB-issued policy authority');
  }
  if (authority == null) return [];
  if (!POLICY_AUTHORITY_INSTANCES.has(authority)) {
    throw new TypeError('official policy evidence requires a DB-issued policy authority');
  }
  const canonicalPolicies = POLICY_AUTHORITY_CANONICAL_POLICIES.get(authority);
  if (!canonicalPolicies) throw new TypeError('official policy evidence authority has no canonical proof');
  if (authority.regionCode !== profile.business.regionCode) {
    throw new TypeError('DB-issued policy authority region does not match the scenario');
  }
  if (authority.stage !== snapshot.stage) {
    throw new TypeError('DB-issued policy authority stage does not match the scenario');
  }
  const authorityTime = new Date(authority.verifiedAt).getTime();
  const snapshotTime = new Date(snapshot.asOf).getTime();
  if (!Number.isFinite(snapshotTime) || Math.abs(authorityTime - snapshotTime) > 24 * 60 * 60 * 1000) {
    throw new TypeError('DB-issued policy authority freshness does not match the scenario snapshot');
  }
  return canonicalPolicies.map((policy) => {
    validatePolicy(policy);
    return evidence(
      `policy.${policy.policyId}`,
      'POLICY',
      'OFFICIAL_POLICY_RECORD',
      {
        policyId: policy.policyId,
        eligibility: policy.eligibility,
        status: policy.status,
        versionId: policy.versionId,
        sourceHash: policy.sourceHash,
        verifiedAt: policy.verifiedAt,
        officialUrl: policy.officialUrl,
        title: policy.title,
      },
      { source: 'sqlite-policy-database', verifiedAt: policy.verifiedAt },
      false,
    );
  });
}

export function buildEvidenceRegistry({ profile, snapshot, finance, market, policies, policyAuthority }) {
  assertRecord(profile, 'profile');
  assertRecord(snapshot, 'snapshot');
  if (profile.synthetic !== true) throw new TypeError('profile must be an explicitly synthetic scenario');
  if (typeof profile.scenarioId !== 'string' || profile.scenarioId.length === 0) {
    throw new TypeError('profile.scenarioId must be a non-empty string');
  }
  if (!STAGES.has(snapshot.stage)) throw new TypeError(`Unknown stage: ${String(snapshot.stage)}`);
  if (!profile.snapshots?.some((item) => item === snapshot || sameValue(item, snapshot))) {
    throw new TypeError('snapshot must belong to the scenario profile');
  }
  assertRecord(profile.business, 'profile.business');
  assertDeterministicOutputs(profile, snapshot, finance, market);
  const records = [
    evidence('context.lifecycle-stage', 'CONTEXT', 'SCENARIO_CONTEXT', { stage: snapshot.stage }, { source: 'synthetic-demo-scenario', asOf: snapshot.asOf }),
    evidence('context.business-category', 'CONTEXT', 'SCENARIO_CONTEXT', { industryCategory: profile.business.industryCategory }, { source: 'synthetic-demo-scenario', asOf: snapshot.asOf }),
    evidence('context.region', 'CONTEXT', 'SCENARIO_CONTEXT', {
      regionCode: profile.business.regionCode,
      districtCode: profile.business.districtCode,
    }, { source: 'synthetic-demo-scenario', asOf: snapshot.asOf }),
    ...operationEvidence(snapshot),
    ...financeEvidence(snapshot.stage, finance, snapshot.asOf),
    ...marketEvidence(market, snapshot.asOf),
    ...policyEvidence(policyAuthority, profile, snapshot, policies),
  ];
  const ids = new Set(records.map((item) => item.id));
  if (ids.size !== records.length) throw new TypeError('evidence IDs must be unique');
  assertEvidenceDlpSafe(records);

  return Object.freeze({
    scenarioId: profile.scenarioId,
    stage: snapshot.stage,
    synthetic: true,
    evidence: records,
  });
}

export function projectEvidenceForExpert(registry, expert) {
  assertRecord(registry, 'registry');
  const allowedDomains = EXPERT_DOMAINS[expert];
  if (!allowedDomains) throw new TypeError(`Unknown expert: ${String(expert)}`);
  if (!Array.isArray(registry.evidence)) throw new TypeError('registry.evidence must be an array');
  return structuredClone(registry.evidence.filter((item) => allowedDomains.has(item.domain)));
}

export const EVIDENCE_DOMAINS_BY_EXPERT = Object.freeze(
  Object.fromEntries(Object.entries(EXPERT_DOMAINS).map(([expert, domains]) => [expert, Object.freeze([...domains])])),
);
