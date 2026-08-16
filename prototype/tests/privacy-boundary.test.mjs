import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { calculateStartupFunding } from '../src/domain/finance-engine.mjs';
import { analyzeMarket } from '../src/domain/market-engine.mjs';
import {
  buildEvidenceRegistry,
  projectEvidenceForExpert,
} from '../src/orchestration/evidence-registry.mjs';

const scenario = JSON.parse(readFileSync(new URL('../data/demo-scenario.json', import.meta.url), 'utf8'));

function registryWith(profile = scenario) {
  const snapshot = profile.snapshots.find((item) => item.stage === 'PRE_START');
  return buildEvidenceRegistry({
    profile,
    snapshot,
    finance: calculateStartupFunding(profile),
    market: analyzeMarket(snapshot.marketSignals, new Date(snapshot.asOf)),
    policies: [],
  });
}

test('expert projections omit identity fields, raw cash flows, and unrelated official URLs', () => {
  const profile = structuredClone(scenario);
  profile.ownerName = 'Synthetic Owner';
  profile.businessRegistrationNumber = '000-00-00000';
  const registry = registryWith(profile);

  for (const expert of ['MARKET', 'OPERATIONS', 'FINANCE']) {
    const serialized = JSON.stringify(projectEvidenceForExpert(registry, expert));
    assert.doesNotMatch(serialized, /Synthetic Owner|000-00-00000|dailyFlowsKrw|officialUrl/);
  }
});

test('expert projection is an isolated copy that cannot mutate the canonical registry', () => {
  const registry = registryWith();
  const projection = projectEvidenceForExpert(registry, 'FINANCE');

  projection[0].value = 'tampered';

  assert.notEqual(registry.evidence[0].value, 'tampered');
});

test('unapproved operational free text is rejected before evidence projection', () => {
  const profile = structuredClone(scenario);
  const snapshot = profile.snapshots.find((item) => item.stage === 'PRE_START');
  snapshot.operations.ownerEmail = 'owner@example.com';

  assert.throws(
    () => buildEvidenceRegistry({
      profile,
      snapshot,
      finance: calculateStartupFunding(profile),
      market: analyzeMarket(snapshot.marketSignals, new Date(snapshot.asOf)),
      policies: [],
    }),
    /operations.*approved fields|ownerEmail/i,
  );
});

test('non-synthetic profiles are rejected from the stored demonstration pipeline', () => {
  const profile = structuredClone(scenario);
  profile.synthetic = false;

  assert.throws(() => registryWith(profile), /synthetic/i);
});

test('sensitive text cannot hide inside an approved operational field', () => {
  const profile = structuredClone(scenario);
  const snapshot = profile.snapshots.find((item) => item.stage === 'PRE_START');
  snapshot.operations.menuCostingStatus = 'owner@example.com';

  assert.throws(
    () => buildEvidenceRegistry({
      profile,
      snapshot,
      finance: calculateStartupFunding(profile),
      market: analyzeMarket(snapshot.marketSignals, new Date(snapshot.asOf)),
      policies: [],
    }),
    /sensitive/i,
  );
});

test('central evidence DLP rejects sensitive text in a market source before projection', () => {
  const profile = structuredClone(scenario);
  const snapshot = profile.snapshots.find((item) => item.stage === 'PRE_START');
  snapshot.marketSignals[0].source = 'owner@example.com';

  assert.throws(
    () => buildEvidenceRegistry({
      profile,
      snapshot,
      finance: calculateStartupFunding(profile),
      market: analyzeMarket(snapshot.marketSignals, new Date(snapshot.asOf)),
      policies: [],
    }),
    /sensitive.*evidence|evidence.*sensitive/i,
  );
});
