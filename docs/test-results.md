# Test Results

## Verified release gate

Fresh offline verification on 2026-08-16 produced the following evidence:

- Policy initializer: exit 0; six official policy records written to `prototype/database/policies.sqlite`.
- Focused submission tests: 27 tests, 27 passed, 0 failed.
- Portfolio `prototype/` full suite: 257 tests, 257 passed, 0 failed.
- API and browser E2E tests use an injected fixed clock so time-sensitive market freshness behavior is reproducible.
- Submission test database assertions: `PRAGMA integrity_check` = `ok`; six policy records; five records with `CHECK_REQUIRED` status.
- Submission scan: no PPT/PDF, model weight, secret signature, real-user fixture, `.git`, `node_modules`, symlink, or temporary artifact.
- Builder safety tests: only the canonical repository `submission/` path is accepted; an unowned existing directory and a disposable junction to an external sentinel are rejected without deletion or external writes.
- Content/data tests: bounded text scans reject private-key blocks, provider-prefixed quoted credential assignments, and representative cloud/API key signatures, including project-key shapes. Pure environment references are allowed, while every parameter-expansion default or alternate is independently restricted to explicit redacted/placeholder values. Every business, transaction, and market demo record is explicitly synthetic.

Reproduction commands:

```powershell
cd prototype
node scripts/init-policy-db.mjs --output database/policies.sqlite
node --test tests/submission.test.mjs
npm.cmd test
cd ../submission/prototype
npm.cmd test
```

The final handoff repeats both full suites, `PRAGMA integrity_check`, `git diff --check`, repository containment checks, and the package scan after documentation is recorded and the package is rebuilt.

## Factual boundaries

- Prototype values are user-entered or synthetic; tests use only synthetic fixtures.
- Industry fixtures carry `PROTOTYPE_REFERENCE_RANGE`, not official-average status.
- Policy fixtures and SQLite contain versioned official-source snapshots; uncertainty is `CHECK_REQUIRED`.
- ChatGPT aided the prototype agent-result design; tests exercise deterministic trusted templates and injected fake gateways only.
- The production target is an enterprise internal local LLM through the verified gateway contract.
- No local model was installed, run, or evaluated for this prototype.
- Market, nearby-store, and vacancy feeds remain `PLANNED_INTEGRATION`; tests reject fabricated/stale provider data.
