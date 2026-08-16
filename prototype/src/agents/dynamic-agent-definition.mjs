import { buildExpertPrompt } from './prompts.mjs';
import { projectEvidenceForExpert } from '../orchestration/evidence-registry.mjs';
import {
  DYNAMIC_EXPERT_ACTION_CODES,
  DYNAMIC_EXPERT_CLAIM_CODES,
} from '../orchestration/opinion-verifier.mjs';

export function defineDynamicAgent(expert, allowedDomains) {
  const claimCodes = DYNAMIC_EXPERT_CLAIM_CODES[expert];
  const actionCodes = DYNAMIC_EXPERT_ACTION_CODES[expert];
  return Object.freeze({
    expert,
    promptVersion: 'expert-v1',
    allowedDomains: Object.freeze([...allowedDomains]),
    claimCodes,
    actionCodes,
    buildInput({ registry }) {
      return buildExpertPrompt({
        expert,
        evidence: projectEvidenceForExpert(registry, expert),
        allowedClaimCodes: [...claimCodes],
        allowedActionCodes: [...actionCodes],
      });
    },
  });
}
