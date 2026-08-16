import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCouncil } from '../public/views/council.js';
import { policyMatches, renderPolicies } from '../public/views/policies.js';
import { allowedStagesForPath, analysisContextFor, applyPathSelection, applyStageSelection, buildAnalysisContext, createLatestRequestGate, financeFactRows, guidanceFor, renderLifecycle, restoreLifecycleFocus } from '../public/views/lifecycle.js';
import { applyImmediateAlert } from '../public/views/market.js';
import { canRequestAdvisor } from '../public/views/advisor.js';

test('empty analysis policy matches remain empty instead of showing the bootstrap catalogue', () => {
  const matches = policyMatches({ policies: [] }, [{ policyId: 'bootstrap-policy' }]);
  const html = renderPolicies(matches);
  assert.deepEqual(matches, []);
  assert.match(html, /현재 질문과 일치하는 정책 후보가 없습니다/);
  assert.doesNotMatch(html, /공식 원문 열기/);
});

test('analysis context carries the selected onboarding path and lifecycle stage', () => {
  assert.deepEqual(buildAnalysisContext('operator', 'OPERATING'), { path: 'operator', stage: 'OPERATING' });
});

test('operator path selection requests a reanalysis with the operating stage', () => {
  assert.deepEqual(applyPathSelection({ path: 'startup', stage: 'SITE_AND_FUNDING' }, 'operator'), {
    path: 'operator', stage: 'OPERATING', reanalyze: true,
  });
});

test('path-stage controls expose the complete startup lifecycle and only valid operator stages', () => {
  assert.deepEqual(allowedStagesForPath('startup'), ['PRE_START', 'SITE_AND_FUNDING', 'OPENING', 'OPERATING', 'CRISIS']);
  assert.deepEqual(allowedStagesForPath('operator'), ['OPERATING', 'CRISIS']);

  const operatorHtml = renderLifecycle('operator', 'OPERATING');
  assert.match(operatorHtml, /id="operator-stage-restriction"/);
  assert.match(operatorHtml, /data-stage="PRE_START"[^>]*disabled[^>]*aria-describedby="operator-stage-restriction"/);
  assert.doesNotMatch(operatorHtml, /data-stage="OPERATING"[^>]*disabled/);
  assert.doesNotMatch(operatorHtml, /data-stage="CRISIS"[^>]*disabled/);
});

test('switching back to startup restores all lifecycle controls', () => {
  assert.deepEqual(applyPathSelection({ path: 'operator', stage: 'CRISIS' }, 'startup'), {
    path: 'startup', stage: 'SITE_AND_FUNDING', reanalyze: true,
  });

  const startupHtml = renderLifecycle('startup', 'SITE_AND_FUNDING');
  assert.doesNotMatch(startupHtml, /data-stage="[^"]+"[^>]*disabled/);
  assert.equal(applyStageSelection({ path: 'startup', stage: 'SITE_AND_FUNDING' }, 'PRE_START').stage, 'PRE_START');
});

test('manual analysis context retains the active realtime cost signal', () => {
  const realtimeSignal = { signalId: 'active-cost', metric: 'INGREDIENT_COST_INDEX', value: 1.5, unit: 'INDEX', source: 'USER_SIMULATION', asOf: '2026-08-02T09:00:00+09:00', refreshTier: 'REALTIME' };
  assert.deepEqual(analysisContextFor({ path: 'operator', stage: 'OPERATING', activeRealtimeSignal: realtimeSignal }), {
    path: 'operator', stage: 'OPERATING', realtimeSignal,
  });
});

test('only the latest analysis request may apply a response after a path-stage race', () => {
  const gate = createLatestRequestGate();
  const startupRequest = gate.begin();
  const operatingRequest = gate.begin();
  const appliedStages = [];
  if (gate.isLatest(operatingRequest)) appliedStages.push('OPERATING');
  if (gate.isLatest(startupRequest)) appliedStages.push('SITE_AND_FUNDING');
  assert.deepEqual(appliedStages, ['OPERATING']);
});

test('immediate event alert is rendered before any later analysis outcome', () => {
  const target = { hidden: true, textContent: '' };
  applyImmediateAlert(target, { message: 'INGREDIENT_COST_SPIKE was reported.' });
  assert.equal(target.hidden, false);
  assert.match(target.textContent, /INGREDIENT_COST_SPIKE/);
});

test('council evidence detail resolves an opinion ID to its source and as-of date', () => {
  const html = renderCouncil({
    generatedAt: '2026-08-02T00:00:00.000Z',
    evidence: [{ id: 'event.INGREDIENT_COST_SPIKE', source: 'SUPPLIER_FEED', asOf: '2026-08-02T09:00:00+09:00' }],
    opinions: [{ expert: 'MARKET', claims: [{ statement: 'Cost review is required.' }], evidenceIds: ['event.INGREDIENT_COST_SPIKE'], assumptions: [], uncertainty: [] }],
    conflicts: [], priorityActions: [],
  });
  assert.match(html, /SUPPLIER_FEED/);
  assert.match(html, /2026-08-02T09:00:00\+09:00/);
  assert.doesNotMatch(html, /분석 응답 생성 시점/);
});

test('path and stage guidance changes between startup planning and existing operation', () => {
  const startup = guidanceFor('startup', 'SITE_AND_FUNDING');
  const operator = guidanceFor('operator', 'OPERATING');
  assert.notEqual(startup.message, operator.message);
  assert.equal(startup.action, '자금 공백을 계약 전 확인');
  assert.equal(operator.action, '매출·원가·현금흐름 점검');
});

test('crisis guidance takes precedence over operator guidance', () => {
  assert.equal(guidanceFor('operator', 'CRISIS').action, '즉시 대응 우선순위 확인');
});

test('operational finance facts render cashflow measures instead of startup cost and gap', () => {
  const labels = financeFactRows({ mode: 'OPERATING_CASHFLOW', openingBalance: 18_400_000, monthlySalesKrw: 19_600_000, forecast: { minimumBalance: 18_400_000, shortfallDate: null } }).map(([label]) => label);
  assert.deepEqual(labels, ['운영 시작 잔액', '월 매출 관측', '28일 예상 최저 잔액', '현금 부족']);
});

test('lifecycle focus restoration returns focus to the same stage button after rerender', () => {
  const button = { focused: false, focus() { this.focused = true; } };
  const region = { querySelector(selector) { return selector === '[data-stage="OPERATING"]' ? button : null; } };
  restoreLifecycleFocus(region, 'OPERATING', true);
  assert.equal(button.focused, true);
});

test('advisor handoff remains unavailable until consent and council are both present', () => {
  assert.equal(canRequestAdvisor(false, { summary: 'review' }), false);
  assert.equal(canRequestAdvisor(true, null), false);
  assert.equal(canRequestAdvisor(true, { summary: 'review' }), true);
});
