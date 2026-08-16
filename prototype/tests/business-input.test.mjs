import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadIndustryBenchmark,
  normalizeBusinessInput,
} from '../src/domain/business-input.mjs';

const operatingInput = () => ({
  path: 'OPERATING',
  stage: 'OPERATING',
  regionCode: 'SEOUL',
  districtCode: 'SEONGDONG',
  neighborhoodName: '성수동',
  industryTemplate: 'FOOD_CAFE',
  businessProfile: { businessName: 'Example Cafe' },
  operating: {
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
});

test('users choose operating and keep their declared values', () => {
  const value = normalizeBusinessInput(operatingInput());

  assert.equal(value.path, 'OPERATING');
  assert.equal(value.stage, 'OPERATING');
  assert.equal(value.operating.declaredNetProfitKrw, 2_000_000);
  assert.equal(value.operating.declaredMarginRate, 0.1);
  assert.deepEqual(value.operating.customCosts, [{ label: 'Cleaning', amountKrw: 200_000 }]);
});

test('preserves a declared operating loss exactly', () => {
  const input = operatingInput();
  input.operating.declaredNetProfitKrw = -2_000_000;

  const value = normalizeBusinessInput(input);

  assert.equal(value.operating.declaredNetProfitKrw, -2_000_000);
});

test('users choose startup only when its stage matches', () => {
  const value = normalizeBusinessInput({
    path: 'STARTUP',
    stage: 'STARTUP',
    regionCode: 'SEOUL',
    districtCode: 'MAPO',
    neighborhoodName: '상수동',
    industryTemplate: 'RETAIL',
    businessProfile: { businessName: 'Example Store' },
    startup: { plannedStartupCostKrw: 10_000_000, ownCapitalKrw: 3_000_000 },
  });

  assert.equal(value.path, 'STARTUP');
  assert.equal(value.startup.ownCapitalKrw, 3_000_000);
  assert.equal(value.operating, undefined);
});

test('rejects missing or mismatched path and stage', () => {
  assert.throws(() => normalizeBusinessInput({ stage: 'STARTUP' }), /path/i);
  assert.throws(() => normalizeBusinessInput({ path: 'STARTUP' }), /stage/i);
  assert.throws(() => normalizeBusinessInput({ path: 'STARTUP', stage: 'OPERATING' }), /match/i);
});

test('requires a plain business profile object', () => {
  const invalidProfiles = [
    undefined,
    'Example Cafe',
    [],
    new Date(),
    new (class BusinessProfile {})(),
  ];

  for (const businessProfile of invalidProfiles) {
    const input = operatingInput();
    input.businessProfile = businessProfile;
    assert.throws(() => normalizeBusinessInput(input), /businessProfile.*plain object/i);
  }
});

test('rejects negative or fractional KRW amounts and invalid declared margins', () => {
  const negative = operatingInput();
  negative.operating.rentKrw = -1;
  assert.throws(() => normalizeBusinessInput(negative), /non-negative integer KRW/i);

  const fractional = operatingInput();
  fractional.operating.materialCostKrw = 0.5;
  assert.throws(() => normalizeBusinessInput(fractional), /non-negative integer KRW/i);

  const extremeMargin = operatingInput();
  extremeMargin.operating.declaredMarginRate = 1.01;
  assert.throws(() => normalizeBusinessInput(extremeMargin), /-1.*1/i);
});

test('rejects blank, duplicate, and excessive custom costs', () => {
  const blank = operatingInput();
  blank.operating.customCosts = [{ label: '  ', amountKrw: 1 }];
  assert.throws(() => normalizeBusinessInput(blank), /label/i);

  const duplicate = operatingInput();
  duplicate.operating.customCosts = [
    { label: 'Cleaning', amountKrw: 1 },
    { label: ' cleaning ', amountKrw: 2 },
  ];
  assert.throws(() => normalizeBusinessInput(duplicate), /duplicate/i);

  const excessive = operatingInput();
  excessive.operating.customCosts = Array.from({ length: 21 }, (_, index) => ({
    label: `Cost ${index + 1}`,
    amountKrw: index,
  }));
  assert.throws(() => normalizeBusinessInput(excessive), /twenty/i);
});

test('loads disclosed prototype ranges for every supported industry template', () => {
  for (const templateId of ['FOOD_CAFE', 'RETAIL', 'PERSONAL_SERVICE', 'GENERAL']) {
    const benchmark = loadIndustryBenchmark(templateId);
    assert.equal(benchmark.templateId, templateId);
    assert.equal(benchmark.status, 'PROTOTYPE_REFERENCE_RANGE');
    assert.equal(typeof benchmark.disclosure, 'string');
    assert.ok(benchmark.disclosure.length > 0);
    for (const ratio of ['labor', 'rent', 'materialsPurchases', 'platformFees', 'otherCustomCosts', 'operatingMargin']) {
      assert.equal(typeof benchmark.ranges[ratio].low, 'number');
      assert.equal(typeof benchmark.ranges[ratio].high, 'number');
    }
  }
});

test('rejects unknown industry templates', () => {
  const input = operatingInput();
  input.industryTemplate = 'CROATIAN_RESTAURANT';
  assert.throws(() => normalizeBusinessInput(input), /unknown.*template/i);
  assert.throws(() => loadIndustryBenchmark('UNKNOWN'), /unknown.*template/i);
});
