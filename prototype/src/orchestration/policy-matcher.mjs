import { createSqlitePolicyEvidenceAuthority } from './evidence-registry.mjs';
import { searchPolicyDatabase } from '../policy-db/policy-repository.mjs';
import { deepFreeze } from './deep-freeze.mjs';

const FUNDING_PURPOSES = Object.freeze({
  STARTUP_COST: Object.freeze({ supportType: 'STARTUP', ftsTerm: 'STARTUP' }),
  WORKING_CAPITAL: Object.freeze({ supportType: 'FINANCE', ftsTerm: 'FINANCE' }),
  FACILITY: Object.freeze({ supportType: 'FINANCE', ftsTerm: 'FINANCE' }),
  RECOVERY: Object.freeze({ supportType: 'RECOVERY', ftsTerm: 'RECOVERY' }),
  LOAN_EXECUTION: Object.freeze({ supportType: 'FINANCE', ftsTerm: 'FINANCE' }),
});
const FRESHNESS_DAYS = 30;
const MATCHER_LIFECYCLE_CONTEXTS = new WeakMap();
const MATCHER_QUERY_CONTEXTS = new WeakMap();

export function resolveMatcherPolicyLifecycleDescriptor(descriptor) {
  if (descriptor == null || typeof descriptor !== 'object') return null;
  return MATCHER_LIFECYCLE_CONTEXTS.get(descriptor) ?? null;
}

export function resolveMatcherQueryDescriptor(descriptor) {
  if (descriptor == null || typeof descriptor !== 'object') return null;
  return MATCHER_QUERY_CONTEXTS.get(descriptor) ?? null;
}

function requireNonBlankString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-blank string`);
  return value.trim();
}

function lifecycleFor({ path, stage, fundingPurpose }) {
  if (path !== stage || !['STARTUP', 'OPERATING'].includes(path)) {
    throw new TypeError('input path and stage must be an allowed pair');
  }
  if (path === 'STARTUP') {
    return {
      authorityStage: 'STARTUP',
      lifecycleStage: 'PRE_START',
      databaseLifecycleStage: 'PRE_START',
      derivedLifecycleReason: 'STARTUP_PATH',
    };
  }
  if (fundingPurpose === 'RECOVERY') {
    return {
      authorityStage: 'OPERATING',
      lifecycleStage: 'CRISIS',
      databaseLifecycleStage: 'CRISIS',
      derivedLifecycleReason: 'FUNDING_PURPOSE_RECOVERY',
    };
  }
  return {
    authorityStage: 'OPERATING',
    lifecycleStage: 'OPERATING',
    databaseLifecycleStage: 'EARLY_OPERATION',
    derivedLifecycleReason: 'OPERATING_PATH',
  };
}

function buildQuery(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('input must be an object');
  }
  const path = requireNonBlankString(input.path, 'input.path');
  const stage = requireNonBlankString(input.stage, 'input.stage');
  const regionCode = requireNonBlankString(input.regionCode, 'input.regionCode');
  const industryTemplate = requireNonBlankString(input.industryTemplate, 'input.industryTemplate');
  const policyDetails = path === 'STARTUP' ? input.startup : input.operating;
  const registrationStatus = requireNonBlankString(
    input.registrationStatus ?? input.businessProfile?.registrationStatus,
    'input.registrationStatus',
  );
  const operatingMonths = input.operatingMonths ?? policyDetails?.operatingMonths ?? (path === 'STARTUP' ? 0 : undefined);
  if (!Number.isInteger(operatingMonths) || operatingMonths < 0) {
    throw new TypeError('input.operatingMonths must be a non-negative integer');
  }
  const fundingPurpose = requireNonBlankString(input.fundingPurpose ?? policyDetails?.fundingPurpose, 'input.fundingPurpose');
  const funding = FUNDING_PURPOSES[fundingPurpose];
  if (!funding) throw new RangeError(`unsupported funding purpose: ${fundingPurpose}`);

  const lifecycle = lifecycleFor({ path, stage, fundingPurpose });
  return Object.freeze({
    path,
    stage,
    regionCode,
    industryTemplate,
    registrationStatus,
    operatingMonths,
    fundingPurpose,
    ...lifecycle,
    ...funding,
  });
}

function recoveryLifecycleDescriptor(query) {
  if (query.authorityStage !== 'OPERATING'
    || query.databaseLifecycleStage !== 'CRISIS'
    || query.fundingPurpose !== 'RECOVERY'
    || query.derivedLifecycleReason !== 'FUNDING_PURPOSE_RECOVERY') {
    throw new TypeError('recovery lifecycle proof requires matcher-derived recovery context');
  }
  const descriptor = Object.freeze({});
  MATCHER_LIFECYCLE_CONTEXTS.set(descriptor, Object.freeze({
    path: query.path,
    stage: query.stage,
    fundingPurpose: query.fundingPurpose,
    authorityStage: query.authorityStage,
    policyLifecycleStage: query.databaseLifecycleStage,
    derivedLifecycleReason: query.derivedLifecycleReason,
  }));
  return descriptor;
}

function matcherQueryDescriptor(query) {
  const descriptor = Object.freeze({});
  MATCHER_QUERY_CONTEXTS.set(descriptor, Object.freeze({
    path: query.path,
    stage: query.stage,
    regionCode: query.regionCode,
    industryTemplate: query.industryTemplate,
    registrationStatus: query.registrationStatus,
    operatingMonths: query.operatingMonths,
    fundingPurpose: query.fundingPurpose,
    authorityStage: query.authorityStage,
    lifecycleStage: query.lifecycleStage,
    databaseLifecycleStage: query.databaseLifecycleStage,
    derivedLifecycleReason: query.derivedLifecycleReason,
    supportType: query.supportType,
    ftsTerm: query.ftsTerm,
  }));
  return descriptor;
}

export function matchPoliciesForBusiness({ database, input, now = new Date() }) {
  if (!database?.prepare) throw new TypeError('policy database is required');
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now must be a valid Date');

  const query = buildQuery(input);
  const matches = searchPolicyDatabase(database, {
    query: query.ftsTerm,
    supportType: query.supportType,
    regionCode: query.regionCode,
    lifecycleStage: query.databaseLifecycleStage,
    now,
    freshnessDays: FRESHNESS_DAYS,
  }).map((match) => deepFreeze(match));

  const authorityOptions = {
    database,
    policies: matches,
    regionCode: query.regionCode,
    stage: query.authorityStage,
    now,
    freshnessDays: FRESHNESS_DAYS,
    queryDescriptor: matcherQueryDescriptor(query),
  };
  if (query.databaseLifecycleStage === 'CRISIS') {
    authorityOptions.lifecycleDescriptor = recoveryLifecycleDescriptor(query);
  }
  const authority = createSqlitePolicyEvidenceAuthority(authorityOptions);

  return Object.freeze({ matches: Object.freeze(matches), authority, query });
}
