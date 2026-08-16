# Prototype Runtime

This directory is the executable prototype. It supports generic startup and operating-business inputs, deterministic financial comparisons, official SQLite policy matching, four verified specialist roles, and a supervisor. The Croatian restaurant data is an optional synthetic demonstration rather than the only supported business type.

## Requirements and commands

Use Node.js 24 or newer. No npm install, network connection, or language model is required.

```powershell
node scripts/init-policy-db.mjs --output database/policies.sqlite
npm.cmd test
npm.cmd start
```

Open `http://127.0.0.1:4173`. The policy initializer accepts only a file inside `prototype/database/`. The submission builder is run from this directory as:

```powershell
node scripts/build-submission.mjs --output ../submission
```

The production CLI accepts only the canonical repository `submission/` destination. It resolves the repository and existing output ancestors with `realpath`, rejects linked/reparse output components, requires an exact builder ownership marker before replacement, validates reviewed data classifications, and performs a bounded sensitive-content scan before copying the file-level allowlist. The scan recognizes provider-prefixed API-key, token, secret, password, and credential assignments case-insensitively. A pure environment reference such as `${NAME}` is allowed; defaults and alternates using `:-`, `-`, `:=`, `=`, `:+`, or `+` are exempt only when their branch is an explicit redacted or placeholder value.

## Implementation boundaries

- Startup analysis compares declared budget, itemized costs, capital, funding gap, and buffer.
- Operating analysis preserves declared profit/margin and displays independently calculated values and differences.
- Deterministic code performs all arithmetic and ratio classification.
- Policy matches come only from the official snapshot SQLite database; unresolved eligibility is `CHECK_REQUIRED`.
- Four specialist definitions and one supervisor use projections, an evidence registry, allowlisted codes, verifiers, and a model-independent gateway contract.

## Factual boundaries

- Prototype values are user-entered or synthetic; no real-user data is included.
- Industry ranges are `PROTOTYPE_REFERENCE_RANGE` references, not official averages.
- Policy records are versioned official-source snapshots and do not guarantee eligibility or approval.
- ChatGPT aided the prototype agent-result design; current outputs use deterministic trusted templates.
- The production target is an enterprise internal local LLM behind the included gateway contract.
- No local model was installed, run, or evaluated for this prototype.
- Market, nearby-store, and vacancy feeds remain `PLANNED_INTEGRATION`, so missing providers never yield invented results.
