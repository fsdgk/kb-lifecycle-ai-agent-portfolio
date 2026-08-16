import { renderMarketIntegrationCategories } from './market-integrations.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function applyImmediateAlert(target, alert) {
  target.hidden = false;
  target.textContent = `즉시 알림: ${alert.message}`;
}

export function renderMarket(market = {}, eventAlert) {
  const alertNote = eventAlert ? `<p class="alert">즉시 알림: ${escapeHtml(eventAlert.message)}</p>` : '';
  if (market.status === 'PLANNED_INTEGRATION') {
    const placeholders = ['하방', '기준', '상방'].map((label) => (
      `<div data-market-placeholder><strong>${label}</strong><span>연동 예정</span></div>`
    )).join('');
    return `<h2 id="market-title">시장 전망</h2>
      <p class="metric-note">연동 상태: <strong data-market-status="PLANNED_INTEGRATION">PLANNED_INTEGRATION</strong></p>
      <p>외부 실시간 시장 데이터 제공자는 아직 연결되지 않았습니다. 아래 항목은 연동 예정이며 실제 시나리오 수치가 아닙니다.</p>
      <div class="scenario-grid" aria-label="시장 데이터 연동 예정">${placeholders}</div>
      ${renderMarketIntegrationCategories(market.categories)}
      ${alertNote}`;
  }
  const scenarios = market.scenarios ?? {};
  const cards = ['downside', 'baseline', 'upside'].map((name) => {
    const scenario = scenarios[name] ?? {};
    return `<div><strong>${escapeHtml(name === 'downside' ? '하방' : name === 'baseline' ? '기준' : '상방')}</strong><span>지수 ${escapeHtml(scenario.index ?? '-')}</span></div>`;
  }).join('');
  return `<h2 id="market-title">시장 전망</h2>
    <div class="scenario-grid" data-market-scenarios>${cards}</div>
    <p class="metric-note">신뢰도: ${escapeHtml(market.confidence?.level ?? '-')} · ${escapeHtml(market.dataDisclosure ?? '')}</p>
    ${alertNote}
    <details><summary>자세히 보기</summary><dl class="evidence-grid">
      <dt>근거 출처</dt><dd>${escapeHtml((market.drivers ?? []).map((item) => item.source).filter(Boolean).join(', ') || '제공된 시장 신호')}</dd>
      <dt>출처 기준일</dt><dd>${escapeHtml((market.drivers ?? []).map((item) => item.asOf).filter(Boolean).join(', ') || '-')}</dd>
      <dt>계산 경로</dt><dd>시장 신호 → 시나리오 지수</dd>
      <dt>불확실성</dt><dd>${escapeHtml(market.confidence?.rationale ?? '시장 입력의 최신성과 범위를 확인해야 합니다.')}</dd>
    </dl></details>`;
}
