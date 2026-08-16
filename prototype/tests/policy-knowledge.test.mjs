import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePolicyMatch } from '../src/domain/policy-knowledge.mjs';
import { openPolicyDatabase } from '../src/policy-db/database.mjs';
import { initializePolicySchema, searchPolicyDatabase, upsertPolicySnapshot } from '../src/policy-db/policy-repository.mjs';
import seedPolicies from '../database/seed-policies.json' with { type: 'json' };

function searchPolicies(query, profile, now) {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  seedPolicies.forEach((policy) => upsertPolicySnapshot(database, policy, '2026-08-02T00:00:00.000Z'));
  const matches = searchPolicyDatabase(database, {
    query,
    regionCode: profile.business.regionCode,
    lifecycleStage: profile.stage,
    now,
    freshnessDays: 30,
  });
  database.close();
  return matches;
}

const seoulPreStartProfile = { business: { regionCode: 'SEOUL' }, stage: 'PRE_START' };

test('Seoul pre-start search excludes archived and out-of-region programs', () => {
  const matches = searchPolicies('창업 자금과 컨설팅', seoulPreStartProfile, new Date('2026-08-01T00:00:00+09:00'));
  assert.ok(matches.some((item) => item.policyId === 'policy-seoul-2026-support'));
  assert.ok(!matches.some((item) => item.policyId === 'policy-seoul-2026-online-sales'));
  assert.ok(!matches.some((item) => item.policyId === 'policy-gyeonggi-2026-fund'));
  assert.ok(matches.every((item) => validatePolicyMatch(item).valid));
});

test('missing eligibility becomes CHECK_REQUIRED instead of an approval claim', () => {
  const [match] = searchPolicies('창업 자금', seoulPreStartProfile, new Date('2026-08-01T00:00:00+09:00'));
  assert.notEqual(match.eligibility, 'APPROVED');
  assert.ok(['LIKELY_MATCH', 'CHECK_REQUIRED'].includes(match.eligibility));
});

test('unrelated query returns no policy recommendations', () => {
  const matches = searchPolicies('quantum zebra', seoulPreStartProfile, new Date('2026-08-01T00:00:00+09:00'));
  assert.deepEqual(matches, []);
});
