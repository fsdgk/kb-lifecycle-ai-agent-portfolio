const SENSITIVE_KEY = /name|number|account|transaction|memo|counterparty/i;
const RAW_FINANCIAL_KEY = /raw.*(?:financial|finance|cash|ledger|balance|sales|cost|revenue|expense)/i;
const RAW_IDENTITY_KEY = /identity|personal|contact|email|phone|address/i;
const ALLOWED_CASE_FIELDS = new Set([
  'industryCategory',
  'regionLevel2',
  'salesChangeRate',
  'costRatioBefore',
  'costRatioAfter',
  'shortfallRange',
  'synthetic',
]);

function containsRawFinancialData(value) {
  if (value == null || typeof value !== 'object') return false;

  return Object.entries(value).some(([key, nestedValue]) => (
    RAW_FINANCIAL_KEY.test(key) || containsRawFinancialData(nestedValue)
  ));
}

function containsRawIdentityData(value) {
  if (value == null || typeof value !== 'object') return false;

  return Object.entries(value).some(([key, nestedValue]) => (
    RAW_IDENTITY_KEY.test(key) || containsRawIdentityData(nestedValue)
  ));
}

function assertNoSensitiveKeys(value) {
  if (value == null || typeof value !== 'object') return;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new TypeError(`External payload contains sensitive field: ${key}`);
    }
    assertNoSensitiveKeys(nestedValue);
  }
}

function assertExactKeys(value, expectedKeys, fieldName) {
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || !keys.every((key) => expectedKeys.includes(key))) {
    throw new TypeError(`${fieldName} must contain only its approved fields`);
  }
}

function isAllowlistedCase(caseData) {
  try {
    assertExternalPayloadSafe(caseData);
    return true;
  } catch {
    return false;
  }
}

export function assertExternalPayloadSafe(payload) {
  assertNoSensitiveKeys(payload);

  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('External payload must be an object');
  }
  assertExactKeys(payload, [...ALLOWED_CASE_FIELDS], 'External payload');

  for (const field of ['industryCategory', 'regionLevel2']) {
    if (typeof payload[field] !== 'string') {
      throw new TypeError(`${field} must be a string`);
    }
  }
  for (const field of ['salesChangeRate', 'costRatioBefore', 'costRatioAfter']) {
    if (!Number.isFinite(payload[field])) {
      throw new TypeError(`${field} must be a finite number`);
    }
  }
  if (typeof payload.synthetic !== 'boolean') {
    throw new TypeError('synthetic must be a boolean');
  }
  if (payload.shortfallRange == null || typeof payload.shortfallRange !== 'object' || Array.isArray(payload.shortfallRange)) {
    throw new TypeError('shortfallRange must be an object');
  }
  assertExactKeys(payload.shortfallRange, ['low', 'high'], 'shortfallRange');
  for (const field of ['low', 'high']) {
    if (!Number.isFinite(payload.shortfallRange[field])) {
      throw new TypeError(`shortfallRange.${field} must be a finite number`);
    }
  }
}

export function buildPseudonymousCase(profile, finance, market) {
  const payload = {
    industryCategory: market.category,
    regionLevel2: market.region,
    salesChangeRate: finance.salesChangeRate,
    costRatioBefore: finance.costRatioBefore,
    costRatioAfter: finance.costRatioAfter,
    shortfallRange: finance.shortfallRange,
    synthetic: Boolean(profile.synthetic ?? finance.synthetic ?? market.synthetic),
  };

  assertExternalPayloadSafe(payload);
  return payload;
}

export function classifyRequest(request) {
  if (request == null || typeof request !== 'object') return 'INTERNAL_ONLY';
  if (containsRawFinancialData(request)) return 'INTERNAL_ONLY';
  if (containsRawIdentityData(request)) return 'INTERNAL_ONLY';

  try {
    assertNoSensitiveKeys(request);
  } catch {
    return 'INTERNAL_ONLY';
  }

  if (
    String(request.source).toUpperCase() === 'PUBLIC'
    && String(request.operation).toUpperCase() === 'SUMMARIZATION'
  ) {
    return 'PUBLIC';
  }

  return 'PSEUDONYMOUS_APPROVED';
}

export function routeModelTask(task) {
  const classification = classifyRequest(task);
  if (classification === 'INTERNAL_ONLY') return 'INTERNAL_RULES_ONLY';

  const kind = String(task.kind ?? task.type ?? task.intent ?? '').toUpperCase();
  if (kind === 'PUBLIC_SOURCE_SUMMARIZATION') {
    return classification === 'PUBLIC' ? 'PUBLIC_MODEL' : 'INTERNAL_RULES_ONLY';
  }
  if (kind === 'STRUCTURED_NARRATIVE' || kind === 'STRUCTURED_EXPERT_NARRATIVE') {
    return classification === 'PSEUDONYMOUS_APPROVED' && isAllowlistedCase(task.case ?? task.payload)
      ? 'APPROVED_ENTERPRISE_MODEL'
      : 'INTERNAL_RULES_ONLY';
  }
  return 'INTERNAL_RULES_ONLY';
}
