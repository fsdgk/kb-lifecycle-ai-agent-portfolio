import { defineDynamicAgent } from './dynamic-agent-definition.mjs';

export const operationsAgent = defineDynamicAgent('OPERATIONS', ['CONTEXT', 'OPERATIONS', 'MARKET']);
export default operationsAgent;
