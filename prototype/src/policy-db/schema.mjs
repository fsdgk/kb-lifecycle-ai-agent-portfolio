export const policySchema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS policies (
    policy_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    organization TEXT NOT NULL,
    official_url TEXT NOT NULL,
    region_code TEXT NOT NULL,
    support_types TEXT NOT NULL,
    lifecycle_stages TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','CHECK_REQUIRED','UPCOMING','CLOSED','ARCHIVED','UNVERIFIED')),
    application_start TEXT,
    application_end TEXT,
    verified_at TEXT NOT NULL,
    current_version_id TEXT NOT NULL REFERENCES policy_versions(version_id) DEFERRABLE INITIALLY DEFERRED
  );
  CREATE TABLE IF NOT EXISTS policy_versions (
    version_id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES policies(policy_id) DEFERRABLE INITIALLY DEFERRED,
    source_hash TEXT NOT NULL,
    source_published_at TEXT,
    source_modified_at TEXT,
    collected_at TEXT NOT NULL,
    source_text TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('CREATED', 'UPDATED'))
  );
  CREATE TABLE IF NOT EXISTS eligibility_rules (
    rule_id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES policies(policy_id),
    rule_type TEXT NOT NULL,
    field TEXT NOT NULL,
    operator TEXT NOT NULL,
    expected_value TEXT NOT NULL,
    evidence_text TEXT NOT NULL,
    verification_status TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_history (
    sync_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    status TEXT NOT NULL,
    created_count INTEGER NOT NULL,
    updated_count INTEGER NOT NULL,
    closed_count INTEGER NOT NULL,
    error_code TEXT
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS policy_documents_fts
    USING fts5(policy_id UNINDEXED, version_id UNINDEXED, title, source_text, tokenize='unicode61');
`;

export function initializePolicySchema(database) {
  database.exec(policySchema);
}
