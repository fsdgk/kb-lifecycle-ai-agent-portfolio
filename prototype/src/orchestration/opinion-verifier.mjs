import { validateExpertOpinion } from '../agents/agent-schema.mjs';
import { PROMPT_VERSIONS } from '../agents/prompts.mjs';
import { projectEvidenceForExpert } from './evidence-registry.mjs';

const PRIMARY_DOMAIN = Object.freeze({
  MARKET: 'MARKET',
  OPERATIONS: 'OPERATIONS',
  FINANCE: 'FINANCE',
  POLICY: 'POLICY',
});
const claimRule = (statement, requiredEvidenceIds, predicate = () => true) => Object.freeze({
  statement,
  requiredEvidenceIds: Object.freeze(requiredEvidenceIds),
  predicate,
});

const actionRule = (title, requiredEvidenceIds, predicate = () => true) => Object.freeze({
  title,
  requiredEvidenceIds: Object.freeze(requiredEvidenceIds),
  predicate,
});

const POLICY_CLAIM_RULES = Object.freeze({
  POLICY_MATCH_REQUIRES_VERIFICATION: claimRule(
    '정책 후보의 신청 자격은 공식 공고에서 다시 확인해야 합니다.',
    [],
    ({ citedEvidence }) => (
    citedEvidence.some((item) => item.domain === 'POLICY' && item.value.eligibility === 'CHECK_REQUIRED')
    ),
  ),
  OFFICIAL_NOTICE_REVIEW_REQUIRED: claimRule(
    '정책 후보는 공식 공고를 기준으로 검토해야 합니다.',
    [],
    ({ citedEvidence }) => (
    citedEvidence.some((item) => item.domain === 'POLICY' && item.kind === 'OFFICIAL_POLICY_RECORD')
    ),
  ),
});

const CLAIM_RULES_BY_STAGE = Object.freeze({
  PRE_START: Object.freeze({
    MARKET: Object.freeze({
      SITE_PREFERENCE_IDENTIFIED: claimRule('후보 입지 중 우선 검증할 대안이 확인되었습니다.', ['market.site.preferred'], ({ evidenceById }) => (
        Boolean(evidenceById.get('market.site.preferred')?.value?.siteId)
      )),
      MARKET_OUTLOOK_AVAILABLE: claimRule('현재 시장 근거로 전망 범위를 비교할 수 있습니다.', ['market.outlook.baseline'], ({ evidenceById }) => (
        Number.isFinite(evidenceById.get('market.outlook.baseline')?.value?.index)
      )),
      MARKET_CONFIDENCE_LIMITED: claimRule('시장 판단에는 추가 데이터 확인이 필요합니다.', ['market.confidence'], ({ evidenceById }) => (
        ['LOW', 'MEDIUM'].includes(evidenceById.get('market.confidence')?.value?.level)
      )),
    }),
    OPERATIONS: Object.freeze({
      OPENING_READINESS_INCOMPLETE: claimRule('개점 전에 영업 준비 상태를 보완해야 합니다.', ['operations.food-service-permit-status'], ({ evidenceById }) => (
        evidenceById.get('operations.food-service-permit-status')?.value?.status !== 'ACTIVE'
      )),
      SUPPLIER_CONCENTRATION_RISK: claimRule('단일 수입 경로에 대한 운영 대응이 필요합니다.', ['operations.supplier-resilience-status'], ({ evidenceById }) => (
        evidenceById.get('operations.supplier-resilience-status')?.value?.status === 'SINGLE_IMPORT_CHANNEL'
      )),
      MENU_COSTING_INCOMPLETE: claimRule('메뉴 원가 검토를 개점 전에 마쳐야 합니다.', ['operations.menu-costing-status'], ({ evidenceById }) => (
        evidenceById.get('operations.menu-costing-status')?.value?.status === 'DRAFT'
      )),
    }),
    FINANCE: Object.freeze({
      FUNDING_GAP_EXISTS: claimRule('개점 계약 전에 확인된 자금 공백을 먼저 해소해야 합니다.', ['finance.startup.funding-gap'], ({ evidenceById }) => (
        evidenceById.get('finance.startup.funding-gap')?.value?.amountKrw > 0
      )),
      FUNDING_GAP_EXCEEDS_OWN_CAPITAL: claimRule('자금 공백이 자기자본보다 큽니다.', [
        'finance.startup.funding-gap',
        'finance.startup.own-capital',
      ], ({ evidenceById }) => (
        evidenceById.get('finance.startup.funding-gap')?.value?.amountKrw
          > evidenceById.get('finance.startup.own-capital')?.value?.amountKrw
      )),
      BUFFER_RECOMMENDED: claimRule('예비자금 확보가 필요합니다.', ['finance.startup.recommended-buffer'], ({ evidenceById }) => (
        evidenceById.get('finance.startup.recommended-buffer')?.value?.amountKrw > 0
      )),
    }),
    POLICY: POLICY_CLAIM_RULES,
  }),
  OPERATING_CRISIS: Object.freeze({
    MARKET: Object.freeze({
      MARKET_DOWNSIDE_RISK: claimRule('현재 시장 근거에는 하방 위험이 나타납니다.', ['market.outlook.baseline'], ({ evidenceById }) => (
        evidenceById.get('market.outlook.baseline')?.value?.index < 100
      )),
      DELIVERY_DEMAND_PRESENT: claimRule('배달 수요 신호를 운영 계획에 반영할 수 있습니다.', ['market.signal.signal-delivery-operating'], ({ evidenceById }) => (
        evidenceById.get('market.signal.signal-delivery-operating')?.value?.value > 0
      )),
      INGREDIENT_COST_PRESSURE: claimRule('식재료 비용 압력이 확인됩니다.', ['market.signal.signal-ingredient-cost-operating'], ({ evidenceById }) => (
        evidenceById.get('market.signal.signal-ingredient-cost-operating')?.value?.value > 1
      )),
    }),
    OPERATIONS: Object.freeze({
      MENU_COSTING_REVIEW_OVERDUE: claimRule('메뉴 원가 검토가 지연되어 있습니다.', ['operations.menu-costing-status'], ({ evidenceById }) => (
        evidenceById.get('operations.menu-costing-status')?.value?.status === 'REVIEW_OVERDUE'
      )),
      SUPPLIER_CONCENTRATION_RISK: claimRule('단일 수입 경로에 대한 운영 대응이 필요합니다.', ['operations.supplier-resilience-status'], ({ evidenceById }) => (
        evidenceById.get('operations.supplier-resilience-status')?.value?.status === 'SINGLE_IMPORT_CHANNEL'
      )),
    }),
    FINANCE: Object.freeze({
      CASH_SHORTFALL_FORECAST: claimRule('현금 부족 가능성에 대한 대응이 필요합니다.', ['finance.cashflow.shortfall-range'], ({ evidenceById }) => (
        evidenceById.get('finance.cashflow.shortfall-range')?.value?.highKrw > 0
      )),
      NEGATIVE_MINIMUM_BALANCE: claimRule('예측 기간 중 현금 잔액이 음수로 내려갑니다.', ['finance.cashflow.minimum-balance'], ({ evidenceById }) => (
        evidenceById.get('finance.cashflow.minimum-balance')?.value?.amountKrw < 0
      )),
    }),
    POLICY: POLICY_CLAIM_RULES,
  }),
});

const POLICY_ACTION_RULES = Object.freeze({
  VERIFY_POLICY_ELIGIBILITY: actionRule('정책 자격 조건을 확인합니다.', [], ({ citedEvidence }) => (
    citedEvidence.some((item) => item.domain === 'POLICY' && item.value.eligibility === 'CHECK_REQUIRED')
  )),
  REVIEW_POLICY_MATCHES: actionRule('정책 후보를 비교 검토합니다.', [], ({ citedEvidence }) => (
    citedEvidence.some((item) => item.domain === 'POLICY')
  )),
  CHECK_OFFICIAL_NOTICE: actionRule('공식 공고를 확인합니다.', [], ({ citedEvidence }) => (
    citedEvidence.some((item) => item.kind === 'OFFICIAL_POLICY_RECORD')
  )),
});

const ACTION_RULES_BY_STAGE = Object.freeze({
  PRE_START: Object.freeze({
    MARKET: Object.freeze({
      VALIDATE_PREFERRED_SITE: actionRule('우선 후보 입지의 현장 조건을 검증합니다.', ['market.site.preferred']),
      COMPARE_SITE_SCENARIOS: actionRule('후보 입지별 수요와 비용 조건을 비교합니다.', ['market.site.preferred']),
      REFRESH_MARKET_DATA: actionRule('최신 상권 데이터를 다시 확인합니다.', ['market.confidence']),
    }),
    OPERATIONS: Object.freeze({
      CHECK_OPERATING_READINESS: actionRule('개점 준비 항목을 점검합니다.', ['operations.food-service-permit-status'], ({ evidenceById }) => (
        evidenceById.get('operations.food-service-permit-status')?.value?.status !== 'ACTIVE'
      )),
    }),
    FINANCE: Object.freeze({
      CLOSE_FUNDING_GAP_BEFORE_COMMITMENT: actionRule('자금 조달 계획을 확정합니다.', ['finance.startup.funding-gap'], ({ evidenceById }) => (
        evidenceById.get('finance.startup.funding-gap')?.value?.amountKrw > 0
      )),
      RESERVE_RECOMMENDED_BUFFER: actionRule('권고 예비자금을 확보합니다.', ['finance.startup.recommended-buffer'], ({ evidenceById }) => (
        evidenceById.get('finance.startup.recommended-buffer')?.value?.amountKrw > 0
      )),
      REQUEST_FINANCE_COUNSEL: actionRule('금융 전문가 상담을 요청합니다.', ['finance.startup.funding-gap'], ({ evidenceById }) => (
        evidenceById.get('finance.startup.funding-gap')?.value?.amountKrw > 0
      )),
    }),
    POLICY: POLICY_ACTION_RULES,
  }),
  OPERATING_CRISIS: Object.freeze({
    MARKET: Object.freeze({
      REFRESH_MARKET_DATA: actionRule('최신 상권 데이터를 다시 확인합니다.', ['market.confidence']),
    }),
    OPERATIONS: Object.freeze({
      STABILIZE_OPERATIONS: actionRule('운영 안정화 조치를 실행합니다.', ['operations.menu-costing-status'], ({ evidenceById }) => (
        evidenceById.get('operations.menu-costing-status')?.value?.status === 'REVIEW_OVERDUE'
      )),
      REVIEW_OPERATING_PERFORMANCE: actionRule('운영 성과를 재점검합니다.', ['operations.menu-costing-status']),
    }),
    FINANCE: Object.freeze({
      ADDRESS_CASH_SHORTFALL: actionRule('예상 현금 부족 대응안을 마련합니다.', ['finance.cashflow.shortfall-range'], ({ evidenceById }) => (
        evidenceById.get('finance.cashflow.shortfall-range')?.value?.highKrw > 0
      )),
      MONITOR_OPERATING_CASHFLOW: actionRule('운영 현금흐름을 점검합니다.', ['finance.cashflow.minimum-balance'], ({ evidenceById }) => (
        Number.isFinite(evidenceById.get('finance.cashflow.minimum-balance')?.value?.amountKrw)
      )),
      REQUEST_FINANCE_COUNSEL: actionRule('금융 전문가 상담을 요청합니다.', ['finance.cashflow.shortfall-range'], ({ evidenceById }) => (
        evidenceById.get('finance.cashflow.shortfall-range')?.value?.highKrw > 0
      )),
    }),
    POLICY: POLICY_ACTION_RULES,
  }),
});

function assertRecord(value, fieldName) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
}

function assertEnvelopeMetadata(metadata, registry, expectedExpert) {
  assertRecord(metadata, 'envelope.metadata');
  if (metadata.generator !== 'ChatGPT') throw new TypeError('metadata generator must be ChatGPT');
  if (metadata.promptVersion !== PROMPT_VERSIONS.expert) throw new TypeError('metadata prompt version mismatch');
  if (metadata.scenarioId !== registry.scenarioId) throw new TypeError('metadata scenarioId mismatch');
  if (metadata.stage !== registry.stage) throw new TypeError('metadata stage mismatch');
  if (metadata.agent !== expectedExpert) throw new TypeError('metadata agent mismatch');
  if (metadata.synthetic !== true || registry.synthetic !== true) throw new TypeError('stored results require synthetic data');
  if (typeof metadata.generatedAt !== 'string' || Number.isNaN(Date.parse(metadata.generatedAt))) {
    throw new TypeError('metadata generatedAt must be a timestamp');
  }
}

function assertPrimaryEvidence(items, evidenceById, expert, fieldName) {
  const requiredDomain = PRIMARY_DOMAIN[expert];
  for (const [index, item] of items.entries()) {
    const hasPrimaryEvidence = item.evidenceIds.some((id) => evidenceById.get(id)?.domain === requiredDomain);
    if (!hasPrimaryEvidence) {
      throw new TypeError(`${fieldName}[${index}] must cite ${requiredDomain.toLowerCase()} evidence`);
    }
  }
}

function assertClaimSemantics(claims, evidenceById, expert, stage) {
  const rules = CLAIM_RULES_BY_STAGE[stage]?.[expert];
  if (!rules) throw new TypeError(`No claim registry for ${expert} at ${stage}`);
  for (const [index, claim] of claims.entries()) {
    const rule = rules[claim.code];
    if (!rule) throw new TypeError(`claims[${index}] contains an unregistered claim code: ${claim.code}`);
    if (claim.statement !== rule.statement) {
      throw new TypeError(`claims[${index}] must use the trusted claim template for ${claim.code}`);
    }
    const missingEvidence = rule.requiredEvidenceIds.find((id) => !claim.evidenceIds.includes(id));
    if (missingEvidence) {
      throw new TypeError(`claims[${index}] evidence relation requires ${missingEvidence}`);
    }
    const citedEvidence = claim.evidenceIds.map((id) => evidenceById.get(id));
    if (!rule.predicate({ claim, evidenceById, citedEvidence })) {
      throw new TypeError(`claims[${index}] semantic predicate does not match the evidence relation`);
    }
  }
}

function assertActionSemantics(actions, evidenceById, expert, stage) {
  const rules = ACTION_RULES_BY_STAGE[stage]?.[expert];
  if (!rules) throw new TypeError(`No action registry for ${expert} at ${stage}`);
  for (const [index, action] of actions.entries()) {
    const rule = rules[action.code];
    if (!rule) throw new TypeError(`actions[${index}] contains an unregistered action code for stage ${stage}: ${action.code}`);
    if (action.title !== rule.title) {
      throw new TypeError(`actions[${index}] must use the trusted action template for ${action.code}`);
    }
    const missingEvidence = rule.requiredEvidenceIds.find((id) => !action.evidenceIds.includes(id));
    if (missingEvidence) throw new TypeError(`actions[${index}] evidence relation requires ${missingEvidence}`);
    const citedEvidence = action.evidenceIds.map((id) => evidenceById.get(id));
    if (!rule.predicate({ action, evidenceById, citedEvidence })) {
      throw new TypeError(`actions[${index}] semantic predicate does not match the evidence relation`);
    }
  }
}

export function verifyExpertOpinion({ envelope, registry, expectedExpert }) {
  assertRecord(envelope, 'envelope');
  assertRecord(registry, 'registry');
  assertEnvelopeMetadata(envelope.metadata, registry, expectedExpert);
  const projection = projectEvidenceForExpert(registry, expectedExpert);
  const evidenceById = new Map(projection.map((item) => [item.id, item]));
  const result = validateExpertOpinion(envelope.result, [...evidenceById.keys()]);
  if (result.expert !== expectedExpert) throw new TypeError('result expert does not match the expected expert');

  assertPrimaryEvidence(result.claims, evidenceById, expectedExpert, 'claims');
  assertClaimSemantics(result.claims, evidenceById, expectedExpert, registry.stage);
  assertPrimaryEvidence(result.actions, evidenceById, expectedExpert, 'actions');
  assertActionSemantics(result.actions, evidenceById, expectedExpert, registry.stage);
  return result;
}

export const EXPERT_CLAIM_CODES_BY_STAGE = Object.freeze(
  Object.fromEntries(Object.entries(CLAIM_RULES_BY_STAGE).map(([stage, experts]) => [
    stage,
    Object.freeze(Object.fromEntries(Object.entries(experts).map(([expert, rules]) => [
      expert,
      Object.freeze(Object.keys(rules)),
    ]))),
  ])),
);

export const EXPERT_CLAIM_TEMPLATES_BY_STAGE = Object.freeze(
  Object.fromEntries(Object.entries(CLAIM_RULES_BY_STAGE).map(([stage, experts]) => [
    stage,
    Object.freeze(Object.fromEntries(Object.entries(experts).map(([expert, rules]) => [
      expert,
      Object.freeze(Object.fromEntries(Object.entries(rules).map(([code, rule]) => [code, rule.statement]))),
    ]))),
  ])),
);

export const EXPERT_ACTION_TEMPLATES_BY_STAGE = Object.freeze(
  Object.fromEntries(Object.entries(ACTION_RULES_BY_STAGE).map(([stage, experts]) => [
    stage,
    Object.freeze(Object.fromEntries(Object.entries(experts).map(([expert, rules]) => [
      expert,
      Object.freeze(Object.fromEntries(Object.entries(rules).map(([code, rule]) => [code, rule.title]))),
    ]))),
  ])),
);

const DYNAMIC_POLICY_CLAIMS = Object.freeze({
  POLICY_MATCH_REQUIRES_VERIFICATION: claimRule(
    'Matched policy candidates require official eligibility verification.',
    ['policy.match-status'],
    ({ evidenceById }) => evidenceById.get('policy.match-status')?.value?.eligibility === 'CHECK_REQUIRED',
  ),
  POLICY_MATCH_FOUND: claimRule(
    'Official policy candidates are available for review.',
    ['policy.match-status'],
    ({ evidenceById }) => evidenceById.get('policy.match-status')?.value?.status === 'MATCHES_FOUND',
  ),
  POLICY_NO_MATCH: claimRule(
    'No current official policy candidate matched the supplied criteria.',
    ['policy.match-status'],
    ({ evidenceById }) => evidenceById.get('policy.match-status')?.value?.status === 'NO_MATCH',
  ),
});

const DYNAMIC_MARKET_CLAIMS = Object.freeze({
  MARKET_DATA_AVAILABLE: claimRule(
    'Available market evidence can support a bounded review.',
    ['market.provider-status', 'market.confidence'],
    ({ evidenceById }) => evidenceById.get('market.provider-status')?.value?.status === 'CURRENT',
  ),
  MARKET_DATA_UNCERTAIN: claimRule(
    'Market evidence is incomplete and must be treated as uncertainty.',
    ['market.provider-status', 'market.confidence'],
    ({ evidenceById }) => (
      evidenceById.get('market.provider-status')?.value?.status !== 'CURRENT'
      || evidenceById.get('market.confidence')?.value?.level !== 'HIGH'
    ),
  ),
});

export const DYNAMIC_CLAIM_RULES_BY_STAGE = Object.freeze({
  STARTUP: Object.freeze({
    MARKET: DYNAMIC_MARKET_CLAIMS,
    OPERATIONS: Object.freeze({
      STARTUP_BUDGET_MISMATCH: claimRule(
        'The declared startup budget differs from the itemized cost total.',
        ['operations.startup.analysis-status'],
        ({ evidenceById }) => evidenceById.get('operations.startup.analysis-status')?.value?.warningCodes
          ?.includes('DECLARED_BUDGET_MISMATCH'),
      ),
      STARTUP_COST_PLAN_RECONCILED: claimRule(
        'The declared startup budget is reconciled with the itemized cost total.',
        ['operations.startup.analysis-status'],
        ({ evidenceById }) => !evidenceById.get('operations.startup.analysis-status')?.value?.warningCodes
          ?.includes('DECLARED_BUDGET_MISMATCH'),
      ),
    }),
    FINANCE: Object.freeze({
      FUNDING_GAP_EXISTS: claimRule(
        'The verified startup calculation contains a funding gap.',
        ['finance.startup.funding-gap'],
        ({ evidenceById }) => ['PRESENT', 'LARGE'].includes(evidenceById.get('finance.startup.funding-gap')?.value?.status),
      ),
      STARTUP_CAPITAL_COVERS_COSTS: claimRule(
        'Available startup capital covers the itemized startup cost.',
        ['finance.startup.funding-gap'],
        ({ evidenceById }) => evidenceById.get('finance.startup.funding-gap')?.value?.status === 'NONE',
      ),
      BUFFER_RECOMMENDED: claimRule(
        'A separate startup contingency buffer is recommended.',
        ['finance.startup.recommended-buffer'],
        ({ evidenceById }) => evidenceById.get('finance.startup.recommended-buffer')?.value?.status === 'RECOMMENDED',
      ),
    }),
    POLICY: DYNAMIC_POLICY_CLAIMS,
  }),
  OPERATING: Object.freeze({
    MARKET: DYNAMIC_MARKET_CLAIMS,
    OPERATIONS: Object.freeze({
      DECLARED_PROFIT_MISMATCH: claimRule(
        'The declared operating profit differs from the calculated result.',
        ['operations.operating.analysis-status'],
        ({ evidenceById }) => evidenceById.get('operations.operating.analysis-status')?.value?.warningCodes
          ?.includes('DECLARED_PROFIT_MISMATCH'),
      ),
      LABOR_RATIO_HIGH: claimRule(
        'The labor cost ratio is above the disclosed prototype reference range.',
        ['operations.operating.benchmark.labor'],
        ({ evidenceById }) => evidenceById.get('operations.operating.benchmark.labor')?.value?.status === 'HIGH',
      ),
      RENT_RATIO_HIGH: claimRule(
        'The rent ratio is above the disclosed prototype reference range.',
        ['operations.operating.benchmark.rent'],
        ({ evidenceById }) => evidenceById.get('operations.operating.benchmark.rent')?.value?.status === 'HIGH',
      ),
      MATERIAL_RATIO_HIGH: claimRule(
        'The materials purchase ratio is above the disclosed prototype reference range.',
        ['operations.operating.benchmark.materials-purchases'],
        ({ evidenceById }) => evidenceById.get('operations.operating.benchmark.materials-purchases')?.value?.status === 'HIGH',
      ),
      OTHER_CUSTOM_RATIO_HIGH: claimRule(
        'Other and custom costs are above the disclosed prototype reference range.',
        ['operations.operating.benchmark.other-custom-costs'],
        ({ evidenceById }) => evidenceById.get('operations.operating.benchmark.other-custom-costs')?.value?.status === 'HIGH',
      ),
      ZERO_SALES_REVIEW: claimRule(
        'Zero sales requires an immediate operating review.',
        ['operations.operating.analysis-status'],
        ({ evidenceById }) => evidenceById.get('operations.operating.analysis-status')?.value?.warningCodes
          ?.includes('ZERO_SALES_REVIEW'),
      ),
      OPERATING_COSTS_REQUIRE_REVIEW: claimRule(
        'Operating costs should be reviewed against the disclosed reference ranges.',
        ['operations.operating.analysis-status'],
      ),
    }),
    FINANCE: Object.freeze({
      NEGATIVE_CALCULATED_PROFIT: claimRule(
        'The calculated operating result is negative.',
        ['finance.operating.calculated-result'],
        ({ evidenceById }) => evidenceById.get('finance.operating.calculated-result')?.value?.status === 'LOSS',
      ),
      ZERO_SALES_FINANCE_RISK: claimRule(
        'Zero sales prevents a meaningful operating margin calculation.',
        ['finance.operating.sales', 'finance.operating.calculated-result'],
        ({ evidenceById }) => evidenceById.get('finance.operating.sales')?.value?.status === 'ZERO',
      ),
      OPERATING_RESULT_AVAILABLE: claimRule(
        'A finite calculated operating result is available for review.',
        ['finance.operating.calculated-result'],
        ({ evidenceById }) => Number.isFinite(
          evidenceById.get('finance.operating.calculated-result')?.value?.netProfitKrw,
        ),
      ),
    }),
    POLICY: DYNAMIC_POLICY_CLAIMS,
  }),
});

const DYNAMIC_POLICY_ACTIONS = Object.freeze({
  VERIFY_POLICY_ELIGIBILITY: actionRule(
    'Verify candidate eligibility against the official notice.',
    ['policy.match-status'],
    ({ evidenceById }) => evidenceById.get('policy.match-status')?.value?.eligibility === 'CHECK_REQUIRED',
  ),
  REVIEW_POLICY_MATCHES: actionRule(
    'Review the current official policy candidates.',
    ['policy.match-status'],
    ({ evidenceById }) => evidenceById.get('policy.match-status')?.value?.status === 'MATCHES_FOUND',
  ),
  CHECK_OFFICIAL_NOTICE: actionRule(
    'Check the official notice before taking action.',
    ['policy.match-status'],
    ({ evidenceById }) => evidenceById.get('policy.match-status')?.value?.status === 'MATCHES_FOUND',
  ),
});

const DYNAMIC_MARKET_ACTIONS = Object.freeze({
  REFRESH_MARKET_DATA: actionRule(
    'Refresh market evidence before relying on the market view.',
    ['market.provider-status', 'market.confidence'],
  ),
});

export const DYNAMIC_ACTION_RULES_BY_STAGE = Object.freeze({
  STARTUP: Object.freeze({
    MARKET: DYNAMIC_MARKET_ACTIONS,
    OPERATIONS: Object.freeze({
      CHECK_OPERATING_READINESS: actionRule(
        'Review startup operating readiness before commitment.',
        ['operations.startup.analysis-status'],
      ),
    }),
    FINANCE: Object.freeze({
      CLOSE_FUNDING_GAP_BEFORE_COMMITMENT: actionRule(
        'Close the verified funding gap before commitment.',
        ['finance.startup.funding-gap'],
        ({ evidenceById }) => ['PRESENT', 'LARGE'].includes(evidenceById.get('finance.startup.funding-gap')?.value?.status),
      ),
      RESERVE_RECOMMENDED_BUFFER: actionRule(
        'Reserve the verified startup contingency buffer.',
        ['finance.startup.recommended-buffer'],
        ({ evidenceById }) => evidenceById.get('finance.startup.recommended-buffer')?.value?.status === 'RECOMMENDED',
      ),
      REQUEST_FINANCE_COUNSEL: actionRule(
        'Request finance counsel before loan execution.',
        ['finance.startup.funding-gap'],
      ),
    }),
    POLICY: DYNAMIC_POLICY_ACTIONS,
  }),
  OPERATING: Object.freeze({
    MARKET: DYNAMIC_MARKET_ACTIONS,
    OPERATIONS: Object.freeze({
      STABILIZE_OPERATIONS: actionRule(
        'Stabilize operations around the verified risk indicators.',
        ['operations.operating.analysis-status'],
      ),
      REVIEW_OPERATING_PERFORMANCE: actionRule(
        'Review operating performance and cost structure.',
        ['operations.operating.analysis-status'],
      ),
    }),
    FINANCE: Object.freeze({
      ADDRESS_CASH_SHORTFALL: actionRule(
        'Address the negative operating result before further commitments.',
        ['finance.operating.calculated-result'],
        ({ evidenceById }) => evidenceById.get('finance.operating.calculated-result')?.value?.status === 'LOSS',
      ),
      MONITOR_OPERATING_CASHFLOW: actionRule(
        'Monitor the verified operating result and cash exposure.',
        ['finance.operating.calculated-result'],
      ),
      REQUEST_FINANCE_COUNSEL: actionRule(
        'Request finance counsel for the operating risk.',
        ['finance.operating.calculated-result'],
      ),
    }),
    POLICY: DYNAMIC_POLICY_ACTIONS,
  }),
});

function dynamicRules(registry, expert, kind) {
  if (registry?.dynamic !== true || !['STARTUP', 'OPERATING'].includes(registry.stage)) {
    throw new TypeError('dynamic verification requires a dynamic normalized-input registry');
  }
  const source = kind === 'claim' ? DYNAMIC_CLAIM_RULES_BY_STAGE : DYNAMIC_ACTION_RULES_BY_STAGE;
  const rules = source[registry.stage]?.[expert];
  if (!rules) throw new TypeError(`No dynamic ${kind} registry for ${expert} at ${registry.stage}`);
  return rules;
}

export function verifyDynamicExpertOpinion({ proposal, registry, expectedExpert }) {
  assertRecord(registry, 'registry');
  const projection = projectEvidenceForExpert(registry, expectedExpert);
  const evidenceById = new Map(projection.map((item) => [item.id, item]));
  const result = validateExpertOpinion(proposal, [...evidenceById.keys()]);
  if (result.expert !== expectedExpert) throw new TypeError('result expert does not match the expected expert');
  const claimRules = dynamicRules(registry, expectedExpert, 'claim');
  const actionRules = dynamicRules(registry, expectedExpert, 'action');
  assertPrimaryEvidence(result.claims, evidenceById, expectedExpert, 'claims');
  assertPrimaryEvidence(result.actions, evidenceById, expectedExpert, 'actions');

  for (const [index, claim] of result.claims.entries()) {
    const rule = claimRules[claim.code];
    if (!rule) throw new TypeError(`claims[${index}] contains an unregistered dynamic claim code: ${claim.code}`);
    if (claim.statement !== rule.statement) throw new TypeError(`claims[${index}] must use the trusted claim template`);
    if (rule.requiredEvidenceIds.some((id) => !claim.evidenceIds.includes(id))) {
      throw new TypeError(`claims[${index}] does not contain the required evidence relation`);
    }
    const citedEvidence = claim.evidenceIds.map((id) => evidenceById.get(id));
    if (!rule.predicate({ evidenceById, citedEvidence, claim })) {
      throw new TypeError(`claims[${index}] semantic predicate does not match canonical evidence`);
    }
  }
  for (const [index, action] of result.actions.entries()) {
    const rule = actionRules[action.code];
    if (!rule) throw new TypeError(`actions[${index}] contains an unregistered dynamic action code`);
    if (action.title !== rule.title) throw new TypeError(`actions[${index}] must use the trusted action template`);
    if (rule.requiredEvidenceIds.some((id) => !action.evidenceIds.includes(id))) {
      throw new TypeError(`actions[${index}] does not contain the required evidence relation`);
    }
    const citedEvidence = action.evidenceIds.map((id) => evidenceById.get(id));
    if (!rule.predicate({ evidenceById, citedEvidence, action })) {
      throw new TypeError(`actions[${index}] semantic predicate does not match canonical evidence`);
    }
  }
  return result;
}

export function buildTrustedDynamicExpertOpinion({
  registry,
  expert,
  claimCodes,
  actionCodes,
  assumptions = [],
  uncertainty = [],
  escalation = false,
}) {
  const claimRules = dynamicRules(registry, expert, 'claim');
  const actionRules = dynamicRules(registry, expert, 'action');
  const proposal = {
    expert,
    claims: claimCodes.map((code) => {
      const rule = claimRules[code];
      if (!rule) throw new TypeError(`Unknown trusted dynamic claim code: ${code}`);
      return {
        code,
        statement: rule.statement,
        evidenceIds: [...rule.requiredEvidenceIds],
        confidence: code.includes('UNCERTAIN') || code.includes('REQUIRES_VERIFICATION') ? 'LOW' : 'HIGH',
      };
    }),
    assumptions: structuredClone(assumptions),
    uncertainty: structuredClone(uncertainty),
    actions: actionCodes.map((code) => {
      const rule = actionRules[code];
      if (!rule) throw new TypeError(`Unknown trusted dynamic action code: ${code}`);
      return { code, title: rule.title, evidenceIds: [...rule.requiredEvidenceIds] };
    }),
    escalation,
  };
  return verifyDynamicExpertOpinion({ proposal, registry, expectedExpert: expert });
}

export const DYNAMIC_EXPERT_CLAIM_CODES = Object.freeze(
  Object.fromEntries(['MARKET', 'OPERATIONS', 'FINANCE', 'POLICY'].map((expert) => [
    expert,
    Object.freeze([...new Set(Object.values(DYNAMIC_CLAIM_RULES_BY_STAGE).flatMap((stage) => Object.keys(stage[expert]))) ]),
  ])),
);

export const DYNAMIC_EXPERT_ACTION_CODES = Object.freeze(
  Object.fromEntries(['MARKET', 'OPERATIONS', 'FINANCE', 'POLICY'].map((expert) => [
    expert,
    Object.freeze([...new Set(Object.values(DYNAMIC_ACTION_RULES_BY_STAGE).flatMap((stage) => Object.keys(stage[expert]))) ]),
  ])),
);
