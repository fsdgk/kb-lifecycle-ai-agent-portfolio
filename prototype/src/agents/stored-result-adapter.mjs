import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { PROMPT_VERSIONS } from './prompts.mjs';

const STAGE_DIRECTORIES = Object.freeze({
  PRE_START: 'pre-start',
  OPERATING_CRISIS: 'operating-crisis',
});
const AGENT_FILES = Object.freeze({
  MARKET: 'market.json',
  OPERATIONS: 'operations.json',
  FINANCE: 'finance.json',
  POLICY: 'policy.json',
  SUPERVISOR: 'supervisor.json',
});
const SCENARIO_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const KNOWN_SCENARIOS = new Set(['seoul-croatian-restaurant']);

function assertExactKeys(value, keys, fieldName) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  const actualKeys = Object.keys(value);
  const unknown = actualKeys.find((key) => !keys.includes(key));
  if (unknown) throw new TypeError(`${fieldName} has unknown field: ${unknown}`);
  const missing = keys.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new TypeError(`${fieldName} is missing required field: ${missing}`);
}

function assertSafeRequest({ root, scenarioId, stage, agent }) {
  if (typeof root !== 'string' || root.length === 0) throw new TypeError('root must be a path string');
  if (typeof scenarioId !== 'string' || !SCENARIO_ID_PATTERN.test(scenarioId)) {
    throw new TypeError('scenarioId must be a safe scenario identifier');
  }
  if (!KNOWN_SCENARIOS.has(scenarioId)) throw new TypeError(`Unknown scenario: ${scenarioId}`);
  if (!Object.hasOwn(STAGE_DIRECTORIES, stage)) throw new TypeError(`Unknown stage: ${String(stage)}`);
  if (!Object.hasOwn(AGENT_FILES, agent)) throw new TypeError(`Unknown agent: ${String(agent)}`);
}

function assertInsideRoot(resolvedRoot, resolvedFile) {
  const childPath = relative(resolvedRoot, resolvedFile);
  if (childPath === '' || childPath === '..' || childPath.startsWith(`..\\`) || childPath.startsWith('../') || isAbsolute(childPath)) {
    throw new TypeError('Stored result path escapes the injected root');
  }
}

function assertMetadata(metadata, request) {
  const keys = ['generator', 'generatedAt', 'promptVersion', 'scenarioId', 'stage', 'agent', 'synthetic'];
  assertExactKeys(metadata, keys, 'metadata');
  if (metadata.generator !== 'ChatGPT') throw new TypeError('metadata.generator must be ChatGPT');
  if (
    typeof metadata.generatedAt !== 'string'
    || Number.isNaN(Date.parse(metadata.generatedAt))
    || new Date(metadata.generatedAt).toISOString() !== metadata.generatedAt
  ) {
    throw new TypeError('metadata.generatedAt must be an ISO timestamp');
  }
  const requiredPromptVersion = request.agent === 'SUPERVISOR'
    ? PROMPT_VERSIONS.supervisor
    : PROMPT_VERSIONS.expert;
  if (metadata.promptVersion !== requiredPromptVersion) {
    throw new TypeError(`metadata.promptVersion must be ${requiredPromptVersion} for ${request.agent}`);
  }
  if (metadata.scenarioId !== request.scenarioId) throw new TypeError('metadata.scenarioId does not match the request');
  if (metadata.stage !== request.stage) throw new TypeError('metadata.stage does not match the request');
  if (metadata.agent !== request.agent) throw new TypeError('metadata.agent does not match the request');
  if (metadata.synthetic !== true) throw new TypeError('metadata.synthetic must be true');
}

export async function loadStoredAgentResult({ root, scenarioId, stage, agent }) {
  const request = { root, scenarioId, stage, agent };
  assertSafeRequest(request);

  const resolvedRoot = await realpath(root);
  const requestedFile = join(resolvedRoot, scenarioId, STAGE_DIRECTORIES[stage], AGENT_FILES[agent]);
  const resolvedFile = await realpath(requestedFile);
  assertInsideRoot(resolvedRoot, resolvedFile);

  let envelope;
  try {
    envelope = JSON.parse(await readFile(resolvedFile, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new TypeError('Stored result must contain valid JSON');
    throw error;
  }

  assertExactKeys(envelope, ['metadata', 'result'], 'stored result envelope');
  assertMetadata(envelope.metadata, request);
  if (envelope.result == null || typeof envelope.result !== 'object' || Array.isArray(envelope.result)) {
    throw new TypeError('stored result envelope.result must be an object');
  }
  return envelope;
}

export const KNOWN_SCENARIO_IDS = Object.freeze([...KNOWN_SCENARIOS]);
