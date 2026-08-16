import { defineDynamicAgent } from './dynamic-agent-definition.mjs';

export const policyAgent = defineDynamicAgent('POLICY', ['CONTEXT', 'FINANCE', 'POLICY']);
export default policyAgent;
