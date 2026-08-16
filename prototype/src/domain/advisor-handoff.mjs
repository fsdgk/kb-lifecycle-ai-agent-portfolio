const SENSITIVE_KEY = /name|number|account|payment|transaction|memo|counterparty|identity|personal|contact|email|phone|address|iban|swift|routing|beneficiary|passport|ssn|card(?:pan|number)?|txn|(?:user|customer|member|person|holder)[_-]?(?:id|identifier)/i;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const GROUPED_NUMBER_VALUE = /\b\d{2,6}(?:[- ]\d{2,6}){2,4}\b/g;
const CARD_VALUE = /\b\d{13,19}\b/g;

function passesLuhn(value) {
  let sum = 0;
  let doubleDigit = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function hasSensitiveStringValue(value) {
  if (EMAIL_VALUE.test(value)) return true;
  if ([...value.matchAll(CARD_VALUE)].some(([candidate]) => passesLuhn(candidate))) return true;

  return [...value.matchAll(GROUPED_NUMBER_VALUE)].some(([candidate]) => {
    const digits = candidate.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 19;
  });
}

function assertNoSensitiveKeys(value) {
  if (typeof value === 'string') {
    if (hasSensitiveStringValue(value)) throw new TypeError('HANDOFF_PAYLOAD_UNSAFE');
    return;
  }
  if (value == null || typeof value !== 'object') return;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new TypeError('HANDOFF_PAYLOAD_UNSAFE');
    }
    assertNoSensitiveKeys(nestedValue);
  }
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function projectStrings(value, fields) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(fields
    .filter((field) => typeof value[field] === 'string')
    .map((field) => [field, value[field]]));
}

function projectStringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function projectCodedItems(items, fields) {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => isRecord(item) && typeof item.code === 'string')
    .map((item) => projectStrings(item, ['code', ...fields]));
}

function projectActions(actions) {
  if (!Array.isArray(actions)) return [];

  return actions
    .filter((action) => isRecord(action) && typeof action.code === 'string')
    .map((action) => ({
      ...projectStrings(action, ['code', 'title', 'severity', 'immediacy', 'expert']),
      evidenceIds: projectStringList(action.evidenceIds),
    }));
}

function projectExpertOpinions(opinions) {
  if (!Array.isArray(opinions)) return [];

  return opinions
    .filter((opinion) => isRecord(opinion) && typeof opinion.expert === 'string')
    .map((opinion) => ({
      expert: opinion.expert,
      claims: projectCodedItems(opinion.claims, ['statement']),
      evidenceIds: projectStringList(opinion.evidenceIds),
      assumptions: projectCodedItems(opinion.assumptions, ['detail']),
      uncertainty: projectCodedItems(opinion.uncertainty, ['detail']),
      actions: projectActions(opinion.actions),
      escalation: opinion.escalation === true,
    }));
}

function projectPolicyEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .filter(isRecord)
    .map((item) => projectStrings(item, ['officialUrl', 'verifiedAt']));
}

function projectPolicyCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];
  return candidates
    .filter((candidate) => isRecord(candidate) && typeof candidate.policyId === 'string')
    .map((candidate) => ({
      ...projectStrings(candidate, ['policyId', 'eligibility', 'officialUrl', 'verifiedAt']),
      evidence: projectPolicyEvidence(candidate.evidence),
    }));
}

function projectCalculationEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .filter((item) => isRecord(item) && typeof item.id === 'string')
    .map((item) => {
      const projection = projectStrings(item, ['id', 'source', 'kind', 'unit', 'asOf']);
      if (Number.isFinite(item.value)) projection.value = item.value;
      return projection;
    });
}

function projectUnverifiedItems(items) {
  return projectCodedItems(items, ['expert', 'detail']);
}

function calculationEvidence(council) {
  if (Array.isArray(council.calculationEvidence)) return council.calculationEvidence;

  return (Array.isArray(council.evidence) ? council.evidence : []).filter((item) => (
    item?.kind === 'DETERMINISTIC_CALCULATION' || item?.kind === 'DETERMINISTIC_CASHFLOW_FORECAST'
  ));
}

function policyCandidates(council) {
  if (Array.isArray(council.policyCandidates)) return council.policyCandidates;
  return Array.isArray(council.policies) ? council.policies : [];
}

function unverifiedItems(council) {
  if (Array.isArray(council.unverifiedItems)) return council.unverifiedItems;
  return Array.isArray(council.uncertainty) ? council.uncertainty : [];
}

export function buildAdvisorHandoff(council = {}, consent = {}) {
  if (consent?.approved !== true) {
    throw new Error('CONSENT_REQUIRED');
  }

  assertNoSensitiveKeys(council);
  const packet = {
    summary: typeof council.summary === 'string'
      ? council.summary
      : 'No council summary was provided; advisor review should rely on the listed evidence and open items.',
    dataAsOf: typeof council.dataAsOf === 'string' ? council.dataAsOf : null,
    expertOpinions: projectExpertOpinions(council.expertOpinions ?? council.opinions),
    policyCandidates: projectPolicyCandidates(policyCandidates(council)),
    calculationEvidence: projectCalculationEvidence(calculationEvidence(council)),
    unverifiedItems: projectUnverifiedItems(unverifiedItems(council)),
    customerQuestion: typeof (council.customerQuestion ?? council.question) === 'string'
      ? (council.customerQuestion ?? council.question)
      : null,
  };

  assertNoSensitiveKeys(packet);
  return packet;
}
