import {
  ACTION_REQUIRED_FIELDS,
  EXPERT_ACTION_CODES,
  EXPERT_CLAIM_REQUIRED_FIELDS,
  EXPERT_NOTE_OPTIONAL_FIELDS,
  EXPERT_NOTE_REQUIRED_FIELDS,
  EXPERT_OPINION_REQUIRED_FIELDS,
  FORBIDDEN_OUTPUT_FIELDS,
  HANDOFF_REQUIRED_FIELDS,
  KNOWN_EXPERTS,
  SUPERVISOR_CONFLICT_REQUIRED_FIELDS,
  SUPERVISOR_REQUIRED_FIELDS,
} from './agent-schema.mjs';

const EXPERT_SYSTEM_PROMPT = `You are one specialist in a protected small-business advisory service.
Return JSON only and follow the provided expert opinion contract exactly.
Use only the supplied evidence IDs. Never invent a policy, URL, eligibility result, number, or action code.
Do not output or store chain-of-thought, hidden reasoning, personal data, raw financial data, or approval guarantees.
Put concise conclusions in claims and make uncertainty explicit.`;

const SUPERVISOR_SYSTEM_PROMPT = `You are the supervisor of four small-business specialists.
Return JSON only and follow the provided supervisor proposal contract exactly.
Use only verified opinions, supplied evidence IDs, and allowed action codes.
Select a maximum of three priority actions. Never invent a policy, URL, eligibility result, number, or action.
Do not output or store chain-of-thought, hidden reasoning, personal data, raw financial data, or approval guarantees.`;

function assertRecord(value, fieldName) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
}

function evidenceIds(evidence) {
  if (!Array.isArray(evidence)) throw new TypeError('evidence must be an array');
  return evidence.map((item, index) => {
    assertRecord(item, `evidence[${index}]`);
    if (typeof item.id !== 'string' || item.id.length === 0) {
      throw new TypeError(`evidence[${index}].id must be a non-empty string`);
    }
    return item.id;
  });
}

function evidenceIdContract(allowedEvidenceIds) {
  return { type: 'string', enum: [...allowedEvidenceIds] };
}

function noteContract(allowedEvidenceIds) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...EXPERT_NOTE_REQUIRED_FIELDS],
    properties: {
      code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' },
      detail: { type: 'string', minLength: 1 },
      evidenceIds: { type: 'array', minItems: 1, items: evidenceIdContract(allowedEvidenceIds) },
    },
    optional: [...EXPERT_NOTE_OPTIONAL_FIELDS],
  };
}

function actionContract(allowedActionCodes, allowedEvidenceIds) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...ACTION_REQUIRED_FIELDS],
    properties: {
      code: { type: 'string', enum: [...allowedActionCodes] },
      title: { type: 'string', minLength: 1 },
      evidenceIds: { type: 'array', minItems: 1, items: evidenceIdContract(allowedEvidenceIds) },
    },
  };
}

function expertOutputContract(expert, allowedActionCodes, allowedEvidenceIds, allowedClaimCodes) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...EXPERT_OPINION_REQUIRED_FIELDS],
    forbiddenFields: [...FORBIDDEN_OUTPUT_FIELDS],
    properties: {
      expert: { const: expert },
      claims: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...EXPERT_CLAIM_REQUIRED_FIELDS],
          properties: {
            code: allowedClaimCodes == null
              ? { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' }
              : { type: 'string', enum: [...allowedClaimCodes] },
            statement: { type: 'string', minLength: 1 },
            evidenceIds: { type: 'array', minItems: 1, items: evidenceIdContract(allowedEvidenceIds) },
            confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          },
        },
      },
      assumptions: { type: 'array', items: noteContract(allowedEvidenceIds) },
      uncertainty: { type: 'array', items: noteContract(allowedEvidenceIds) },
      actions: { type: 'array', items: actionContract(allowedActionCodes, allowedEvidenceIds) },
      escalation: { type: 'boolean' },
    },
  };
}

function supervisorOutputContract(allowedActionCodes, allowedEvidenceIds) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...SUPERVISOR_REQUIRED_FIELDS],
    forbiddenFields: [...FORBIDDEN_OUTPUT_FIELDS],
    properties: {
      summary: { type: 'string', minLength: 1 },
      priorityActions: {
        type: 'array',
        maxItems: 3,
        items: actionContract(allowedActionCodes, allowedEvidenceIds),
      },
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...SUPERVISOR_CONFLICT_REQUIRED_FIELDS],
          properties: {
            code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' },
            experts: { type: 'array', minItems: 2, items: { type: 'string', enum: [...KNOWN_EXPERTS] } },
            actionCodes: { type: 'array', items: { type: 'string', enum: [...allowedActionCodes] } },
            evidenceIds: { type: 'array', minItems: 1, items: evidenceIdContract(allowedEvidenceIds) },
            resolution: { type: 'string', minLength: 1 },
          },
        },
      },
      assumptions: { type: 'array', items: noteContract(allowedEvidenceIds) },
      uncertainty: { type: 'array', items: noteContract(allowedEvidenceIds) },
      handoff: {
        type: 'object',
        additionalProperties: false,
        required: [...HANDOFF_REQUIRED_FIELDS],
        properties: {
          recommended: { type: 'boolean' },
          reasons: { type: 'array', items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' } },
        },
      },
    },
  };
}

export function buildExpertPrompt({ expert, evidence, allowedClaimCodes, allowedActionCodes }) {
  if (!KNOWN_EXPERTS.includes(expert)) throw new TypeError(`Unknown expert: ${String(expert)}`);
  if (allowedClaimCodes != null && (!Array.isArray(allowedClaimCodes) || allowedClaimCodes.some((code) => typeof code !== 'string'))) {
    throw new TypeError('allowedClaimCodes must be an array of strings');
  }
  if (allowedActionCodes != null && (!Array.isArray(allowedActionCodes) || allowedActionCodes.some((code) => typeof code !== 'string'))) {
    throw new TypeError('allowedActionCodes must be an array of strings');
  }
  const resolvedActionCodes = allowedActionCodes ?? EXPERT_ACTION_CODES[expert];
  if (resolvedActionCodes.some((code) => !EXPERT_ACTION_CODES[expert].includes(code))) {
    throw new TypeError(`allowedActionCodes contains a code outside the ${expert} registry`);
  }
  const allowedEvidenceIds = evidenceIds(evidence);
  return {
    system: EXPERT_SYSTEM_PROMPT,
    input: {
      expert,
      allowedEvidenceIds,
      ...(allowedClaimCodes == null ? {} : { allowedClaimCodes: [...allowedClaimCodes] }),
      allowedActionCodes: [...resolvedActionCodes],
      outputContract: expertOutputContract(expert, resolvedActionCodes, allowedEvidenceIds, allowedClaimCodes),
      evidence: structuredClone(evidence),
    },
  };
}

export function buildSupervisorPrompt({ verifiedOpinions, allowedActionCodes, evidence }) {
  if (!Array.isArray(verifiedOpinions)) throw new TypeError('verifiedOpinions must be an array');
  if (!Array.isArray(allowedActionCodes) || allowedActionCodes.some((code) => typeof code !== 'string')) {
    throw new TypeError('allowedActionCodes must be an array of strings');
  }
  const allowedEvidenceIds = evidenceIds(evidence);
  return {
    system: SUPERVISOR_SYSTEM_PROMPT,
    input: {
      verifiedOpinions: structuredClone(verifiedOpinions),
      allowedEvidenceIds,
      allowedActionCodes: [...allowedActionCodes],
      outputContract: supervisorOutputContract(allowedActionCodes, allowedEvidenceIds),
      evidence: structuredClone(evidence),
    },
  };
}

export const PROMPT_VERSIONS = Object.freeze({ expert: 'expert-v1', supervisor: 'supervisor-v1' });
