import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateExpertOpinion,
  validateSupervisorProposal,
} from '../src/agents/agent-schema.mjs';
import { buildExpertPrompt, buildSupervisorPrompt } from '../src/agents/prompts.mjs';
import { defineModelGateway } from '../src/model/model-gateway-contract.mjs';

const allowedEvidenceIds = [
  'calculation.finance.funding-gap',
  'policy.seoul-credit-guarantee.eligibility',
];

function validExpertOpinion(overrides = {}) {
  return {
    expert: 'FINANCE',
    claims: [{
      code: 'FUNDING_GAP_EXISTS',
      statement: '계산 결과 자금 부족을 해소한 후 계약해야 합니다.',
      evidenceIds: ['calculation.finance.funding-gap'],
      confidence: 'HIGH',
    }],
    assumptions: [],
    uncertainty: [],
    actions: [{
      code: 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT',
      title: '자금 조달 계획을 확정합니다.',
      evidenceIds: ['calculation.finance.funding-gap'],
    }],
    escalation: true,
    ...overrides,
  };
}

function validSupervisorProposal(overrides = {}) {
  return {
    summary: '검증된 자금 부족 근거를 먼저 해소해야 합니다.',
    priorityActions: [{
      code: 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT',
      title: '자금 조달 계획을 확정합니다.',
      evidenceIds: ['calculation.finance.funding-gap'],
    }],
    conflicts: [],
    assumptions: [],
    uncertainty: [],
    handoff: { recommended: true, reasons: ['LARGE_FUNDING_GAP'] },
    ...overrides,
  };
}

test('expert contract accepts a strict evidence-backed opinion', () => {
  const opinion = validExpertOpinion();

  assert.equal(validateExpertOpinion(opinion, allowedEvidenceIds), opinion);
});

test('expert contract rejects unknown fields at every schema level', () => {
  assert.throws(
    () => validateExpertOpinion(validExpertOpinion({ secretReasoning: 'hidden' }), allowedEvidenceIds),
    /unknown field/i,
  );

  const opinion = validExpertOpinion();
  opinion.claims[0].extra = true;
  assert.throws(() => validateExpertOpinion(opinion, allowedEvidenceIds), /unknown field/i);
});

test('expert contract rejects evidence and action codes outside their registries', () => {
  const inventedEvidence = validExpertOpinion();
  inventedEvidence.claims[0].evidenceIds = ['policy.invented'];
  assert.throws(() => validateExpertOpinion(inventedEvidence, allowedEvidenceIds), /evidence/i);

  const inventedAction = validExpertOpinion();
  inventedAction.actions[0].code = 'APPROVE_LOAN_NOW';
  assert.throws(() => validateExpertOpinion(inventedAction, allowedEvidenceIds), /action code/i);
});

test('expert contract rejects direct policy identifiers, URLs, and numeric claims', () => {
  for (const statement of [
    'POLICY-FAKE-001 정책을 신청하세요.',
    'https://example.test/fake 공고를 확인하세요.',
    '자금 부족은 30,000,000원입니다.',
  ]) {
    const opinion = validExpertOpinion();
    opinion.claims[0].statement = statement;
    assert.throws(() => validateExpertOpinion(opinion, allowedEvidenceIds), /policy|url|numeric/i);
  }
});

test('expert contract rejects sensitive strings and approval guarantees', () => {
  for (const statement of [
    '고객 이메일은 owner@example.com입니다.',
    '계좌번호는 110-123-456789입니다.',
    '이 정책자금은 반드시 승인됩니다.',
    '지원금은 무조건 받을 수 있습니다.',
    '고객 이름은 홍길동입니다.',
  ]) {
    const opinion = validExpertOpinion();
    opinion.claims[0].statement = statement;
    assert.throws(() => validateExpertOpinion(opinion, allowedEvidenceIds), /sensitive|approval|guarantee/i);
  }
});

test('expert contract rejects Korean spelled numeric amounts', () => {
  for (const statement of [
    '자금 부족은 삼천만원입니다.',
    '운영 자금으로 일억 원이 필요합니다.',
    '예상 비용은 삼 원입니다.',
  ]) {
    const opinion = validExpertOpinion();
    opinion.claims[0].statement = statement;
    assert.throws(() => validateExpertOpinion(opinion, allowedEvidenceIds), /numeric/i);
  }
});

test('expert contract allows ordinary Korean words containing number-like syllables', () => {
  for (const statement of [
    '사업이 원활하게 진행됩니다.',
    '방식이 일관됩니다.',
    '이 원칙을 따릅니다.',
    '이 일정은 유효합니다.',
    '설명이 명확합니다.',
  ]) {
    const opinion = validExpertOpinion();
    opinion.claims[0].statement = statement;
    assert.equal(validateExpertOpinion(opinion, allowedEvidenceIds), opinion);
  }
});

test('expert contract rejects non-finite values instead of serializing them', () => {
  const opinion = validExpertOpinion();
  opinion.actions[0].score = Number.NaN;

  assert.throws(() => validateExpertOpinion(opinion, allowedEvidenceIds), /finite|unknown field/i);
});

test('supervisor contract accepts at most three allowlisted evidence-backed actions', () => {
  const proposal = validSupervisorProposal();

  assert.equal(
    validateSupervisorProposal(
      proposal,
      allowedEvidenceIds,
      ['CLOSE_FUNDING_GAP_BEFORE_COMMITMENT'],
    ),
    proposal,
  );
});

test('supervisor contract rejects excess priorities and unknown references', () => {
  const tooMany = validSupervisorProposal({
    priorityActions: Array.from({ length: 4 }, () => ({
      code: 'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT',
      title: '자금 조달 계획을 확정합니다.',
      evidenceIds: ['calculation.finance.funding-gap'],
    })),
  });
  assert.throws(
    () => validateSupervisorProposal(tooMany, allowedEvidenceIds, ['CLOSE_FUNDING_GAP_BEFORE_COMMITMENT']),
    /three|3/i,
  );

  const unknownAction = validSupervisorProposal();
  assert.throws(
    () => validateSupervisorProposal(unknownAction, allowedEvidenceIds, ['REVIEW_POLICY_MATCHES']),
    /action code/i,
  );

  const unknownEvidence = validSupervisorProposal();
  unknownEvidence.priorityActions[0].evidenceIds = ['calculation.unknown'];
  assert.throws(
    () => validateSupervisorProposal(
      unknownEvidence,
      allowedEvidenceIds,
      ['CLOSE_FUNDING_GAP_BEFORE_COMMITMENT'],
    ),
    /evidence/i,
  );
});

test('fixed prompt builders expose only evidence JSON and prohibit hidden reasoning output', () => {
  const expertPrompt = buildExpertPrompt({
    expert: 'FINANCE',
    evidence: [{ id: 'calculation.finance.funding-gap', kind: 'DETERMINISTIC_CALCULATION' }],
  });
  const supervisorPrompt = buildSupervisorPrompt({
    verifiedOpinions: [validExpertOpinion()],
    allowedActionCodes: ['CLOSE_FUNDING_GAP_BEFORE_COMMITMENT'],
    evidence: [{ id: 'calculation.finance.funding-gap', kind: 'DETERMINISTIC_CALCULATION' }],
  });

  assert.match(expertPrompt.system, /JSON only/i);
  assert.match(expertPrompt.system, /do not (?:output|store).*chain-of-thought/i);
  assert.deepEqual(expertPrompt.input.allowedEvidenceIds, ['calculation.finance.funding-gap']);
  assert.deepEqual(expertPrompt.input.allowedActionCodes, [
    'CLOSE_FUNDING_GAP_BEFORE_COMMITMENT',
    'RESERVE_RECOMMENDED_BUFFER',
    'ADDRESS_CASH_SHORTFALL',
    'MONITOR_OPERATING_CASHFLOW',
    'REQUEST_FINANCE_COUNSEL',
  ]);
  assert.equal(expertPrompt.input.outputContract.additionalProperties, false);
  assert.deepEqual(expertPrompt.input.outputContract.required, [
    'expert',
    'claims',
    'assumptions',
    'uncertainty',
    'actions',
    'escalation',
  ]);
  assert.deepEqual(expertPrompt.input.outputContract.properties.claims.items.required, [
    'code',
    'statement',
    'evidenceIds',
    'confidence',
  ]);
  assert.equal(expertPrompt.input.outputContract.properties.claims.items.additionalProperties, false);
  assert.deepEqual(
    expertPrompt.input.outputContract.properties.claims.items.properties.evidenceIds.items.enum,
    ['calculation.finance.funding-gap'],
  );
  assert.deepEqual(expertPrompt.input.outputContract.forbiddenFields, [
    'chainOfThought',
    'hiddenReasoning',
    'policyId',
    'officialUrl',
    'numericValue',
    'sensitiveData',
  ]);
  assert.match(supervisorPrompt.system, /maximum of three/i);
  assert.deepEqual(supervisorPrompt.input.allowedActionCodes, ['CLOSE_FUNDING_GAP_BEFORE_COMMITMENT']);
  assert.equal(supervisorPrompt.input.outputContract.additionalProperties, false);
  assert.equal(supervisorPrompt.input.outputContract.properties.priorityActions.maxItems, 3);
  assert.deepEqual(
    supervisorPrompt.input.outputContract.properties.priorityActions.items.properties.evidenceIds.items.enum,
    ['calculation.finance.funding-gap'],
  );
  assert.deepEqual(supervisorPrompt.input.outputContract.required, [
    'summary',
    'priorityActions',
    'conflicts',
    'assumptions',
    'uncertainty',
    'handoff',
  ]);
  assert.deepEqual(supervisorPrompt.input.outputContract.forbiddenFields, [
    'chainOfThought',
    'hiddenReasoning',
    'policyId',
    'officialUrl',
    'numericValue',
    'sensitiveData',
  ]);
});

test('model gateway helper validates a model-independent generate contract', async () => {
  const gateway = defineModelGateway({
    name: 'stored-chatgpt-results',
    async generate(request) {
      return { requestId: request.requestId, output: { ok: true } };
    },
  });

  assert.deepEqual(
    await gateway.generate({ requestId: 'request-1', role: 'FINANCE', prompt: { system: 'x', input: {} } }),
    { requestId: 'request-1', output: { ok: true } },
  );
  assert.throws(() => defineModelGateway({ name: 'broken' }), /generate/i);
});
