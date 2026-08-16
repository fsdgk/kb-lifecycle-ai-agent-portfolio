const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const officialLink = (url) => /^https:\/\//.test(String(url)) ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" data-official-policy-link>공식 원문 열기</a>` : '공식 원문 없음';

export function policyMatches(analysis) {
  return Array.isArray(analysis?.policies) ? analysis.policies : [];
}

export function renderPolicies(policies = []) {
  const rows = policies.map((policy) => `<tr>
    <td><strong>${escapeHtml(policy.title ?? policy.policyId)}</strong><br><span class="muted">${escapeHtml(policy.institution ?? policy.policyId)}</span></td>
    <td>${escapeHtml(policy.eligibility ?? policy.status ?? '-')}</td>
    <td>${escapeHtml(policy.verifiedAt ?? '-')}</td>
    <td>${escapeHtml((policy.requiredChecks ?? []).join(', ') || '-')}</td>
    <td>${officialLink(policy.officialUrl)}</td>
  </tr>`).join('');
  return `<h2 id="policy-title">정책 후보 비교</h2>
    <p>후보는 승인이나 수급을 뜻하지 않습니다. 공식 원문에서 자격·접수기간·예산을 확인하세요.</p>
    <details data-policy-comparison><summary>정책 후보 비교 열기</summary>
      <div class="table-wrap"><table><thead><tr><th scope="col">후보</th><th scope="col">판정</th><th scope="col">확인일</th><th scope="col">확인할 사항</th><th scope="col">공식 링크</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">현재 질문과 일치하는 정책 후보가 없습니다.</td></tr>'}</tbody></table></div>
    </details>`;
}
