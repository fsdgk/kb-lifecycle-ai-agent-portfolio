import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = await realpath(resolve(scriptDirectory, '../..'));
const intendedOutputPath = resolve(repositoryRoot, 'submission');
const ownershipMarkerName = '.kb-submission-owner.json';
const ownershipMarkerContents = `${JSON.stringify({
  schemaVersion: 1,
  builder: 'kb-lifecycle-submission',
  repositoryRelativeOutput: 'submission',
}, null, 2)}\n`;

const ALLOWLIST = Object.freeze([
  'README.md',
  'LICENSES.md',
  'docs/architecture.md',
  'docs/data-sources.md',
  'docs/privacy-security.md',
  'docs/prototype-vs-production.md',
  'docs/submission-checklist.md',
  'docs/technical-description.md',
  'docs/test-results.md',
  'prototype/README.md',
  'prototype/package.json',
  'prototype/server.mjs',
  'prototype/data/business-profile.json',
  'prototype/data/demo-scenario.json',
  'prototype/data/industry-benchmarks.json',
  'prototype/data/market-signals.json',
  'prototype/data/ontology.json',
  'prototype/data/policies.json',
  'prototype/data/transactions.json',
  'prototype/database/policies.sqlite',
  'prototype/database/schema.sql',
  'prototype/database/seed-policies.json',
  'prototype/database/sources.json',
  'prototype/public/app.js',
  'prototype/public/favicon.svg',
  'prototype/public/index.html',
  'prototype/public/styles.css',
  'prototype/public/views/advisor.js',
  'prototype/public/views/business-input.js',
  'prototype/public/views/council.js',
  'prototype/public/views/financial-analysis.js',
  'prototype/public/views/lifecycle.js',
  'prototype/public/views/market-integrations.js',
  'prototype/public/views/market.js',
  'prototype/public/views/policies.js',
  'prototype/scripts/browser-runtime.mjs',
  'prototype/scripts/build-submission.mjs',
  'prototype/scripts/capture-screenshots.mjs',
  'prototype/scripts/init-policy-db.mjs',
  'prototype/scripts/sync-policies.mjs',
  'prototype/src/agents/agent-schema.mjs',
  'prototype/src/agents/dynamic-agent-definition.mjs',
  'prototype/src/agents/finance-agent.mjs',
  'prototype/src/agents/market-agent.mjs',
  'prototype/src/agents/operations-agent.mjs',
  'prototype/src/agents/policy-agent.mjs',
  'prototype/src/agents/prompts.mjs',
  'prototype/src/agents/stored-result-adapter.mjs',
  'prototype/src/agents/supervisor-agent.mjs',
  'prototype/src/api/router.mjs',
  'prototype/src/data/repository.mjs',
  'prototype/src/domain/advisor-handoff.mjs',
  'prototype/src/domain/business-analysis.mjs',
  'prototype/src/domain/business-input.mjs',
  'prototype/src/domain/event-engine.mjs',
  'prototype/src/domain/expert-council.mjs',
  'prototype/src/domain/finance-engine.mjs',
  'prototype/src/domain/market-engine.mjs',
  'prototype/src/domain/policy-knowledge.mjs',
  'prototype/src/domain/security-gateway.mjs',
  'prototype/src/market/market-data-contract.mjs',
  'prototype/src/model/model-gateway-contract.mjs',
  'prototype/src/orchestration/deep-freeze.mjs',
  'prototype/src/orchestration/dynamic-expert-orchestrator.mjs',
  'prototype/src/orchestration/evidence-registry.mjs',
  'prototype/src/orchestration/opinion-verifier.mjs',
  'prototype/src/orchestration/policy-matcher.mjs',
  'prototype/src/policy-db/database.mjs',
  'prototype/src/policy-db/policy-repository.mjs',
  'prototype/src/policy-db/policy-sync.mjs',
  'prototype/src/policy-db/schema.mjs',
  'prototype/tests/agent-contract.test.mjs',
  'prototype/tests/api.test.mjs',
  'prototype/tests/business-analysis.test.mjs',
  'prototype/tests/business-input.test.mjs',
  'prototype/tests/capture-screenshots.test.mjs',
  'prototype/tests/dynamic-analysis-api.test.mjs',
  'prototype/tests/dynamic-analysis-e2e.test.mjs',
  'prototype/tests/dynamic-expert-orchestrator.test.mjs',
  'prototype/tests/dynamic-ui.test.mjs',
  'prototype/tests/e2e.test.mjs',
  'prototype/tests/event-engine.test.mjs',
  'prototype/tests/expert-council.test.mjs',
  'prototype/tests/finance-engine.test.mjs',
  'prototype/tests/fixtures.test.mjs',
  'prototype/tests/market-data-contract.test.mjs',
  'prototype/tests/market-engine.test.mjs',
  'prototype/tests/opinion-verifier.test.mjs',
  'prototype/tests/policy-database.test.mjs',
  'prototype/tests/policy-knowledge.test.mjs',
  'prototype/tests/policy-matcher.test.mjs',
  'prototype/tests/policy-sync.test.mjs',
  'prototype/tests/privacy-boundary.test.mjs',
  'prototype/tests/repository.test.mjs',
  'prototype/tests/security-gateway.test.mjs',
  'prototype/tests/stored-result-adapter.test.mjs',
  'prototype/tests/submission.test.mjs',
  'prototype/tests/ui-behavior.test.mjs',
  'prototype/tests/ui-format.test.mjs',
]);

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

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent));
}

function comparablePath(path) {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isSamePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function parseOutputArgument(args) {
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) {
    throw new Error('Usage: node scripts/build-submission.mjs --output ../submission');
  }
  return resolve(process.cwd(), args[1]);
}

async function nearestExistingAncestor(path) {
  let candidate = resolve(path);
  while (true) {
    try {
      await lstat(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw new Error(`No existing ancestor found for ${path}`);
      candidate = parent;
    }
  }
}

async function assertNoLinkedOutputComponents(outputPath) {
  const pathFromRoot = relative(repositoryRoot, outputPath);
  let component = repositoryRoot;
  for (const segment of pathFromRoot.split(/[\\/]+/).filter(Boolean)) {
    component = join(component, segment);
    let metadata;
    try {
      metadata = await lstat(component);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const resolvedComponent = await realpath(component);
    if (metadata.isSymbolicLink() || !isSamePath(resolvedComponent, component)) {
      throw new Error(`Submission output contains a symlink, junction, or reparse-point component: ${component}`);
    }
  }
}

async function assertSafeOutput(outputPath) {
  const resolvedOutput = resolve(outputPath);
  if (!isSamePath(resolvedOutput, intendedOutputPath)) {
    throw new Error(`The only supported output is ${intendedOutputPath}.`);
  }
  if (!isWithin(repositoryRoot, resolvedOutput)) {
    throw new Error('The submission output must remain inside the canonical repository worktree.');
  }
  await assertNoLinkedOutputComponents(resolvedOutput);
  const existingAncestor = await nearestExistingAncestor(resolvedOutput);
  const realAncestor = await realpath(existingAncestor);
  if (!isWithin(repositoryRoot, realAncestor)) {
    throw new Error('The nearest existing submission output ancestor resolves outside the repository worktree.');
  }
  return resolvedOutput;
}

async function assertExistingOutputIsOwned(outputPath) {
  let outputMetadata;
  try {
    outputMetadata = await lstat(outputPath);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!outputMetadata.isDirectory() || outputMetadata.isSymbolicLink()) {
    throw new Error('Existing submission output is not a regular builder-owned directory.');
  }
  const markerPath = join(outputPath, ownershipMarkerName);
  let markerMetadata;
  try {
    markerMetadata = await lstat(markerPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Existing submission output has no valid builder ownership marker; refusing replacement.');
    }
    throw error;
  }
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink()) {
    throw new Error('Existing submission output has an invalid builder ownership marker; refusing replacement.');
  }
  if (await readFile(markerPath, 'utf8') !== ownershipMarkerContents) {
    throw new Error('Existing submission output has an invalid builder ownership marker; refusing replacement.');
  }
  return true;
}

async function assertAllowlistedSources() {
  for (const path of ALLOWLIST) {
    const sourcePath = resolve(repositoryRoot, path);
    if (!isWithin(repositoryRoot, sourcePath)) throw new Error(`Unsafe allowlist entry: ${path}`);
    const source = await lstat(sourcePath);
    if (!source.isFile() || source.isSymbolicLink()) {
      throw new Error(`Allowlist entry must be a regular non-symlink file: ${path}`);
    }
  }
}

async function assertNoSensitiveAllowlistedText() {
  for (const path of ALLOWLIST) {
    if (!scannedTextExtensions.has(extname(path).toLowerCase())) continue;
    const sourcePath = resolve(repositoryRoot, path);
    const size = (await lstat(sourcePath)).size;
    if (size > maximumScannedTextBytes) {
      throw new Error(`Allowlisted text file exceeds the bounded content scan limit: ${path}`);
    }
    const contents = await readFile(sourcePath, 'utf8');
    const finding = findSensitiveContent(contents);
    if (finding) throw new Error(`Sensitive content (${finding}) found in allowlisted file: ${path}`);
  }
}

async function readDataJson(name) {
  return readFile(resolve(repositoryRoot, 'prototype', 'data', name), 'utf8').then(JSON.parse);
}

async function assertReviewedDataSources() {
  const [businessProfile, demoScenario, marketSignals, transactions] = await Promise.all([
    readDataJson('business-profile.json'),
    readDataJson('demo-scenario.json'),
    readDataJson('market-signals.json'),
    readDataJson('transactions.json'),
  ]);
  if (businessProfile?.synthetic !== true || demoScenario?.synthetic !== true) {
    throw new Error('Every business demonstration profile must be explicitly synthetic.');
  }
  if (!Array.isArray(demoScenario.snapshots)
      || !demoScenario.snapshots.flatMap((snapshot) => snapshot.marketSignals ?? [])
        .every((record) => record?.synthetic === true)
      || !Array.isArray(marketSignals)
      || !marketSignals.every((record) => record?.synthetic === true)
      || !Array.isArray(transactions)
      || !transactions.every((record) => record?.synthetic === true)) {
    throw new Error('Every transaction and market demonstration record must be explicitly synthetic.');
  }

  const [benchmarks, ontology, legacyPolicies] = await Promise.all([
    readDataJson('industry-benchmarks.json'),
    readDataJson('ontology.json'),
    readDataJson('policies.json'),
  ]);
  if (!Array.isArray(benchmarks)
      || !benchmarks.every((record) => record?.status === 'PROTOTYPE_REFERENCE_RANGE')) {
    throw new Error('industry-benchmarks.json must remain reviewed prototype reference data.');
  }
  if (!Array.isArray(ontology?.entities) || !Array.isArray(ontology?.relations)) {
    throw new Error('ontology.json must remain the reviewed project schema.');
  }
  if (!Array.isArray(legacyPolicies)
      || !legacyPolicies.every((record) => record?.officialUrl && record?.verifiedAt)) {
    throw new Error('policies.json must remain a reviewed legacy official-source snapshot.');
  }
}

async function copyAllowlist(destinationRoot) {
  for (const path of ALLOWLIST) {
    const destination = join(destinationRoot, ...path.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(repositoryRoot, path), destination);
  }
}

export async function buildSubmission(outputPath) {
  const resolvedOutput = await assertSafeOutput(outputPath);
  await assertAllowlistedSources();
  await assertNoSensitiveAllowlistedText();
  await assertReviewedDataSources();

  const outputExists = await assertExistingOutputIsOwned(resolvedOutput);
  await assertSafeOutput(resolvedOutput);
  if (outputExists) await rm(resolvedOutput, { recursive: true, force: true });
  await assertSafeOutput(resolvedOutput);
  try {
    await mkdir(resolvedOutput, { recursive: true });
    await assertSafeOutput(resolvedOutput);
    await copyAllowlist(resolvedOutput);
    await writeFile(join(resolvedOutput, ownershipMarkerName), ownershipMarkerContents, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    try {
      await assertSafeOutput(resolvedOutput);
      await rm(resolvedOutput, { recursive: true, force: true });
    } catch {
      // Leave an unexpectedly redirected path untouched for manual inspection.
    }
    throw error;
  }
  return {
    outputPath: resolvedOutput,
    sourceFileCount: ALLOWLIST.length,
    ownershipMarkerCount: 1,
  };
}

const outputPath = parseOutputArgument(process.argv.slice(2));
const result = await buildSubmission(outputPath);
console.log(
  `Built ${result.outputPath} from ${result.sourceFileCount} explicitly allowlisted source files plus ${result.ownershipMarkerCount} builder ownership marker.`,
);
