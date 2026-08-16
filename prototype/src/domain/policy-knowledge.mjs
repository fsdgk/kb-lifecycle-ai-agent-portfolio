import { loadPolicies, loadOntology } from '../data/repository.mjs';

const tokens = (text) => new Set(String(text).toLowerCase().match(/[가-힣a-z0-9]+/g) ?? []);
const overlap = (left, right) => [...left].filter((token) => right.has(token)).length;
const queryAliases = new Map([
  ['창업', 'startup'],
  ['자금', 'finance'],
  ['컨설팅', 'consulting'],
]);

export function searchPolicies(query, profile, now = new Date()) {
  const queryTokens = tokens(query);
  const ontology = loadOntology();
  const expanded = new Set(queryTokens);

  for (const queryToken of queryTokens) {
    for (const [term, alias] of queryAliases) {
      if (queryToken.includes(term)) expanded.add(alias);
    }
  }

  for (const relation of ontology.relations) {
    if (queryTokens.has(relation.from.toLowerCase())) {
      expanded.add(relation.to.toLowerCase());
    }
  }

  return loadPolicies()
    .filter((policy) => policy.status !== 'ARCHIVED')
    .filter((policy) => (
      policy.regions.includes('NATIONAL') || policy.regions.includes(profile.business.regionCode)
    ))
    .filter((policy) => !policy.applicationEnd || new Date(policy.applicationEnd) >= now)
    .map((policy) => {
      const policyTokens = tokens([
        policy.sourceTitle,
        ...policy.lifecycleStages,
        ...policy.supportTypes,
      ].join(' '));
      const relevanceScore = overlap(expanded, policyTokens);
      if (!relevanceScore) return undefined;

      const score = relevanceScore
        + (policy.regions.includes(profile.business.regionCode) ? 2 : 1);

      return {
        policyId: policy.policyId,
        score,
        status: policy.status,
        eligibility: policy.requiredChecks.length ? 'CHECK_REQUIRED' : 'LIKELY_MATCH',
        evidence: [{
          sourceTitle: policy.sourceTitle,
          officialUrl: policy.officialUrl,
          verifiedAt: policy.verifiedAt,
        }],
        requiredChecks: policy.requiredChecks,
        officialUrl: policy.officialUrl,
        verifiedAt: policy.verifiedAt,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
}

export function validatePolicyMatch(match) {
  const errors = [];

  if (!match.officialUrl) errors.push('official_url_missing');
  if (!match.verifiedAt) errors.push('verified_at_missing');
  if (!match.evidence?.every((item) => item.officialUrl && item.verifiedAt)) {
    errors.push('evidence_missing');
  }
  if (match.eligibility === 'APPROVED') errors.push('approval_claim_forbidden');

  return { valid: errors.length === 0, errors };
}
