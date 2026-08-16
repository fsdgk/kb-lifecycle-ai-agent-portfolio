# Privacy and Security

## Data minimization

The prototype input contract asks for business context and financial amounts, not identity, account, card, credential, or contact fields. The submitted fixtures are synthetic. The current API analyzes a request in memory and does not implement an account database or persistent user-profile store.

Specialists receive bounded projections rather than the full request. The evidence and opinion layers reject email addresses, account/registration-like identifiers, hidden-reasoning fields, unknown fields, direct untrusted policy IDs/URLs, numeric claims outside canonical calculations, and policy approval guarantees. Consultation handoff is consent-gated and the prototype previews data rather than sending it to a live advisor system.

## Integrity and supply-chain boundary

Policy provenance comes from the SQLite database and cannot be supplied by a model. Output schemas, code/action allowlists, canonical evidence IDs, deep-frozen records, deterministic templates, and post-generation verifiers constrain every agent result. The package contains no network client, credential, `.env`, private key, model installer, model weight, or `node_modules` tree.

## Production controls still required

Authentication, authorization, encryption/key management, retention/deletion policy, audit logging, monitoring, recovery, vulnerability management, consent records, and enterprise gateway deployment are production responsibilities; this local prototype does not claim those controls are complete.

## Factual boundaries

- Prototype values are user-entered or synthetic, with no real-user fixture in the package.
- Industry ranges are `PROTOTYPE_REFERENCE_RANGE` and not official averages.
- Policy records are versioned official-source snapshots; ambiguity is reported as `CHECK_REQUIRED`.
- ChatGPT aided the prototype agent-result design; deterministic templates and verifiers control runtime output.
- The production target is an enterprise internal local LLM behind enterprise security controls.
- No local model was installed, run, or evaluated for this prototype.
- Market, nearby-store, and vacancy feeds remain `PLANNED_INTEGRATION`.
