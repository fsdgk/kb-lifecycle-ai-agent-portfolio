import { DatabaseSync } from 'node:sqlite';

export function openPolicyDatabase(filePath, { readOnly = false } = {}) {
  return new DatabaseSync(filePath, {
    readOnly,
    enableForeignKeyConstraints: true,
  });
}
