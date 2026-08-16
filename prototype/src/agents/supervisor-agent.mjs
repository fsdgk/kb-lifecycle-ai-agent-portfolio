import { buildSupervisorPrompt } from './prompts.mjs';
import { EXPERT_ACTION_CODES } from './agent-schema.mjs';
import {
  DYNAMIC_EXPERT_ACTION_CODES,
  DYNAMIC_EXPERT_CLAIM_CODES,
} from '../orchestration/opinion-verifier.mjs';

const actionCodes = Object.freeze([...new Set(Object.values(EXPERT_ACTION_CODES).flat())]);
const claimCodes = Object.freeze([...new Set(Object.values(DYNAMIC_EXPERT_CLAIM_CODES).flat())]);

export const supervisorAgent = Object.freeze({
  expert: 'SUPERVISOR',
  promptVersion: 'supervisor-v1',
  allowedDomains: Object.freeze(['CONTEXT', 'MARKET', 'OPERATIONS', 'FINANCE', 'POLICY']),
  claimCodes,
  actionCodes: Object.freeze([...new Set(Object.values(DYNAMIC_EXPERT_ACTION_CODES).flat())]),
  buildInput({ verifiedOpinions, evidence }) {
    const usedActionCodes = [...new Set(verifiedOpinions.flatMap((opinion) => opinion.actions.map((action) => action.code)))]
      .filter((code) => actionCodes.includes(code));
    return buildSupervisorPrompt({ verifiedOpinions, allowedActionCodes: usedActionCodes, evidence });
  },
});

export default supervisorAgent;
