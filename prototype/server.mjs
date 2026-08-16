import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequestHandler } from './src/api/router.mjs';
import { openPolicyDatabase } from './src/policy-db/database.mjs';
import { initializePolicySchema, upsertPolicySnapshot } from './src/policy-db/policy-repository.mjs';
import seedPolicies from './database/seed-policies.json' with { type: 'json' };

function createServerPolicyDatabase(now) {
  const database = openPolicyDatabase(':memory:');
  initializePolicySchema(database);
  for (const policy of seedPolicies) upsertPolicySnapshot(database, policy, now.toISOString());
  return database;
}

export function createAppServer({ now = () => new Date(), policyDatabase, dynamicCouncil } = {}) {
  const serverDatabase = policyDatabase ?? createServerPolicyDatabase(now());
  const server = createServer(createRequestHandler({ now, policyDatabase: serverDatabase, dynamicCouncil }));
  server.once('close', () => {
    if (policyDatabase == null) serverDatabase.close();
  });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = process.env.PORT ?? 4173;
  createAppServer().listen(port, '127.0.0.1');
}
