import { readFile, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPolicyDatabase } from '../src/policy-db/database.mjs';
import { initializePolicySchema, upsertPolicySnapshot } from '../src/policy-db/policy-repository.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const databaseDirectory = resolve(scriptDirectory, '../database');
const argumentsAfterScript = process.argv.slice(2);
const outputArgument = argumentsAfterScript[0] === '--output'
  ? argumentsAfterScript[1]
  : argumentsAfterScript.length === 1 ? argumentsAfterScript[0] : undefined;

if (!outputArgument) {
  throw new Error('Usage: node scripts/init-policy-db.mjs --output <database output path inside prototype/database>');
}

const outputPath = resolve(process.cwd(), outputArgument);
const outputRelativePath = relative(databaseDirectory, outputPath);
if (!outputRelativePath || outputRelativePath.startsWith('..') || outputRelativePath.includes(':')) {
  throw new Error('The database output path must be a file inside prototype/database/.');
}

const [seedPolicies, sources] = await Promise.all([
  readFile(resolve(databaseDirectory, 'seed-policies.json'), 'utf8').then(JSON.parse),
  readFile(resolve(databaseDirectory, 'sources.json'), 'utf8').then(JSON.parse),
]);
const sourceUrls = new Set(sources.map((source) => source.officialUrl));
if (seedPolicies.length !== 6 || seedPolicies.some((policy) => !policy.officialUrl || !sourceUrls.has(policy.officialUrl))) {
  throw new Error('Every one of the six seeded policies must have an official source URL.');
}

await rm(outputPath, { force: true });
const database = openPolicyDatabase(outputPath);
try {
  initializePolicySchema(database);
  for (const policy of seedPolicies) {
    upsertPolicySnapshot(database, policy, '2026-08-02T00:00:00.000Z');
  }
  const policyCount = database.prepare('SELECT COUNT(*) AS count FROM policies').get().count;
  if (policyCount !== 6) throw new Error(`Expected six seeded policies, found ${policyCount}.`);
} finally {
  database.close();
}

console.log(`Initialized ${outputPath} with six official policy records.`);
