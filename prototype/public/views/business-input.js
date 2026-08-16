const COMMON_DEFAULTS = Object.freeze({
  regionCode: 'SEOUL', districtCode: '', neighborhoodName: '',
  industryTemplate: 'GENERAL', registrationStatus: 'NOT_REGISTERED',
  fundingPurpose: 'WORKING_CAPITAL', businessName: '', businessDescription: '',
});
const SEOUL_DISTRICTS = Object.freeze([
  ['JONGNO', '종로구'], ['JUNG', '중구'], ['YONGSAN', '용산구'], ['SEONGDONG', '성동구'],
  ['GWANGJIN', '광진구'], ['DONGDAEMUN', '동대문구'], ['JUNGNANG', '중랑구'], ['SEONGBUK', '성북구'],
  ['GANGBUK', '강북구'], ['DOBONG', '도봉구'], ['NOWON', '노원구'], ['EUNPYEONG', '은평구'],
  ['SEODAEMUN', '서대문구'], ['MAPO', '마포구'], ['YANGCHEON', '양천구'], ['GANGSEO', '강서구'],
  ['GURO', '구로구'], ['GEUMCHEON', '금천구'], ['YEONGDEUNGPO', '영등포구'], ['DONGJAK', '동작구'],
  ['GWANAK', '관악구'], ['SEOCHO', '서초구'], ['GANGNAM', '강남구'], ['SONGPA', '송파구'],
  ['GANGDONG', '강동구'],
]);
const STARTUP_DEFAULTS = Object.freeze({
  declaredTotalBudgetKrw: '', ownCapitalKrw: '', depositKrw: '', interiorCostKrw: '',
  equipmentCostKrw: '', initialInventoryKrw: '', permitsMarketingKrw: '', otherCostKrw: '',
});
const OPERATING_DEFAULTS = Object.freeze({
  operatingMonths: '', monthlySalesKrw: '', declaredNetProfitKrw: '', declaredMarginPercent: '', laborCostKrw: '',
  rentKrw: '', materialCostKrw: '', platformFeesKrw: '', advertisingKrw: '', utilitiesAndFeesKrw: '', otherCostKrw: '',
});
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const emptyStage = (defaults) => ({ ...defaults, customCosts: [] });
const stageKey = (path) => path === 'OPERATING' ? 'operating' : 'startup';

export function createBusinessInputState(overrides = {}) {
  const state = {
    path: 'STARTUP', pendingPath: null,
    common: { ...COMMON_DEFAULTS, ...(overrides.common ?? {}) },
    startup: { ...emptyStage(STARTUP_DEFAULTS), ...(overrides.startup ?? {}) },
    operating: { ...emptyStage(OPERATING_DEFAULTS), ...(overrides.operating ?? {}) },
    nextCustomId: 1,
    transition: { status: 'READY', message: '창업 준비 또는 운영 중인 사업을 선택하세요.' },
    errors: { ...(overrides.errors ?? {}) },
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (!['common', 'startup', 'operating', 'errors'].includes(key)) state[key] = value;
  }
  return state;
}

function hasStageValues(stage) {
  return Object.entries(stage).some(([key, value]) => key === 'customCosts'
    ? value.length > 0 : String(value ?? '').trim() !== '');
}

export function reduceBusinessInput(state, action) {
  const currentStage = stageKey(state.path);
  if (action.type === 'EDIT_COMMON') {
    return { ...state, common: { ...state.common, [action.field]: action.value }, errors: { ...state.errors, [action.field]: undefined } };
  }
  if (action.type === 'EDIT_STAGE') {
    return { ...state, [currentStage]: { ...state[currentStage], [action.field]: action.value }, errors: { ...state.errors, [action.field]: undefined } };
  }
  if (action.type === 'EDIT_CUSTOM_COST') {
    return { ...state, [currentStage]: { ...state[currentStage], customCosts: state[currentStage].customCosts.map((cost) => (
      cost.id === action.id ? { ...cost, [action.field]: action.value } : cost
    )) } };
  }
  if (action.type === 'ADD_CUSTOM_COST') {
    if (state[currentStage].customCosts.length >= 20) return state;
    return {
      ...state, nextCustomId: state.nextCustomId + 1,
      [currentStage]: { ...state[currentStage], customCosts: [...state[currentStage].customCosts, { id: state.nextCustomId, label: '', amountKrw: '' }] },
    };
  }
  if (action.type === 'REMOVE_CUSTOM_COST') {
    return { ...state, [currentStage]: { ...state[currentStage], customCosts: state[currentStage].customCosts.filter((cost) => cost.id !== action.id) } };
  }
  if (action.type === 'REQUEST_PATH') {
    if (!['STARTUP', 'OPERATING'].includes(action.path) || action.path === state.path) return state;
    if (!hasStageValues(state[currentStage])) return reduceBusinessInput({ ...state, pendingPath: action.path }, { type: 'CONFIRM_PATH' });
    return {
      ...state, pendingPath: action.path,
      transition: { status: 'CONFIRM_REQUIRED', message: '경로를 바꾸면 현재 단계 전용 입력이 지워집니다. 공통 입력은 유지됩니다.' },
    };
  }
  if (action.type === 'CONFIRM_PATH') {
    if (!state.pendingPath) return state;
    const nextPath = state.pendingPath;
    return {
      ...state, path: nextPath, pendingPath: null,
      [currentStage]: emptyStage(currentStage === 'startup' ? STARTUP_DEFAULTS : OPERATING_DEFAULTS),
      errors: {},
      transition: { status: 'PATH_CHANGED', message: `${nextPath === 'STARTUP' ? '창업 준비' : '운영 중'} 입력으로 전환했습니다. 공통 입력은 유지되었습니다.` },
    };
  }
  if (action.type === 'CANCEL_PATH') return { ...state, pendingPath: null, transition: { status: 'READY', message: '기존 입력 경로를 유지했습니다.' } };
  if (action.type === 'SET_ERRORS') return { ...state, errors: { ...action.errors } };
  if (action.type === 'SET_DEMO') {
    return createBusinessInputState({
      common: {
        regionCode: 'SEOUL', districtCode: 'SEONGDONG', neighborhoodName: '성수동',
        industryTemplate: 'FOOD_CAFE', registrationStatus: 'NOT_REGISTERED', fundingPurpose: 'WORKING_CAPITAL',
        businessName: '합성 크로아티아 음식점 예시', businessDescription: '선택적으로 불러온 합성 데모이며 실제 사업 정보가 아닙니다.',
      },
      startup: {
        ...STARTUP_DEFAULTS, declaredTotalBudgetKrw: '112000000', ownCapitalKrw: '60000000', depositKrw: '30000000',
        interiorCostKrw: '40000000', equipmentCostKrw: '30000000', initialInventoryKrw: '10000000', permitsMarketingKrw: '2000000', otherCostKrw: '0', customCosts: [],
      },
      transition: { status: 'DEMO_LOADED', message: '선택적 합성 데모 값을 불러왔습니다.' },
    });
  }
  return state;
}

const integerValue = (entries, name) => Number(entries.get(name));
const textValue = (entries, name) => String(entries.get(name) ?? '').trim();

export function validateBusinessInputEntries(entries, path, customRows = []) {
  const errors = {};
  for (const name of ['regionCode', 'districtCode', 'neighborhoodName', 'industryTemplate', 'registrationStatus', 'fundingPurpose', 'businessName', 'businessDescription']) {
    if (!textValue(entries, name)) errors[name] = { code: 'REQUIRED', message: '필수 입력입니다.' };
  }
  const numericFields = path === 'STARTUP'
    ? ['declaredTotalBudgetKrw', 'ownCapitalKrw', 'depositKrw', 'interiorCostKrw', 'equipmentCostKrw', 'initialInventoryKrw', 'permitsMarketingKrw', 'otherCostKrw']
    : ['operatingMonths', 'monthlySalesKrw', 'declaredNetProfitKrw', 'declaredMarginPercent', 'laborCostKrw', 'rentKrw', 'materialCostKrw', 'platformFeesKrw', 'advertisingKrw', 'utilitiesAndFeesKrw', 'otherCostKrw'];
  for (const name of numericFields) {
    const raw = String(entries.get(name) ?? '').trim();
    if (!raw) {
      errors[name] = { code: 'REQUIRED', message: '필수 입력입니다.' };
      continue;
    }
    const value = Number(raw);
    const isPercent = name === 'declaredMarginPercent';
    const allowsNegative = name === 'declaredNetProfitKrw' || isPercent;
    const valid = Number.isFinite(value) && (isPercent || Number.isInteger(value)) && (allowsNegative || value >= 0) && (!isPercent || (value >= -100 && value <= 100));
    if (!valid) errors[name] = { code: isPercent ? 'INVALID_PERCENT' : 'INVALID_KRW_AMOUNT', message: isPercent ? '-100%에서 100% 사이의 숫자를 입력하세요.' : '0 이상의 정수 원화 금액을 입력하세요.' };
  }
  for (const row of customRows) {
    const labelName = `customLabel-${row.id}`;
    const amountName = `customAmount-${row.id}`;
    if (!textValue(entries, labelName)) errors[labelName] = { code: 'REQUIRED', message: '비용 이름을 입력하세요.' };
    const amount = String(entries.get(amountName) ?? '').trim();
    if (!amount) errors[amountName] = { code: 'REQUIRED', message: '비용 금액을 입력하세요.' };
    else if (!Number.isInteger(Number(amount)) || Number(amount) < 0) errors[amountName] = { code: 'INVALID_KRW_AMOUNT', message: '0 이상의 정수 원화 금액을 입력하세요.' };
  }
  return errors;
}

export function businessInputFromEntries(entries, path, customRows = []) {
  const customCosts = customRows.map((row) => ({ label: textValue(entries, `customLabel-${row.id}`), amountKrw: integerValue(entries, `customAmount-${row.id}`) }));
  const otherCostKrw = integerValue(entries, 'otherCostKrw');
  const common = {
    path, stage: path, regionCode: textValue(entries, 'regionCode'), districtCode: textValue(entries, 'districtCode'),
    neighborhoodName: textValue(entries, 'neighborhoodName'), industryTemplate: textValue(entries, 'industryTemplate'),
    businessProfile: {
      businessName: textValue(entries, 'businessName'), businessDescription: textValue(entries, 'businessDescription'), registrationStatus: textValue(entries, 'registrationStatus'),
    },
  };
  if (path === 'STARTUP') {
    return { ...common, startup: {
      fundingPurpose: textValue(entries, 'fundingPurpose'), declaredTotalBudgetKrw: integerValue(entries, 'declaredTotalBudgetKrw'),
      ownCapitalKrw: integerValue(entries, 'ownCapitalKrw'), depositKrw: integerValue(entries, 'depositKrw'), interiorCostKrw: integerValue(entries, 'interiorCostKrw'),
      equipmentCostKrw: integerValue(entries, 'equipmentCostKrw'), initialInventoryKrw: integerValue(entries, 'initialInventoryKrw'),
      permitsMarketingKrw: integerValue(entries, 'permitsMarketingKrw'), otherCostKrw, customCosts,
    } };
  }
  return { ...common, operating: {
    operatingMonths: integerValue(entries, 'operatingMonths'), fundingPurpose: textValue(entries, 'fundingPurpose'), monthlySalesKrw: integerValue(entries, 'monthlySalesKrw'),
    declaredNetProfitKrw: integerValue(entries, 'declaredNetProfitKrw'), declaredMarginRate: Number(entries.get('declaredMarginPercent')) / 100,
    laborCostKrw: integerValue(entries, 'laborCostKrw'), rentKrw: integerValue(entries, 'rentKrw'), materialCostKrw: integerValue(entries, 'materialCostKrw'),
    platformFeesKrw: integerValue(entries, 'platformFeesKrw'), advertisingKrw: integerValue(entries, 'advertisingKrw'), utilitiesAndFeesKrw: integerValue(entries, 'utilitiesAndFeesKrw'),
    customCosts: [...(otherCostKrw === 0 ? [] : [{ label: 'Other cost', amountKrw: otherCostKrw }]), ...customCosts],
  } };
}

export function mapServerFieldErrors(fields = []) {
  return Object.fromEntries(fields.map((item) => {
    const field = String(item.field ?? '');
    const controlName = field.split('.').at(-1);
    return [controlName, item];
  }).filter(([controlName]) => controlName));
}

function field(state, name, label, options = {}) {
  const value = options.common ? state.common[name] : state[stageKey(state.path)][name];
  const error = state.errors[name] ?? state.errors[`${stageKey(state.path)}.${name}`];
  const describedBy = error ? `${name}-error` : '';
  const inputType = options.type === 'text' ? '' : ` type="number" step="${options.step ?? 1}"${options.allowNegative ? '' : ' min="0"'}`;
  return `<div class="form-field"><label for="${name}">${label}</label><input id="${name}" name="${name}" value="${escapeHtml(value)}"${inputType} required${describedBy ? ` aria-describedby="${describedBy}"` : ''}${error ? ' aria-invalid="true"' : ''}>${error ? `<p id="${name}-error" class="field-error" data-field-code="${escapeHtml(error.code)}">${escapeHtml(error.message)}</p>` : ''}</div>`;
}

function selectField(state, name, label, options) {
  const value = state.common[name];
  const error = state.errors[name];
  const describedBy = error ? `${name}-error` : '';
  return `<div class="form-field"><label for="${name}">${label}</label><select id="${name}" name="${name}" required${describedBy ? ` aria-describedby="${describedBy}"` : ''}${error ? ' aria-invalid="true"' : ''}>${options.map(([key, text]) => `<option value="${key}"${key === value ? ' selected' : ''}>${text}</option>`).join('')}</select>${error ? `<p id="${name}-error" class="field-error" data-field-code="${escapeHtml(error.code)}">${escapeHtml(error.message)}</p>` : ''}</div>`;
}

function readonlyField(state, name, label, value, note) {
  const error = state.errors[name];
  const describedBy = [note ? `${name}-note` : '', error ? `${name}-error` : ''].filter(Boolean).join(' ');
  return `<div class="form-field"><label for="${name}">${label}</label><input id="${name}" name="${name}" value="${escapeHtml(value)}" readonly required${describedBy ? ` aria-describedby="${describedBy}"` : ''}${error ? ' aria-invalid="true"' : ''}>${note ? `<p id="${name}-note" class="muted">${escapeHtml(note)}</p>` : ''}${error ? `<p id="${name}-error" class="field-error" data-field-code="${escapeHtml(error.code)}">${escapeHtml(error.message)}</p>` : ''}</div>`;
}

function locationFields(state) {
  return `${readonlyField(state, 'regionCode', '정책 권역', 'SEOUL', '서울 전체가 아니라 구와 동 단위로 분석 기준을 잡습니다.')}${selectField(state, 'districtCode', '서울 자치구', [['', '구 선택'], ...SEOUL_DISTRICTS])}${field(state, 'neighborhoodName', '동/상권명', { common: true, type: 'text' })}`;
}

function customCostFields(state) {
  const rows = state[stageKey(state.path)].customCosts;
  const groupError = state.errors.customCosts;
  return `<fieldset class="custom-costs"><legend>사용자 지정 비용 (최대 20개)</legend>${groupError ? `<p class="field-error" role="alert" data-custom-cost-error="${escapeHtml(groupError.code)}">${escapeHtml(groupError.message)}</p>` : ''}<div data-custom-cost-list>${rows.map((row, index) => {
    const labelError = state.errors[`customLabel-${row.id}`];
    const amountError = state.errors[`customAmount-${row.id}`];
    return `<div class="custom-cost-row" data-custom-cost-id="${row.id}"><div class="form-field"><label for="customLabel-${row.id}">사용자 지정 비용 ${index + 1} 이름</label><input id="customLabel-${row.id}" name="customLabel-${row.id}" value="${escapeHtml(row.label)}" required${labelError ? ` aria-invalid="true" aria-describedby="customLabel-${row.id}-error"` : ''}>${labelError ? `<p id="customLabel-${row.id}-error" class="field-error" data-field-code="${escapeHtml(labelError.code)}">${escapeHtml(labelError.message)}</p>` : ''}</div><div class="form-field"><label for="customAmount-${row.id}">사용자 지정 비용 ${index + 1} 금액 (원)</label><input id="customAmount-${row.id}" name="customAmount-${row.id}" type="number" step="1" min="0" value="${escapeHtml(row.amountKrw)}" required${amountError ? ` aria-invalid="true" aria-describedby="customAmount-${row.id}-error"` : ''}>${amountError ? `<p id="customAmount-${row.id}-error" class="field-error" data-field-code="${escapeHtml(amountError.code)}">${escapeHtml(amountError.message)}</p>` : ''}</div><button type="button" class="secondary-button" data-remove-custom-cost="${row.id}">비용 삭제</button></div>`;
  }).join('')}</div><button type="button" class="secondary-button" data-add-custom-cost${rows.length >= 20 ? ' disabled' : ''}>사용자 지정 비용 추가</button><p class="muted">${rows.length}/20개</p></fieldset>`;
}

function startupFields(state) {
  return `<fieldset><legend>창업 자금 계획</legend><div class="form-grid">${field(state, 'declaredTotalBudgetKrw', '신고한 총예산 (원)')}${field(state, 'ownCapitalKrw', '자기자본 (원)')}${field(state, 'depositKrw', '보증금 (원)')}${field(state, 'interiorCostKrw', '인테리어·시설비 (원)')}${field(state, 'equipmentCostKrw', '장비비 (원)')}${field(state, 'initialInventoryKrw', '초기 재료·재고비 (원)')}${field(state, 'permitsMarketingKrw', '인허가·초기 마케팅비 (원)')}${field(state, 'otherCostKrw', '기타 비용 (원)')}</div></fieldset>`;
}

function operatingFields(state) {
  return `<fieldset><legend>월 운영 실적</legend><div class="form-grid">${field(state, 'operatingMonths', '운영 개월 수')}${field(state, 'monthlySalesKrw', '월 매출 (원)')}${field(state, 'declaredNetProfitKrw', '신고한 월 순이익 (원)', { allowNegative: true })}${field(state, 'declaredMarginPercent', '신고한 영업이익률 (%)', { step: 0.01, allowNegative: true })}${field(state, 'laborCostKrw', '인건비 (원)')}${field(state, 'rentKrw', '임차료 (원)')}${field(state, 'materialCostKrw', '재료·매입비 (원)')}${field(state, 'platformFeesKrw', '플랫폼 수수료 (원)')}${field(state, 'advertisingKrw', '광고비 (원)')}${field(state, 'utilitiesAndFeesKrw', '공과금·수수료 (원)')}${field(state, 'otherCostKrw', '기타 비용 (원)')}</div></fieldset>`;
}

export function renderBusinessInput(state) {
  const confirmation = state.pendingPath ? `<div class="path-confirmation" data-path-confirmation role="alert"><p>${escapeHtml(state.transition.message)}</p><div class="button-row"><button type="button" data-confirm-path>전환하고 단계 입력 지우기</button><button type="button" class="secondary-button" data-cancel-path>취소</button></div></div>` : '';
  return `<form id="business-input-form" novalidate>${confirmation}<p id="input-transition-status" class="muted" role="status" aria-live="polite">${escapeHtml(state.transition.message)}</p><fieldset><legend>공통 사업 정보</legend><div class="form-grid">${locationFields(state)}${selectField(state, 'industryTemplate', '업종 템플릿', [['FOOD_CAFE', '음식·카페'], ['RETAIL', '소매'], ['PERSONAL_SERVICE', '개인 서비스'], ['GENERAL', '일반 사업']])}${selectField(state, 'registrationStatus', '사업자등록 상태', [['NOT_REGISTERED', '미등록'], ['REGISTERED', '등록 완료']])}${selectField(state, 'fundingPurpose', '자금 목적', [['STARTUP_COST', '창업 비용'], ['WORKING_CAPITAL', '운전자금'], ['FACILITY', '시설'], ['RECOVERY', '회복'], ['LOAN_EXECUTION', '대출 실행']])}${field(state, 'businessName', '사업명', { common: true, type: 'text' })}${field(state, 'businessDescription', '기본 사업 설명', { common: true, type: 'text' })}</div></fieldset>${state.path === 'STARTUP' ? startupFields(state) : operatingFields(state)}${customCostFields(state)}<div class="button-row"><button type="submit" data-analysis-submit>분석 실행</button><button type="button" class="secondary-button" data-fill-synthetic-demo>선택적 합성 데모 채우기</button></div><p class="muted">합성 데모는 선택 사항이며 실제 사업·시장 데이터가 아닙니다.</p></form>`;
}
