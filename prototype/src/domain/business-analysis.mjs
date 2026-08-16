import { roundKrw } from './finance-engine.mjs';

const STARTUP_DECLARATION_KEYS = new Set(['declaredTotalBudgetKrw', 'plannedStartupCostKrw', 'ownCapitalKrw', 'customCosts']);
const OPTIONAL_OPERATING_COSTS = ['platformFeesKrw', 'advertisingKrw', 'utilitiesAndFeesKrw'];

function sumCustomCosts(customCosts) {
  return (customCosts ?? []).reduce((total, cost) => total + cost.amountKrw, 0);
}

function ratio(amountKrw, salesKrw) {
  return salesKrw === 0 ? null : amountKrw / salesKrw;
}

function classifyRatio(value, range) {
  if (value == null) return null;
  if (value < range.low) return 'LOW';
  if (value > range.high) return 'HIGH';
  return 'WITHIN';
}

function benchmarkResult(value, range) {
  if (value == null) return null;
  return { status: classifyRatio(value, range), range: { ...range } };
}

function requireStartupInput(input) {
  if (input?.path !== 'STARTUP' || input.startup == null) {
    throw new TypeError('input must be a normalized STARTUP business input');
  }
}

function requireOperatingInput(input) {
  if (input?.path !== 'OPERATING' || input.operating == null) {
    throw new TypeError('input must be a normalized OPERATING business input');
  }
}

function requireBenchmark(benchmark) {
  if (benchmark?.status !== 'PROTOTYPE_REFERENCE_RANGE' || benchmark.ranges == null) {
    throw new TypeError('benchmark must be a disclosed prototype reference range');
  }
}

function requireIntegerDeclaration(value, name) {
  if (!Number.isInteger(value)) throw new TypeError(`${name} must be a finite integer KRW amount`);
}

function requireFiniteDeclaration(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
}

export function analyzeStartupInput(input, benchmark) {
  requireStartupInput(input);
  requireBenchmark(benchmark);
  const startup = input.startup;
  const declaredTotalBudgetKrw = startup.declaredTotalBudgetKrw ?? startup.plannedStartupCostKrw;
  requireIntegerDeclaration(declaredTotalBudgetKrw, 'declaredTotalBudgetKrw');
  const detailCostTotalKrw = Object.entries(startup)
    .filter(([key, value]) => !STARTUP_DECLARATION_KEYS.has(key) && key.endsWith('Krw') && Number.isInteger(value))
    .reduce((total, [, value]) => total + value, sumCustomCosts(startup.customCosts));
  const ownCapitalKrw = startup.ownCapitalKrw ?? 0;
  const declaredBudgetDifferenceKrw = declaredTotalBudgetKrw - detailCostTotalKrw;
  const warnings = declaredBudgetDifferenceKrw === 0 ? [] : ['DECLARED_BUDGET_MISMATCH'];

  return {
    declaredTotalBudgetKrw,
    detailCostTotalKrw,
    ownCapitalKrw,
    fundingGapKrw: Math.max(0, detailCostTotalKrw - ownCapitalKrw),
    declaredBudgetDifferenceKrw,
    recommendedBufferKrw: roundKrw(detailCostTotalKrw * 0.15),
    rounding: 'HALF_UP_TO_NEAREST_KRW',
    benchmarkDisclosure: benchmark.disclosure,
    warnings,
  };
}

export function analyzeOperatingInput(input, benchmark) {
  requireOperatingInput(input);
  requireBenchmark(benchmark);
  const operating = input.operating;
  requireIntegerDeclaration(operating.declaredNetProfitKrw, 'declaredNetProfitKrw');
  requireFiniteDeclaration(operating.declaredMarginRate, 'declaredMarginRate');
  const salesKrw = operating.monthlySalesKrw;
  const costs = {
    laborKrw: operating.laborCostKrw ?? 0,
    rentKrw: operating.rentKrw ?? 0,
    materialsPurchasesKrw: operating.materialCostKrw ?? operating.materialsPurchasesCostKrw ?? 0,
    platformFeesKrw: operating.platformFeesKrw ?? 0,
    advertisingKrw: operating.advertisingKrw ?? 0,
    utilitiesAndFeesKrw: operating.utilitiesAndFeesKrw ?? 0,
    customKrw: sumCustomCosts(operating.customCosts),
  };
  const costTotalKrw = Object.values(costs).reduce((total, value) => total + value, 0);
  const calculatedNetProfitKrw = salesKrw - costTotalKrw;
  const ratios = {
    labor: ratio(costs.laborKrw, salesKrw),
    rent: ratio(costs.rentKrw, salesKrw),
    materialsPurchases: ratio(costs.materialsPurchasesKrw, salesKrw),
    platformFees: ratio(costs.platformFeesKrw, salesKrw),
    otherCustomCosts: ratio(costs.advertisingKrw + costs.utilitiesAndFeesKrw + costs.customKrw, salesKrw),
  };
  const calculatedMarginRate = ratio(calculatedNetProfitKrw, salesKrw);
  const benchmarks = {
    labor: benchmarkResult(ratios.labor, benchmark.ranges.labor),
    rent: benchmarkResult(ratios.rent, benchmark.ranges.rent),
    materialsPurchases: benchmarkResult(ratios.materialsPurchases, benchmark.ranges.materialsPurchases),
    platformFees: benchmarkResult(ratios.platformFees, benchmark.ranges.platformFees),
    otherCustomCosts: benchmarkResult(ratios.otherCustomCosts, benchmark.ranges.otherCustomCosts),
    operatingMargin: benchmarkResult(calculatedMarginRate, benchmark.ranges.operatingMargin),
  };
  const warnings = [];
  if (operating.declaredNetProfitKrw !== calculatedNetProfitKrw) warnings.push('DECLARED_PROFIT_MISMATCH');
  if (calculatedMarginRate != null && operating.declaredMarginRate !== calculatedMarginRate) warnings.push('DECLARED_MARGIN_MISMATCH');
  if (benchmarks.labor?.status === 'HIGH') warnings.push('LABOR_RATIO_HIGH');
  if (benchmarks.rent?.status === 'HIGH') warnings.push('RENT_RATIO_HIGH');
  if (benchmarks.materialsPurchases?.status === 'HIGH') warnings.push('MATERIAL_RATIO_HIGH');
  if (OPTIONAL_OPERATING_COSTS.some((key) => operating[key] == null)) warnings.push('MISSING_COST_REVIEW');
  if (salesKrw === 0) warnings.push('ZERO_SALES_REVIEW');
  if (calculatedNetProfitKrw < 0) warnings.push('NEGATIVE_CALCULATED_PROFIT');

  return {
    salesKrw,
    costs,
    costTotalKrw,
    declared: {
      netProfitKrw: operating.declaredNetProfitKrw,
      marginRate: operating.declaredMarginRate,
    },
    calculated: {
      netProfitKrw: calculatedNetProfitKrw,
      marginRate: calculatedMarginRate,
    },
    differences: {
      netProfitKrw: operating.declaredNetProfitKrw - calculatedNetProfitKrw,
      marginRate: calculatedMarginRate == null ? null : operating.declaredMarginRate - calculatedMarginRate,
    },
    ratios,
    benchmarks,
    benchmarkDisclosure: benchmark.disclosure,
    rounding: 'HALF_UP_TO_NEAREST_KRW',
    warnings,
  };
}
