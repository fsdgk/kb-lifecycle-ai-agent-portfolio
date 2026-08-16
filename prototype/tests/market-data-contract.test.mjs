import test from 'node:test';
import assert from 'node:assert/strict';

import { createMarketDataGateway } from '../src/market/market-data-contract.mjs';
import { factualMarketGuidance, plannedMarketIntegrationState } from '../src/domain/market-engine.mjs';
import { renderMarketIntegrationCategories } from '../public/views/market-integrations.js';

const MARKET_CATEGORIES = [
  'NEARBY_COMPETITORS',
  'NEW_OPENINGS',
  'CLOSURES',
  'VACANCIES',
  'RENT_LISTINGS',
  'FOOTFALL',
  'SALES_TREND',
];

function providerCategory(overrides = {}) {
  return {
    category: 'FOOTFALL',
    source: 'official-market-provider',
    asOf: '2026-08-03T09:00:00+09:00',
    confidence: 'MEDIUM',
    ...overrides,
  };
}

test('missing provider returns the explicit planned integration state without market facts', async () => {
  const gateway = createMarketDataGateway({});
  const result = await gateway.getAreaSnapshot({ region: 'SEOUL', industry: 'FOOD_CAFE' });

  assert.deepEqual(result, plannedMarketIntegrationState('SEOUL', 'FOOD_CAFE'));
  assert.equal(result.status, 'PLANNED_INTEGRATION');
  assert.deepEqual(result.categories, MARKET_CATEGORIES);
  assert.match(result.disclosure, /No live external market provider/);
});

test('provider categories retain only complete provenance and supported categories', async () => {
  const gateway = createMarketDataGateway({
    providerName: 'official-market-provider',
    fetchAreaSnapshot: async () => [providerCategory()],
  });

  const result = await gateway.getAreaSnapshot({
    region: 'SEOUL', industry: 'FOOD_CAFE', now: new Date('2026-08-03T10:00:00+09:00'),
  });

  assert.deepEqual(result.categories, [providerCategory()]);
  assert.equal(result.status, 'CURRENT');
  await assert.rejects(
    () => createMarketDataGateway({
      providerName: 'official-market-provider',
      fetchAreaSnapshot: async () => [providerCategory({ source: '' })],
    }).getAreaSnapshot({ region: 'SEOUL', industry: 'FOOD_CAFE' }),
    /source/i,
  );
  for (const field of ['category', 'source', 'asOf', 'confidence']) {
    const incomplete = providerCategory();
    delete incomplete[field];
    await assert.rejects(
      () => createMarketDataGateway({
        providerName: 'official-market-provider',
        fetchAreaSnapshot: async () => [incomplete],
      }).getAreaSnapshot({ region: 'SEOUL', industry: 'FOOD_CAFE' }),
      new RegExp(field, 'i'),
    );
  }
});

test('market gateway does not transmit finance or identity data to a provider', async () => {
  let providerRequest;
  const gateway = createMarketDataGateway({
    providerName: 'official-market-provider',
    fetchAreaSnapshot: async (request) => {
      providerRequest = request;
      return [providerCategory()];
    },
  });

  await assert.rejects(
    () => gateway.getAreaSnapshot({
      region: 'SEOUL', industry: 'FOOD_CAFE', monthlySalesKrw: 20_000_000,
    }),
    /approved fields/i,
  );
  assert.equal(providerRequest, undefined);

  await assert.rejects(
    () => createMarketDataGateway({
      providerName: 'official-market-provider',
      fetchAreaSnapshot: async () => [providerCategory({ ownerEmail: 'owner@example.com' })],
    }).getAreaSnapshot({ region: 'SEOUL', industry: 'FOOD_CAFE' }),
    /approved fields/i,
  );
});

test('stale provider categories are excluded from factual guidance and placeholders name all planned categories', async () => {
  const gateway = createMarketDataGateway({
    providerName: 'official-market-provider',
    fetchAreaSnapshot: async () => [providerCategory({ asOf: '2026-08-01T09:00:00+09:00' })],
  });
  const now = new Date('2026-08-03T10:00:00+09:00');
  const result = await gateway.getAreaSnapshot({ region: 'SEOUL', industry: 'FOOD_CAFE', now });

  assert.equal(result.status, 'PLANNED_INTEGRATION');
  assert.deepEqual(factualMarketGuidance([providerCategory({ asOf: '2026-08-01T09:00:00+09:00' })], now), []);
  const html = renderMarketIntegrationCategories(MARKET_CATEGORIES);
  for (const category of MARKET_CATEGORIES) assert.match(html, new RegExp(category));
  assert.doesNotMatch(html, /\d{2,}/);
});

test('oversized provider freshness hints cannot revive stale categories beyond service-owned limits', async () => {
  const now = new Date('2026-08-03T10:00:00+09:00');

  for (const category of MARKET_CATEGORIES) {
    const gateway = createMarketDataGateway({
      providerName: 'official-market-provider',
      fetchAreaSnapshot: async () => [providerCategory({
        category,
        asOf: '2020-01-01T00:00:00Z',
        maxAgeHours: 1_000_000,
      })],
    });

    const result = await gateway.getAreaSnapshot({ region: 'SEOUL', industry: 'FOOD_CAFE', now });
    assert.equal(result.status, 'PLANNED_INTEGRATION', `${category} must not use a provider-widened freshness window`);
  }
});

test('factual guidance excludes current-looking categories with missing or invalid provenance', () => {
  const now = new Date('2026-08-03T10:00:00+09:00');
  const incomplete = providerCategory();
  delete incomplete.source;

  for (const category of [
    incomplete,
    providerCategory({ category: 'UNKNOWN_CATEGORY' }),
    providerCategory({ source: 'owner@example.com' }),
    providerCategory({ asOf: 'not-a-timestamp' }),
    providerCategory({ confidence: 'UNVERIFIED' }),
  ]) {
    assert.deepEqual(factualMarketGuidance([category], now), []);
  }
});
