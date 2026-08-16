const stages = [
  ['PRE_START', '시작 전'],
  ['SITE_AND_FUNDING', '입지·자금 설계'],
  ['OPENING', '개점 준비'],
  ['OPERATING', '운영'],
  ['CRISIS', '위기 대응'],
];

const pathStageMatrix = {
  startup: stages.map(([key]) => key),
  operator: ['OPERATING', 'CRISIS'],
};

export function allowedStagesForPath(path) {
  return [...(pathStageMatrix[path] ?? [])];
}

export function stageFor(path) {
  return path === 'operator' ? 'OPERATING' : 'SITE_AND_FUNDING';
}

export function stageLabel(stage) {
  return stages.find(([key]) => key === stage)?.[1] ?? stage;
}

export function guidanceFor(path, stage) {
  if (stage === 'CRISIS') {
    return { message: '위기 신호는 즉시 알림과 공식 지원 원문 확인으로 이어집니다.', action: '즉시 대응 우선순위 확인' };
  }
  if (path === 'operator' || stage === 'OPERATING') {
    return { message: '운영 중인 사업은 최근 변화가 현금흐름과 운영 안정성에 미치는 영향을 먼저 점검합니다.', action: '매출·원가·현금흐름 점검' };
  }
  return { message: '창업 전에는 입지 검증과 자금 공백을 계약 전에 함께 확인합니다.', action: '자금 공백을 계약 전 확인' };
}

export function buildAnalysisContext(path, stage, extraContext = {}) {
  return { path, stage, ...extraContext };
}

export function analysisContextFor(state, extraContext = {}) {
  return buildAnalysisContext(state.path, state.stage, {
    ...(state.activeRealtimeSignal ? { realtimeSignal: state.activeRealtimeSignal } : {}),
    ...extraContext,
  });
}

export function createLatestRequestGate() {
  let latest = 0;
  return {
    begin() { latest += 1; return latest; },
    invalidate() { latest += 1; },
    isLatest(requestId) { return requestId === latest; },
  };
}

export function analysisRouteFor({ demoMode }) {
  if (demoMode) return 'LEGACY_DEMO';
  return 'DYNAMIC';
}

export function applyPathSelection(state, path) {
  return { path, stage: stageFor(path), reanalyze: true };
}

export function applyStageSelection(state, stage) {
  if (!allowedStagesForPath(state.path).includes(stage)) {
    return { path: state.path, stage: state.stage, reanalyze: false };
  }
  return { path: state.path, stage, reanalyze: true };
}

export function financeFactRows(finance = {}) {
  if (finance.mode === 'OPERATING_CASHFLOW') {
    return [
      ['운영 시작 잔액', formatKrw(finance.openingBalance)],
      ['월 매출 관측', formatKrw(finance.monthlySalesKrw)],
      ['28일 예상 최저 잔액', formatKrw(finance.forecast?.minimumBalance)],
      ['현금 부족', finance.forecast?.shortfallDate ?? '예상 없음'],
    ];
  }
  return [
    ['계획 창업비', formatKrw(finance.plannedCost)],
    ['자기자금', formatKrw(finance.ownCapital)],
    ['예상 자금 공백', formatKrw(finance.fundingGap)],
    ['실제 정책 후보', '공식 원문 기준 확인 필요'],
  ];
}

export function restoreLifecycleFocus(region, stage, shouldRestore) {
  if (!shouldRestore || !stage) return;
  region.querySelector(`[data-stage="${stage}"]`)?.focus();
}

export function formatKrw(amount) {
  if (!Number.isFinite(amount)) return '-';
  const wholeAmount = Math.trunc(amount);
  const eok = Math.trunc(wholeAmount / 100_000_000);
  const tenThousand = Math.trunc((wholeAmount % 100_000_000) / 10_000);
  if (eok && tenThousand) return `${eok}억 ${tenThousand.toLocaleString('ko-KR')}만원`;
  if (eok) return `${eok}억원`;
  if (tenThousand) return `${tenThousand.toLocaleString('ko-KR')}만원`;
  return `${wholeAmount.toLocaleString('ko-KR')}원`;
}

export function renderLifecycle(path, stage) {
  const allowedStages = allowedStagesForPath(path);
  const restriction = path === 'operator'
    ? '<p id="operator-stage-restriction" class="muted" data-operator-stage-restriction>기존 운영 경로에서는 운영 및 위기 대응 단계만 선택할 수 있습니다.</p>'
    : '';
  return `<h2>사업 단계</h2>${restriction}<ol class="lifecycle-list">${stages.map(([key, label]) => {
    const unavailable = !allowedStages.includes(key);
    return `
    <li><button type="button" data-stage="${key}" aria-current="${key === stage ? 'step' : 'false'}"${unavailable ? ' disabled aria-describedby="operator-stage-restriction"' : ''}>${label}</button></li>`;
  }).join('')}</ol>`;
}
