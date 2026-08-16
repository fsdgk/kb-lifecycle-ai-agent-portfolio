import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPolicyDatabase } from '../src/policy-db/database.mjs';
import { initializePolicySchema } from '../src/policy-db/policy-repository.mjs';
import { syncKnownPolicies } from '../src/policy-db/policy-sync.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const databaseDirectory = resolve(scriptDirectory, '../database');
const argumentsAfterScript = process.argv.slice(2);
const databaseArgument = argumentsAfterScript[0] === '--database' ? argumentsAfterScript[1] : undefined;

if (!databaseArgument || argumentsAfterScript.length !== 2) {
  throw new Error('Usage: node scripts/sync-policies.mjs --database <database path inside prototype/database>');
}

const databasePath = resolve(process.cwd(), databaseArgument);
const databaseRelativePath = relative(databaseDirectory, databasePath);
if (!databaseRelativePath || databaseRelativePath.startsWith('..') || databaseRelativePath.includes(':')) {
  throw new Error('The database path must be a file inside prototype/database/.');
}

const sources = JSON.parse(await readFile(resolve(databaseDirectory, 'sources.json'), 'utf8'));
const database = openPolicyDatabase(databasePath);
try {
  initializePolicySchema(database);
  const summary = await syncKnownPolicies({ database, sources });
  const integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
  if (integrity !== 'ok') throw new Error(`Policy database integrity check failed: ${integrity}`);
  console.log(JSON.stringify(summary));
  if (summary.failedSourceIds.length === sources.length) process.exitCode = 1;
} finally {
  database.close();
}
