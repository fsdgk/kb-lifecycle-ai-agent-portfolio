import { defineDynamicAgent } from './dynamic-agent-definition.mjs';

export const financeAgent = defineDynamicAgent('FINANCE', ['CONTEXT', 'FINANCE']);
export default financeAgent;
