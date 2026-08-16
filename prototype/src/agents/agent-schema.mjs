const EXPERTS = new Set(['MARKET', 'OPERATIONS', 'FINANCE', 'POLICY']);
const CONFIDENCE_LEVELS = new Set(['HIGH', 'MEDIUM', 'LOW']);

export const EXPERT_OPINION_REQUIRED_FIELDS = Object.freeze([
  'expert',
  'claims',
  'assumptions',
  'uncertainty',
  'actions',
  'escalation',
]);
export const EXPERT_CLAIM_REQUIRED_FIELDS = Object.freeze([
  'code',
  'statement',
  'evidenceIds',
  'confidence',
]);
export const EXPERT_NOTE_REQUIRED_FIELDS = Object.freeze(['code', 'detail']);
export const EXPERT_NOTE_OPTIONAL_FIELDS = Object.freeze(['evidenceIds']);
export const ACTION_REQUIRED_FIELDS = Object.freeze(['code', 'title', 'evidenceIds']);
export const SUPERVISOR_REQUIRED_FIELDS = Object.freeze([
  'summary',
  'priorityActions',
  'conflicts',
  'assumptions',
  'uncertainty',
  'handoff',
]);
export const SUPERVISOR_CONFLICT_REQUIRED_FIELDS = Object.freeze([
  'code',
  'experts',
  'actionCodes',
  'evidenceIds',
  'resolution',
]);
export const HANDOFF_REQUIRED_FIELDS = Object.freeze(['recommended', 'reasons']);
export const FORBIDDEN_OUTPUT_FIELDS = Object.freeze([
  'chainOfThought',
  'hiddenReasoning',
  'policyId',
  'officialUrl',
  'numericValue',
  'sensitiveData',
]);

const ACTION_CODES_BY_EXPERT = Object.freeze({
  MARKET: new Set(['VALIDATE_PREFERRED_SITE', 'COMPARE_SITE_SCENARIOS', 'REFRESH_MARKET_DATA']),
  OPERATIONS: new Set(['CHECK_OPERATING_READINESS', 'STABILIZE_OPERATIONS', 'REVIEW_OPERATING_PERFORMANCE']),
  FINANCE: new Set([
    'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT',
    'RESERVE_RECOMMENDED_BUFFER',
    'ADDRESS_CASH_SHORTFALL',
    'MONITOR_OPERATING_CASHFLOW',
    'REQUEST_FINANCE_COUNSEL',
  ]),
  POLICY: new Set(['VERIFY_POLICY_ELIGIBILITY', 'REVIEW_POLICY_MATCHES', 'CHECK_OFFICIAL_NOTICE']),
});

const URL_PATTERN = /(?:https?:\/\/|www\.)/iu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE_PATTERN = /(?:\+?82[-\s]?)?0?1[016789][-\s]?\d{3,4}[-\s]?\d{4}/u;
const ACCOUNT_PATTERN = /\b\d{2,4}[-\s]\d{2,6}[-\s]\d{4,8}\b/u;
const RESIDENT_ID_PATTERN = /\b\d{6}[-\s]?[1-4]\d{6}\b/u;
const NUMERIC_CLAIM_PATTERN = /\d/u;
const KOREAN_DIGIT_WORDS = '\uc601\uacf5\uc77c\uc774\uc0bc\uc0ac\uc624\uc721\uce60\ud314\uad6c';
const KOREAN_MAGNITUDE_WORDS = '\uc2ed\ubc31\ucc9c\ub9cc\uc5b5\uc870';
const KOREAN_NUMERIC_CLAIM_PATTERN = new RegExp(
  `(?<![\uac00-\ud7a3])(?:[${KOREAN_DIGIT_WORDS}]*[${KOREAN_MAGNITUDE_WORDS}][${KOREAN_DIGIT_WORDS}${KOREAN_MAGNITUDE_WORDS}]*\\s*|[${KOREAN_DIGIT_WORDS}]\\s+)(?:\uc6d0|\ud37c\uc13c\ud2b8|\ud504\ub85c|\uac1c\uc6d4|\uc77c|\uba85)(?=$|[\\s.,!?;:)\\]}]|[\uc740\ub294\uc774\uac00\uc744\ub97c\uc758]|\uc73c\ub85c|\uc5d0\uc11c|\ubd80\ud130|\uae4c\uc9c0|\ub9c8\ub2e4|\ub2f9|\uc9dc\ub9ac|\uc785\ub2c8\ub2e4|\uc774\ub2e4|\uc774\uace0|\uc774\uba70|\uc815\ub3c4|\uac00\ub7c9|\ud544\uc694|\uc608\uc0c1)`,
  'u',
);
const POLICY_IDENTIFIER_PATTERN = /\b(?:POLICY|PROGRAM|FUND)[-_][A-Z0-9_-]+\b/iu;
const SENSITIVE_IDENTITY_CONTEXT_PATTERN = /(?:\uace0\uac1d|\ub300\ud45c|\uc2e0\uccad\uc778|\uc0ac\uc6a9\uc790)\s*(?:\uc758\s*)?(?:\uc774\ub984|\uc131\uba85)/u;
const APPROVAL_GUARANTEE_PATTERN = /(?:guaranteed\s+approval|approval\s+(?:is\s+)?guaranteed|will\s+be\s+approved|approved\s+for|\ubb34\uc870\uac74\s*(?:\uc9c0\uc6d0|\uc2b9\uc778|\uc9c0\uae09|\uc218\ub839|\ubc1b)|\ubc18\ub4dc\uc2dc\s*(?:\uc2b9\uc778|\uc9c0\uae09|\uc218\ub839|\ubc1b)|\uc2b9\uc778(?:\uc774|\uc740|\uc744)?\s*(?:\ud655정|\ubcf4\uc7a5|\ub429\ub2c8\ub2e4)|\uc9c0\uc6d0\uae08\s*\uc218\ub839\s*(?:\ud655정|\ubcf4\uc7a5))/iu;

function assertRecord(value, fieldName) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
}

function assertExactKeys(value, required, optional, fieldName) {
  assertRecord(value, fieldName);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${fieldName} has unknown field: ${unknown}`);
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new TypeError(`${fieldName} is missing required field: ${missing}`);
}

function assertNoNonFinite(value, path = 'value') {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`${path} must contain only finite numbers`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoNonFinite(item, `${path}[${index}]`));
  } else if (value != null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assertNoNonFinite(nested, `${path}.${key}`);
    }
  }
}

function assertCode(value, fieldName) {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]*$/u.test(value)) {
    throw new TypeError(`${fieldName} must be an uppercase code`);
  }
}

function assertNarrative(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  if (
    EMAIL_PATTERN.test(value)
    || PHONE_PATTERN.test(value)
    || ACCOUNT_PATTERN.test(value)
    || RESIDENT_ID_PATTERN.test(value)
    || SENSITIVE_IDENTITY_CONTEXT_PATTERN.test(value)
  ) {
    throw new TypeError(`${fieldName} contains a sensitive string`);
  }
  if (URL_PATTERN.test(value)) throw new TypeError(`${fieldName} contains a direct URL`);
  if (POLICY_IDENTIFIER_PATTERN.test(value)) throw new TypeError(`${fieldName} contains a direct policy identifier`);
  if (NUMERIC_CLAIM_PATTERN.test(value) || KOREAN_NUMERIC_CLAIM_PATTERN.test(value)) {
    throw new TypeError(`${fieldName} contains an unregistered numeric claim`);
  }
  if (APPROVAL_GUARANTEE_PATTERN.test(value)) {
    throw new TypeError(`${fieldName} contains an approval or guarantee claim`);
  }
}

function allowedEvidenceSet(allowedEvidenceIds) {
  if (!Array.isArray(allowedEvidenceIds) || allowedEvidenceIds.some((id) => typeof id !== 'string')) {
    throw new TypeError('allowedEvidenceIds must be an array of strings');
  }
  return new Set(allowedEvidenceIds);
}

function assertEvidenceIds(value, registry, fieldName, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${fieldName} must contain evidence IDs`);
  }
  for (const evidenceId of value) {
    if (typeof evidenceId !== 'string' || !registry.has(evidenceId)) {
      throw new TypeError(`${fieldName} contains unknown evidence ID: ${String(evidenceId)}`);
    }
  }
}

function validateClaim(claim, registry, index) {
  const fieldName = `claims[${index}]`;
  assertExactKeys(claim, EXPERT_CLAIM_REQUIRED_FIELDS, [], fieldName);
  assertCode(claim.code, `${fieldName}.code`);
  assertNarrative(claim.statement, `${fieldName}.statement`);
  assertEvidenceIds(claim.evidenceIds, registry, `${fieldName}.evidenceIds`);
  if (!CONFIDENCE_LEVELS.has(claim.confidence)) {
    throw new TypeError(`${fieldName}.confidence must be HIGH, MEDIUM, or LOW`);
  }
}

function validateNote(note, registry, fieldName) {
  assertExactKeys(note, EXPERT_NOTE_REQUIRED_FIELDS, EXPERT_NOTE_OPTIONAL_FIELDS, fieldName);
  assertCode(note.code, `${fieldName}.code`);
  assertNarrative(note.detail, `${fieldName}.detail`);
  if (Object.hasOwn(note, 'evidenceIds')) {
    assertEvidenceIds(note.evidenceIds, registry, `${fieldName}.evidenceIds`);
  }
}

function validateAction(action, registry, allowedActionCodes, fieldName) {
  assertExactKeys(action, ACTION_REQUIRED_FIELDS, [], fieldName);
  assertCode(action.code, `${fieldName}.code`);
  if (!allowedActionCodes.has(action.code)) {
    throw new TypeError(`${fieldName} contains unknown action code: ${action.code}`);
  }
  assertNarrative(action.title, `${fieldName}.title`);
  assertEvidenceIds(action.evidenceIds, registry, `${fieldName}.evidenceIds`);
}

export function validateExpertOpinion(value, allowedEvidenceIds) {
  assertNoNonFinite(value);
  assertExactKeys(
    value,
    EXPERT_OPINION_REQUIRED_FIELDS,
    [],
    'expert opinion',
  );
  if (!EXPERTS.has(value.expert)) throw new TypeError(`Unknown expert: ${String(value.expert)}`);
  if (!Array.isArray(value.claims) || value.claims.length === 0) {
    throw new TypeError('claims must contain at least one claim');
  }
  for (const field of ['assumptions', 'uncertainty', 'actions']) {
    if (!Array.isArray(value[field])) throw new TypeError(`${field} must be an array`);
  }
  if (typeof value.escalation !== 'boolean') throw new TypeError('escalation must be a boolean');

  const registry = allowedEvidenceSet(allowedEvidenceIds);
  value.claims.forEach((claim, index) => validateClaim(claim, registry, index));
  value.assumptions.forEach((note, index) => validateNote(note, registry, `assumptions[${index}]`));
  value.uncertainty.forEach((note, index) => validateNote(note, registry, `uncertainty[${index}]`));
  value.actions.forEach((action, index) => (
    validateAction(action, registry, ACTION_CODES_BY_EXPERT[value.expert], `actions[${index}]`)
  ));
  return value;
}

function validateConflict(conflict, registry, actionCodes, index) {
  const fieldName = `conflicts[${index}]`;
  assertExactKeys(
    conflict,
    SUPERVISOR_CONFLICT_REQUIRED_FIELDS,
    [],
    fieldName,
  );
  assertCode(conflict.code, `${fieldName}.code`);
  if (!Array.isArray(conflict.experts) || conflict.experts.length < 2 || conflict.experts.some((expert) => !EXPERTS.has(expert))) {
    throw new TypeError(`${fieldName}.experts must contain known experts`);
  }
  if (!Array.isArray(conflict.actionCodes) || conflict.actionCodes.some((code) => !actionCodes.has(code))) {
    throw new TypeError(`${fieldName} contains unknown action code`);
  }
  assertEvidenceIds(conflict.evidenceIds, registry, `${fieldName}.evidenceIds`);
  assertNarrative(conflict.resolution, `${fieldName}.resolution`);
}

export function validateSupervisorProposal(value, allowedEvidenceIds, allowedActionCodes) {
  assertNoNonFinite(value);
  assertExactKeys(
    value,
    SUPERVISOR_REQUIRED_FIELDS,
    [],
    'supervisor proposal',
  );
  assertNarrative(value.summary, 'summary');
  if (!Array.isArray(value.priorityActions) || value.priorityActions.length > 3) {
    throw new TypeError('priorityActions must contain a maximum of three actions');
  }
  for (const field of ['conflicts', 'assumptions', 'uncertainty']) {
    if (!Array.isArray(value[field])) throw new TypeError(`${field} must be an array`);
  }
  if (!Array.isArray(allowedActionCodes) || allowedActionCodes.some((code) => typeof code !== 'string')) {
    throw new TypeError('allowedActionCodes must be an array of strings');
  }

  const registry = allowedEvidenceSet(allowedEvidenceIds);
  const actionCodes = new Set(allowedActionCodes);
  value.priorityActions.forEach((action, index) => (
    validateAction(action, registry, actionCodes, `priorityActions[${index}]`)
  ));
  value.conflicts.forEach((conflict, index) => validateConflict(conflict, registry, actionCodes, index));
  value.assumptions.forEach((note, index) => validateNote(note, registry, `assumptions[${index}]`));
  value.uncertainty.forEach((note, index) => validateNote(note, registry, `uncertainty[${index}]`));

  assertExactKeys(value.handoff, HANDOFF_REQUIRED_FIELDS, [], 'handoff');
  if (typeof value.handoff.recommended !== 'boolean') throw new TypeError('handoff.recommended must be a boolean');
  if (!Array.isArray(value.handoff.reasons)) throw new TypeError('handoff.reasons must be an array');
  value.handoff.reasons.forEach((reason) => assertCode(reason, 'handoff.reasons[]'));
  return value;
}

export const KNOWN_EXPERTS = Object.freeze([...EXPERTS]);
export const EXPERT_ACTION_CODES = Object.freeze(
  Object.fromEntries(Object.entries(ACTION_CODES_BY_EXPERT).map(([expert, codes]) => [expert, Object.freeze([...codes])])),
);
