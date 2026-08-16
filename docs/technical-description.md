# Technical Description

## Service behavior

The prototype is a generic multi-industry service with two explicit paths: startup planning and operating-business review. Startup inputs compare declared budget, itemized costs, owner capital, funding gap, and a calculated buffer. Operating inputs preserve declared profit and margin while separately calculating profit, margin, cost ratios, and differences. All monetary arithmetic and ratio classification is deterministic JavaScript.

Four specialists—market, operations, finance, and policy—receive bounded projections from a canonical evidence registry. Each may select only allowlisted claim/action codes. The supervisor ranks up to three verified actions. The opinion verifier rejects unknown evidence, unsupported codes, invented policy identifiers or URLs, approval guarantees, sensitive strings, and numeric prose outside deterministic evidence.

Policy matching queries the included SQLite database. Records carry official URLs, snapshot dates, region/stage/support metadata, and conservative eligibility. Missing or compound checks return `CHECK_REQUIRED`; an agent cannot create a policy record.

## Runtime and commands

Node.js 24+ is required. The service has no required network call or npm package.

```powershell
cd prototype
node scripts/init-policy-db.mjs --output database/policies.sqlite
npm.cmd test
npm.cmd start
```

## Factual boundaries

- Prototype values are user-entered or synthetic; the Croatian restaurant is only an optional synthetic demo.
- Industry ranges are labeled `PROTOTYPE_REFERENCE_RANGE`, not official averages.
- Policy data consists of versioned official-source snapshots and uses `CHECK_REQUIRED` for unresolved eligibility.
- ChatGPT aided the prototype agent-result design; the executable prototype uses deterministic trusted templates.
- The production target is an enterprise internal local LLM through the model-gateway contract.
- No local model was installed, run, or evaluated for this prototype.
- Market, nearby-store, and vacancy feeds are `PLANNED_INTEGRATION`, with no fabricated live results.
