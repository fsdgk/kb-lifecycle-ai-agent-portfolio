import { createHash } from 'node:crypto';
import { initializePolicySchema } from './schema.mjs';

const queryAliases = new Map([
  ['창업', 'STARTUP'],
  ['자금', 'FINANCE'],
  ['컨설팅', 'CONSULTING'],
  ['李쎌뾽', 'STARTUP'],
  ['?먭툑', 'FINANCE'],
  ['而⑥꽕??', 'CONSULTING'],
]);

const snapshotText = (snapshot) => snapshot.sourceText ?? [
  snapshot.title,
  ...(snapshot.supportTypes ?? []),
  ...(snapshot.lifecycleStages ?? []),
  ...(snapshot.requiredChecks ?? []),
].join(' ');

const sourceHashFor = (snapshot, sourceText) => createHash('sha256')
  .update(JSON.stringify({
    title: snapshot.title,
    organization: snapshot.organization,
    officialUrl: snapshot.officialUrl,
    regionCode: snapshot.regionCode,
    supportTypes: snapshot.supportTypes ?? [],
    lifecycleStages: snapshot.lifecycleStages ?? [],
    status: snapshot.status,
    applicationStart: snapshot.applicationStart ?? null,
    applicationEnd: snapshot.applicationEnd ?? null,
    sourcePublishedAt: snapshot.sourcePublishedAt ?? null,
    sourceModifiedAt: snapshot.sourceModifiedAt ?? null,
    sourceText,
    eligibilityRules: snapshot.eligibilityRules ?? snapshot.requiredChecks ?? [],
  }))
  .digest('hex');

const rulesFor = (snapshot) => (snapshot.eligibilityRules ?? snapshot.requiredChecks ?? [])
  .map((rule, index) => (typeof rule === 'string' ? {
    ruleId: `${snapshot.policyId}:required-check:${index + 1}`,
    ruleType: 'REQUIRED_CHECK',
    field: 'manual_review',
    operator: 'REQUIRES_CONFIRMATION',
    expectedValue: 'true',
    evidenceText: rule,
    verificationStatus: 'CHECK_REQUIRED',
  } : {
    ruleId: rule.ruleId ?? `${snapshot.policyId}:rule:${index + 1}`,
    ruleType: rule.ruleType ?? 'REQUIRED_CHECK',
    field: rule.field ?? 'manual_review',
    operator: rule.operator ?? 'REQUIRES_CONFIRMATION',
    expectedValue: rule.expectedValue ?? 'true',
    evidenceText: rule.evidenceText ?? rule.text ?? '',
    verificationStatus: rule.verificationStatus ?? 'CHECK_REQUIRED',
  }));

const writeRules = (database, snapshot) => {
  database.prepare('DELETE FROM eligibility_rules WHERE policy_id = ?').run(snapshot.policyId);
  const insertRule = database.prepare(`
    INSERT INTO eligibility_rules (
      rule_id, policy_id, rule_type, field, operator, expected_value, evidence_text, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const rule of rulesFor(snapshot)) {
    insertRule.run(
      rule.ruleId,
      snapshot.policyId,
      rule.ruleType,
      rule.field,
      rule.operator,
      rule.expectedValue,
      rule.evidenceText,
      rule.verificationStatus,
    );
  }
};

export function upsertPolicySnapshot(database, snapshot, collectedAt) {
  const sourceText = snapshotText(snapshot);
  const sourceHash = snapshot.sourceHash ?? sourceHashFor(snapshot, sourceText);
  const existing = database.prepare(`
    SELECT p.current_version_id AS versionId, v.source_hash AS sourceHash
    FROM policies p
    JOIN policy_versions v ON v.version_id = p.current_version_id
    WHERE p.policy_id = ?
  `).get(snapshot.policyId);

  if (existing?.sourceHash === sourceHash) {
    database.prepare(`
      UPDATE policies SET
        title = ?, organization = ?, official_url = ?, region_code = ?, support_types = ?, lifecycle_stages = ?,
        status = ?, application_start = ?, application_end = ?, verified_at = ?
      WHERE policy_id = ?
    `).run(
      snapshot.title,
      snapshot.organization,
      snapshot.officialUrl,
      snapshot.regionCode,
      JSON.stringify(snapshot.supportTypes ?? []),
      JSON.stringify(snapshot.lifecycleStages ?? []),
      snapshot.status,
      snapshot.applicationStart ?? null,
      snapshot.applicationEnd ?? null,
      snapshot.verifiedAt,
      snapshot.policyId,
    );
    return { policyId: snapshot.policyId, versionId: existing.versionId, changeType: 'UNCHANGED' };
  }

  const changeType = existing ? 'UPDATED' : 'CREATED';
  const versionId = `${snapshot.policyId}:${collectedAt}:${sourceHash}`;
  database.exec('BEGIN');
  try {
    database.prepare(`
      INSERT INTO policy_versions (
        version_id, policy_id, source_hash, source_published_at, source_modified_at, collected_at, source_text, change_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      snapshot.policyId,
      sourceHash,
      snapshot.sourcePublishedAt ?? null,
      snapshot.sourceModifiedAt ?? null,
      collectedAt,
      sourceText,
      changeType,
    );

    database.prepare(`
      INSERT INTO policies (
        policy_id, title, organization, official_url, region_code, support_types, lifecycle_stages,
        status, application_start, application_end, verified_at, current_version_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(policy_id) DO UPDATE SET
        title = excluded.title,
        organization = excluded.organization,
        official_url = excluded.official_url,
        region_code = excluded.region_code,
        support_types = excluded.support_types,
        lifecycle_stages = excluded.lifecycle_stages,
        status = excluded.status,
        application_start = excluded.application_start,
        application_end = excluded.application_end,
        verified_at = excluded.verified_at,
        current_version_id = excluded.current_version_id
    `).run(
      snapshot.policyId,
      snapshot.title,
      snapshot.organization,
      snapshot.officialUrl,
      snapshot.regionCode,
      JSON.stringify(snapshot.supportTypes ?? []),
      JSON.stringify(snapshot.lifecycleStages ?? []),
      snapshot.status,
      snapshot.applicationStart ?? null,
      snapshot.applicationEnd ?? null,
      snapshot.verifiedAt,
      versionId,
    );

    database.prepare('DELETE FROM policy_documents_fts WHERE policy_id = ?').run(snapshot.policyId);
    database.prepare(`
      INSERT INTO policy_documents_fts (policy_id, version_id, title, source_text) VALUES (?, ?, ?, ?)
    `).run(snapshot.policyId, versionId, snapshot.title, sourceText);
    writeRules(database, snapshot);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return { policyId: snapshot.policyId, versionId, changeType };
}

const queryExpressionFor = (query) => {
  const text = String(query ?? '').trim();
  if (!text) return null;
  const terms = new Set();
  for (const [alias, expanded] of queryAliases) {
    if (text.toLowerCase().includes(alias.toLowerCase())) terms.add(expanded);
  }
  for (const token of text.match(/[\p{L}\p{N}_]+/gu) ?? []) terms.add(token);
  return [...terms].map((term) => `"${term.replaceAll('"', '')}"`).join(' OR ');
};

const evaluateEligibility = () => 'CHECK_REQUIRED';

const loadRules = (database, policyId) => database.prepare(`
  SELECT evidence_text AS evidenceText, verification_status AS verificationStatus
  FROM eligibility_rules WHERE policy_id = ? ORDER BY rule_id
`).all(policyId);

export function searchPolicyDatabase(database, criteria) {
  const expression = queryExpressionFor(criteria.query);
  if (!expression) return [];
  const now = criteria.now instanceof Date ? criteria.now : new Date(criteria.now ?? Date.now());
  const nowDate = now.toISOString().slice(0, 10);
  const freshnessThreshold = criteria.freshnessDays == null
    ? null
    : new Date(now.getTime() - criteria.freshnessDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ranked = database.prepare(`
    SELECT
      p.policy_id AS policyId, p.title, p.organization AS institution,
      p.official_url AS officialUrl, p.region_code AS regionCode,
      p.status, p.verified_at AS verifiedAt, p.current_version_id AS versionId,
      v.source_hash AS sourceHash,
      bm25(policy_documents_fts) AS rank
    FROM policy_documents_fts
    JOIN policies p ON p.policy_id = policy_documents_fts.policy_id
      AND p.current_version_id = policy_documents_fts.version_id
    JOIN policy_versions v ON v.version_id = p.current_version_id
    WHERE policy_documents_fts MATCH ?
      AND p.status IN ('ACTIVE', 'CHECK_REQUIRED', 'UPCOMING')
      AND (p.region_code = 'NATIONAL' OR p.region_code = ?)
      AND EXISTS (SELECT 1 FROM json_each(p.lifecycle_stages) WHERE value = ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(p.support_types) WHERE value = ?))
      AND (p.application_start IS NULL OR p.application_start <= ?)
      AND (p.application_end IS NULL OR p.application_end >= ?)
      AND (? IS NULL OR p.verified_at >= ?)
    ORDER BY rank, p.policy_id
  `).all(
    expression,
    criteria.regionCode,
    criteria.lifecycleStage,
    criteria.supportType ?? null,
    criteria.supportType ?? null,
    nowDate,
    nowDate,
    freshnessThreshold,
    freshnessThreshold,
  );

  return ranked
    .map((policy) => {
      const rules = loadRules(database, policy.policyId);
      return {
        policyId: policy.policyId,
        title: policy.title,
        institution: policy.institution,
        status: policy.status,
        regionCode: policy.regionCode,
        eligibility: evaluateEligibility(rules),
        officialUrl: policy.officialUrl,
        verifiedAt: policy.verifiedAt,
        versionId: policy.versionId,
        sourceHash: policy.sourceHash,
        evidence: [{
          policyId: policy.policyId,
          versionId: policy.versionId,
          officialUrl: policy.officialUrl,
          verifiedAt: policy.verifiedAt,
        }],
        requiredChecks: rules.map((rule) => rule.evidenceText),
      };
    });
}

export { initializePolicySchema };
