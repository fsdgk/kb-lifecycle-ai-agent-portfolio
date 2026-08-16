import { createHash, randomUUID } from 'node:crypto';
import officialSources from '../../database/sources.json' with { type: 'json' };
import { upsertPolicySnapshot } from './policy-repository.mjs';

const normalizeOfficialText = (text) => String(text ?? '')
  .normalize('NFKC')
  .replace(/\s+/gu, ' ')
  .trim();

const isoDate = (now) => now.toISOString().slice(0, 10);

const emptySummary = () => ({
  status: 'SUCCESS',
  createdCount: 0,
  updatedCount: 0,
  unchangedCount: 0,
  closedCount: 0,
  failedSourceIds: [],
});

function normalizeOfficialUrl(value, sourceId = 'unknown') {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Source ${sourceId} must have an HTTPS official URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    throw new Error(`Source ${sourceId} must have an HTTPS official URL.`);
  }
  return url.href;
}

const createOfficialAllowlist = (officialUrls) => {
  const urls = new Set();
  const hosts = new Set();
  for (const officialUrl of officialUrls) {
    const normalizedUrl = normalizeOfficialUrl(officialUrl, 'allowlist');
    urls.add(normalizedUrl);
    hosts.add(new URL(normalizedUrl).hostname);
  }
  return { urls, hosts };
};

const checkedInOfficialAllowlist = createOfficialAllowlist(
  officialSources.map((source) => source.officialUrl),
);

function assertOfficialHttpsSource(source, allowlist) {
  const normalizedUrl = normalizeOfficialUrl(source.officialUrl, source.sourceId ?? 'unknown');
  const host = new URL(normalizedUrl).hostname;
  if (!allowlist.hosts.has(host) || !allowlist.urls.has(normalizedUrl)) {
    throw new Error(`Source ${source.sourceId ?? 'unknown'} is not an allowlisted official URL.`);
  }
  return normalizedUrl;
}

const findExistingPolicy = (database, officialUrl) => database.prepare(`
  SELECT
    policy_id AS policyId, title, organization, official_url AS officialUrl, region_code AS regionCode,
    support_types AS supportTypes, lifecycle_stages AS lifecycleStages, status,
    application_start AS applicationStart, application_end AS applicationEnd
  FROM policies WHERE official_url = ?
`).get(officialUrl);

const parseJsonArray = (value) => value ? JSON.parse(value) : [];

const snapshotFor = (database, source, sourceText, now) => {
  const existing = findExistingPolicy(database, source.officialUrl);
  const applicationEnd = source.applicationEnd ?? existing?.applicationEnd ?? null;
  const closed = applicationEnd && applicationEnd < isoDate(now);
  return {
    policyId: source.policyId ?? existing?.policyId ?? source.sourceId,
    title: source.title ?? existing?.title ?? source.sourceId,
    organization: source.organization ?? existing?.organization ?? 'Unknown official organization',
    officialUrl: source.officialUrl,
    regionCode: source.regionCode ?? existing?.regionCode ?? 'NATIONAL',
    supportTypes: source.supportTypes ?? parseJsonArray(existing?.supportTypes),
    lifecycleStages: source.lifecycleStages ?? parseJsonArray(existing?.lifecycleStages),
    status: closed ? 'CLOSED' : source.status ?? existing?.status ?? 'CHECK_REQUIRED',
    applicationStart: source.applicationStart ?? existing?.applicationStart ?? null,
    applicationEnd,
    sourcePublishedAt: source.sourcePublishedAt ?? null,
    sourceModifiedAt: source.sourceModifiedAt ?? null,
    sourceText,
    sourceHash: createHash('sha256').update(sourceText).digest('hex'),
    verifiedAt: isoDate(now),
    eligibilityRules: source.eligibilityRules ?? source.requiredChecks,
  };
};

const recordSyncHistory = (database, sourceId, now, status, counts, errorCode = null) => {
  database.prepare(`
    INSERT INTO sync_history (
      sync_id, source_id, started_at, finished_at, status, created_count, updated_count, closed_count, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    sourceId,
    now.toISOString(),
    now.toISOString(),
    status,
    counts.createdCount,
    counts.updatedCount,
    counts.closedCount,
    errorCode,
  );
};

const markUnverified = (database, officialUrl) => database.prepare(
  'UPDATE policies SET status = ? WHERE official_url = ?',
).run('UNVERIFIED', officialUrl).changes;

const markUnlistedPoliciesUnverified = (database, synchronizedUrls, now) => {
  const policies = database.prepare(
    'SELECT policy_id AS policyId, official_url AS officialUrl, status FROM policies',
  ).all();
  for (const policy of policies) {
    const normalizedUrl = normalizeOfficialUrl(policy.officialUrl, policy.policyId);
    if (!synchronizedUrls.has(normalizedUrl) && policy.status !== 'UNVERIFIED') {
      database.prepare('UPDATE policies SET status = ? WHERE policy_id = ?')
        .run('UNVERIFIED', policy.policyId);
      recordSyncHistory(database, `unlisted-policy:${policy.policyId}`, now, 'FAILED', {
        createdCount: 0,
        updatedCount: 0,
        closedCount: 0,
      }, 'SOURCE_UNLISTED');
    }
  }
};

export async function syncKnownPolicies({
  database,
  sources,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (!database) throw new Error('A policy database is required.');
  if (!Array.isArray(sources)) throw new Error('Policy sources must be an array.');
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('A valid synchronization time is required.');

  const summary = emptySummary();
  const synchronizedUrls = new Set();

  for (const source of sources) {
    const normalizedUrl = assertOfficialHttpsSource(source, checkedInOfficialAllowlist);
    synchronizedUrls.add(normalizedUrl);
    const sourceCounts = { createdCount: 0, updatedCount: 0, closedCount: 0 };
    try {
      const response = await fetchImpl(source.officialUrl, { redirect: 'error' });
      if (!response?.ok) {
        if (response?.status === 404 || response?.status === 410) markUnverified(database, source.officialUrl);
        summary.failedSourceIds.push(source.sourceId);
        recordSyncHistory(database, source.sourceId, now, 'FAILED', sourceCounts, `HTTP_${response?.status ?? 'UNKNOWN'}`);
        continue;
      }

      const sourceText = normalizeOfficialText(await response.text());
      if (!sourceText) throw new Error('EMPTY_SOURCE_TEXT');
      const snapshot = snapshotFor(database, source, sourceText, now);
      const previousStatus = findExistingPolicy(database, source.officialUrl)?.status;
      const write = upsertPolicySnapshot(database, snapshot, now.toISOString());
      if (write.changeType === 'CREATED') {
        summary.createdCount += 1;
        sourceCounts.createdCount = 1;
      } else if (write.changeType === 'UPDATED') {
        summary.updatedCount += 1;
        sourceCounts.updatedCount = 1;
      } else {
        summary.unchangedCount += 1;
      }
      if (snapshot.status === 'CLOSED' && previousStatus !== 'CLOSED') {
        summary.closedCount += 1;
        sourceCounts.closedCount = 1;
      }
      recordSyncHistory(database, source.sourceId, now, 'SUCCESS', sourceCounts);
    } catch (error) {
      summary.failedSourceIds.push(source.sourceId);
      recordSyncHistory(database, source.sourceId, now, 'FAILED', sourceCounts, error.code ?? error.message);
    }
  }

  markUnlistedPoliciesUnverified(database, synchronizedUrls, now);
  if (summary.failedSourceIds.length === sources.length && sources.length) summary.status = 'FAILED';
  else if (summary.failedSourceIds.length) summary.status = 'PARTIAL_FAILURE';
  return summary;
}

export { normalizeOfficialText };
