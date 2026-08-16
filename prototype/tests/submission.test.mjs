import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPolicyDatabase } from '../src/policy-db/database.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const prototypeRoot = resolve(testDirectory, '..');
const repositoryRoot = resolve(prototypeRoot, '..');

const requiredFiles = [
  '.kb-submission-owner.json',
  'README.md',
  'LICENSES.md',
  'docs/technical-description.md',
  'docs/architecture.md',
  'docs/data-sources.md',
  'docs/privacy-security.md',
  'docs/prototype-vs-production.md',
  'docs/test-results.md',
  'docs/submission-checklist.md',
  'prototype/package.json',
  'prototype/README.md',
  'prototype/server.mjs',
  'prototype/public/index.html',
  'prototype/src/agents/market-agent.mjs',
  'prototype/src/agents/operations-agent.mjs',
  'prototype/src/agents/finance-agent.mjs',
  'prototype/src/agents/policy-agent.mjs',
  'prototype/src/agents/supervisor-agent.mjs',
  'prototype/src/orchestration/dynamic-expert-orchestrator.mjs',
  'prototype/src/orchestration/evidence-registry.mjs',
  'prototype/src/orchestration/opinion-verifier.mjs',
  'prototype/src/orchestration/policy-matcher.mjs',
  'prototype/src/model/model-gateway-contract.mjs',
  'prototype/data/industry-benchmarks.json',
  'prototype/database/policies.sqlite',
  'prototype/database/schema.sql',
  'prototype/database/sources.json',
  'prototype/database/seed-policies.json',
  'prototype/scripts/build-submission.mjs',
  'prototype/scripts/init-policy-db.mjs',
  'prototype/tests/submission.test.mjs',
];

const disclosureDocuments = [
  'README.md',
  'prototype/README.md',
  'docs/technical-description.md',
  'docs/architecture.md',
  'docs/data-sources.md',
  'docs/privacy-security.md',
  'docs/prototype-vs-production.md',
  'docs/test-results.md',
  'docs/submission-checklist.md',
];

const requiredDisclosures = [
  /user-entered or synthetic/i,
  /PROTOTYPE_REFERENCE_RANGE/,
  /official-source snapshots/i,
  /ChatGPT aided the prototype agent-result design/i,
  /enterprise internal local LLM/i,
  /No local model was installed, run, or evaluated/i,
  /PLANNED_INTEGRATION/,
];

const scannedTextExtensions = new Set([
  '.css', '.html', '.js', '.json', '.md', '.mjs', '.sql', '.svg',
]);
const maximumScannedTextBytes = 2 * 1024 * 1024;
const sensitiveContentPatterns = [
  ['private-key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['OpenAI-style API key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub-style token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Google-style API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['Slack-style token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
];
const quotedCredentialAssignmentPattern = /(?<![\p{L}\p{N}_-])(?<nameQuote>['"]?)(?<name>[A-Za-z][A-Za-z0-9_-]*)\k<nameQuote>\s*[:=]\s*(?<valueQuote>['"])(?<value>[^'"\r\n]{8,})\k<valueQuote>/giu;
const explicitCredentialLiteralPlaceholderPatterns = [
  /^<\s*(?:redacted|placeholder)\s*>$/i,
  /^\[\s*(?:redacted|placeholder)\s*\]$/i,
  /^(?:redacted|placeholder|not[-_ ]allowed)$/i,
  /^your[-_ ]+(?:api[-_ ]*key|token|secret|password|credentials?)(?:[-_ ]+here)?$/i,
];
const environmentCredentialReferencePattern = /^\$\{(?<name>[A-Z][A-Z0-9_]*)(?:(?<operator>:-|:=|:\+|-|=|\+)(?<branch>[^}\r\n]*))?\}$/i;

function isCredentialVariableName(name) {
  const compactName = name.replace(/[_-]/g, '').toLowerCase();
  return [
    'apikey',
    'token',
    'secret',
    'password',
    'passwd',
    'pwd',
    'credential',
    'credentials',
  ].some((suffix) => compactName.endsWith(suffix));
}

function isExplicitCredentialLiteralPlaceholder(value) {
  const normalizedValue = value.trim();
  return explicitCredentialLiteralPlaceholderPatterns.some((pattern) => pattern.test(normalizedValue));
}

function isExplicitCredentialPlaceholder(value) {
  const normalizedValue = value.trim();
  const environmentReference = environmentCredentialReferencePattern.exec(normalizedValue);
  if (!environmentReference) return isExplicitCredentialLiteralPlaceholder(normalizedValue);
  if (!environmentReference.groups.operator) return true;
  return isExplicitCredentialLiteralPlaceholder(environmentReference.groups.branch);
}

function findSensitiveContent(contents) {
  const directFinding = sensitiveContentPatterns.find(([, pattern]) => pattern.test(contents));
  if (directFinding) return directFinding[0];
  for (const match of contents.matchAll(quotedCredentialAssignmentPattern)) {
    if (isCredentialVariableName(match.groups.name)
        && !isExplicitCredentialPlaceholder(match.groups.value)) {
      return 'credential assignment';
    }
  }
  return null;
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    const pathRelativeToRoot = relative(root, path).replaceAll('\\', '/');
    assert.equal(entry.isSymbolicLink(), false, `Submission must not contain symlinks: ${pathRelativeToRoot}`);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else files.push(pathRelativeToRoot);
  }
  return files.sort();
}

async function createRepositoryFixture(t, label) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), `kb-submission-${label}-`));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const fixturePrototype = join(fixtureRoot, 'prototype');
  const fixturePublic = join(fixturePrototype, 'public');
  const fixtureDatabase = join(fixturePrototype, 'database');
  await Promise.all([
    mkdir(fixturePublic, { recursive: true }),
    mkdir(fixtureDatabase, { recursive: true }),
  ]);
  await Promise.all([
    cp(join(repositoryRoot, 'docs'), join(fixtureRoot, 'docs'), { recursive: true }),
    cp(join(prototypeRoot, 'data'), join(fixturePrototype, 'data'), { recursive: true }),
    cp(join(prototypeRoot, 'scripts'), join(fixturePrototype, 'scripts'), { recursive: true }),
    cp(join(prototypeRoot, 'src'), join(fixturePrototype, 'src'), { recursive: true }),
    cp(join(prototypeRoot, 'tests'), join(fixturePrototype, 'tests'), { recursive: true }),
    cp(join(prototypeRoot, 'public', 'views'), join(fixturePublic, 'views'), { recursive: true }),
    cp(join(repositoryRoot, 'README.md'), join(fixtureRoot, 'README.md')),
    cp(join(repositoryRoot, 'LICENSES.md'), join(fixtureRoot, 'LICENSES.md')),
    ...['README.md', 'package.json', 'server.mjs'].map((name) => (
      cp(join(prototypeRoot, name), join(fixturePrototype, name))
    )),
    ...['app.js', 'favicon.svg', 'index.html', 'styles.css'].map((name) => (
      cp(join(prototypeRoot, 'public', name), join(fixturePublic, name))
    )),
    ...['policies.sqlite', 'schema.sql', 'seed-policies.json', 'sources.json'].map((name) => (
      cp(join(prototypeRoot, 'database', name), join(fixtureDatabase, name))
    )),
  ]);
  return {
    root: fixtureRoot,
    prototype: fixturePrototype,
    builder: join(fixturePrototype, 'scripts', 'build-submission.mjs'),
    output: join(fixtureRoot, 'submission'),
  };
}

function runBuilder(fixture, output = fixture.output) {
  return spawnSync(process.execPath, [fixture.builder, '--output', output], {
    cwd: fixture.prototype,
    encoding: 'utf8',
  });
}

async function assertNoSensitiveText(root, packagedFiles) {
  for (const relativePath of packagedFiles) {
    if (!scannedTextExtensions.has(extname(relativePath).toLowerCase())) continue;
    const path = join(root, relativePath);
    const size = (await lstat(path)).size;
    assert.ok(size <= maximumScannedTextBytes, `Text scan bound exceeded: ${relativePath}`);
    const contents = await readFile(path, 'utf8');
    const finding = findSensitiveContent(contents);
    assert.equal(finding, null, `${relativePath} contains a ${finding}`);
  }
}

async function assertReviewedDataClassifications(output) {
  const dataRoot = join(output, 'prototype', 'data');
  assert.deepEqual(
    (await readdir(dataRoot)).filter((name) => name.endsWith('.json')).sort(),
    [
      'business-profile.json',
      'demo-scenario.json',
      'industry-benchmarks.json',
      'market-signals.json',
      'ontology.json',
      'policies.json',
      'transactions.json',
    ],
  );

  const businessProfile = JSON.parse(await readFile(join(dataRoot, 'business-profile.json'), 'utf8'));
  const demoScenario = JSON.parse(await readFile(join(dataRoot, 'demo-scenario.json'), 'utf8'));
  const marketSignals = JSON.parse(await readFile(join(dataRoot, 'market-signals.json'), 'utf8'));
  const transactions = JSON.parse(await readFile(join(dataRoot, 'transactions.json'), 'utf8'));
  assert.equal(businessProfile.synthetic, true);
  assert.equal(demoScenario.synthetic, true);
  assert.ok(demoScenario.snapshots.flatMap((snapshot) => snapshot.marketSignals).every((record) => record.synthetic === true));
  assert.ok(marketSignals.every((record) => record.synthetic === true));
  assert.ok(transactions.every((record) => record.synthetic === true));

  const benchmarks = JSON.parse(await readFile(join(dataRoot, 'industry-benchmarks.json'), 'utf8'));
  const ontology = JSON.parse(await readFile(join(dataRoot, 'ontology.json'), 'utf8'));
  const legacyPolicies = JSON.parse(await readFile(join(dataRoot, 'policies.json'), 'utf8'));
  assert.ok(benchmarks.every((record) => record.status === 'PROTOTYPE_REFERENCE_RANGE'));
  assert.ok(Array.isArray(ontology.entities) && Array.isArray(ontology.relations));
  assert.ok(legacyPolicies.every((record) => record.officialUrl && record.verifiedAt));
}

test('allowlisted builder produces a standalone, factual, artifact-free submission', async (t) => {
  const fixture = await createRepositoryFixture(t, 'complete');
  const sentinel = join(fixture.prototype, 'real-user-private-test-sentinel.json');
  await writeFile(sentinel, '{"mustNeverShip":true}\n', 'utf8');

  const built = runBuilder(fixture);
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  assert.match(built.stdout, /99 explicitly allowlisted source files plus 1 builder ownership marker/i);

  for (const path of requiredFiles) {
    assert.equal((await lstat(join(fixture.output, path))).isFile(), true, `Missing required submission file: ${path}`);
  }
  await assert.rejects(lstat(join(fixture.output, 'prototype', basename(sentinel))), { code: 'ENOENT' });

  const packagedFiles = await listFiles(fixture.output);
  const forbidden = packagedFiles.filter((path) => (
    /(^|\/)(?:\.git|node_modules)(?:\/|$)/i.test(path)
    || /\.(?:ppt|pptx|pdf|gguf|safetensors|onnx|pt|pth|ckpt|h5|pem|key|tmp|temp|bak|swp)$/i.test(path)
    || /(^|\/)(?:\.env(?:\..*)?|id_rsa|credentials?|secrets?)(?:\/|\.|$)/i.test(path)
    || /real[-_ ]?user/i.test(path)
    || /~$/.test(path)
  ));
  assert.deepEqual(forbidden, []);
  await assertNoSensitiveText(fixture.output, packagedFiles);
  await assertReviewedDataClassifications(fixture.output);

  for (const documentPath of disclosureDocuments) {
    const contents = await readFile(join(fixture.output, documentPath), 'utf8');
    for (const disclosure of requiredDisclosures) {
      assert.match(contents, disclosure, `${documentPath} omits ${disclosure}`);
    }
  }
  const dataSources = await readFile(join(fixture.output, 'docs/data-sources.md'), 'utf8');
  assert.match(dataSources, /business-profile\.json.*demo-scenario\.json.*market-signals\.json.*transactions\.json.*synthetic/is);
  assert.match(dataSources, /industry-benchmarks\.json.*hand-authored.*prototype reference/is);
  assert.match(dataSources, /ontology\.json.*project schema/is);
  assert.match(dataSources, /policies\.json.*legacy official-source snapshot/is);
  assert.match(dataSources, /authoritative.*SQLite.*sources\.json.*seed-policies\.json/is);

  const database = openPolicyDatabase(join(fixture.output, 'prototype/database/policies.sqlite'));
  try {
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM policies').get().count, 6);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM policies WHERE status = 'CHECK_REQUIRED'").get().count,
      5,
    );
  } finally {
    database.close();
  }
});

test('production CLI accepts only the intended submission directory', async (t) => {
  const fixture = await createRepositoryFixture(t, 'exact-output');
  const outside = await mkdtemp(join(tmpdir(), 'kb-submission-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));

  for (const refusedPath of [
    outside,
    fixture.root,
    fixture.prototype,
    join(fixture.root, 'docs'),
    join(fixture.root, 'plans'),
  ]) {
    const attempt = runBuilder(fixture, refusedPath);
    assert.notEqual(attempt.status, 0);
    assert.match(attempt.stderr, /only supported output.*submission/i);
  }
});

test('builder never replaces an unowned existing submission directory', async (t) => {
  const fixture = await createRepositoryFixture(t, 'ownership');
  const sentinel = join(fixture.output, 'sentinel.txt');
  await mkdir(fixture.output, { recursive: true });
  await writeFile(sentinel, 'must remain\n', 'utf8');

  const attempt = runBuilder(fixture);
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /ownership marker/i);
  assert.equal(await readFile(sentinel, 'utf8'), 'must remain\n');
});

test('builder rejects a junction or symlink output without touching its external target', async (t) => {
  const fixture = await createRepositoryFixture(t, 'junction');
  const external = await mkdtemp(join(tmpdir(), 'kb-submission-external-'));
  const sentinel = join(external, 'sentinel.txt');
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(sentinel, 'outside must remain\n', 'utf8');
  try {
    await symlink(external, fixture.output, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EACCES', 'ENOTSUP', 'EPERM'].includes(error.code)) {
      t.skip(`Platform cannot create a disposable directory link: ${error.code}`);
      return;
    }
    throw error;
  }

  const attempt = runBuilder(fixture);
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /symlink|junction|reparse|real path/i);
  assert.equal(await readFile(sentinel, 'utf8'), 'outside must remain\n');
  await assert.rejects(lstat(join(external, 'README.md')), { code: 'ENOENT' });
});

test('builder rejects sensitive signatures in allowlisted text files', async (t) => {
  const signatures = [
    ['private-key', ['-----BEGIN ', 'PRIVATE KEY-----'].join('')],
    ['credential-assignment', ['password', ' = "not-a-live-value"'].join('')],
    ['cloud-key', ['AKIA', '0'.repeat(16)].join('')],
    ['api-key', ['sk-', '0'.repeat(24)].join('')],
    ['api-project-key', ['sk-proj-', '0'.repeat(24)].join('')],
  ];

  for (const [label, signature] of signatures) {
    await t.test(label, async (subtest) => {
      const fixture = await createRepositoryFixture(subtest, label);
      await appendFile(join(fixture.prototype, 'server.mjs'), `\n// ${signature}\n`, 'utf8');
      const attempt = runBuilder(fixture);
      assert.notEqual(attempt.status, 0);
      assert.match(attempt.stderr, /sensitive content/i);
    });
  }
});

test('builder rejects provider-prefixed quoted credential assignments', async (t) => {
  const assignments = [
    ['openai-project-key', ['OPENAI', '_API_KEY="', 'sk-proj-', 'abcdefghijklmnopqrstuvwxyz123456', '"'].join('')],
    ['prefixed-api-key', ['ACME', '_API_KEY="', 'fake-secret-shaped-api-key-123456', '"'].join('')],
    ['prefixed-token', ['SERVICE', '_TOKEN="', 'fake-secret-shaped-token-123456', '"'].join('')],
    ['prefixed-secret', ['CLIENT', '_SECRET="', 'fake-secret-shaped-secret-123456', '"'].join('')],
    ['mixed-case-password', ['DbPass', 'Word="', 'fake-secret-shaped-password-123456', '"'].join('')],
    ['credential-name', ['service_', 'credential="', 'fake-secret-shaped-credential-123456', '"'].join('')],
  ];

  for (const [label, assignment] of assignments) {
    await t.test(label, async (subtest) => {
      const fixture = await createRepositoryFixture(subtest, label);
      await appendFile(join(fixture.prototype, 'server.mjs'), `\n// ${assignment}\n`, 'utf8');
      const attempt = runBuilder(fixture);
      assert.notEqual(attempt.status, 0);
      assert.match(attempt.stderr, /sensitive content/i);
    });
  }
});

test('builder rejects literal credential parameter-expansion branches', async (t) => {
  const cases = [
    ['colon-default-shell', ['SERVICE', '_TOKEN="', '${', 'SERVICE_TOKEN', ':-', 'literal-secret-value-123456', '}', '"'].join('')],
    ['default-json', ['"CLIENT', '_SECRET": "', '${', 'CLIENT_SECRET', '-', 'arbitrary-default-value-123456', '}', '"'].join('')],
    ['colon-assign-js', ['password = "', '${', 'PASSWORD', ':=', 'fake-assigned-password-123456', '}', '"'].join('')],
    ['assign-shell', ['SERVICE_', 'CREDENTIAL="', '${', 'SERVICE_CREDENTIAL', '=', 'fake-credential-value-123456', '}', '"'].join('')],
    ['colon-alternate-json', ['"ACCESS', '_TOKEN": "', '${', 'ACCESS_TOKEN', ':+', 'fake-alternate-token-123456', '}', '"'].join('')],
    ['alternate-js', ['client', 'Secret = "', '${', 'CLIENT_SECRET', '+', 'fake-client-secret-123456', '}', '"'].join('')],
    ['empty-default', ['SERVICE', '_TOKEN="', '${', 'SERVICE_TOKEN', ':-', '}', '"'].join('')],
  ];

  for (const [label, assignment] of cases) {
    await t.test(label, async (subtest) => {
      const fixture = await createRepositoryFixture(subtest, `expansion-${label}`);
      await appendFile(join(fixture.prototype, 'server.mjs'), `\n// ${assignment}\n`, 'utf8');
      const attempt = runBuilder(fixture);
      assert.notEqual(attempt.status, 0);
      assert.match(attempt.stderr, /sensitive content/i);
    });
  }
});

test('builder allows explicit quoted credential placeholders', async (t) => {
  const fixture = await createRepositoryFixture(t, 'credential-placeholders');
  const placeholders = [
    ['OPENAI', '_API_KEY="', '<redacted>', '"'].join(''),
    ['SERVICE', '_TOKEN="', '${', 'SERVICE_TOKEN', '}', '"'].join(''),
    ['CLIENT', '_SECRET="', 'YOUR_SECRET_HERE', '"'].join(''),
    ['DB_PASS', 'WORD="', 'PLACEHOLDER', '"'].join(''),
    ['SERVICE_', 'CREDENTIAL="', '[REDACTED]', '"'].join(''),
    ['FALLBACK', '_TOKEN="', '${', 'FALLBACK_TOKEN', ':-', 'REDACTED', '}', '"'].join(''),
    ['"CLIENT', '_SECRET": "', '${', 'CLIENT_SECRET', '-', '<redacted>', '}', '"'].join(''),
    ['password = "', '${', 'PASSWORD', ':=', 'PLACEHOLDER', '}', '"'].join(''),
    ['SERVICE_', 'CREDENTIAL="', '${', 'SERVICE_CREDENTIAL', '=', '[REDACTED]', '}', '"'].join(''),
    ['"ACCESS', '_TOKEN": "', '${', 'ACCESS_TOKEN', ':+', 'YOUR_TOKEN_HERE', '}', '"'].join(''),
    ['DbPass', 'Word = "', '${', 'DB_PASSWORD', '+', 'not-allowed', '}', '"'].join(''),
  ];
  await appendFile(join(fixture.prototype, 'server.mjs'), `\n// ${placeholders.join('\n// ')}\n`, 'utf8');

  const attempt = runBuilder(fixture);
  assert.equal(attempt.status, 0, `${attempt.stdout}\n${attempt.stderr}`);
});

test('builder rejects a non-synthetic demonstration record', async (t) => {
  const fixture = await createRepositoryFixture(t, 'non-synthetic');
  const profilePath = join(fixture.prototype, 'data', 'business-profile.json');
  const profile = JSON.parse(await readFile(profilePath, 'utf8'));
  profile.synthetic = false;
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');

  const attempt = runBuilder(fixture);
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /synthetic/i);
});
