"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.pg-migration", override: true });
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
const { PostgresStore } = require("../../database/postgres/store");
const { importBackup, verifyBackup, syncBackup } = require("./backup-files");

async function main() {
  const [command, directory, schema, previousDirectory] = process.argv.slice(2);
  if (!["import", "verify", "sync"].includes(command) || !directory || !schema || (command === "sync" && !previousDirectory)) throw new Error("Usage: node scripts/database-migration/postgres.js import|verify|sync BACKUP_DIRECTORY NEW_SCHEMA [PREVIOUS_BACKUP_DIRECTORY]");
  if (!/^bafna_migration_[a-z0-9_]+$/.test(schema)) throw new Error("Use an isolated bafna_migration_* schema");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 15000 });
  try {
    const store = new PostgresStore(pool, { schema });
    const receipt = await (command === "import" ? importBackup(store, directory) : command === "sync" ? syncBackup(store, previousDirectory, directory) : verifyBackup(store, directory));
    await fs.writeFile(path.join(directory, `postgres-${schema}-verified.json`), JSON.stringify(receipt, null, 2) + "\n");
    console.log(`Verified ${receipt.collections.length} collections; all documents, IDs, fields and BSON types match`);
    console.log(`Migration receipt: ${receipt.migrationId}`);
  } finally { await pool.end(); }
}
main().catch(error => { console.error(`PostgreSQL ${process.argv[2] || "migration"} failed: ${error.code || error.message}`); process.exitCode = 1; });
