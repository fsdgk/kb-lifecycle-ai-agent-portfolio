import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadBusinessProfile,
  loadMarketSignals,
  loadPolicies,
  loadTransactions,
} from '../data/repository.mjs';
import { searchPolicies } from '../domain/policy-knowledge.mjs';
import { calculateStartupFunding, forecastCashflow } from '../domain/finance-engine.mjs';
import { analyzeMarket, applyRealtimeSignal } from '../domain/market-engine.mjs';
import { runStoredDemoCouncil } from '../domain/expert-council.mjs';
import { processBusinessEvent } from '../domain/event-engine.mjs';
import { buildAdvisorHandoff } from '../domain/advisor-handoff.mjs';
import { loadIndustryBenchmark, normalizeBusinessInput } from '../domain/business-input.mjs';
import { analyzeOperatingInput, analyzeStartupInput } from '../domain/business-analysis.mjs';
import { matchPoliciesForBusiness } from '../orchestration/policy-matcher.mjs';
import { runDynamicExpertCouncil } from '../orchestration/dynamic-expert-orchestrator.mjs';

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const PUBLIC_DIRECTORY = fileURLToPath(new URL('../../public/', import.meta.url));
const API_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cache-control': 'no-store',
};
const STATIC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

class HttpError extends Error {
  constructor(statusCode, code, message, fields) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
  }
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, API_HEADERS);
  response.end(JSON.stringify(body));
}

function sendError(response, error) {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof HttpError ? error.message : 'Internal server error';
  sendJson(response, statusCode, {
    error: {
      code,
      message,
      ...(Array.isArray(error?.fields) ? { fields: error.fields } : {}),
    },
  });
}

async function readJsonBody(request) {
  const contentType = String(request.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }

  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    request.resume();
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'JSON body exceeds the 1 MB limit');
  }

  const encodedBody = await new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let receivedBytes = 0;
    let settled = false;

    const onData = (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes <= MAX_JSON_BODY_BYTES) {
        chunks.push(chunk);
        return;
      }

      settled = true;
      request.off('data', onData);
      request.off('end', onEnd);
      request.once('close', () => request.off('error', onError));
      request.resume();
      rejectBody(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'JSON body exceeds the 1 MB limit'));
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      request.off('data', onData);
      request.off('error', onError);
      resolveBody(Buffer.concat(chunks));
    };
    const onError = (error) => {
      if (settled) return;
      settled = true;
      request.off('data', onData);
      request.off('end', onEnd);
      rejectBody(error);
    };

    request.on('data', onData);
    request.once('end', onEnd);
    request.on('error', onError);
  });

  let body;
  try {
    const decodedBody = new TextDecoder('utf-8', { fatal: true }).decode(encodedBody);
    body = JSON.parse(decodedBody);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must contain valid JSON');
  }
  if (!isRecord(body)) {
    throw new HttpError(400, 'INVALID_BODY', 'Request body must be a JSON object');
  }
  return body;
}

const ANALYSIS_PATHS = new Set(['startup', 'operator']);
const ANALYSIS_STAGES = new Set(['PRE_START', 'SITE_AND_FUNDING', 'OPENING', 'OPERATING', 'CRISIS']);
const ANALYSIS_STAGE_MATRIX = {
  startup: ANALYSIS_STAGES,
  operator: new Set(['OPERATING', 'CRISIS']),
};

function validateAnalysisContext(context) {
  if (context == null) return {};
  if (!isRecord(context)) throw new HttpError(400, 'INVALID_ANALYSIS_CONTEXT', 'context must be an object');
  const normalized = {};
  const hasPath = Object.hasOwn(context, 'path');
  const hasStage = Object.hasOwn(context, 'stage');
  if (hasPath !== hasStage) {
    throw new HttpError(400, 'INVALID_ANALYSIS_CONTEXT', 'context.path and context.stage must be provided together');
  }
  if (hasPath) {
    if (!ANALYSIS_PATHS.has(context.path)) throw new HttpError(400, 'INVALID_ANALYSIS_CONTEXT', 'context.path is not supported');
    normalized.path = context.path;
  }
  if (hasStage) {
    if (!ANALYSIS_STAGES.has(context.stage)) throw new HttpError(400, 'INVALID_ANALYSIS_CONTEXT', 'context.stage is not supported');
    normalized.stage = context.stage;
  }
  if (normalized.path && normalized.stage && !ANALYSIS_STAGE_MATRIX[normalized.path].has(normalized.stage)) {
    throw new HttpError(400, 'INVALID_ANALYSIS_CONTEXT', 'context.stage is not supported for context.path');
  }
  if (context.realtimeSignal != null) {
    const signal = context.realtimeSignal;
    const valid = isRecord(signal)
      && typeof signal.signalId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(signal.signalId)
      && signal.metric === 'INGREDIENT_COST_INDEX'
      && Number.isFinite(signal.value) && signal.value >= 0.5 && signal.value <= 2
      && signal.unit === 'INDEX'
      && typeof signal.source === 'string' && /^[A-Z0-9_]{1,64}$/.test(signal.source)
      && typeof signal.asOf === 'string' && Number.isFinite(new Date(signal.asOf).getTime())
      && signal.refreshTier === 'REALTIME';
    if (!valid) throw new HttpError(400, 'INVALID_ANALYSIS_CONTEXT', 'context.realtimeSignal is not a supported bounded signal');
    normalized.realtimeSignal = {
      signalId: signal.signalId,
      metric: signal.metric,
      value: signal.value,
      unit: signal.unit,
      source: signal.source,
      asOf: signal.asOf,
      refreshTier: signal.refreshTier,
    };
  }
  return normalized;
}

function requiresOperatingFinance(context) {
  return context.path === 'operator' || ['OPERATING', 'CRISIS'].includes(context.stage);
}

function calculateOperatingCashflow(profile, transactions) {
  const snapshot = profile.snapshots.find((item) => item.lifecycleStage === 'OPERATING_MONTH_4');
  const salesTransactions = transactions.filter((item) => (
    item.scenarioId === profile.scenarioId && item.synthetic === true && item.type === 'MONTHLY_SALES' && Number.isInteger(item.amountKrw)
  ));
  const monthlySalesKrw = salesTransactions.reduce((sum, item) => sum + item.amountKrw, 0) || snapshot?.monthlySalesKrw;
  const openingBalance = snapshot?.cashAvailableKrw;
  if (!snapshot || !Number.isInteger(openingBalance) || !Number.isInteger(monthlySalesKrw)) {
    throw new HttpError(500, 'OPERATING_FINANCE_UNAVAILABLE', 'Synthetic operating finance inputs are unavailable');
  }
  const dailyFlows = [monthlySalesKrw, ...Array(27).fill(0)];
  return {
    mode: 'OPERATING_CASHFLOW',
    snapshotId: snapshot.snapshotId,
    asOf: snapshot.asOf,
    openingBalance,
    monthlySalesKrw,
    sourceTransactionIds: salesTransactions.map((item) => item.transactionId),
    forecast: forecastCashflow(openingBalance, dailyFlows),
  };
}

function buildAnalysis(question, now = new Date(), context = {}) {
  const profile = loadBusinessProfile();
  const selectedProfile = {
    ...profile,
    ...(context.path ? { path: context.path } : {}),
    ...(context.stage ? { stage: context.stage } : {}),
  };
  const finance = requiresOperatingFinance(context)
    ? calculateOperatingCashflow(profile, loadTransactions())
    : calculateStartupFunding(profile);
  const baseMarket = analyzeMarket(loadMarketSignals(), now);
  const market = context.realtimeSignal ? applyRealtimeSignal(baseMarket, context.realtimeSignal) : baseMarket;
  const policies = searchPolicies(question, selectedProfile, now);
  const council = runStoredDemoCouncil({ question, profile: selectedProfile, finance, market, policies });

  return {
    meta: {
      synthetic: profile.synthetic,
      scenarioId: profile.scenarioId,
      generatedAt: now.toISOString(),
      context: Object.fromEntries(['path', 'stage'].filter((field) => context[field] != null).map((field) => [field, context[field]])),
    },
    profile: selectedProfile,
    finance,
    market,
    policies,
    council,
  };
}

function dynamicFieldError(error) {
  const message = String(error?.message ?? 'Business input is invalid');
  const pathMatch = message.match(/\b((?:startup|operating)(?:\.[A-Za-z][A-Za-z0-9]*)+)\s+must\b/u);
  const field = pathMatch?.[1]
    ?? (message.includes('registrationStatus') ? 'businessProfile.registrationStatus'
      : message.includes('fundingPurpose') ? 'fundingPurpose'
        : message.includes('operatingMonths') ? 'operating.operatingMonths'
        : message.includes('declaredTotalBudgetKrw') ? 'startup.declaredTotalBudgetKrw'
      : message.includes('declaredNetProfitKrw') ? 'operating.declaredNetProfitKrw'
        : message.includes('declaredMarginRate') ? 'operating.declaredMarginRate'
      : message.includes('custom cost') || message.includes('customCosts') ? 'customCosts'
        : message.includes('industry template') ? 'industryTemplate'
          : message.includes('regionCode') ? 'regionCode'
            : message.includes('businessProfile') ? 'businessProfile'
              : message.includes('path') || message.includes('stage') ? 'path' : 'input');
  const code = message.includes('integer KRW') ? 'INVALID_KRW_AMOUNT'
    : message.includes('declaredMarginRate') ? 'INVALID_PERCENT'
      : message.includes('custom') ? 'INVALID_CUSTOM_COST'
        : message.includes('industry template') ? 'INVALID_INDUSTRY_TEMPLATE'
          : message.includes('regionCode') ? 'INVALID_REGION'
            : message.includes('businessProfile') ? 'INVALID_BUSINESS_PROFILE'
              : message.includes('path') || message.includes('stage') ? 'INVALID_PATH_STAGE' : 'INVALID_FIELD';
  return new HttpError(400, 'INVALID_BUSINESS_INPUT', 'Business input contains invalid fields', [{ field, code, message }]);
}

function validateDynamicPolicyFields(input) {
  const details = input[input.path === 'STARTUP' ? 'startup' : 'operating'];
  const registrationStatus = input.businessProfile?.registrationStatus;
  if (typeof registrationStatus !== 'string' || !registrationStatus.trim()) {
    throw new HttpError(400, 'INVALID_BUSINESS_INPUT', 'Business input contains invalid fields', [{
      field: 'businessProfile.registrationStatus', code: 'REQUIRED', message: 'businessProfile.registrationStatus is required',
    }]);
  }
  if (typeof details?.fundingPurpose !== 'string' || !details.fundingPurpose.trim()) {
    throw new HttpError(400, 'INVALID_BUSINESS_INPUT', 'Business input contains invalid fields', [{
      field: `${input.path === 'STARTUP' ? 'startup' : 'operating'}.fundingPurpose`, code: 'REQUIRED', message: 'fundingPurpose is required',
    }]);
  }
  if (input.path === 'OPERATING' && (!Number.isInteger(details.operatingMonths) || details.operatingMonths < 0)) {
    throw new HttpError(400, 'INVALID_BUSINESS_INPUT', 'Business input contains invalid fields', [{
      field: 'operating.operatingMonths', code: 'INVALID_OPERATING_MONTHS', message: 'operating.operatingMonths must be a non-negative integer',
    }]);
  }
}

async function buildDynamicAnalysis(rawInput, dependencies) {
  if (!dependencies.policyDatabase?.prepare) {
    throw new HttpError(500, 'ANALYSIS_DEPENDENCY_UNAVAILABLE', 'Policy database is unavailable');
  }
  let input;
  let analysis;
  try {
    input = normalizeBusinessInput(rawInput);
    validateDynamicPolicyFields(input);
    const benchmark = loadIndustryBenchmark(input.industryTemplate);
    analysis = input.path === 'STARTUP'
      ? analyzeStartupInput(input, benchmark)
      : analyzeOperatingInput(input, benchmark);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) throw dynamicFieldError(error);
    throw error;
  }

  const generatedAt = dependencies.now();
  const policyResult = matchPoliciesForBusiness({ database: dependencies.policyDatabase, input, now: generatedAt });
  const market = {
    status: 'PLANNED_INTEGRATION', confidence: { level: 'LOW' },
    disclosure: 'No live external market provider is connected in this prototype.',
  };
  const council = await dependencies.dynamicCouncil({ input, analysis, market, policyResult });
  return {
    input, analysis, market, policies: policyResult.matches, council,
    disclosures: {
      agentMode: 'PROTOTYPE_DETERMINISTIC_AGENTS',
      productionModelTarget: 'LOCAL_LLM_PLANNED_NOT_RUNNING',
      benchmark: analysis.benchmarkDisclosure,
      market: market.disclosure,
      policy: 'Policy candidates come from the server-owned SQLite snapshot and require official notice verification.',
    },
  };
}

function isWithin(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot));
}

async function serveStatic(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    throw new HttpError(404, 'NOT_FOUND', 'Route not found');
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'INVALID_PATH', 'Request path is not valid');
  }
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const candidate = resolve(PUBLIC_DIRECTORY, relativePath);
  if (!isWithin(PUBLIC_DIRECTORY, candidate)) {
    throw new HttpError(403, 'PATH_TRAVERSAL_REJECTED', 'Static path is outside the public directory');
  }

  let canonicalRoot;
  let canonicalCandidate;
  try {
    canonicalRoot = await realpath(PUBLIC_DIRECTORY);
    canonicalCandidate = await realpath(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new HttpError(404, 'NOT_FOUND', 'Static file not found');
    }
    throw error;
  }
  if (!isWithin(canonicalRoot, canonicalCandidate)) {
    throw new HttpError(403, 'PATH_TRAVERSAL_REJECTED', 'Static path is outside the public directory');
  }

  let body;
  try {
    body = await readFile(canonicalCandidate);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      throw new HttpError(404, 'NOT_FOUND', 'Static file not found');
    }
    throw error;
  }

  response.writeHead(200, {
    ...STATIC_HEADERS,
    'content-type': CONTENT_TYPES[extname(canonicalCandidate).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

async function routeRequest(request, response, dependencies) {
  const url = new URL(request.url, 'http://localhost');

  if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
    sendJson(response, 200, {
      profile: loadBusinessProfile(),
      transactions: loadTransactions(),
      marketSignals: loadMarketSignals(),
      policies: loadPolicies(),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/analyze') {
    const body = await readJsonBody(request);
    if (typeof body.question !== 'string' || body.question.trim() === '') {
      throw new HttpError(400, 'INVALID_QUESTION', 'question must be a non-empty string');
    }
    const context = validateAnalysisContext(body.context);
    sendJson(response, 200, buildAnalysis(body.question.trim(), dependencies.now(), context));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/analysis') {
    const body = await readJsonBody(request);
    sendJson(response, 200, await buildDynamicAnalysis(body, dependencies));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/events') {
    const body = await readJsonBody(request);
    if (!isRecord(body.event) || typeof body.event.type !== 'string' || body.event.type.trim() === '') {
      throw new HttpError(400, 'INVALID_EVENT', 'event must be an object with a non-empty type');
    }
    if (body.context != null && !isRecord(body.context)) {
      throw new HttpError(400, 'INVALID_EVENT', 'context must be an object when provided');
    }
    sendJson(response, 200, { alerts: processBusinessEvent(body.event, body.context ?? {}) });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/policies') {
    sendJson(response, 200, { policies: loadPolicies() });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/advisor-handoff') {
    const body = await readJsonBody(request);
    if (!isRecord(body.council)) {
      throw new HttpError(400, 'INVALID_COUNCIL', 'council must be an object');
    }
    if (!isRecord(body.consent) || body.consent.approved !== true) {
      throw new HttpError(403, 'CONSENT_REQUIRED', 'Explicit advisor handoff consent is required');
    }
    let handoff;
    try {
      handoff = buildAdvisorHandoff(body.council, { approved: true });
    } catch (error) {
      if (error?.message === 'HANDOFF_PAYLOAD_UNSAFE') {
        throw new HttpError(400, 'HANDOFF_PAYLOAD_UNSAFE', 'Council payload contains unsafe fields');
      }
      throw error;
    }
    sendJson(response, 200, { consent: { approved: true }, handoff });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    throw new HttpError(404, 'NOT_FOUND', 'Route not found');
  }
  await serveStatic(request, response, url.pathname);
}

export function createRequestHandler({ now = () => new Date(), policyDatabase, dynamicCouncil = runDynamicExpertCouncil } = {}) {
  const dependencies = { now, policyDatabase, dynamicCouncil };
  return function handleRequest(request, response) {
    routeRequest(request, response, dependencies).catch((error) => {
      if (!response.headersSent) sendError(response, error);
      else response.destroy();
    });
  };
}
