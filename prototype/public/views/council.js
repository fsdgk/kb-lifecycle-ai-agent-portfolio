const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const textItems = (items, field = 'detail') => (items ?? []).map((item) => escapeHtml(item[field] ?? item.code)).join('; ') || '-';

function formatKrw(value) {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 100_000_000) {
    const eok = Math.trunc(abs / 100_000_000);
    const man = Math.trunc((abs % 100_000_000) / 10_000);
    return `${value < 0 ? '-' : ''}${eok}억${man ? ` ${man.toLocaleString('ko-KR')}만원` : ''}`;
  }
  if (abs >= 10_000) return `${value < 0 ? '-' : ''}${Math.round(abs / 10_000).toLocaleString('ko-KR')}만원`;
  return `${value.toLocaleString('ko-KR')}원`;
}

function evidenceById(council) {
  return new Map((council.evidence ?? []).map((item) => [item.id, item]));
}

function evidenceValue(council, id) {
  return evidenceById(council).get(id)?.value ?? {};
}

function actionGuidance(action, council) {
  const fundingGap = evidenceValue(council, 'finance.startup.funding-gap').amountKrw;
  const buffer = evidenceValue(council, 'finance.startup.recommended-buffer').amountKrw;
  const policy = evidenceValue(council, 'policy.match-status');
  const calculated = evidenceValue(council, 'finance.operating.calculated-result');
  const declaredDiff = evidenceValue(council, 'finance.operating.declared-difference');

  if (action.code === 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT') {
    return `부족 자금 ${formatKrw(fundingGap)}을 먼저 메워야 합니다. 임대 보증금, 인테리어, 장비비 중 계약 전에 줄일 수 있는 항목을 다시 잡고, 남는 금액만 정책자금·대출·자기자본 조합으로 설계하세요.`;
  }
  if (action.code === 'RESERVE_RECOMMENDED_BUFFER') {
    return `예상 못 한 오픈 지연과 초기 매출 변동에 대비해 완충자금 ${formatKrw(buffer)}을 별도로 남겨두는 편이 안전합니다.`;
  }
  if (action.code === 'VERIFY_POLICY_ELIGIBILITY') {
    return `정책 후보 ${policy.matchCount ?? 0}건은 신청기간, 업종 제한, 서울 사업장 요건, 예산 잔여 여부를 공식 공고에서 확인한 뒤 진행하세요.`;
  }
  if (action.code === 'CHECK_OPERATING_READINESS') {
    return '오픈 전에는 메뉴 원가표, 월 고정비, 손익분기 매출, 인허가 상태를 먼저 닫아야 합니다. 이 네 가지가 비어 있으면 자금 추천보다 운영 리스크가 먼저입니다.';
  }
  if (action.code === 'REFRESH_MARKET_DATA') {
    return '상권 데이터는 아직 연동 예정 상태입니다. 실제 서비스에서는 해당 구·동의 경쟁점포, 신규 입점, 폐업, 임대 매물, 유동인구를 확인한 뒤 입지 판단에 반영합니다.';
  }
  if (action.code === 'REVIEW_OPERATING_PERFORMANCE') {
    return `계산 순이익 ${formatKrw(calculated.netProfitKrw)}과 비용 비중을 기준으로 임대료·인건비·재료비 중 매출 대비 높은 항목부터 점검하세요.`;
  }
  if (action.code === 'ADDRESS_CASH_SHORTFALL') {
    return `계산 순이익이 ${formatKrw(calculated.netProfitKrw)}입니다. 추가 차입보다 고정비 축소, 원가 재산정, 단기 현금 유출 통제가 먼저입니다.`;
  }
  if (action.code === 'MONITOR_OPERATING_CASHFLOW') {
    return `사용자 신고값과 계산값 차이 ${formatKrw(declaredDiff.netProfitKrw)}를 먼저 맞춰야 합니다. 매출 누락, 비용 누락, 부가세·수수료 반영 여부를 확인하세요.`;
  }
  if (action.code === 'STABILIZE_OPERATIONS') {
    return '운영 안정화가 우선입니다. 손실 원인을 매출 부족, 원재료비, 인건비, 임대료로 나누고 이번 달에 바로 조정 가능한 항목부터 실행하세요.';
  }
  return action.title;
}

function summaryGuidance(council) {
  const fundingGap = evidenceValue(council, 'finance.startup.funding-gap').amountKrw;
  const buffer = evidenceValue(council, 'finance.startup.recommended-buffer').amountKrw;
  const policy = evidenceValue(council, 'policy.match-status');
  const calculated = evidenceValue(council, 'finance.operating.calculated-result');
  if (Number.isFinite(fundingGap) && fundingGap > 0) {
    const totalNeed = Number.isFinite(buffer) ? fundingGap + buffer : fundingGap;
    return `전문가 종합 판단: 현재 계획은 부족 자금 ${formatKrw(fundingGap)}${Number.isFinite(buffer) ? `과 완충자금 ${formatKrw(buffer)}` : ''}을 먼저 해결해야 합니다. 최소 검토 자금은 ${formatKrw(totalNeed)}이며, 정책 후보 ${policy.matchCount ?? 0}건은 자격 확인 후 조달 계획에 반영하세요.`;
  }
  if (Number.isFinite(calculated.netProfitKrw)) {
    return `전문가 종합 판단: 계산 순이익은 ${formatKrw(calculated.netProfitKrw)}입니다. 비용 비중과 사용자가 신고한 수익성을 비교해 차이가 큰 항목부터 조정하세요.`;
  }
  return council.summary ?? '전문가 의견을 불러오는 중입니다.';
}

function evidenceDetail(council, evidenceIds, generatedAt) {
  const evidenceById = new Map((council.evidence ?? []).map((item) => [item.id, item]));
  const matched = evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
  const sources = matched.map((item) => item.producerSource ?? item.source ?? item.provenance?.source).filter(Boolean);
  const dates = matched.map((item) => item.asOf ?? item.provenance?.asOf ?? item.provenance?.verifiedAt).filter(Boolean);
  return {
    source: sources.join(', ') || '근거 출처를 확인할 수 없음',
    asOf: dates.join(', ') || (generatedAt ? `분석 생성 시점(대체): ${generatedAt}` : '출처 기준일을 확인할 수 없음'),
  };
}

export function renderCouncil(council = {}, generatedAt) {
  const opinions = (council.opinions ?? []).map((opinion) => {
    const evidenceIds = [...new Set([
      ...(opinion.evidenceIds ?? []),
      ...(opinion.claims ?? []).flatMap((item) => item.evidenceIds ?? []),
      ...(opinion.actions ?? []).flatMap((item) => item.evidenceIds ?? []),
    ])];
    const actionList = (opinion.actions ?? []).map((action) => `<li data-action-guidance>${escapeHtml(actionGuidance(action, council))}</li>`).join('');
    return `<li data-expert-opinion>
    <h3>${escapeHtml(opinion.expert)} 전문 의견</h3>
    <p>${textItems(opinion.claims, 'statement')}</p>
    ${actionList ? `<h4>권장 실행</h4><ul>${actionList}</ul>` : ''}
    <details data-council-trace><summary>자세히 보기</summary><dl class="evidence-grid">
      <dt>근거 출처</dt><dd>${escapeHtml(evidenceDetail(council, evidenceIds, generatedAt).source)}</dd>
      <dt>출처 기준일</dt><dd>${escapeHtml(evidenceDetail(council, evidenceIds, generatedAt).asOf)}</dd>
      <dt>계산 경로</dt><dd>프로필·시장·재무·정책 입력 → ${escapeHtml(opinion.expert)} 의견</dd>
      <dt>전문가 의견</dt><dd>${textItems(opinion.claims, 'statement')}</dd>
      <dt>가정</dt><dd>${textItems(opinion.assumptions)}</dd>
      <dt>불확실성</dt><dd>${textItems(opinion.uncertainty)}</dd>
      <dt>충돌</dt><dd>${escapeHtml((council.conflicts ?? []).map((item) => item.detail ?? item.code).join('; ') || '확인된 전문가 간 충돌 없음')}</dd>
    </dl></details>
  </li>`;
  }).join('');
  const actions = (council.priorityActions ?? []).map((action) => `<li data-action-guidance>${escapeHtml(actionGuidance(action, council))}${action.immediacy ? ` (${escapeHtml(action.immediacy)})` : ''}</li>`).join('');
  const uncertainty = (council.uncertainty ?? []).map((item) => `<li><strong>${escapeHtml(item.code)}</strong>: ${escapeHtml(item.detail)}</li>`).join('');
  return `<h2 id="council-title">협업 근거: 전문가 의견</h2>
    <p>${escapeHtml(summaryGuidance(council))}</p>
    <h3>Supervisor 우선순위</h3><ul class="tag-list" data-supervisor-priorities>${actions || '<li>분석 결과를 기다리는 중입니다.</li>'}</ul>
    <h3>불확실성과 근거 한계</h3><ul class="tag-list" data-council-uncertainty>${uncertainty || '<li>표시할 불확실성이 없습니다.</li>'}</ul>
    <ul class="opinion-list">${opinions}</ul>`;
}
