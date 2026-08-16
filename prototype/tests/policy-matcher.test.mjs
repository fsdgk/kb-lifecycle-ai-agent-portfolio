import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openPolicyDatabase } from '../src/policy-db/database.mjs';
import { normalizeBusinessInput } from '../src/domain/business-input.mjs';
import { calculateStartupFunding, forecastCashflow } from '../src/domain/finance-engine.mjs';
import { analyzeMarket } from '../src/domain/market-engine.mjs';
import { initializePolicySchema, upsertPolicySnapshot } from '../src/policy-db/policy-repository.mjs';
import { buildEvidenceRegistry, createSqlitePolicyEvidenceAuthority } from '../src/orchestration/evidence-registry.mjs';
import { matchPoliciesForBusiness } from '../src/orchestration/policy-matcher.mjs';
import seedPolicies from '../database/seed-policies.json' with { type: 'json' };

const now = new Date('2026-08-02T00:00:00.000Z');
const demoScenario = JSON.parse(readFileSync(new URL('../data/demo-scenario.json', import.meta.url), 'utf8'));

function policyDatabase() {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  seedPolicies.forEach((policy) => upsertPolicySnapshot(database, policy, now.toISOString()));
  return database;
}

function businessInput(overrides = {}) {
  return {
    path: 'STARTUP',
    stage: 'STARTUP',
    regionCode: 'SEOUL',
    industryTemplate: 'FOOD_CAFE',
    registrationStatus: 'NOT_REGISTERED',
    operatingMonths: 0,
    fundingPurpose: 'WORKING_CAPITAL',
    ...overrides,
  };
}

function normalizedInput(path, fundingPurpose) {
  return normalizeBusinessInput({
    path,
    stage: path,
    regionCode: 'SEOUL',
    industryTemplate: 'FOOD_CAFE',
    businessProfile: { businessName: 'Example Cafe', registrationStatus: path === 'STARTUP' ? 'NOT_REGISTERED' : 'REGISTERED' },
    [path === 'STARTUP' ? 'startup' : 'operating']: path === 'STARTUP'
      ? { fundingPurpose }
      : { operatingMonths: 18, fundingPurpose },
  });
}

function registryInputsFor(stage) {
  const sourceStage = stage === 'STARTUP' ? 'PRE_START' : 'OPERATING_CRISIS';
  const snapshot = { ...structuredClone(demoScenario.snapshots.find((item) => item.stage === sourceStage)), stage };
  const profile = { ...structuredClone(demoScenario), snapshots: [snapshot] };
  const finance = stage === 'STARTUP'
    ? calculateStartupFunding(profile)
    : forecastCashflow(snapshot.finance.openingBalanceKrw, snapshot.finance.dailyFlowsKrw, snapshot.finance.days);
  return {
    profile,
    snapshot,
    finance,
    market: analyzeMarket(snapshot.marketSignals, new Date(snapshot.asOf)),
  };
}

test('matches Seoul pre-start working capital only to current Seoul or national official policies', () => {
  const database = policyDatabase();
  try {
    const result = matchPoliciesForBusiness({ database, input: businessInput(), now });

    assert.ok(result.matches.length > 0);
    assert.ok(result.matches.every((item) => ['SEOUL', 'NATIONAL'].includes(item.regionCode)));
    assert.ok(result.matches.every((item) => !['ARCHIVED', 'CLOSED', 'UNVERIFIED'].includes(item.status)));
    assert.ok(result.matches.every((item) => typeof item.institution === 'string' && item.institution.length > 0));
    assert.ok(result.matches.every((item) => /^[a-f0-9]{64}$/u.test(item.sourceHash)));
    assert.equal(result.query.lifecycleStage, 'PRE_START');
    assert.equal(result.query.supportType, 'FINANCE');
    assert.equal(result.authority.stage, 'STARTUP');
  } finally {
    database.close();
  }
});

test('maps an operating recovery need to the crisis support query', () => {
  const database = policyDatabase();
  try {
    const result = matchPoliciesForBusiness({
      database,
      input: businessInput({
        path: 'OPERATING', stage: 'OPERATING', registrationStatus: 'REGISTERED', operatingMonths: 18,
        fundingPurpose: 'RECOVERY',
      }),
      now,
    });

    assert.equal(result.query.lifecycleStage, 'CRISIS');
    assert.equal(result.query.derivedLifecycleReason, 'FUNDING_PURPOSE_RECOVERY');
    assert.equal(result.authority.stage, 'OPERATING');
    assert.equal(result.authority.policyLifecycleStage, 'CRISIS');
    assert.equal(result.query.supportType, 'RECOVERY');
    assert.ok(result.matches.length > 0);
    assert.ok(result.matches.every((item) => item.requiredChecks.length > 0));
    assert.ok(result.matches.every((item) => item.eligibility === 'CHECK_REQUIRED'));
  } finally {
    database.close();
  }
});

test('maps a normalized operating input to operating policy metadata unless recovery is requested', () => {
  const database = policyDatabase();
  try {
    const result = matchPoliciesForBusiness({
      database,
      input: businessInput({
        path: 'OPERATING', stage: 'OPERATING', registrationStatus: 'REGISTERED', operatingMonths: 18,
      }),
      now,
    });

    assert.equal(result.query.lifecycleStage, 'OPERATING');
    assert.equal(result.query.derivedLifecycleReason, 'OPERATING_PATH');
  } finally {
    database.close();
  }
});

test('rejects normalized inputs whose path and stage do not match', () => {
  const database = policyDatabase();
  try {
    for (const input of [
      businessInput({ path: 'STARTUP', stage: 'OPERATING' }),
      businessInput({ path: 'OPERATING', stage: 'STARTUP' }),
    ]) {
      assert.throws(
        () => matchPoliciesForBusiness({ database, input, now }),
        { name: 'TypeError', message: /path.*stage/i },
      );
    }
  } finally {
    database.close();
  }
});

test('matches actual normalized startup and operating-recovery inputs', () => {
  const database = policyDatabase();
  try {
    const startup = normalizeBusinessInput({
      path: 'STARTUP', stage: 'STARTUP', regionCode: 'SEOUL', industryTemplate: 'FOOD_CAFE',
      businessProfile: { businessName: 'Example Cafe', registrationStatus: 'NOT_REGISTERED' },
      startup: { fundingPurpose: 'WORKING_CAPITAL' },
    });
    const operatingRecovery = normalizeBusinessInput({
      path: 'OPERATING', stage: 'OPERATING', regionCode: 'SEOUL', industryTemplate: 'FOOD_CAFE',
      businessProfile: { businessName: 'Example Cafe', registrationStatus: 'REGISTERED' },
      operating: { operatingMonths: 18, fundingPurpose: 'RECOVERY' },
    });

    const startupResult = matchPoliciesForBusiness({ database, input: startup, now });
    const recoveryResult = matchPoliciesForBusiness({ database, input: operatingRecovery, now });

    assert.equal(startupResult.query.lifecycleStage, 'PRE_START');
    assert.equal(startupResult.query.derivedLifecycleReason, 'STARTUP_PATH');
    assert.equal(recoveryResult.query.lifecycleStage, 'CRISIS');
    assert.equal(recoveryResult.query.derivedLifecycleReason, 'FUNDING_PURPOSE_RECOVERY');
  } finally {
    database.close();
  }
});

test('builds registry evidence from matcher authorities using normalized startup and operating stages', () => {
  const database = policyDatabase();
  try {
    const startupAuthority = matchPoliciesForBusiness({
      database, input: normalizedInput('STARTUP', 'WORKING_CAPITAL'), now,
    }).authority;
    const operatingAuthority = matchPoliciesForBusiness({
      database, input: normalizedInput('OPERATING', 'WORKING_CAPITAL'), now,
    }).authority;

    const startupRegistry = buildEvidenceRegistry({ ...registryInputsFor('STARTUP'), policyAuthority: startupAuthority });
    const operatingRegistry = buildEvidenceRegistry({ ...registryInputsFor('OPERATING'), policyAuthority: operatingAuthority });

    assert.equal(startupRegistry.stage, 'STARTUP');
    assert.ok(startupRegistry.evidence.some((item) => item.id === 'finance.startup.funding-gap'));
    assert.equal(operatingRegistry.stage, 'OPERATING');
    assert.ok(operatingRegistry.evidence.some((item) => item.id === 'finance.cashflow.shortfall-range'));
  } finally {
    database.close();
  }
});

test('keeps a recovery authority at OPERATING while separately proving crisis policy lifecycle', () => {
  const database = policyDatabase();
  try {
    const authority = matchPoliciesForBusiness({
      database, input: normalizedInput('OPERATING', 'RECOVERY'), now,
    }).authority;
    const registry = buildEvidenceRegistry({ ...registryInputsFor('OPERATING'), policyAuthority: authority });

    assert.equal(authority.stage, 'OPERATING');
    assert.equal(authority.policyLifecycleStage, 'CRISIS');
    assert.equal(registry.stage, 'OPERATING');
  } finally {
    database.close();
  }
});

test('rejects forged lifecycle stages that contradict normalized startup and operating authority stages', () => {
  const database = policyDatabase();
  try {
    const startupMatch = matchPoliciesForBusiness({
      database, input: normalizedInput('STARTUP', 'WORKING_CAPITAL'), now,
    }).matches[0];
    const operatingMatch = matchPoliciesForBusiness({
      database, input: normalizedInput('OPERATING', 'WORKING_CAPITAL'), now,
    }).matches[0];

    assert.throws(() => createSqlitePolicyEvidenceAuthority({
      database,
      policies: [operatingMatch],
      regionCode: 'SEOUL',
      stage: 'STARTUP',
      policyLifecycleStage: 'EARLY_OPERATION',
      now,
    }), /stage|lifecycle/i);
    assert.throws(() => createSqlitePolicyEvidenceAuthority({
      database,
      policies: [startupMatch],
      regionCode: 'SEOUL',
      stage: 'OPERATING',
      policyLifecycleStage: 'PRE_START',
      now,
    }), /stage|lifecycle/i);
  } finally {
    database.close();
  }
});

test('requires matcher-issued proof before an operating authority can use crisis policies', () => {
  const database = policyDatabase();
  try {
    const recoveryMatch = matchPoliciesForBusiness({
      database, input: normalizedInput('OPERATING', 'RECOVERY'), now,
    }).matches[0];

    assert.throws(() => createSqlitePolicyEvidenceAuthority({
      database,
      policies: [recoveryMatch],
      regionCode: 'SEOUL',
      stage: 'OPERATING',
      policyLifecycleStage: 'CRISIS',
      now,
    }), /matcher|proof|lifecycle/i);
    for (const lifecycleDescriptor of ['RECOVERY', true]) {
      assert.throws(() => createSqlitePolicyEvidenceAuthority({
        database,
        policies: [recoveryMatch],
        regionCode: 'SEOUL',
        stage: 'OPERATING',
        lifecycleDescriptor,
        now,
      }), /matcher|proof|lifecycle/i);
    }
  } finally {
    database.close();
  }
});

test('excludes active policies whose verified date is older than the authority freshness window', () => {
  const database = policyDatabase();
  try {
    database.prepare('UPDATE policies SET verified_at = ? WHERE policy_id = ?')
      .run('2026-06-01', 'policy-mss-2026-integrated');

    const result = matchPoliciesForBusiness({ database, input: businessInput(), now });

    assert.deepEqual(result.matches, []);
    assert.deepEqual(result.authority.policies, []);
  } finally {
    database.close();
  }
});

test('never substitutes another local region when only national policies match', () => {
  const database = policyDatabase();
  try {
    const result = matchPoliciesForBusiness({
      database,
      input: businessInput({ regionCode: 'BUSAN', fundingPurpose: 'RECOVERY' }),
      now,
    });

    assert.ok(result.matches.every((item) => item.regionCode === 'NATIONAL'));
  } finally {
    database.close();
  }
});

test('treats a policy with no stored eligibility rules as check required', () => {
  const database = policyDatabase();
  try {
    database.prepare('DELETE FROM eligibility_rules WHERE policy_id = ?').run('policy-mss-2026-integrated');

    const result = matchPoliciesForBusiness({ database, input: businessInput(), now });

    assert.equal(result.matches[0].eligibility, 'CHECK_REQUIRED');
    assert.deepEqual(result.matches[0].requiredChecks, []);
  } finally {
    database.close();
  }
});

test('maps each funding purpose to an explicit deterministic SQLite query', () => {
  const database = policyDatabase();
  try {
    const expected = {
      STARTUP_COST: ['STARTUP', 'STARTUP'],
      WORKING_CAPITAL: ['FINANCE', 'FINANCE'],
      FACILITY: ['FINANCE', 'FINANCE'],
      RECOVERY: ['RECOVERY', 'RECOVERY'],
      LOAN_EXECUTION: ['FINANCE', 'FINANCE'],
    };

    for (const [fundingPurpose, [supportType, ftsTerm]] of Object.entries(expected)) {
      const result = matchPoliciesForBusiness({ database, input: businessInput({ fundingPurpose }), now });
      assert.equal(result.query.supportType, supportType, fundingPurpose);
      assert.equal(result.query.ftsTerm, ftsTerm, fundingPurpose);
    }
  } finally {
    database.close();
  }
});

test('issues authority only for database-canonical policy records and never calls fetch', () => {
  const database = policyDatabase();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network access is forbidden'); };
  try {
    const result = matchPoliciesForBusiness({ database, input: businessInput(), now });
    const candidate = result.matches[0];

    assert.equal(result.authority.policies[0].sourceHash, result.matches[0].sourceHash);
    for (const field of ['officialUrl', 'versionId', 'sourceHash', 'regionCode']) {
      const forged = { ...candidate, [field]: `forged-${field}` };
      assert.throws(() => createSqlitePolicyEvidenceAuthority({
        database,
        policies: [forged],
        regionCode: 'SEOUL',
        stage: 'PRE_START',
        now,
      }), /policy|official|region|version|database/i, field);
    }
    assert.throws(() => createSqlitePolicyEvidenceAuthority({
      database,
      policies: [candidate],
      regionCode: 'SEOUL',
      stage: 'NOT_A_POLICY_STAGE',
      now,
    }), /stage/i);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('recursively freezes matcher results and DB-authority canonical policy views', () => {
  const database = policyDatabase();
  try {
    const result = matchPoliciesForBusiness({ database, input: businessInput(), now });
    const match = result.matches[0];
    const canonical = result.authority.policies[0];

    for (const value of [
      match,
      match.requiredChecks,
      match.evidence,
      match.evidence[0],
      canonical,
      canonical.requiredChecks,
      canonical.lifecycleStages,
      canonical.supportTypes,
    ]) {
      assert.equal(Object.isFrozen(value), true);
    }
  } finally {
    database.close();
  }
});
