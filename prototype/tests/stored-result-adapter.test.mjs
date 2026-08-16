import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadStoredAgentResult } from '../src/agents/stored-result-adapter.mjs';

function storedEnvelope(overrides = {}) {
  return {
    metadata: {
      generator: 'ChatGPT',
      generatedAt: '2026-08-02T00:00:00.000Z',
      promptVersion: 'expert-v1',
      scenarioId: 'seoul-croatian-restaurant',
      stage: 'PRE_START',
      agent: 'FINANCE',
      synthetic: true,
      ...overrides,
    },
    result: { expert: 'FINANCE' },
  };
}

async function writeStoredResult(root, envelope = storedEnvelope()) {
  const directory = join(root, 'seoul-croatian-restaurant', 'pre-start');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'finance.json'), JSON.stringify(envelope), 'utf8');
}

test('stored-result adapter loads a matching known scenario stage and agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kb-agent-results-'));
  await writeStoredResult(root);

  const loaded = await loadStoredAgentResult({
    root,
    scenarioId: 'seoul-croatian-restaurant',
    stage: 'PRE_START',
    agent: 'FINANCE',
  });

  assert.equal(loaded.metadata.generator, 'ChatGPT');
  assert.equal(loaded.metadata.synthetic, true);
  assert.equal(loaded.result.expert, 'FINANCE');
});

test('stored-result adapter rejects unknown identifiers and traversal before reading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kb-agent-results-'));
  const unregistered = join(root, 'another-safe-scenario', 'pre-start');
  await mkdir(unregistered, { recursive: true });
  await writeFile(join(unregistered, 'finance.json'), JSON.stringify(storedEnvelope({ scenarioId: 'another-safe-scenario' })), 'utf8');

  for (const request of [
    { scenarioId: '../outside', stage: 'PRE_START', agent: 'FINANCE' },
    { scenarioId: 'another-safe-scenario', stage: 'PRE_START', agent: 'FINANCE' },
    { scenarioId: 'seoul-croatian-restaurant', stage: 'UNKNOWN', agent: 'FINANCE' },
    { scenarioId: 'seoul-croatian-restaurant', stage: 'PRE_START', agent: 'HACKER' },
  ]) {
    await assert.rejects(() => loadStoredAgentResult({ root, ...request }), /scenario|stage|agent|identifier/i);
  }
});

test('stored-result adapter rejects symlink escape from the injected root', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kb-agent-results-'));
  const outside = await mkdtemp(join(tmpdir(), 'kb-agent-results-outside-'));
  await writeStoredResult(outside);
  await mkdir(join(root, 'seoul-croatian-restaurant'), { recursive: true });

  try {
    await symlink(
      join(outside, 'seoul-croatian-restaurant', 'pre-start'),
      join(root, 'seoul-croatian-restaurant', 'pre-start'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('This Windows environment does not permit test symlink creation.');
      return;
    }
    throw error;
  }

  await assert.rejects(
    () => loadStoredAgentResult({
      root,
      scenarioId: 'seoul-croatian-restaurant',
      stage: 'PRE_START',
      agent: 'FINANCE',
    }),
    /root|symlink|escape/i,
  );
});

test('stored-result adapter enforces complete matching ChatGPT synthetic metadata', async () => {
  const invalidMetadata = [
    { generator: 'LocalLLM' },
    { generatedAt: 'not-a-date' },
    { promptVersion: '' },
    { promptVersion: 'expert-v0' },
    { promptVersion: 'supervisor-v1' },
    { scenarioId: 'different-scenario' },
    { stage: 'OPERATING_CRISIS' },
    { agent: 'POLICY' },
    { synthetic: false },
  ];

  for (const override of invalidMetadata) {
    const root = await mkdtemp(join(tmpdir(), 'kb-agent-results-'));
    await writeStoredResult(root, storedEnvelope(override));
    await assert.rejects(
      () => loadStoredAgentResult({
        root,
        scenarioId: 'seoul-croatian-restaurant',
        stage: 'PRE_START',
        agent: 'FINANCE',
      }),
      /metadata|generator|generatedAt|promptVersion|scenario|stage|agent|synthetic/i,
    );
  }
});

test('stored-result adapter accepts the supervisor role only with supervisor-v1', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kb-agent-results-'));
  const directory = join(root, 'seoul-croatian-restaurant', 'pre-start');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'supervisor.json'), JSON.stringify(storedEnvelope({
    promptVersion: 'supervisor-v1',
    agent: 'SUPERVISOR',
  })), 'utf8');

  const loaded = await loadStoredAgentResult({
    root,
    scenarioId: 'seoul-croatian-restaurant',
    stage: 'PRE_START',
    agent: 'SUPERVISOR',
  });
  assert.equal(loaded.metadata.promptVersion, 'supervisor-v1');
});

test('stored-result adapter rejects unknown envelope and metadata fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kb-agent-results-'));
  const envelope = storedEnvelope({ modelSecret: 'not-allowed' });
  envelope.hiddenReasoning = 'not-allowed';
  await writeStoredResult(root, envelope);

  await assert.rejects(
    () => loadStoredAgentResult({
      root,
      scenarioId: 'seoul-croatian-restaurant',
      stage: 'PRE_START',
      agent: 'FINANCE',
    }),
    /unknown field/i,
  );
});
