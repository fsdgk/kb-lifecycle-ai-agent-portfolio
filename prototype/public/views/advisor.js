export function canRequestAdvisor(consentApproved, council) {
  return consentApproved === true && council != null;
}

export function renderAdvisor(council = {}, handoff) {
  const recommendation = (council.handoffRecommended || council.handoff?.recommended)
    ? '전문가 검토를 권장하는 신호가 있습니다.'
    : '현재 근거만으로는 전문가 연결이 필수는 아닙니다.';
  const result = handoff ? '<p class="status-message" role="status" data-consultation-recorded>동의한 상담 요청을 기록했습니다. 이 프로토타입에서는 외부로 전송하지 않습니다.</p>' : '';
  return `<h2 id="advisor-title">전문가 연결</h2>
    <p>${recommendation} 연결 전에는 전달 범위에 명시적으로 동의해야 합니다.</p>
    <button type="button" data-action="open-advisor-consent">동의 범위 확인</button>${result}
    <dialog id="advisor-consent-dialog" aria-labelledby="advisor-consent-title">
      <h3 id="advisor-consent-title">전문가 연결 동의</h3>
      <p>전달 범위를 확인하고 동의한 뒤에만 전문가 연결을 요청할 수 있습니다.</p>
      <label class="consent-row"><input id="advisor-consent" type="checkbox"> <span>전문가 검토를 위해 현재 분석의 비식별 근거와 미확인 항목을 전달하는 데 동의합니다.</span></label>
      <div class="dialog-actions">
        <button id="advisor-submit" type="button" data-advisor-action disabled>전문가 연결 요청</button>
        <button type="button" class="secondary-button" data-action="close-advisor-consent">닫기</button>
      </div>
    </dialog>`;
}
