import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.mjs';

async function startServer(t, options) {
  const server = createAppServer(options).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function postAnalysis(baseUrl, input) {
  const response = await fetch(`${baseUrl}/api/analysis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return { response, body: await response.json() };
}

function startupInput() {
  return {
    path: 'STARTUP',
    stage: 'STARTUP',
    regionCode: 'SEOUL',
    districtCode: 'SEONGDONG',
    neighborhoodName: '성수동',
    industryTemplate: 'FOOD_CAFE',
    businessProfile: {
      businessName: 'User supplied startup',
      businessDescription: 'A user-entered food business.',
      registrationStatus: 'NOT_REGISTERED',
    },
    startup: {
      fundingPurpose: 'WORKING_CAPITAL',
      declaredTotalBudgetKrw: 112_000_000,
      ownCapitalKrw: 60_000_000,
      depositKrw: 30_000_000,
      interiorCostKrw: 40_000_000,
      equipmentCostKrw: 30_000_000,
      initialInventoryKrw: 10_000_000,
      permitsMarketingKrw: 2_000_000,
      customCosts: [],
    },
  };
}

function operatingInput() {
  return {
    path: 'OPERATING',
    stage: 'OPERATING',
    regionCode: 'SEOUL',
    districtCode: 'SEONGDONG',
    neighborhoodName: '성수동',
    industryTemplate: 'FOOD_CAFE',
    businessProfile: {
      businessName: 'User supplied operator',
      businessDescription: 'A user-entered operating business.',
      registrationStatus: 'REGISTERED',
    },
    operating: {
      operatingMonths: 18,
      fundingPurpose: 'WORKING_CAPITAL',
      monthlySalesKrw: 20_000_000,
      declaredNetProfitKrw: 2_000_000,
      declaredMarginRate: 0.1,
      laborCostKrw: 5_000_000,
      rentKrw: 2_000_000,
      materialCostKrw: 7_000_000,
      platformFeesKrw: 500_000,
      advertisingKrw: 300_000,
      utilitiesAndFeesKrw: 700_000,
      customCosts: [{ label: 'Cleaning', amountKrw: 200_000 }],
    },
  };
}

test('startup raw input returns only the dynamic analysis composition', async (t) => {
  const baseUrl = await startServer(t);
  const { response, body } = await postAnalysis(baseUrl, startupInput());

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body), ['input', 'analysis', 'market', 'policies', 'council', 'disclosures']);
  assert.equal(body.input.businessProfile.businessName, 'User supplied startup');
  assert.deepEqual(body.analysis, {
    declaredTotalBudgetKrw: 112_000_000,
    detailCostTotalKrw: 112_000_000,
    ownCapitalKrw: 60_000_000,
    fundingGapKrw: 52_000_000,
    declaredBudgetDifferenceKrw: 0,
    recommendedBufferKrw: 16_800_000,
    rounding: 'HALF_UP_TO_NEAREST_KRW',
    benchmarkDisclosure: 'These are prototype reference ranges for discussion only; they are not official industry averages or financial advice.',
    warnings: [],
  });
  assert.equal(body.market.status, 'PLANNED_INTEGRATION');
  assert.equal(body.council.metadata.generator, 'DETERMINISTIC_TRUSTED_TEMPLATES');
  assert.deepEqual(body.council.opinions.map((item) => item.expert), ['MARKET', 'OPERATIONS', 'FINANCE', 'POLICY']);
  assert.ok(body.policies.every((policy) => policy.officialUrl.startsWith('https://')));
  assert.equal(body.disclosures.agentMode, 'PROTOTYPE_DETERMINISTIC_AGENTS');
  assert.equal(body.disclosures.productionModelTarget, 'LOCAL_LLM_PLANNED_NOT_RUNNING');
  assert.doesNotMatch(JSON.stringify(body), /scenario-seoul-croatia|runStoredDemoCouncil|(?:^|[:,\[\s])(?:NaN|Infinity)(?:[,}\]\s]|$)/i);
});

test('operating raw input returns declared and calculated values from that request', async (t) => {
  const baseUrl = await startServer(t);
  const { response, body } = await postAnalysis(baseUrl, operatingInput());

  assert.equal(response.status, 200);
  assert.equal(body.input.path, 'OPERATING');
  assert.equal(body.analysis.declared.netProfitKrw, 2_000_000);
  assert.equal(body.analysis.calculated.netProfitKrw, 4_300_000);
  assert.equal(body.analysis.calculated.marginRate, 0.215);
  assert.equal(body.analysis.differences.netProfitKrw, -2_300_000);
  assert.equal(body.analysis.benchmarks.labor.status, 'WITHIN');
  assert.equal(body.analysis.benchmarks.operatingMargin.status, 'HIGH');
  assert.ok(body.council.opinions.find((item) => item.expert === 'OPERATIONS'));
  assert.doesNotMatch(JSON.stringify(body), /scenario-seoul-croatia|(?:^|[:,\[\s])(?:NaN|Infinity)(?:[,}\]\s]|$)/i);
});

test('invalid dynamic fields use stable field codes and never serialize non-finite numbers', async (t) => {
  const baseUrl = await startServer(t);
  const invalid = operatingInput();
  invalid.operating.declaredMarginRate = null;
  invalid.operating.rentKrw = 1.5;
  const { response, body } = await postAnalysis(baseUrl, invalid);

  assert.equal(response.status, 400);
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(body.error.code, 'INVALID_BUSINESS_INPUT');
  assert.deepEqual(body.error.fields, [{
    field: 'operating.rentKrw',
    code: 'INVALID_KRW_AMOUNT',
    message: 'operating.rentKrw must be a non-negative integer KRW amount',
  }]);
  assert.doesNotMatch(JSON.stringify(body), /(?:^|[:,\[\s])(?:NaN|Infinity)(?:[,}\]\s]|$)/);
});

test('missing required declarations and invalid custom-cost boundaries stay in the field error envelope', async (t) => {
  const baseUrl = await startServer(t);
  const missing = startupInput();
  delete missing.startup.declaredTotalBudgetKrw;
  const missingResult = await postAnalysis(baseUrl, missing);
  assert.equal(missingResult.response.status, 400);
  assert.equal(missingResult.body.error.code, 'INVALID_BUSINESS_INPUT');
  assert.equal(missingResult.body.error.fields[0].field, 'startup.declaredTotalBudgetKrw');

  const missingOperatingContext = operatingInput();
  delete missingOperatingContext.businessProfile.registrationStatus;
  const contextResult = await postAnalysis(baseUrl, missingOperatingContext);
  assert.equal(contextResult.response.status, 400);
  assert.equal(contextResult.body.error.fields[0].field, 'businessProfile.registrationStatus');

  const excessive = operatingInput();
  excessive.operating.customCosts = Array.from({ length: 21 }, (_, index) => ({ label: `Cost ${index}`, amountKrw: index }));
  const excessiveResult = await postAnalysis(baseUrl, excessive);
  assert.equal(excessiveResult.response.status, 400);
  assert.equal(excessiveResult.body.error.fields[0].code, 'INVALID_CUSTOM_COST');
  assert.doesNotMatch(JSON.stringify(excessiveResult.body), /(?:^|[:,\[\s])(?:NaN|Infinity)(?:[,}\]\s]|$)/);
});

test('internal matcher defects return a sanitized 500 instead of a field-validation response', async (t) => {
  const policyDatabase = {
    prepare() { throw new TypeError('internal policy row decoder failed: secret implementation detail'); },
  };
  const baseUrl = await startServer(t, { policyDatabase });
  const { response, body } = await postAnalysis(baseUrl, startupInput());

  assert.equal(response.status, 500);
  assert.deepEqual(body, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  assert.doesNotMatch(JSON.stringify(body), /decoder|secret|implementation/i);
});

test('internal council defects return the same sanitized 500 boundary', async (t) => {
  const dynamicCouncil = async () => {
    throw new RangeError('private council aggregation overflow');
  };
  const baseUrl = await startServer(t, { dynamicCouncil });
  const { response, body } = await postAnalysis(baseUrl, startupInput());

  assert.equal(response.status, 500);
  assert.deepEqual(body, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  assert.doesNotMatch(JSON.stringify(body), /private|council|overflow/i);
});
