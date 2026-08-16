import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openPolicyDatabase } from '../src/policy-db/database.mjs';
import { initializePolicySchema } from '../src/policy-db/policy-repository.mjs';
import { syncKnownPolicies } from '../src/policy-db/policy-sync.mjs';

const source = {
  sourceId: 'mss-2026-integrated',
  policyId: 'policy-test',
  title: 'Official test policy',
  organization: 'Test Government',
  officialUrl: 'https://www.mss.go.kr/site/smba/ex/bbs/View.do?bcIdx=1064353&cbIdx=310',
  regionCode: 'SEOUL',
  supportTypes: ['FINANCE'],
  lifecycleStages: ['EARLY_OPERATION'],
  status: 'ACTIVE',
};

const response = (body, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

const versionCount = (database, policyId) => database.prepare(
  'SELECT COUNT(*) AS count FROM policy_versions WHERE policy_id = ?',
).get(policyId).count;

const currentPolicy = (database, policyId) => database.prepare(
  'SELECT status, verified_at AS verifiedAt, current_version_id AS versionId FROM policies WHERE policy_id = ?',
).get(policyId);

const createDatabase = () => {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  return database;
};

test('sync creates a new version only when normalized official source content changes', async () => {
  // A sync that skips text hashing would fail to create the second immutable version.
  const database = createDatabase();
  const first = await syncKnownPolicies({
    database,
    sources: [source],
    fetchImpl: async () => response('Official notice version one'),
    now: new Date('2026-08-02T00:00:00.000Z'),
  });
  const second = await syncKnownPolicies({
    database,
    sources: [source],
    fetchImpl: async () => response('Official   notice\nversion two'),
    now: new Date('2026-08-03T00:00:00.000Z'),
  });
  const unchanged = await syncKnownPolicies({
    database,
    sources: [source],
    fetchImpl: async () => response('Official notice version two'),
    now: new Date('2026-08-04T00:00:00.000Z'),
  });

  assert.equal(first.createdCount, 1);
  assert.equal(second.updatedCount, 1);
  assert.equal(unchanged.unchangedCount, 1);
  assert.equal(versionCount(database, 'policy-test'), 2);
  const latestVersion = database.prepare(
    'SELECT source_hash AS sourceHash, source_text AS sourceText FROM policy_versions WHERE policy_id = ? ORDER BY collected_at DESC LIMIT 1',
  ).get('policy-test');
  assert.equal(latestVersion.sourceText, 'Official notice version two');
  assert.equal(latestVersion.sourceHash, createHash('sha256').update('Official notice version two').digest('hex'));
});

test('HTTP failure retains the last verified version and records a failed source audit', async () => {
  // A failure handler that overwrites the current version or verification date would lose trusted evidence.
  const database = createDatabase();
  await syncKnownPolicies({
    database,
    sources: [source],
    fetchImpl: async () => response('Verified notice'),
    now: new Date('2026-08-02T00:00:00.000Z'),
  });
  const verified = currentPolicy(database, 'policy-test');
  const failed = await syncKnownPolicies({
    database,
    sources: [source],
    fetchImpl: async () => response('Server unavailable', { status: 503 }),
    now: new Date('2026-08-03T00:00:00.000Z'),
  });

  assert.deepEqual(failed.failedSourceIds, ['mss-2026-integrated']);
  assert.equal(versionCount(database, 'policy-test'), 1);
  assert.deepEqual(currentPolicy(database, 'policy-test'), verified);
  assert.equal(database.prepare(
    'SELECT status FROM sync_history WHERE source_id = ? ORDER BY started_at DESC LIMIT 1',
  ).get('mss-2026-integrated').status, 'FAILED');
});

test('an application end date transitions an unchanged policy to CLOSED', async () => {
  // Without lifecycle handling, expired policies remain active despite an elapsed official end date.
  const database = createDatabase();
  const endingSource = { ...source, applicationEnd: '2026-08-02' };
  await syncKnownPolicies({
    database,
    sources: [endingSource],
    fetchImpl: async () => response('Official notice'),
    now: new Date('2026-08-02T00:00:00.000Z'),
  });
  const result = await syncKnownPolicies({
    database,
    sources: [endingSource],
    fetchImpl: async () => response('Official notice'),
    now: new Date('2026-08-03T00:00:00.000Z'),
  });
  const alreadyClosed = await syncKnownPolicies({
    database,
    sources: [endingSource],
    fetchImpl: async () => response('Official notice'),
    now: new Date('2026-08-04T00:00:00.000Z'),
  });

  assert.equal(result.unchangedCount, 1);
  assert.equal(result.closedCount, 1);
  assert.equal(alreadyClosed.closedCount, 0);
  assert.equal(currentPolicy(database, 'policy-test').status, 'CLOSED');
  assert.equal(versionCount(database, 'policy-test'), 1);
});

test('a missing official source becomes UNVERIFIED instead of being deleted', async () => {
  // Deleting a missing source would discard the last verifiable policy and its evidence.
  const database = createDatabase();
  await syncKnownPolicies({
    database,
    sources: [source],
    fetchImpl: async () => response('Verified notice'),
    now: new Date('2026-08-02T00:00:00.000Z'),
  });
  const result = await syncKnownPolicies({
    database,
    sources: [source],
    fetchImpl: async () => response('Not found', { status: 404 }),
    now: new Date('2026-08-03T00:00:00.000Z'),
  });

  assert.deepEqual(result.failedSourceIds, ['mss-2026-integrated']);
  assert.equal(currentPolicy(database, 'policy-test').status, 'UNVERIFIED');
  assert.equal(versionCount(database, 'policy-test'), 1);
});

test('sync refuses an HTTPS attacker URL that is absent from the checked-in allowlist before fetching', async () => {
  // Trusting any HTTPS host would permit an attacker-controlled page into the policy store.
  const database = createDatabase();
  let fetched = false;

  await assert.rejects(
    syncKnownPolicies({
      database,
      sources: [{ ...source, officialUrl: 'https://attacker.example/notices/test' }],
      fetchImpl: async () => {
        fetched = true;
        return response('Untrusted notice');
      },
    }),
    /allowlisted official URL/,
  );

  assert.equal(fetched, false);
});

test('sync ignores caller-supplied allowlist overrides before fetching', async () => {
  // A public override would allow a caller to turn an attacker URL into a trusted source.
  const database = createDatabase();
  let fetched = false;

  await assert.rejects(
    syncKnownPolicies({
      database,
      sources: [{ ...source, officialUrl: 'https://attacker.example/notices/test' }],
      allowedOfficialUrls: ['https://attacker.example/notices/test'],
      fetchImpl: async () => {
        fetched = true;
        return response('Untrusted notice');
      },
    }),
    /allowlisted official URL/,
  );

  assert.equal(fetched, false);
});

test('an unlisted policy transition to UNVERIFIED creates an audit row', async () => {
  // Omitting an audit record would make an allowlist removal indistinguishable from a never-synced policy.
  const database = createDatabase();
  await syncKnownPolicies({
    database,
    sources: [source],
    fetchImpl: async () => response('Verified notice'),
    now: new Date('2026-08-02T00:00:00.000Z'),
  });

  await syncKnownPolicies({
    database,
    sources: [],
    now: new Date('2026-08-03T00:00:00.000Z'),
  });

  assert.equal(currentPolicy(database, 'policy-test').status, 'UNVERIFIED');
  const audit = database.prepare(`
    SELECT source_id AS sourceId, status, created_count AS createdCount,
      updated_count AS updatedCount, closed_count AS closedCount, error_code AS errorCode
    FROM sync_history
    WHERE source_id = ?
  `).get('unlisted-policy:policy-test');
  assert.deepEqual({ ...audit }, {
    sourceId: 'unlisted-policy:policy-test',
    status: 'FAILED',
    createdCount: 0,
    updatedCount: 0,
    closedCount: 0,
    errorCode: 'SOURCE_UNLISTED',
  });
});

test('sync CLI rejects a database path outside the policy database directory', () => {
  // Accepting a path outside the database directory would let a maintenance command overwrite unrelated files.
  const command = spawnSync(process.execPath, ['scripts/sync-policies.mjs', '--database', '../outside.sqlite'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });

  assert.notEqual(command.status, 0);
  assert.match(command.stderr, /must be a file inside prototype\/database/);
});
