import { readFileSync } from 'node:fs';

const readJson = (name) => JSON.parse(
  readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8'),
);

export const loadBusinessProfile = () => readJson('business-profile.json');
export const loadTransactions = () => readJson('transactions.json');
export const loadMarketSignals = () => readJson('market-signals.json');
export const loadPolicies = () => readJson('policies.json');
export const loadOntology = () => readJson('ontology.json');
