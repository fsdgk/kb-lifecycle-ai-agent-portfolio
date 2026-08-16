import test from 'node:test';
import assert from 'node:assert/strict';
import { openPolicyDatabase } from '../src/policy-db/database.mjs';
import { initializePolicySchema, upsertPolicySnapshot } from '../src/policy-db/policy-repository.mjs';
import seedPolicies from '../database/seed-policies.json' with { type: 'json' };

test('database fixture preserves six official policy sources', () => {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  seedPolicies.forEach((policy) => upsertPolicySnapshot(database, policy, '2026-08-02T00:00:00.000Z'));

  const policies = database.prepare(`
    SELECT policy_id AS policyId, official_url AS officialUrl, verified_at AS verifiedAt, status
    FROM policies ORDER BY policy_id
  `).all();
  database.close();

  assert.equal(policies.length, 6);
  assert.ok(policies.every((policy) => policy.officialUrl && policy.verifiedAt === '2026-08-01'));
  assert.equal(policies.find((policy) => policy.policyId === 'policy-seoul-2026-online-sales').status, 'ARCHIVED');
});
