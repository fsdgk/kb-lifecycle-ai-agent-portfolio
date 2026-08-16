import { defineDynamicAgent } from './dynamic-agent-definition.mjs';

export const marketAgent = defineDynamicAgent('MARKET', ['CONTEXT', 'MARKET']);
export default marketAgent;
