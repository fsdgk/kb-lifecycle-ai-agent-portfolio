# Architecture

## Request flow

1. `business-input.mjs` validates the startup/operating path, stage, region, industry template, and user values.
2. `business-analysis.mjs` calculates gaps, profit, margins, ratios, comparisons, and warning codes without a language model.
3. `policy-matcher.mjs` retrieves only official records from SQLite and attaches DB-issued evidence authority.
4. `market-data-contract.mjs` accepts provenance-complete provider records or returns `PLANNED_INTEGRATION`.
5. `evidence-registry.mjs` creates canonical evidence and minimum-data projections for four specialists.
6. Market, operations, finance, and policy agents select trusted claim/action codes; `opinion-verifier.mjs` revalidates each result.
7. The supervisor ranks no more than three evidence-backed actions. A model gateway is optional and cannot bypass schemas, allowed codes, evidence authority, or trusted rendering.
8. The API returns normalized input, deterministic analysis, market state, policy matches, council result, and disclosures to the browser UI.

## Trust boundaries

The SQLite policy database, deterministic calculations, evidence registry, specialist projections, verifiers, trusted templates, and model-gateway contract are separate modules. Model output—if a production gateway is later connected—is a proposal, not an authority. Finance arithmetic, policy provenance, eligibility status, and final text constraints remain code-controlled.

## Factual boundaries

- Prototype values are user-entered or synthetic, and the Croatian restaurant remains an optional synthetic demo.
- Industry ranges use `PROTOTYPE_REFERENCE_RANGE`; they are not official averages.
- Policy retrieval uses versioned official-source snapshots and unresolved criteria stay `CHECK_REQUIRED`.
- ChatGPT aided the prototype agent-result design; current agent results use deterministic trusted templates.
- The production target is an enterprise internal local LLM behind the existing gateway and verifier boundary.
- No local model was installed, run, or evaluated for this prototype.
- Market, nearby-store, and vacancy providers remain `PLANNED_INTEGRATION`.
