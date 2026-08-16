import { currentMarketCategory } from '../market/market-data-contract.mjs';

export { plannedMarketIntegrationState } from '../market/market-data-contract.mjs';

export function factualMarketGuidance(categories, now = new Date()) {
  if (!Array.isArray(categories)) return [];
  return categories.filter((category) => {
    try {
      return Boolean(currentMarketCategory(category, now));
    } catch {
      return false;
    }
  });
}

const MAX_AGE_HOURS_BY_TIER = {
  REALTIME: 1,
  DAILY: 24,
  WEEKLY: 7 * 24,
  MONTHLY: 31 * 24,
  QUARTERLY: 93 * 24,
};

const SOURCE_BY_METRIC = {
  WEEKEND_FOOTFALL_INDEX: 'seoulEstimatedSales',
  WEEKENDFOOTFALLINDEX: 'seoulEstimatedSales',
  NEARBY_FOREIGN_RESTAURANT_COUNT: 'nearbyForeignRestaurantCount',
  NEARBYFOREIGNRESTAURANTCOUNT: 'nearbyForeignRestaurantCount',
  DELIVERY_SALES_SHARE: 'deliverySalesShare',
  DELIVERYSALESSHARE: 'deliverySalesShare',
  INGREDIENT_COST_INDEX: 'ingredientCostIndex',
  INGREDIENTCOSTINDEX: 'ingredientCostIndex',
};

const metricKey = (metric) => String(metric).toUpperCase().replace(/[^A-Z0-9]/g, '');

function sourceFor(signal) {
  return signal.source ?? SOURCE_BY_METRIC[signal.metric] ?? SOURCE_BY_METRIC[metricKey(signal.metric)] ?? signal.metric;
}

function freshnessFor(signal, now) {
  const maxAgeHours = signal.maxAgeHours ?? MAX_AGE_HOURS_BY_TIER[signal.refreshTier] ?? 0;
  const asOfTime = new Date(signal.asOf).getTime();
  const ageHours = (now.getTime() - asOfTime) / (60 * 60 * 1000);
  const status = Number.isFinite(asOfTime) && ageHours >= 0 && ageHours <= maxAgeHours ? 'CURRENT' : 'STALE';

  return { ...signal, source: sourceFor(signal), maxAgeHours, status };
}

function latestBy(signals, keyFor) {
  const latest = new Map();

  for (const signal of signals) {
    const asOfTime = new Date(signal.asOf).getTime();
    const key = keyFor(signal);
    const prior = latest.get(key);
    if (Number.isFinite(asOfTime) && (!prior || asOfTime > new Date(prior.asOf).getTime())) {
      latest.set(key, signal);
    }
  }

  return latest;
}

function valueFor(signals, key) {
  return latestBy(signals, (signal) => metricKey(signal.metric)).get(key)?.value;
}

function buildScenarios(usableSignals) {
  const footfall = valueFor(usableSignals, 'WEEKENDFOOTFALLINDEX') ?? 100;
  const deliveryShare = valueFor(usableSignals, 'DELIVERYSALESSHARE') ?? 0;
  const competition = valueFor(usableSignals, 'NEARBYFOREIGNRESTAURANTCOUNT') ?? 0;
  const ingredientCost = valueFor(usableSignals, 'INGREDIENTCOSTINDEX') ?? 1;

  const demandLift = Math.round((footfall - 100) / 6) + (deliveryShare >= 0.25 ? 1 : 0);
  const competitionPressure = Math.round(competition / 5);
  const costPressure = Math.round(Math.max(0, ingredientCost - 1) * 10);
  const baselineIndex = 100 + demandLift - competitionPressure - costPressure;

  return {
    horizon: '3_MONTHS',
    downside: {
      index: baselineIndex - 13,
      drivers: ['ingredient_cost', 'rent_pressure'],
    },
    baseline: {
      index: baselineIndex,
      drivers: ['evening_demand', 'novel_cuisine_interest'],
    },
    upside: {
      index: baselineIndex + 11,
      drivers: ['local_event', 'review_growth'],
    },
  };
}

function buildDrivers(usableSignals) {
  const driverByMetric = {
    WEEKENDFOOTFALLINDEX: 'evening_demand',
    DELIVERYSALESSHARE: 'delivery_demand',
    NEARBYFOREIGNRESTAURANTCOUNT: 'competition_pressure',
    INGREDIENTCOSTINDEX: 'ingredient_cost',
  };

  return usableSignals.map((signal) => ({
    driver: driverByMetric[metricKey(signal.metric)] ?? 'market_signal',
    metric: signal.metric,
    source: signal.source,
    asOf: signal.asOf,
  }));
}

function confidenceFor(usableSignals) {
  const generalSignals = usableSignals.filter((signal) => (
    metricKey(signal.metric) !== 'SITECANDIDATESCOREINPUT'
  ));
  const metricKeys = new Set(generalSignals.map((signal) => metricKey(signal.metric)));
  const hasDemand = metricKeys.has('WEEKENDFOOTFALLINDEX') || metricKeys.has('DELIVERYSALESSHARE');
  const hasCompetition = metricKeys.has('NEARBYFOREIGNRESTAURANTCOUNT');
  const hasCost = metricKeys.has('INGREDIENTCOSTINDEX');
  const level = hasDemand && hasCompetition && hasCost ? 'HIGH' : generalSignals.length >= 2 ? 'MEDIUM' : 'LOW';

  return {
    level,
    rationale: `${generalSignals.length} current signal(s); demand=${hasDemand}, competition=${hasCompetition}, cost=${hasCost}`,
  };
}

function buildSiteAnalysis(usableSignals) {
  const siteSignals = usableSignals.filter((signal) => (
    metricKey(signal.metric) === 'SITECANDIDATESCOREINPUT'
    && signal.synthetic === true
    && signal.scenarioId
    && signal.siteId
  ));
  const scored = siteSignals
    .map((signal) => {
      const { demandIndex, costIndex, competitionIndex } = signal.value ?? {};
      if (![demandIndex, costIndex, competitionIndex].every(Number.isFinite)) return undefined;

      return {
        signal,
        score: Math.round(
          demandIndex * 0.5
          + (100 - costIndex) * 0.3
          + (100 - competitionIndex) * 0.2,
        ),
      };
    })
    .filter(Boolean);
  const ranked = [...scored].sort((left, right) => (
    right.score - left.score || String(left.signal.siteId).localeCompare(String(right.signal.siteId))
  ));
  const rankBySite = new Map(ranked.map((item, index) => [item.signal.siteId, index + 1]));
  const siteComparison = scored.map(({ signal, score }) => ({
    siteId: signal.siteId,
    score,
    rank: rankBySite.get(signal.siteId),
    evidenceIds: [`market.site.${signal.siteId}`],
  }));
  const scoreMargin = ranked.length >= 2 ? ranked[0].score - ranked[1].score : 0;
  const confidenceLevel = ranked.length < 2 || scoreMargin < 3
    ? 'LOW'
    : scoreMargin >= 10 ? 'HIGH' : 'MEDIUM';

  return {
    siteComparison,
    preferredSite: ranked[0]?.signal.siteId,
    siteEvidence: scored.map(({ signal, score }) => ({
      id: `market.site.${signal.siteId}`,
      source: signal.source,
      signalId: signal.signalId,
      scenarioId: signal.scenarioId,
      synthetic: signal.synthetic,
      asOf: signal.asOf,
      refreshTier: signal.refreshTier,
      maxAgeHours: signal.maxAgeHours,
      score,
      scoreInputs: signal.value,
      scoringMethod: 'DETERMINISTIC_WEIGHTED_SYNTHETIC_INPUTS',
    })),
    siteConfidence: {
      level: confidenceLevel,
      synthetic: true,
      rationale: `${ranked.length} synthetic candidate(s); score margin=${scoreMargin}`,
    },
  };
}

export function analyzeMarket(signals, now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }

  const annotatedSignals = signals.map((signal) => freshnessFor(signal, now));
  const usableSignals = annotatedSignals.filter((signal) => signal.status === 'CURRENT');
  const excludedSignals = annotatedSignals.filter((signal) => signal.status === 'STALE');
  const asOfBySource = Object.fromEntries(
    [...latestBy(annotatedSignals, (signal) => signal.source)]
      .map(([source, signal]) => [source, signal.asOf]),
  );
  const siteAnalysis = buildSiteAnalysis(usableSignals);

  return {
    usableSignals,
    excludedSignals,
    asOfBySource,
    scenarios: buildScenarios(usableSignals),
    drivers: buildDrivers(usableSignals),
    confidence: confidenceFor(usableSignals),
    ...siteAnalysis,
    dataDisclosure: 'Latest available inputs are used; not all sources are live.',
  };
}

export function applyRealtimeSignal(analysis, signal) {
  const realtimeSignal = {
    ...signal,
    signalId: signal.signalId ?? signal.id,
    source: signal.source ?? sourceFor(signal),
    maxAgeHours: signal.maxAgeHours ?? MAX_AGE_HOURS_BY_TIER.REALTIME,
  };
  const priorSignals = [...analysis.usableSignals, ...analysis.excludedSignals]
    .map(({ status, ...priorSignal }) => priorSignal);

  return analyzeMarket([...priorSignals, realtimeSignal], new Date(realtimeSignal.asOf));
}
