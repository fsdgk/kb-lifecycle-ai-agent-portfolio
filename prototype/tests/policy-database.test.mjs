import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { openPolicyDatabase } from '../src/policy-db/database.mjs';
import {
  initializePolicySchema,
  searchPolicyDatabase,
  upsertPolicySnapshot,
} from '../src/policy-db/policy-repository.mjs';
import seedPolicies from '../database/seed-policies.json' with { type: 'json' };

test('official policies are versioned and Seoul retrieval excludes archived and other-region records', () => {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  seedPolicies.forEach((policy) => upsertPolicySnapshot(database, policy, '2026-08-02T00:00:00.000Z'));

  const matches = searchPolicyDatabase(database, {
    query: '李쎌뾽 ?먭툑 而⑥꽕??',
    regionCode: 'SEOUL',
    lifecycleStage: 'PRE_START',
    now: new Date('2026-08-02T00:00:00.000Z'),
    freshnessDays: 30,
  });

  assert.ok(matches.some((item) => item.policyId === 'policy-mss-2026-integrated'));
  assert.ok(matches.some((item) => item.policyId === 'policy-seoul-2026-support'));
  assert.equal(matches.some((item) => item.status === 'ARCHIVED'), false);
  assert.equal(matches.some((item) => item.regionCode === 'GYEONGGI'), false);
});

test('unchanged source content refreshes its verification date without creating a new version', () => {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  const firstSnapshot = seedPolicies.find((policy) => policy.policyId === 'policy-mss-2026-integrated');
  const firstWrite = upsertPolicySnapshot(database, firstSnapshot, '2026-08-02T00:00:00.000Z');
  const refreshedSnapshot = { ...firstSnapshot, verifiedAt: '2026-08-03' };
  const refreshedWrite = upsertPolicySnapshot(database, refreshedSnapshot, '2026-08-03T00:00:00.000Z');

  const matches = searchPolicyDatabase(database, {
    query: '李쎌뾽',
    regionCode: 'SEOUL',
    lifecycleStage: 'PRE_START',
    now: new Date('2026-08-04T00:00:00.000Z'),
    freshnessDays: 1,
  });

  assert.equal(refreshedWrite.changeType, 'UNCHANGED');
  assert.equal(refreshedWrite.versionId, firstWrite.versionId);
  assert.equal(matches.find((item) => item.policyId === firstSnapshot.policyId).verifiedAt, '2026-08-03');
});

test('a reverted official source creates a new immutable version', () => {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  const firstSnapshot = seedPolicies.find((policy) => policy.policyId === 'policy-mss-2026-integrated');
  const firstWrite = upsertPolicySnapshot(database, firstSnapshot, '2026-08-02T00:00:00.000Z');
  const changedSnapshot = { ...firstSnapshot, title: 'Updated official notice', sourceText: 'Updated official notice STARTUP PRE_START' };
  upsertPolicySnapshot(database, changedSnapshot, '2026-08-03T00:00:00.000Z');
  const revertedWrite = upsertPolicySnapshot(database, firstSnapshot, '2026-08-04T00:00:00.000Z');

  const versionCount = database.prepare('SELECT COUNT(*) AS count FROM policy_versions WHERE policy_id = ?')
    .get(firstSnapshot.policyId).count;

  assert.equal(revertedWrite.changeType, 'UPDATED');
  assert.notEqual(revertedWrite.versionId, firstWrite.versionId);
  assert.equal(versionCount, 3);
});

test('identical collection inputs reproduce the same version identifiers', () => {
  const leftDatabase = openPolicyDatabase(':memory:');
  const rightDatabase = openPolicyDatabase(':memory:');
  initializePolicySchema(leftDatabase);
  initializePolicySchema(rightDatabase);
  const snapshot = seedPolicies.find((policy) => policy.policyId === 'policy-mss-2026-integrated');

  const left = upsertPolicySnapshot(leftDatabase, snapshot, '2026-08-02T00:00:00.000Z');
  const right = upsertPolicySnapshot(rightDatabase, snapshot, '2026-08-02T00:00:00.000Z');

  assert.equal(left.versionId, right.versionId);
});

test('initializer accepts an explicit database output and rejects paths outside its database directory', async () => {
  const outputPath = 'database/policy-db-cli-test.sqlite';
  try {
    const initialized = spawnSync(process.execPath, ['scripts/init-policy-db.mjs', '--output', outputPath], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8',
    });
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.equal(existsSync(new URL('../database/policy-db-cli-test.sqlite', import.meta.url)), true);

    const rejected = spawnSync(process.execPath, ['scripts/init-policy-db.mjs', '--output', '../outside.sqlite'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8',
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /must be a file inside prototype\/database/);
  } finally {
    await rm(new URL('../database/policy-db-cli-test.sqlite', import.meta.url), { force: true });
  }
});
