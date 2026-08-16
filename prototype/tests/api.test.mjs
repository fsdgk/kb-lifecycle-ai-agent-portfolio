import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../server.mjs';

async function startServer(t) {
  const server = createAppServer({
    now: () => new Date('2026-08-03T00:00:00.000Z'),
  }).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function rawPost(baseUrl, body) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL('/api/analyze', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

function postChunkedPastLimitWithoutEnding(baseUrl) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL('/api/analyze', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
      },
    });
    const timeout = setTimeout(() => {
      request.destroy();
      reject(new Error('Timed out waiting for an early 413 response'));
    }, 2_000);

    request.on('response', (response) => {
      clearTimeout(timeout);
      request.end();
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    request.write(Buffer.alloc(1024 * 1024, 0x20));
    request.write(Buffer.from('x'));
  });
}

test('bootstrap and analysis endpoints return traceable JSON', async (t) => {
  const baseUrl = await startServer(t);
  const bootstrap = await fetch(`${baseUrl}/api/bootstrap`).then((response) => response.json());
  assert.equal(bootstrap.profile.scenarioId, 'scenario-seoul-croatia-001');

  const analysis = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: '창업 자금과 후보지를 함께 분석해줘' }),
  }).then((response) => response.json());

  assert.equal(analysis.meta.synthetic, true);
  assert.equal(analysis.meta.scenarioId, 'scenario-seoul-croatia-001');
  assert.match(analysis.meta.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(analysis.council.evidence.length > 0);
});

test('analysis composes the real finance, policy, market, and council contracts', async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: '창업 자금과 컨설팅 정책을 찾아줘' }),
  });
  const analysis = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(analysis.finance, {
    plannedCost: 112_000_000,
    ownCapital: 60_000_000,
    fundingGap: 52_000_000,
    recommendedBuffer: 16_800_000,
  });
  assert.ok(analysis.policies.length > 0);
  assert.ok(analysis.policies.every((policy) => (
    policy.eligibility !== 'APPROVED'
    && policy.evidence.every((item) => item.officialUrl && item.verifiedAt)
  )));
  assert.deepEqual(analysis.market.siteComparison, [
    { siteId: 'A', score: 64, rank: 2, evidenceIds: ['market.site.A'] },
    { siteId: 'B', score: 68, rank: 1, evidenceIds: ['market.site.B'] },
  ]);
  assert.deepEqual(
    analysis.council.opinions.map((opinion) => opinion.expert),
    ['MARKET', 'OPERATIONS', 'FINANCE', 'POLICY'],
  );
});

test('analysis applies a bounded realtime cost signal after an ingredient-cost event', async (t) => {
  const baseUrl = await startServer(t);
  const question = '창업 자금과 정책 지원을 분석해줘';
  const baseline = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }),
  }).then((response) => response.json());
  const event = await fetch(`${baseUrl}/api/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: { type: 'INGREDIENT_COST_SPIKE', source: 'USER_SIMULATION', asOf: '2026-08-02T09:00:00+09:00' } }),
  }).then((response) => response.json());
  assert.equal(event.alerts[0].channel, 'IMMEDIATE');

  const changed = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question,
      context: {
        path: 'startup',
        stage: 'SITE_AND_FUNDING',
        realtimeSignal: {
          signalId: 'simulation-ingredient-cost-spike',
          metric: 'INGREDIENT_COST_INDEX',
          value: 1.5,
          unit: 'INDEX',
          source: 'USER_SIMULATION',
          asOf: '2026-08-02T09:00:00+09:00',
          refreshTier: 'REALTIME',
        },
      },
    }),
  }).then((response) => response.json());

  assert.equal(changed.meta.context.stage, 'SITE_AND_FUNDING');
  assert.equal(changed.meta.context.path, 'startup');
  assert.equal(changed.market.scenarios.baseline.index, baseline.market.scenarios.baseline.index - 5);
  assert.equal(changed.market.scenarios.downside.index, baseline.market.scenarios.downside.index - 5);
  assert.equal(changed.market.usableSignals.at(-1).metric, 'INGREDIENT_COST_INDEX');

  const laterQuestion = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: '이후 수동 질문', context: {
      path: 'startup', stage: 'SITE_AND_FUNDING', realtimeSignal: changed.market.usableSignals.at(-1),
    } }),
  }).then((response) => response.json());
  assert.equal(laterQuestion.market.scenarios.baseline.index, changed.market.scenarios.baseline.index);
});

test('operator analysis uses synthetic operating cashflow instead of startup funding', async (t) => {
  const baseUrl = await startServer(t);
  const startup = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: '현재 사업 분석', context: { path: 'startup', stage: 'SITE_AND_FUNDING' } }),
  }).then((response) => response.json());
  const operator = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: '현재 사업 분석', context: { path: 'operator', stage: 'OPERATING' } }),
  }).then((response) => response.json());

  assert.equal(operator.meta.context.path, 'operator');
  assert.equal(operator.meta.context.stage, 'OPERATING');
  assert.equal(operator.finance.mode, 'OPERATING_CASHFLOW');
  assert.equal(operator.finance.snapshotId, 'snapshot-operating-month-4-2027-02-01');
  assert.equal(operator.finance.forecast.daily.length, 28);
  assert.equal('plannedCost' in operator.finance, false);
  assert.notDeepEqual(operator.finance, startup.finance);
  assert.equal(operator.profile.stage, 'OPERATING');
  const operationsOpinion = operator.council.opinions.find((opinion) => opinion.expert === 'OPERATIONS');
  assert.equal(operationsOpinion.claims[0].code, 'OPERATING_PERFORMANCE_REVIEW_REQUIRED');
  assert.equal(operator.council.opinions.find((opinion) => opinion.expert === 'FINANCE').claims[0].code, 'OPERATING_CASHFLOW_FORECAST_AVAILABLE');

  const handoff = await fetch(`${baseUrl}/api/advisor-handoff`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ council: operator.council, consent: { approved: true } }),
  }).then((response) => response.json());
  assert.deepEqual(handoff.handoff.calculationEvidence, [{
    id: 'evidence.finance.cashflow.minimumBalance', source: 'FINANCE', kind: 'DETERMINISTIC_CASHFLOW_FORECAST',
    value: operator.finance.forecast.minimumBalance, unit: 'KRW', asOf: '2027-02-01',
  }]);
});

test('analysis rejects operator contexts at pre-operating lifecycle stages', async (t) => {
  const baseUrl = await startServer(t);

  for (const stage of ['PRE_START', 'SITE_AND_FUNDING', 'OPENING']) {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Review this business', context: { path: 'operator', stage } }),
    });
    const body = await response.json();

    assert.equal(response.status, 400, stage);
    assert.deepEqual(Object.keys(body), ['error'], stage);
    assert.equal(body.error.code, 'INVALID_ANALYSIS_CONTEXT', stage);
    assert.equal(typeof body.error.message, 'string', stage);
  }
});

for (const [label, context] of [
  ['path-only', { path: 'operator' }],
  ['stage-only', { stage: 'OPERATING' }],
]) {
  test(`analysis rejects ${label} lifecycle context`, async (t) => {
    const baseUrl = await startServer(t);
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Review this business', context }),
    });
    const body = await response.json();

    assert.equal(response.status, 400, JSON.stringify(context));
    assert.deepEqual(Object.keys(body), ['error'], JSON.stringify(context));
    assert.equal(body.error.code, 'INVALID_ANALYSIS_CONTEXT', JSON.stringify(context));
    assert.equal(typeof body.error.message, 'string', JSON.stringify(context));
    assert.ok(body.error.message.length > 0, JSON.stringify(context));
  });
}

test('analysis accepts paired lifecycle, signal-only, empty, and omitted contexts', async (t) => {
  const baseUrl = await startServer(t);
  const acceptedContexts = [
    { path: 'operator', stage: 'OPERATING' },
    {
      realtimeSignal: {
        signalId: 'simulation-ingredient-cost-spike',
        metric: 'INGREDIENT_COST_INDEX',
        value: 1.5,
        unit: 'INDEX',
        source: 'USER_SIMULATION',
        asOf: '2026-08-02T09:00:00+09:00',
        refreshTier: 'REALTIME',
      },
    },
    {},
    undefined,
  ];

  for (const context of acceptedContexts) {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Review this business', ...(context ? { context } : {}) }),
    });
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(context));
    assert.ok(body.council.opinions.length > 0, JSON.stringify(context));
  }
});

test('analysis rejects unsafe realtime signal context', async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: '시장 분석', context: { realtimeSignal: { metric: 'ARBITRARY', value: 1 } } }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_ANALYSIS_CONTEXT');
});

test('event, policy, and advisor routes preserve their domain contracts', async (t) => {
  const baseUrl = await startServer(t);

  const policiesResponse = await fetch(`${baseUrl}/api/policies`);
  const policyBody = await policiesResponse.json();
  assert.equal(policiesResponse.status, 200);
  assert.equal(policyBody.policies.length, 6);
  assert.ok(policyBody.policies.every((policy) => policy.officialUrl && policy.verifiedAt));

  const eventResponse = await fetch(`${baseUrl}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event: {
        type: 'INGREDIENT_COST_SPIKE',
        source: 'SUPPLIER_FEED',
        asOf: '2026-08-01T15:05:00+09:00',
      },
    }),
  });
  const eventBody = await eventResponse.json();
  assert.equal(eventResponse.status, 200);
  assert.equal(eventBody.alerts[0].channel, 'IMMEDIATE');
  assert.equal(eventBody.alerts[0].evidence[0].source, 'SUPPLIER_FEED');

  const handoffResponse = await fetch(`${baseUrl}/api/advisor-handoff`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      council: {
        summary: 'A funding plan needs review before commitment.',
        opinions: [{
          expert: 'FINANCE',
          claims: [{ code: 'FUNDING_GAP_EXISTS', statement: 'A deterministic gap is available.' }],
        }],
        evidence: [{
          id: 'evidence.finance.fundingGap',
          source: 'FINANCE',
          kind: 'DETERMINISTIC_CALCULATION',
          value: 52_000_000,
          unit: 'KRW',
        }],
      },
      consent: { approved: true },
    }),
  });
  const handoffBody = await handoffResponse.json();
  assert.equal(handoffResponse.status, 200);
  assert.deepEqual(handoffBody.consent, { approved: true });
  assert.deepEqual(handoffBody.handoff.calculationEvidence, [{
    id: 'evidence.finance.fundingGap',
    source: 'FINANCE',
    kind: 'DETERMINISTIC_CALCULATION',
    value: 52_000_000,
    unit: 'KRW',
  }]);
});

test('API responses set JSON security and no-store headers', async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/api/bootstrap`);

  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('API validation failures use the stable error envelope', async (t) => {
  const baseUrl = await startServer(t);
  const cases = [
    {
      path: '/api/analyze',
      body: JSON.stringify({ question: '   ' }),
      status: 400,
      code: 'INVALID_QUESTION',
    },
    {
      path: '/api/events',
      body: JSON.stringify({ event: null }),
      status: 400,
      code: 'INVALID_EVENT',
    },
    {
      path: '/api/advisor-handoff',
      body: JSON.stringify({ council: { summary: 'Review needed' }, consent: { approved: false } }),
      status: 403,
      code: 'CONSENT_REQUIRED',
    },
    {
      path: '/api/analyze',
      body: '{not valid JSON',
      status: 400,
      code: 'INVALID_JSON',
    },
  ];

  for (const item of cases) {
    const response = await fetch(`${baseUrl}${item.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: item.body,
    });
    const body = await response.json();
    assert.equal(response.status, item.status);
    assert.deepEqual(Object.keys(body), ['error']);
    assert.equal(body.error.code, item.code);
    assert.equal(typeof body.error.message, 'string');
    assert.ok(body.error.message.length > 0);
  }
});

test('JSON request bodies larger than 1 MB are rejected', async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'x'.repeat(1024 * 1024) }),
  });
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('chunked JSON crossing 1 MB is rejected before the client ends the request', async (t) => {
  const baseUrl = await startServer(t);
  const response = await postChunkedPastLimitWithoutEnding(baseUrl);

  assert.equal(response.status, 413);
  assert.equal(response.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('malformed UTF-8 JSON is rejected instead of decoding replacement characters', async (t) => {
  const baseUrl = await startServer(t);
  const body = Buffer.concat([
    Buffer.from('{"question":"'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('"}'),
  ]);
  const response = await rawPost(baseUrl, body);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_JSON');
});

test('static path traversal is rejected before filesystem access', async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/..%5cserver.mjs`);

  assert.equal(response.status, 403);
});

test('static files are served only from the public directory', async (t) => {
  const publicDirectory = new URL('../public/', import.meta.url);
  const testAsset = new URL('__api-test__.txt', publicDirectory);
  await mkdir(publicDirectory, { recursive: true });
  await writeFile(testAsset, 'public asset', 'utf8');
  t.after(() => rm(testAsset, { force: true }));

  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/__api-test__.txt`);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'public asset');
  assert.match(response.headers.get('content-type'), /^text\/plain/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('a public-directory junction escape is rejected before its target is read', async (t) => {
  const publicDirectory = new URL('../public/', import.meta.url);
  const escapeLink = new URL('__escape-link__', publicDirectory);
  const outsideDirectory = await mkdtemp(join(tmpdir(), 'kb-static-escape-'));
  await mkdir(publicDirectory, { recursive: true });
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));

  try {
    await symlink(outsideDirectory, escapeLink, 'junction');
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error?.code)) throw error;
    const baseUrl = await startServer(t);
    const fallback = await fetch(`${baseUrl}/..%5cserver.mjs`);
    assert.equal(fallback.status, 403);
    t.skip(`junction creation is not permitted on this platform: ${error.code}`);
    return;
  }
  t.after(() => unlink(escapeLink));

  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/__escape-link__`);

  assert.equal(response.status, 403);
});
