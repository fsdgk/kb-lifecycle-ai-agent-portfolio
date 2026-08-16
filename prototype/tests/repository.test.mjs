import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadBusinessProfile,
  loadTransactions,
  loadPolicies,
  loadMarketSignals,
  loadOntology,
} from '../src/data/repository.mjs';

test('fixtures expose one traceable synthetic scenario and six real policies', () => {
  const profile = loadBusinessProfile();
  assert.equal(profile.scenarioId, 'scenario-seoul-croatia-001');
  assert.equal(profile.synthetic, true);
  assert.equal(profile.business.industryCode, 'I56194');
  assert.equal(loadPolicies().length, 6);
  assert.ok(loadTransactions().every((row) => row.synthetic && row.scenarioId === profile.scenarioId));
  assert.ok(loadMarketSignals().every((row) => (
    row.synthetic && row.scenarioId === profile.scenarioId && row.asOf && row.refreshTier
  )));
  assert.ok(loadOntology().relations.length >= 8);
});

test('policy fixtures preserve the verified inventory and archived snapshot semantics', () => {
  const policies = loadPolicies();
  const requiredFields = [
    'policyId',
    'sourceTitle',
    'officialUrl',
    'verifiedAt',
    'status',
    'regions',
    'lifecycleStages',
    'supportTypes',
    'eligibility',
    'exclusions',
    'requiredChecks',
    'version',
  ];

  assert.deepEqual(
    policies.map((policy) => policy.policyId).sort(),
    [
      'policy-gyeonggi-2026-fund',
      'policy-incheon-2026-support',
      'policy-mss-2026-integrated',
      'policy-seoul-2026-exit',
      'policy-seoul-2026-online-sales',
      'policy-seoul-2026-support',
    ],
  );
  assert.deepEqual(
    Object.fromEntries(policies.map((policy) => [policy.policyId, policy.status])),
    {
      'policy-mss-2026-integrated': 'DETAIL_CHECK_REQUIRED',
      'policy-seoul-2026-support': 'ACTIVE_WITH_SUBPROGRAM_CHECK',
      'policy-seoul-2026-online-sales': 'ARCHIVED',
      'policy-gyeonggi-2026-fund': 'ACTIVE_BUDGET_CHECK_REQUIRED',
      'policy-incheon-2026-support': 'ACTIVE_WITH_SUBPROGRAM_CHECK',
      'policy-seoul-2026-exit': 'ACTIVE_BUDGET_CHECK_REQUIRED',
    },
  );
  assert.ok(policies.every((policy) => requiredFields.every((field) => Object.hasOwn(policy, field))));
  assert.ok(policies.every((policy) => policy.officialUrl && policy.verifiedAt === '2026-08-01'));

  const archivedOnlineSales = policies.find((policy) => policy.policyId === 'policy-seoul-2026-online-sales');
  assert.deepEqual(
    {
      status: archivedOnlineSales.status,
      applicationEnd: archivedOnlineSales.applicationEnd,
      snapshotStatus: archivedOnlineSales.version.snapshotStatus,
      archivedReason: archivedOnlineSales.version.archivedReason,
    },
    {
      status: 'ARCHIVED',
      applicationEnd: '2026-05-25',
      snapshotStatus: 'PRESERVED',
      archivedReason: 'APPLICATION_CLOSED',
    },
  );
});
