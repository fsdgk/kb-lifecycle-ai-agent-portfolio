import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessInputFromEntries,
  createBusinessInputState,
  mapServerFieldErrors,
  reduceBusinessInput,
  renderBusinessInput,
  validateBusinessInputEntries,
} from '../public/views/business-input.js';
import { renderFinancialAnalysis } from '../public/views/financial-analysis.js';
import { renderCouncil } from '../public/views/council.js';
import { renderPolicies } from '../public/views/policies.js';
import { analysisRouteFor, createLatestRequestGate } from '../public/views/lifecycle.js';
import { renderMarket } from '../public/views/market.js';

test('invalidating a request gate makes an in-flight response stale', () => {
  const gate = createLatestRequestGate();
  const requestId = gate.begin();
  assert.equal(gate.isLatest(requestId), true);
  gate.invalidate();
  assert.equal(gate.isLatest(requestId), false);
});

test('legacy analysis routing requires explicit demo mode', () => {
  assert.equal(analysisRouteFor({ demoMode: false, hasDynamicResult: false }), 'DYNAMIC');
  assert.equal(analysisRouteFor({ demoMode: false, hasDynamicResult: true }), 'DYNAMIC');
  assert.equal(analysisRouteFor({ demoMode: true, hasDynamicResult: false }), 'LEGACY_DEMO');
});

test('path switching requires a visible reducer transition and preserves only common fields', () => {
  let state = createBusinessInputState();
  state = reduceBusinessInput(state, { type: 'EDIT_COMMON', field: 'businessName', value: 'Shared name' });
  state = reduceBusinessInput(state, { type: 'EDIT_STAGE', field: 'depositKrw', value: '30000000' });
  state = reduceBusinessInput(state, { type: 'REQUEST_PATH', path: 'OPERATING' });

  assert.equal(state.path, 'STARTUP');
  assert.equal(state.pendingPath, 'OPERATING');
  assert.equal(state.transition.status, 'CONFIRM_REQUIRED');
  assert.match(renderBusinessInput(state), /data-path-confirmation/);

  state = reduceBusinessInput(state, { type: 'CONFIRM_PATH' });
  assert.equal(state.path, 'OPERATING');
  assert.equal(state.common.businessName, 'Shared name');
  assert.equal(state.startup.depositKrw, '');
  assert.equal(state.transition.status, 'PATH_CHANGED');
});

test('custom costs add and remove through the reducer and stop at twenty', () => {
  let state = createBusinessInputState();
  for (let index = 0; index < 21; index += 1) state = reduceBusinessInput(state, { type: 'ADD_CUSTOM_COST' });
  assert.equal(state.startup.customCosts.length, 20);
  const removedId = state.startup.customCosts[5].id;
  state = reduceBusinessInput(state, { type: 'REMOVE_CUSTOM_COST', id: removedId });
  assert.equal(state.startup.customCosts.length, 19);
  assert.equal(state.startup.customCosts.some((item) => item.id === removedId), false);
});

test('operating months is stage-only and does not return after an operating-startup-operating cycle', () => {
  let state = createBusinessInputState();
  assert.equal(Object.hasOwn(state.common, 'operatingMonths'), false);
  assert.equal(state.operating.operatingMonths, '');

  state = reduceBusinessInput(state, { type: 'REQUEST_PATH', path: 'OPERATING' });
  state = reduceBusinessInput(state, { type: 'EDIT_STAGE', field: 'operatingMonths', value: '18' });
  state = reduceBusinessInput(state, { type: 'REQUEST_PATH', path: 'STARTUP' });
  state = reduceBusinessInput(state, { type: 'CONFIRM_PATH' });
  state = reduceBusinessInput(state, { type: 'REQUEST_PATH', path: 'OPERATING' });

  assert.equal(state.path, 'OPERATING');
  assert.equal(state.operating.operatingMonths, '');
});

test('form entries keep integer KRW values and convert a percentage to a ratio', () => {
  const raw = businessInputFromEntries(new Map([
    ['regionCode', 'SEOUL'], ['districtCode', 'SEONGDONG'], ['neighborhoodName', '성수동'],
    ['industryTemplate', 'FOOD_CAFE'], ['registrationStatus', 'REGISTERED'],
    ['businessName', 'Example'], ['businessDescription', 'Description'], ['fundingPurpose', 'WORKING_CAPITAL'],
    ['operatingMonths', '18'], ['monthlySalesKrw', '20000000'], ['declaredNetProfitKrw', '2000000'],
    ['declaredMarginPercent', '10'], ['laborCostKrw', '5000000'], ['rentKrw', '2000000'],
    ['materialCostKrw', '7000000'], ['platformFeesKrw', '500000'], ['advertisingKrw', '300000'],
    ['utilitiesAndFeesKrw', '700000'], ['otherCostKrw', '200000'],
  ]), 'OPERATING', []);

  assert.equal(raw.operating.monthlySalesKrw, 20_000_000);
  assert.equal(raw.operating.declaredMarginRate, 0.1);
  assert.equal(raw.regionCode, 'SEOUL');
  assert.equal(raw.districtCode, 'SEONGDONG');
  assert.equal(raw.neighborhoodName, '성수동');
  assert.deepEqual(raw.operating.customCosts, [{ label: 'Other cost', amountKrw: 200_000 }]);
});

test('business location is scoped to Seoul district and neighborhood inputs', () => {
  const html = renderBusinessInput(createBusinessInputState());

  assert.match(html, /<input[^>]+id="regionCode"[^>]+value="SEOUL"[^>]+readonly/);
  assert.match(html, /서울 전체가 아니라 구와 동 단위로 분석 기준을 잡습니다/);
  assert.match(html, /<select id="districtCode"[^>]*name="districtCode"/);
  assert.match(html, /<option value="SEONGDONG">성동구<\/option>/);
  assert.match(html, /<input id="neighborhoodName" name="neighborhoodName"/);
  assert.doesNotMatch(html, /<option value="BUSAN">/);
  assert.doesNotMatch(html, /<option value="GYEONGGI">/);
});

test('native labels, stable inline errors, and all startup and operating fields are rendered', () => {
  const startup = renderBusinessInput(createBusinessInputState({ errors: {
    declaredTotalBudgetKrw: { code: 'REQUIRED', message: 'Required field' },
  } }));
  assert.match(startup, /<label for="declaredTotalBudgetKrw">/);
  assert.match(startup, /id="declaredTotalBudgetKrw-error"[^>]*data-field-code="REQUIRED"/);
  assert.match(startup, /aria-invalid="true"/);
  assert.match(startup, /name="permitsMarketingKrw"/);

  const selectErrors = renderBusinessInput(createBusinessInputState({ errors: {
    regionCode: { code: 'REQUIRED', message: '지역을 선택하세요.' },
    districtCode: { code: 'REQUIRED', message: '구를 선택하세요.' },
    registrationStatus: { code: 'INVALID_ENUM', message: '등록 상태를 확인하세요.' },
  } }));
  assert.match(selectErrors, /<input id="regionCode"[^>]*aria-describedby="regionCode-note regionCode-error"[^>]*aria-invalid="true"/);
  assert.match(selectErrors, /id="regionCode-error"[^>]*data-field-code="REQUIRED"/);
  assert.match(selectErrors, /<select id="districtCode"[^>]*aria-describedby="districtCode-error"[^>]*aria-invalid="true"/);
  assert.match(selectErrors, /id="districtCode-error"[^>]*data-field-code="REQUIRED"/);
  assert.match(selectErrors, /<select id="registrationStatus"[^>]*aria-describedby="registrationStatus-error"[^>]*aria-invalid="true"/);

  const customErrorState = createBusinessInputState({
    startup: { customCosts: [{ id: 1, label: '', amountKrw: '' }] },
    errors: {
      'customLabel-1': { code: 'REQUIRED', message: '비용 이름을 입력하세요.' },
      customCosts: { code: 'INVALID_CUSTOM_COST', message: '중복된 비용 이름입니다.' },
    },
  });
  const customErrorHtml = renderBusinessInput(customErrorState);
  assert.match(customErrorHtml, /id="customLabel-1-error"[^>]*data-field-code="REQUIRED"/);
  assert.match(customErrorHtml, /data-custom-cost-error="INVALID_CUSTOM_COST"/);

  const operatingState = reduceBusinessInput(createBusinessInputState(), { type: 'REQUEST_PATH', path: 'OPERATING' });
  const operating = renderBusinessInput(reduceBusinessInput(operatingState, { type: 'CONFIRM_PATH' }));
  for (const name of ['monthlySalesKrw', 'declaredNetProfitKrw', 'declaredMarginPercent', 'laborCostKrw', 'rentKrw', 'materialCostKrw', 'platformFeesKrw', 'advertisingKrw', 'utilitiesAndFeesKrw']) {
    assert.match(operating, new RegExp(`name="${name}"`));
  }
});

test('nested API field paths map to the controls that users can correct', () => {
  const errors = mapServerFieldErrors([
    { field: 'businessProfile.registrationStatus', code: 'REQUIRED', message: 'Required' },
    { field: 'businessProfile.businessName', code: 'REQUIRED', message: 'Required' },
    { field: 'regionCode', code: 'INVALID_REGION', message: 'Invalid region' },
    { field: 'startup.fundingPurpose', code: 'REQUIRED', message: 'Required' },
  ]);
  assert.deepEqual(Object.keys(errors), ['registrationStatus', 'businessName', 'regionCode', 'fundingPurpose']);
});

test('empty and fractional form values produce stable client-side field codes', () => {
  const errors = validateBusinessInputEntries(new Map([
    ['regionCode', 'SEOUL'], ['districtCode', ''], ['neighborhoodName', ''],
    ['businessName', ''], ['businessDescription', 'Description'],
    ['declaredTotalBudgetKrw', '1.5'], ['ownCapitalKrw', '0'], ['depositKrw', '0'],
    ['interiorCostKrw', '0'], ['equipmentCostKrw', '0'], ['initialInventoryKrw', '0'],
    ['permitsMarketingKrw', '0'], ['otherCostKrw', '0'],
  ]), 'STARTUP', []);
  assert.equal(errors.districtCode.code, 'REQUIRED');
  assert.equal(errors.neighborhoodName.code, 'REQUIRED');
  assert.equal(errors.businessName.code, 'REQUIRED');
  assert.equal(errors.declaredTotalBudgetKrw.code, 'INVALID_KRW_AMOUNT');
});

test('financial, policy, and council results expose comparisons, ranges, provenance, experts, and uncertainty', () => {
  const analysisHtml = renderFinancialAnalysis({
    salesKrw: 20_000_000,
    costTotalKrw: 15_700_000,
    declared: { netProfitKrw: 2_000_000, marginRate: 0.1 },
    calculated: { netProfitKrw: 4_300_000, marginRate: 0.215 },
    differences: { netProfitKrw: -2_300_000, marginRate: -0.115 },
    ratios: { labor: 0.25 },
    benchmarks: { labor: { status: 'WITHIN', range: { low: 0.2, high: 0.35 } } },
    benchmarkDisclosure: 'Prototype reference ranges only.',
  }, 'OPERATING');
  assert.match(analysisHtml, /data-comparison="declared-profit"/);
  assert.match(analysisHtml, /data-comparison="calculated-profit"/);
  assert.match(analysisHtml, /data-benchmark-status="WITHIN"/);
  assert.match(analysisHtml, /Prototype reference ranges only/);
  assert.match(analysisHtml, /id="financial-title"[^>]*tabindex="-1"/);

  const policiesHtml = renderPolicies([{ policyId: 'policy-1', title: 'Official candidate', institution: 'Agency', eligibility: 'CHECK_REQUIRED', verifiedAt: '2026-08-01', officialUrl: 'https://official.example/policy', requiredChecks: ['Check notice'] }]);
  assert.match(policiesHtml, /Official candidate/);
  assert.match(policiesHtml, /Agency/);
  assert.match(policiesHtml, /Check notice/);
  assert.match(policiesHtml, /data-official-policy-link/);

  const councilHtml = renderCouncil({
    summary: 'Verified summary',
    priorityActions: [{ title: 'Priority', evidenceIds: ['e-1'] }],
    uncertainty: [{ code: 'MARKET_DATA_PLANNED_INTEGRATION', detail: 'No provider.' }],
    opinions: ['MARKET', 'OPERATIONS', 'FINANCE', 'POLICY'].map((expert) => ({ expert, claims: [{ statement: `${expert} detail` }], actions: [], assumptions: [], uncertainty: [], evidenceIds: [] })),
    evidence: [], conflicts: [],
  });
  assert.equal((councilHtml.match(/data-expert-opinion/g) ?? []).length, 4);
  assert.match(councilHtml, /MARKET_DATA_PLANNED_INTEGRATION/);
  assert.match(councilHtml, /data-supervisor-priorities/);
});

test('council renders actionable Korean guidance from canonical evidence values', () => {
  const councilHtml = renderCouncil({
    summary: 'Verified summary',
    priorityActions: [
      { code: 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT', title: 'Close gap', evidenceIds: ['finance.startup.funding-gap'] },
      { code: 'RESERVE_RECOMMENDED_BUFFER', title: 'Reserve buffer', evidenceIds: ['finance.startup.recommended-buffer'] },
      { code: 'VERIFY_POLICY_ELIGIBILITY', title: 'Verify policy', evidenceIds: ['policy.match-status'] },
    ],
    opinions: [
      { expert: 'FINANCE', claims: [{ statement: 'Funding gap exists.', evidenceIds: ['finance.startup.funding-gap'] }], actions: [{ code: 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT', title: 'Close gap', evidenceIds: ['finance.startup.funding-gap'] }], assumptions: [], uncertainty: [], evidenceIds: [] },
      { expert: 'POLICY', claims: [{ statement: 'Policy check required.', evidenceIds: ['policy.match-status'] }], actions: [{ code: 'VERIFY_POLICY_ELIGIBILITY', title: 'Verify policy', evidenceIds: ['policy.match-status'] }], assumptions: [], uncertainty: [], evidenceIds: [] },
    ],
    evidence: [
      { id: 'finance.startup.funding-gap', domain: 'FINANCE', value: { amountKrw: 75_000_000, status: 'LARGE' }, provenance: { source: 'deterministic-business-analysis' } },
      { id: 'finance.startup.recommended-buffer', domain: 'FINANCE', value: { amountKrw: 18_000_000, status: 'RECOMMENDED' }, provenance: { source: 'deterministic-business-analysis' } },
      { id: 'policy.match-status', domain: 'POLICY', value: { matchCount: 1, eligibility: 'CHECK_REQUIRED' }, provenance: { source: 'sqlite-policy-database' } },
    ],
    uncertainty: [], conflicts: [],
  });

  assert.match(councilHtml, /부족 자금 7,500만원/);
  assert.match(councilHtml, /완충자금 1,800만원/);
  assert.match(councilHtml, /정책 후보 1건/);
  assert.match(councilHtml, /전문가 종합 판단/);
  assert.match(councilHtml, /data-action-guidance/);
});

test('dynamic expert traces resolve claim evidence through nested provenance', () => {
  const html = renderCouncil({
    opinions: [{
      expert: 'FINANCE',
      claims: [{ statement: 'Calculated result.', evidenceIds: ['finance.operating.calculated-result'] }],
      actions: [], assumptions: [], uncertainty: [],
    }],
    evidence: [{
      id: 'finance.operating.calculated-result',
      provenance: { source: 'deterministic-business-analysis', asOf: '2026-08-03' },
    }],
    priorityActions: [], conflicts: [], uncertainty: [],
  });
  assert.match(html, /deterministic-business-analysis/);
  assert.match(html, /2026-08-03/);
});

test('planned market integration renders status and non-numeric Korean placeholders', () => {
  const html = renderMarket({
    status: 'PLANNED_INTEGRATION',
    confidence: { level: 'LOW' },
    dataDisclosure: 'No live external market provider is connected in this prototype.',
  });
  assert.match(html, /data-market-status="PLANNED_INTEGRATION"[^>]*>PLANNED_INTEGRATION</);
  assert.match(html, /외부 실시간 시장 데이터 제공자는 아직 연결되지 않았습니다/);
  assert.equal((html.match(/data-market-placeholder/g) ?? []).length, 3);
  assert.match(html, /<span>연동 예정<\/span>/);
  assert.doesNotMatch(html, /data-market-scenarios|지수\s*-|지수\s*\d/);
});
