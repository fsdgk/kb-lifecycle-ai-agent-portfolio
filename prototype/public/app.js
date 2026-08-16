import { analysisContextFor, analysisRouteFor, applyStageSelection, createLatestRequestGate, financeFactRows, guidanceFor, renderLifecycle, restoreLifecycleFocus, stageFor, stageLabel } from './views/lifecycle.js';
import { applyImmediateAlert, renderMarket } from './views/market.js';
import { renderCouncil } from './views/council.js';
import { policyMatches, renderPolicies } from './views/policies.js';
import { canRequestAdvisor, renderAdvisor } from './views/advisor.js';
import { businessInputFromEntries, createBusinessInputState, mapServerFieldErrors, reduceBusinessInput, renderBusinessInput, validateBusinessInputEntries } from './views/business-input.js';
import { renderFinancialAnalysis } from './views/financial-analysis.js';

const state = {
  path: 'startup', stage: 'SITE_AND_FUNDING', bootstrap: null, analysis: null,
  eventAlert: null, activeRealtimeSignal: null, handoff: null,
  businessInput: createBusinessInputState(), dynamicResult: null, dynamicHandoff: null, demoMode: false,
};
const $ = (selector) => document.querySelector(selector);
const analysisRequestGate = createLatestRequestGate();
const dynamicRequestGate = createLatestRequestGate();

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.message ?? '요청을 처리하지 못했습니다.');
    error.fields = body.error?.fields ?? [];
    throw error;
  }
  return body;
}

function selectedCouncil() { return state.dynamicResult?.council ?? state.analysis?.council; }
function selectedPolicies() { return state.dynamicResult?.policies ?? policyMatches(state.analysis); }

function legacyPathFor(inputPath) { return inputPath === 'OPERATING' ? 'operator' : 'startup'; }

function commitBusinessPath(businessInput, { demoMode = false } = {}) {
  state.businessInput = businessInput;
  state.demoMode = demoMode;
  state.path = legacyPathFor(businessInput.path);
  state.stage = stageFor(state.path);
  state.dynamicResult = null;
  state.dynamicHandoff = null;
  state.analysis = null;
  state.handoff = null;
  dynamicRequestGate.invalidate();
  analysisRequestGate.invalidate();
  $('#analysis-meta').textContent = '경로가 변경되었습니다. 새 입력으로 분석을 실행해 주세요.';
  $('#path-status').textContent = state.path === 'startup' ? '새 창업 준비 경로를 선택했습니다.' : '기존 운영 경로를 선택했습니다.';
}

function requireUserInputAnalysis() {
  $('#partner-status').textContent = '사업 정보를 입력하고 분석 실행을 눌러 사용자 입력 기반 분석을 먼저 완료해 주세요.';
}

function exitDemoMode() {
  if (!state.demoMode) return false;
  state.demoMode = false;
  state.analysis = null;
  state.handoff = null;
  analysisRequestGate.invalidate();
  $('#analysis-meta').textContent = '사업 정보가 변경되었습니다. 사용자 입력 기반 분석을 다시 실행해 주세요.';
  return true;
}

function mutateBusinessInput(action) {
  state.businessInput = reduceBusinessInput(state.businessInput, action);
  return exitDemoMode();
}

function render() {
  const finance = state.analysis?.finance;
  const lifecycleRegion = $('#lifecycle-region');
  const focusedStage = document.activeElement?.closest?.('[data-stage]')?.dataset.stage;
  $('#business-input-region').innerHTML = renderBusinessInput(state.businessInput);
  $('#financial-region').innerHTML = renderFinancialAnalysis(state.dynamicResult?.analysis, state.dynamicResult?.input?.path);
  lifecycleRegion.innerHTML = renderLifecycle(state.path, state.stage);
  restoreLifecycleFocus(lifecycleRegion, focusedStage, Boolean(focusedStage));
  $('#stage-fact').textContent = `현재 단계: ${stageLabel(state.stage)}`;
  const guidance = guidanceFor(state.path, state.stage);
  $('#stage-guidance').textContent = `${guidance.message} 다음 행동: ${guidance.action}`;
  const hasDemoAnalysis = state.demoMode && state.analysis;
  $('#analysis-kind').textContent = hasDemoAnalysis ? '선택적 합성 데모 분석' : '사용자 입력 분석';
  $('#business-title').textContent = hasDemoAnalysis ? '서울 성동구 크로아티아 음식점' : '사업 정보를 입력해 분석을 시작하세요';
  $('#finance-facts').innerHTML = '';
  if (finance) {
    const factKeys = finance.mode === 'OPERATING_CASHFLOW'
      ? ['opening-balance', 'monthly-sales', 'minimum-balance', 'shortfall-date']
      : ['planned-cost', 'own-capital', 'funding-gap', 'policy-candidates'];
    $('#finance-facts').innerHTML = financeFactRows(finance).map(([label, value], index) => {
      const rawValue = factKeys[index] === 'funding-gap' ? finance.fundingGap : '';
      return `<div data-finance-fact="${factKeys[index]}"${rawValue === '' ? '' : ` data-value="${rawValue}"`}><dt>${label}</dt><dd>${value}</dd></div>`;
    }).join('');
  }
  const market = state.dynamicResult?.market
    ? { ...state.dynamicResult.market, dataDisclosure: state.dynamicResult.market.disclosure }
    : state.analysis?.market;
  $('#market-region').innerHTML = renderMarket(market, state.eventAlert);
  $('#council-region').innerHTML = renderCouncil(selectedCouncil(), state.analysis?.meta?.generatedAt);
  $('#policy-region').innerHTML = renderPolicies(selectedPolicies());
  $('#advisor-region').innerHTML = renderAdvisor(selectedCouncil(), state.dynamicResult ? state.dynamicHandoff : state.handoff);
  document.querySelectorAll('.path-choice').forEach((button) => {
    const dynamicPath = button.dataset.path === 'operator' ? 'OPERATING' : 'STARTUP';
    button.setAttribute('aria-pressed', String(dynamicPath === state.businessInput.path));
  });
}

async function analyze(question, extraContext = {}) {
  if (!state.demoMode) {
    requireUserInputAnalysis();
    return null;
  }
  const requestId = analysisRequestGate.begin();
  $('#partner-status').textContent = '최신 근거를 분석하고 있습니다.';
  try {
    const analysis = await request('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, context: analysisContextFor(state, extraContext) }) });
    if (!analysisRequestGate.isLatest(requestId)) return null;
    state.analysis = analysis;
    $('#analysis-meta').textContent = `분석 기준: ${state.analysis.meta.generatedAt}`;
    $('#partner-status').textContent = '분석 결과를 업데이트했습니다.';
    render();
    return analysis;
  } catch (error) {
    if (analysisRequestGate.isLatest(requestId)) throw error;
    return null;
  }
}

async function runContextualAnalysis(question, extraContext = {}) {
  const route = analysisRouteFor({ demoMode: state.demoMode });
  if (route === 'LEGACY_DEMO') return analyze(question, extraContext);
  return submitBusinessInput($('#business-input-form'));
}

async function simulateCostSpike() {
  const button = $('#cost-spike');
  button.disabled = true;
  const asOf = new Date().toISOString();
  try {
    const response = await request('/api/events', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: { type: 'INGREDIENT_COST_SPIKE', source: 'USER_SIMULATION', asOf } }),
    });
    state.eventAlert = response.alerts[0];
    applyImmediateAlert($('#immediate-alert'), state.eventAlert);
    state.activeRealtimeSignal = {
      signalId: 'simulation-ingredient-cost-spike', metric: 'INGREDIENT_COST_INDEX', value: 1.5,
      unit: 'INDEX', source: 'USER_SIMULATION', asOf, refreshTier: 'REALTIME',
    };
    await runContextualAnalysis('식재료 원가 상승 후 시장 전망과 정책 확인');
  } catch (error) {
    $('#partner-status').textContent = error.message;
  } finally { button.disabled = false; }
}

async function submitBusinessInput(form) {
  const currentPath = state.businessInput.path;
  const customRows = state.businessInput[currentPath === 'STARTUP' ? 'startup' : 'operating'].customCosts;
  const entries = new FormData(form);
  const clientErrors = validateBusinessInputEntries(entries, currentPath, customRows);
  if (Object.keys(clientErrors).length > 0) {
    state.businessInput = reduceBusinessInput(state.businessInput, { type: 'SET_ERRORS', errors: clientErrors });
    $('#partner-status').textContent = '사업 정보를 확인하고 표시된 필수·형식 오류를 수정한 뒤 사용자 입력 기반 분석을 실행해 주세요.';
    render();
    document.querySelector('[aria-invalid="true"]')?.focus();
    return null;
  }
  const requestId = dynamicRequestGate.begin();
  const button = form.querySelector('[data-analysis-submit]');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  $('#partner-status').textContent = '입력값으로 동적 분석을 실행하고 있습니다.';
  const rawInput = businessInputFromEntries(entries, currentPath, customRows);
  try {
    const result = await request('/api/analysis', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rawInput),
    });
    if (!dynamicRequestGate.isLatest(requestId)) return null;
    state.dynamicResult = result;
    state.dynamicHandoff = null;
    state.businessInput = reduceBusinessInput(state.businessInput, { type: 'SET_ERRORS', errors: {} });
    $('#partner-status').textContent = '사용자 입력 기반 동적 분석을 업데이트했습니다.';
    render();
    $('#financial-title')?.focus?.();
    return result;
  } catch (error) {
    if (!dynamicRequestGate.isLatest(requestId)) return null;
    state.businessInput = reduceBusinessInput(state.businessInput, { type: 'SET_ERRORS', errors: mapServerFieldErrors(error.fields) });
    $('#partner-status').textContent = error.message;
    render();
    document.querySelector('[aria-invalid="true"]')?.focus();
    return null;
  } finally {
    if (dynamicRequestGate.isLatest(requestId)) {
      const currentButton = $('[data-analysis-submit]');
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.removeAttribute('aria-busy');
      }
    }
  }
}

async function connectAdvisor() {
  const consent = $('#advisor-consent');
  const council = selectedCouncil();
  if (!canRequestAdvisor(consent.checked, council)) return;
  const button = $('#advisor-submit');
  button.disabled = true;
  if (state.dynamicResult) {
    state.dynamicHandoff = { status: 'CONSULTATION_REQUEST_RECORDED', externalTransmission: false };
    render();
    return;
  }
  try {
    const response = await request('/api/advisor-handoff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ council, consent: { approved: true } }) });
    state.handoff = response.handoff;
    render();
  } catch (error) {
    $('#partner-status').textContent = error.message;
    button.disabled = false;
  }
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const path = event.target.closest('.path-choice');
    if (path) {
      const nextBusinessInput = reduceBusinessInput(state.businessInput, {
        type: 'REQUEST_PATH', path: path.dataset.path === 'operator' ? 'OPERATING' : 'STARTUP',
      });
      if (nextBusinessInput.path !== state.businessInput.path) commitBusinessPath(nextBusinessInput);
      else state.businessInput = nextBusinessInput;
      render();
    }
    const stage = event.target.closest('[data-stage]');
    if (stage) {
      const selection = applyStageSelection(state, stage.dataset.stage);
      state.path = selection.path;
      state.stage = selection.stage;
      render();
      if (selection.reanalyze) runContextualAnalysis($('#question').value).catch((error) => { $('#partner-status').textContent = error.message; });
    }
    if (event.target.id === 'partner-toggle') {
      const body = $('#partner-body'); const expanded = !body.hidden;
      body.hidden = expanded; event.target.setAttribute('aria-expanded', String(!expanded)); event.target.textContent = expanded ? '패널 펼치기' : '패널 접기';
    }
    if (event.target.id === 'cost-spike') simulateCostSpike();
    if (event.target.closest('[data-confirm-path]')) {
      commitBusinessPath(reduceBusinessInput(state.businessInput, { type: 'CONFIRM_PATH' }));
      render();
      $('#business-input-form input, #business-input-form select')?.focus();
    }
    if (event.target.closest('[data-cancel-path]')) {
      state.businessInput = reduceBusinessInput(state.businessInput, { type: 'CANCEL_PATH' });
      render();
    }
    if (event.target.closest('[data-add-custom-cost]')) {
      mutateBusinessInput({ type: 'ADD_CUSTOM_COST' });
      render();
      document.querySelector('[data-custom-cost-list] .custom-cost-row:last-child input')?.focus();
    }
    const removeCustomCost = event.target.closest('[data-remove-custom-cost]');
    if (removeCustomCost) {
      mutateBusinessInput({ type: 'REMOVE_CUSTOM_COST', id: Number(removeCustomCost.dataset.removeCustomCost) });
      render();
      $('[data-add-custom-cost]')?.focus();
    }
    if (event.target.closest('[data-fill-synthetic-demo]')) {
      commitBusinessPath(reduceBusinessInput(state.businessInput, { type: 'SET_DEMO' }), { demoMode: true });
      render();
      $('#businessName')?.focus();
      analyze($('#question').value).catch((error) => { $('#partner-status').textContent = error.message; });
    }
    if (event.target.closest('[data-action="open-advisor-consent"]')) $('#advisor-consent-dialog')?.showModal();
    if (event.target.closest('[data-action="close-advisor-consent"]')) $('#advisor-consent-dialog')?.close();
    if (event.target.id === 'advisor-submit') connectAdvisor();
  });
  document.addEventListener('input', (event) => {
    if (!event.target.closest('#business-input-form')) return;
    const customMatch = event.target.name?.match(/^custom(Label|Amount)-(\d+)$/u);
    if (customMatch) {
      const exitedDemo = mutateBusinessInput({
        type: 'EDIT_CUSTOM_COST', id: Number(customMatch[2]), field: customMatch[1] === 'Label' ? 'label' : 'amountKrw', value: event.target.value,
      });
      if (exitedDemo) {
        render();
        document.querySelector(`[name="${event.target.name}"]`)?.focus();
      }
      return;
    }
    const commonFields = new Set(['regionCode', 'districtCode', 'neighborhoodName', 'industryTemplate', 'registrationStatus', 'fundingPurpose', 'businessName', 'businessDescription']);
    const exitedDemo = mutateBusinessInput({
      type: commonFields.has(event.target.name) ? 'EDIT_COMMON' : 'EDIT_STAGE', field: event.target.name, value: event.target.value,
    });
    if (exitedDemo) {
      const fieldName = event.target.name;
      render();
      const editedControl = document.querySelector(`[name="${fieldName}"]`);
      editedControl?.focus();
      if (editedControl?.setSelectionRange) editedControl.setSelectionRange(editedControl.value.length, editedControl.value.length);
    }
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'advisor-consent') $('#advisor-submit').disabled = !canRequestAdvisor(event.target.checked, selectedCouncil());
  });
  document.addEventListener('submit', (event) => {
    if (event.target.id !== 'business-input-form') return;
    event.preventDefault();
    submitBusinessInput(event.target);
  });
  $('#question-form').addEventListener('submit', async (event) => { event.preventDefault(); try { await runContextualAnalysis(new FormData(event.currentTarget).get('question').trim()); } catch (error) { $('#partner-status').textContent = error.message; } });
}

async function initialize() {
  bindEvents();
  try {
    state.bootstrap = await request('/api/bootstrap');
    render();
    document.body.dataset.ready = 'true';
  } catch (error) {
    $('#analysis-meta').textContent = error.message;
    render();
  }
}

initialize();
