const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const krw = (value) => Number.isFinite(value) ? `${Math.trunc(value).toLocaleString('ko-KR')}원` : '해당 없음';
const percent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '해당 없음';
const STATUS_LABELS = { LOW: 'LOW · 참고 범위보다 낮음', WITHIN: 'WITHIN · 참고 범위 안', HIGH: 'HIGH · 참고 범위보다 높음' };

function startupResult(analysis) {
  return `<dl class="fact-grid comparison-grid"><div data-comparison="declared-budget"><dt>신고한 총예산</dt><dd>${krw(analysis.declaredTotalBudgetKrw)}</dd></div><div data-comparison="calculated-budget"><dt>계산한 세부 비용 합계</dt><dd>${krw(analysis.detailCostTotalKrw)}</dd></div><div data-comparison="budget-difference"><dt>예산 차이</dt><dd>${krw(analysis.declaredBudgetDifferenceKrw)}</dd></div><div><dt>계산한 자금 공백</dt><dd>${krw(analysis.fundingGapKrw)}</dd></div><div><dt>권장 완충자금</dt><dd>${krw(analysis.recommendedBufferKrw)}</dd></div></dl>`;
}

function operatingResult(analysis) {
  const benchmarks = Object.entries(analysis.benchmarks ?? {}).map(([name, item]) => item == null ? '' : `<tr data-benchmark-status="${item.status}"><th scope="row">${escapeHtml(name)}</th><td>${percent(analysis.ratios?.[name] ?? (name === 'operatingMargin' ? analysis.calculated?.marginRate : null))}</td><td>${escapeHtml(STATUS_LABELS[item.status] ?? item.status)}</td><td>${percent(item.range.low)}–${percent(item.range.high)}</td></tr>`).join('');
  return `<dl class="fact-grid comparison-grid"><div data-comparison="declared-profit"><dt>신고한 순이익</dt><dd>${krw(analysis.declared?.netProfitKrw)}</dd></div><div data-comparison="calculated-profit"><dt>계산한 순이익</dt><dd>${krw(analysis.calculated?.netProfitKrw)}</dd></div><div data-comparison="profit-difference"><dt>순이익 차이</dt><dd>${krw(analysis.differences?.netProfitKrw)}</dd></div><div data-comparison="declared-margin"><dt>신고한 이익률</dt><dd>${percent(analysis.declared?.marginRate)}</dd></div><div data-comparison="calculated-margin"><dt>계산한 이익률</dt><dd>${percent(analysis.calculated?.marginRate)}</dd></div><div data-comparison="margin-difference"><dt>이익률 차이</dt><dd>${percent(analysis.differences?.marginRate)}</dd></div></dl><div class="table-wrap"><table><caption>비용 비율과 프로토타입 참고 범위</caption><thead><tr><th scope="col">항목</th><th scope="col">계산 비율</th><th scope="col">상태</th><th scope="col">참고 범위</th></tr></thead><tbody>${benchmarks}</tbody></table></div>`;
}

export function renderFinancialAnalysis(analysis, path) {
  if (!analysis) return '<h2 id="financial-title" tabindex="-1">재무 분석 결과</h2><p>사업 정보를 입력하고 분석을 실행하세요.</p>';
  return `<h2 id="financial-title" tabindex="-1">신고값과 계산값 비교</h2>${path === 'OPERATING' ? operatingResult(analysis) : startupResult(analysis)}<p class="benchmark-disclosure" data-benchmark-disclosure><strong>프로토타입 참고 범위:</strong> ${escapeHtml(analysis.benchmarkDisclosure)}</p>`;
}
