import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPseudonymousCase,
  assertExternalPayloadSafe,
  classifyRequest,
  routeModelTask,
} from '../src/domain/security-gateway.mjs';

test('approved commercial model receives ratios and ranges, never raw identifiers', () => {
  const payload = buildPseudonymousCase(
    {
      customerName: 'Kim Customer',
      businessNumber: '123-45-67890',
      accountNumber: '110-123-456789',
      industry: 'private restaurant',
      district: 'Gangnam',
    },
    {
      salesChangeRate: -0.2,
      costRatioBefore: 0.34,
      costRatioAfter: 0.42,
      shortfallRange: { low: 18_000_000, high: 23_000_000 },
    },
    { category: 'restaurant', region: 'Seoul Gangnam' },
  );

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /Kim Customer|123-45-67890|110-123-456789|private restaurant/);
  assert.match(serialized, /restaurant/);
  assert.doesNotThrow(() => assertExternalPayloadSafe(payload));
});

test('raw transaction text forces internal-only routing', () => {
  assert.equal(
    classifyRequest({ accountNumber: '110-123', rawTransactions: [{ memo: 'supplier payment' }] }),
    'INTERNAL_ONLY',
  );
});

test('public-source summarization is classified as public', () => {
  assert.equal(
    classifyRequest({ source: 'PUBLIC', operation: 'SUMMARIZATION', text: 'published report' }),
    'PUBLIC',
  );
});

test('raw financial data is classified as internal-only', () => {
  assert.equal(
    classifyRequest({ rawFinancialData: { monthlySalesKrw: 19_600_000 } }),
    'INTERNAL_ONLY',
  );
});

test('structured expert narrative over a safe case uses the approved enterprise model', () => {
  assert.equal(
    routeModelTask({
      type: 'STRUCTURED_EXPERT_NARRATIVE',
      case: {
        industryCategory: 'restaurant',
        regionLevel2: 'Seoul Gangnam',
        salesChangeRate: -0.2,
        costRatioBefore: 0.34,
        costRatioAfter: 0.42,
        shortfallRange: { low: 18_000_000, high: 23_000_000 },
        synthetic: true,
      },
    }),
    'APPROVED_ENTERPRISE_MODEL',
  );
});

test('malformed requests fail closed to internal-only', () => {
  assert.equal(classifyRequest(null), 'INTERNAL_ONLY');
});

test('recursive validation rejects a nested counterparty field', () => {
  assert.throws(
    () => assertExternalPayloadSafe({ evidence: [{ counterparty: 'Supplier A' }] }),
    /sensitive field: counterparty/i,
  );
});

test('public-source summarization uses the public model', () => {
  assert.equal(
    routeModelTask({
      type: 'PUBLIC_SOURCE_SUMMARIZATION',
      source: 'PUBLIC',
      operation: 'SUMMARIZATION',
      text: 'published report',
    }),
    'PUBLIC_MODEL',
  );
});

test('raw-data calculation uses internal rules only', () => {
  assert.equal(
    routeModelTask({
      type: 'RAW_DATA_CALCULATION',
      rawFinancialData: { monthlySalesKrw: 19_600_000 },
    }),
    'INTERNAL_RULES_ONLY',
  );
});

test('structured narrative with non-allowlisted case data stays internal', () => {
  assert.equal(
    routeModelTask({
      type: 'STRUCTURED_EXPERT_NARRATIVE',
      case: { industryCategory: 'restaurant', freeform: 'uncontrolled detail' },
    }),
    'INTERNAL_RULES_ONLY',
  );
});

test('external payload validation rejects nested shortfall fields outside its exact schema', () => {
  assert.throws(
    () => assertExternalPayloadSafe({
      industryCategory: 'restaurant',
      regionLevel2: 'Seoul Gangnam',
      salesChangeRate: -0.2,
      costRatioBefore: 0.34,
      costRatioAfter: 0.42,
      shortfallRange: { low: 18_000_000, high: 23_000_000, currency: 'KRW' },
      synthetic: true,
    }),
    /shortfallRange/i,
  );
});

test('raw identity data stays internal and cannot route to the approved model', () => {
  const task = {
    type: 'STRUCTURED_EXPERT_NARRATIVE',
    rawIdentityData: { email: 'owner@example.com' },
    case: {
      industryCategory: 'restaurant',
      regionLevel2: 'Seoul Gangnam',
      salesChangeRate: -0.2,
      costRatioBefore: 0.34,
      costRatioAfter: 0.42,
      shortfallRange: { low: 18_000_000, high: 23_000_000 },
      synthetic: true,
    },
  };

  assert.equal(classifyRequest(task), 'INTERNAL_ONLY');
  assert.equal(routeModelTask(task), 'INTERNAL_RULES_ONLY');
});

test('direct and nested identity contact fields stay internal', () => {
  const safeCase = {
    industryCategory: 'restaurant',
    regionLevel2: 'Seoul Gangnam',
    salesChangeRate: -0.2,
    costRatioBefore: 0.34,
    costRatioAfter: 0.42,
    shortfallRange: { low: 18_000_000, high: 23_000_000 },
    synthetic: true,
  };
  const identityFields = [
    { phone: '010-1234-5678' },
    { email: 'owner@example.com' },
    { contact: 'owner contact' },
    { context: { address: 'Seoul Gangnam-gu' } },
  ];

  for (const identityData of identityFields) {
    const task = { type: 'STRUCTURED_EXPERT_NARRATIVE', ...identityData, case: safeCase };
    assert.equal(classifyRequest(task), 'INTERNAL_ONLY');
    assert.equal(routeModelTask(task), 'INTERNAL_RULES_ONLY');
  }
});
