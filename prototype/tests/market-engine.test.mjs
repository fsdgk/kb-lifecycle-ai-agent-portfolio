import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarket, applyRealtimeSignal } from '../src/domain/market-engine.mjs';
import { loadMarketSignals } from '../src/data/repository.mjs';

test('analysis preserves each source timestamp and excludes expired signals', () => {
  const now = new Date('2026-08-01T15:00:00+09:00');
  const signals = [
    ...loadMarketSignals(),
    {
      signalId: 'signal-expired-cost',
      synthetic: true,
      scenarioId: 'scenario-seoul-croatia-001',
      source: 'ingredientCostIndex',
      metric: 'INGREDIENT_COST_INDEX',
      value: 1.14,
      asOf: '2026-07-31T12:00:00+09:00',
      maxAgeHours: 24,
      refreshTier: 'DAILY',
      unit: 'INDEX',
    },
  ];

  const result = analyzeMarket(signals, now);

  assert.equal(result.asOfBySource.seoulEstimatedSales, '2026-08-01');
  assert.ok(result.usableSignals.every((signal) => signal.status === 'CURRENT'));
  assert.ok(result.excludedSignals.every((signal) => signal.status === 'STALE'));
  assert.equal(result.usableSignals.find((signal) => signal.signalId === 'signal-delivery-share'), undefined);
  assert.equal(
    result.excludedSignals.find((signal) => signal.signalId === 'signal-delivery-share')?.status,
    'STALE',
  );
  assert.equal(
    result.excludedSignals.find((signal) => signal.signalId === 'signal-expired-cost')?.status,
    'STALE',
  );
});

test('realtime cost event updates outlook without changing monthly source dates', () => {
  const base = analyzeMarket(loadMarketSignals(), new Date('2026-08-01T15:00:00+09:00'));
  const updated = applyRealtimeSignal(base, {
    id: 'signal-cost-spike',
    metric: 'ingredientCostIndex',
    value: 1.14,
    asOf: '2026-08-01T15:05:00+09:00',
    refreshTier: 'REALTIME',
  });

  assert.notDeepEqual(updated.scenarios, base.scenarios);
  assert.equal(updated.asOfBySource.seoulEstimatedSales, base.asOfBySource.seoulEstimatedSales);
  assert.equal(updated.asOfBySource.ingredientCostIndex, '2026-08-01T15:05:00+09:00');
  assert.equal(updated.usableSignals.at(-1).status, 'CURRENT');

  const laterCost = applyRealtimeSignal(updated, {
    id: 'signal-cost-spike-2',
    metric: 'ingredientCostIndex',
    value: 1.5,
    asOf: '2026-08-01T15:10:00+09:00',
    refreshTier: 'REALTIME',
  });
  const refreshedDemand = applyRealtimeSignal(laterCost, {
    id: 'signal-footfall-revision',
    metric: 'weekendFootfallIndex',
    value: 130,
    asOf: '2026-08-01T15:15:00+09:00',
    refreshTier: 'REALTIME',
  });

  assert.notDeepEqual(laterCost.scenarios, updated.scenarios);
  assert.equal(refreshedDemand.asOfBySource.seoulEstimatedSales, '2026-08-01T15:15:00+09:00');
});

test('newest timestamp wins when current source signals arrive out of order', () => {
  const result = analyzeMarket([
    {
      signalId: 'signal-footfall-newest',
      source: 'seoulEstimatedSales',
      metric: 'WEEKEND_FOOTFALL_INDEX',
      value: 130,
      asOf: '2026-08-01T14:00:00+09:00',
      maxAgeHours: 24,
      refreshTier: 'DAILY',
    },
    {
      signalId: 'signal-footfall-older',
      source: 'seoulEstimatedSales',
      metric: 'WEEKEND_FOOTFALL_INDEX',
      value: 106,
      asOf: '2026-08-01T13:00:00+09:00',
      maxAgeHours: 24,
      refreshTier: 'DAILY',
    },
  ], new Date('2026-08-01T15:00:00+09:00'));

  assert.equal(result.asOfBySource.seoulEstimatedSales, '2026-08-01T14:00:00+09:00');
  assert.equal(result.scenarios.baseline.index, 105);
  assert.equal(result.dataDisclosure, 'Latest available inputs are used; not all sources are live.');
});

test('synthetic A/B inputs produce a deterministic and traceable site comparison', () => {
  const result = analyzeMarket(
    loadMarketSignals(),
    new Date('2026-08-01T15:00:00+09:00'),
  );

  assert.deepEqual(result.siteComparison, [
    { siteId: 'A', score: 64, rank: 2, evidenceIds: ['market.site.A'] },
    { siteId: 'B', score: 68, rank: 1, evidenceIds: ['market.site.B'] },
  ]);
  assert.equal(result.preferredSite, 'B');
  assert.equal(result.siteConfidence.level, 'MEDIUM');
  assert.equal(result.siteConfidence.synthetic, true);
  assert.deepEqual(
    result.siteEvidence.map((item) => ({
      id: item.id,
      source: item.source,
      signalId: item.signalId,
      scenarioId: item.scenarioId,
      synthetic: item.synthetic,
      asOf: item.asOf,
      refreshTier: item.refreshTier,
      maxAgeHours: item.maxAgeHours,
    })),
    [
      {
        id: 'market.site.A',
        source: 'syntheticSiteComparison',
        signalId: 'signal-site-candidate-a',
        scenarioId: 'scenario-seoul-croatia-001',
        synthetic: true,
        asOf: '2026-08-01',
        refreshTier: 'WEEKLY',
        maxAgeHours: 168,
      },
      {
        id: 'market.site.B',
        source: 'syntheticSiteComparison',
        signalId: 'signal-site-candidate-b',
        scenarioId: 'scenario-seoul-croatia-001',
        synthetic: true,
        asOf: '2026-08-01',
        refreshTier: 'WEEKLY',
        maxAgeHours: 168,
      },
    ],
  );
});

test('site-only signals do not raise general market confidence', () => {
  const siteSignals = loadMarketSignals().filter((signal) => (
    signal.metric === 'SITE_CANDIDATE_SCORE_INPUT'
  ));
  const result = analyzeMarket(
    siteSignals,
    new Date('2026-08-01T15:00:00+09:00'),
  );

  assert.equal(result.confidence.level, 'LOW');
  assert.equal(result.siteConfidence.level, 'MEDIUM');
  assert.equal(result.preferredSite, 'B');
});
