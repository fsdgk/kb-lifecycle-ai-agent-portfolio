import test from 'node:test';
import assert from 'node:assert/strict';
import { loadIndustryBenchmark, normalizeBusinessInput } from '../src/domain/business-input.mjs';
import { analyzeOperatingInput, analyzeStartupInput } from '../src/domain/business-analysis.mjs';

const foodBenchmark = loadIndustryBenchmark('FOOD_CAFE');

const startupFixture = normalizeBusinessInput({
  path: 'STARTUP',
  stage: 'STARTUP',
  regionCode: 'SEOUL',
  industryTemplate: 'FOOD_CAFE',
  businessProfile: { businessName: 'Example Cafe' },
  startup: {
    declaredTotalBudgetKrw: 112_000_000,
    ownCapitalKrw: 60_000_000,
    depositKrw: 30_000_000,
    interiorCostKrw: 40_000_000,
    equipmentCostKrw: 30_000_000,
    initialInventoryKrw: 10_000_000,
    customCosts: [{ label: 'Opening permit', amountKrw: 2_000_000 }],
  },
});

const operatingFixture = (overrides = {}) => {
  const operating = {
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
    ...overrides,
  };
  for (const [key, value] of Object.entries(operating)) {
    if (value === undefined) delete operating[key];
  }
  return normalizeBusinessInput({
  path: 'OPERATING',
  stage: 'OPERATING',
  regionCode: 'SEOUL',
  industryTemplate: 'FOOD_CAFE',
  businessProfile: { businessName: 'Example Cafe' },
  operating,
  });
};

test('startup analysis compares declared budget, detail sum, capital and buffer', () => {
  const result = analyzeStartupInput(startupFixture, foodBenchmark);

  assert.equal(result.detailCostTotalKrw, 112_000_000);
  assert.equal(result.fundingGapKrw, 52_000_000);
  assert.equal(result.declaredBudgetDifferenceKrw, 0);
  assert.equal(result.recommendedBufferKrw, 16_800_000);
  assert.deepEqual(result.warnings, []);
});

test('startup reports a declared budget mismatch without changing its funding calculation', () => {
  const input = structuredClone(startupFixture);
  input.startup.declaredTotalBudgetKrw = 111_999_999;

  const result = analyzeStartupInput(input, foodBenchmark);

  assert.equal(result.declaredBudgetDifferenceKrw, -1);
  assert.equal(result.fundingGapKrw, 52_000_000);
  assert.deepEqual(result.warnings, ['DECLARED_BUDGET_MISMATCH']);
});

test('operating analysis preserves declarations and calculates independent values', () => {
  const result = analyzeOperatingInput(operatingFixture(), foodBenchmark);

  assert.equal(result.declared.netProfitKrw, 2_000_000);
  assert.equal(result.calculated.netProfitKrw, 4_300_000);
  assert.equal(result.differences.netProfitKrw, -2_300_000);
  assert.equal(result.ratios.labor, 0.25);
  assert.equal(result.ratios.otherCustomCosts, 0.06);
  assert.equal(result.costTotalKrw, 15_700_000);
  assert.deepEqual(result.warnings, ['DECLARED_PROFIT_MISMATCH', 'DECLARED_MARGIN_MISMATCH']);
});

test('operating analysis retains negative declarations and flags a negative calculated profit', () => {
  const result = analyzeOperatingInput(operatingFixture({
    declaredNetProfitKrw: -1_000_000,
    declaredMarginRate: 1,
    materialCostKrw: 18_000_000,
  }), foodBenchmark);

  assert.equal(result.declared.netProfitKrw, -1_000_000);
  assert.equal(result.declared.marginRate, 1);
  assert.equal(result.calculated.netProfitKrw, -6_700_000);
  assert.ok(result.warnings.includes('NEGATIVE_CALCULATED_PROFIT'));
  assert.ok(result.warnings.includes('MATERIAL_RATIO_HIGH'));
});

test('zero sales exposes null ratios and a stable review warning', () => {
  const result = analyzeOperatingInput(operatingFixture({ monthlySalesKrw: 0 }), foodBenchmark);

  assert.equal(result.calculated.marginRate, null);
  assert.equal(result.differences.marginRate, null);
  assert.equal(result.ratios.labor, null);
  assert.equal(result.benchmarks.labor, null);
  assert.ok(result.warnings.includes('ZERO_SALES_REVIEW'));
  assert.ok(!result.warnings.includes('DECLARED_MARGIN_MISMATCH'));
});

test('analysis rejects absent declared startup and operating financial declarations', () => {
  const startup = structuredClone(startupFixture);
  delete startup.startup.declaredTotalBudgetKrw;
  assert.throws(
    () => analyzeStartupInput(startup, foodBenchmark),
    /declaredTotalBudgetKrw must be a finite integer KRW amount/,
  );

  const profit = operatingFixture();
  delete profit.operating.declaredNetProfitKrw;
  assert.throws(
    () => analyzeOperatingInput(profit, foodBenchmark),
    /declaredNetProfitKrw must be a finite integer KRW amount/,
  );

  const margin = operatingFixture();
  delete margin.operating.declaredMarginRate;
  assert.throws(
    () => analyzeOperatingInput(margin, foodBenchmark),
    /declaredMarginRate must be a finite number/,
  );
});

test('optional and custom costs are totalled deterministically with half-up KRW buffer rounding', () => {
  const result = analyzeOperatingInput(operatingFixture({
    monthlySalesKrw: 10_000_000,
    laborCostKrw: 0,
    rentKrw: 0,
    materialCostKrw: 0,
    platformFeesKrw: undefined,
    advertisingKrw: undefined,
    utilitiesAndFeesKrw: undefined,
    customCosts: [{ label: 'A', amountKrw: 333_333 }, { label: 'B', amountKrw: 666_667 }],
  }), foodBenchmark);
  const startup = analyzeStartupInput(normalizeBusinessInput({
    path: 'STARTUP', stage: 'STARTUP', regionCode: 'SEOUL', industryTemplate: 'GENERAL',
    businessProfile: { businessName: 'Round' },
    startup: { declaredTotalBudgetKrw: 10, ownCapitalKrw: 0, equipmentCostKrw: 10 },
  }), loadIndustryBenchmark('GENERAL'));

  assert.equal(result.costs.customKrw, 1_000_000);
  assert.equal(result.costTotalKrw, 1_000_000);
  assert.ok(result.warnings.includes('MISSING_COST_REVIEW'));
  assert.equal(startup.recommendedBufferKrw, 2);
  assert.equal(startup.rounding, 'HALF_UP_TO_NEAREST_KRW');
});

test('benchmark boundaries are within and high ratios carry the disclosed prototype range', () => {
  const within = analyzeOperatingInput(operatingFixture({ laborCostKrw: 4_000_000 }), foodBenchmark);
  const high = analyzeOperatingInput(operatingFixture({ laborCostKrw: 7_000_001, rentKrw: 4_000_000 }), foodBenchmark);

  assert.equal(within.benchmarks.labor.status, 'WITHIN');
  assert.equal(high.benchmarks.labor.status, 'HIGH');
  assert.equal(high.benchmarks.rent.status, 'HIGH');
  assert.ok(high.warnings.includes('LABOR_RATIO_HIGH'));
  assert.ok(high.warnings.includes('RENT_RATIO_HIGH'));
  assert.equal(high.benchmarkDisclosure, foodBenchmark.disclosure);
});

test('other and custom costs use prototype-reference LOW WITHIN and HIGH ranges', () => {
  const low = analyzeOperatingInput(operatingFixture({
    advertisingKrw: 0, utilitiesAndFeesKrw: 0, customCosts: [],
  }), foodBenchmark);
  const within = analyzeOperatingInput(operatingFixture({
    advertisingKrw: 500_000, utilitiesAndFeesKrw: 500_000, customCosts: [],
  }), foodBenchmark);
  const high = analyzeOperatingInput(operatingFixture({
    advertisingKrw: 2_000_000, utilitiesAndFeesKrw: 2_000_000,
    customCosts: [{ label: 'Delivery supplies', amountKrw: 1_000_000 }],
  }), foodBenchmark);

  assert.equal(low.benchmarks.otherCustomCosts.status, 'LOW');
  assert.equal(within.benchmarks.otherCustomCosts.status, 'WITHIN');
  assert.equal(high.benchmarks.otherCustomCosts.status, 'HIGH');
  assert.equal(high.benchmarks.otherCustomCosts.range.high, 0.15);
});
