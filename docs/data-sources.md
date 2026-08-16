# Data Sources

## Policy data

`prototype/database/sources.json` is the source inventory and `seed-policies.json` is the normalized snapshot input. `policies.sqlite` is generated from those files. The six records point to official pages from the Korean Ministry of SMEs and Startups, Seoul Metropolitan Government, Gyeonggi Province, and Incheon Metropolitan City. Snapshot verification is dated 2026-08-01; this date is not a claim that a program remains open later.

The database records official URL, organization, source date where available, verification date, region, lifecycle stage, support type, status, and required checks. An archived Seoul online-sales record is retained for history but excluded from current matching. The remaining five records are `CHECK_REQUIRED`; the application page and responsible agency must be rechecked before action.

## User and demonstration data

Interactive analysis uses values a user supplies in the browser. The files `business-profile.json`, `demo-scenario.json`, `market-signals.json`, and `transactions.json` are synthetic demonstration data and every business, market, and transaction record is explicitly marked `synthetic: true`. The Croatian restaurant scenario demonstrates behavior; it is not a real customer and is not the only supported industry.

The other JSON files in `prototype/data/` have reviewed, non-synthetic classifications:

- `industry-benchmarks.json` is hand-authored prototype reference data with `PROTOTYPE_REFERENCE_RANGE` status. It is not observed industry data.
- `ontology.json` is a project schema describing the entities and relations used by the prototype. It is not a business or market fixture.
- `policies.json` is a legacy official-source snapshot retained for the stored demonstration pipeline. It is distinct from the authoritative runtime policy repository.

The authoritative SQLite policy pipeline uses `prototype/database/sources.json` as its reviewed official-source inventory and `prototype/database/seed-policies.json` as its normalized snapshot input to generate `policies.sqlite`.

## Reference ranges and future connectors

Industry ranges are hand-authored prototype discussion references. They have status `PROTOTYPE_REFERENCE_RANGE` and are not government statistics, bank standards, official industry averages, or financial advice. Live market connectors must supply source, as-of time, confidence, and category before factual guidance may use their data.

## Factual boundaries

- Prototype values are user-entered or synthetic; no real-user dataset is packaged.
- Industry ranges are `PROTOTYPE_REFERENCE_RANGE`, not official averages.
- Policy records are versioned official-source snapshots; unresolved eligibility remains `CHECK_REQUIRED`.
- ChatGPT aided the prototype agent-result design; it did not replace source provenance.
- The production target is an enterprise internal local LLM connected through the gateway contract.
- No local model was installed, run, or evaluated for this prototype.
- Market, nearby-store, and vacancy feeds remain `PLANNED_INTEGRATION` and supply no fabricated facts.
