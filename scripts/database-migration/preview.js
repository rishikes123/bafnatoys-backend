"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.pg-migration", override: true });
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const [directory, schema, port = "5002", applicationRoot = process.cwd(), provider = "postgres"] = process.argv.slice(2);
if (!directory || !schema) throw new Error("Usage: node scripts/database-migration/preview.js BACKUP_DIRECTORY SCHEMA [PORT]");
const receipt = JSON.parse(fs.readFileSync(path.join(directory, `postgres-${schema}-verified.json`)));
if (!receipt.dataVerified) throw new Error("Verified restore receipt is required");
const child = spawn(process.execPath, [path.join(applicationRoot, "server.js")], {
  cwd: applicationRoot,
  env: { ...process.env, DB_PROVIDER: provider, PG_APP_SCHEMA: schema,
    PG_VERIFIED_MIGRATION: receipt.migrationId, MIGRATION_READ_ONLY: "true",
    DISABLE_BACKGROUND_JOBS: "true", PORT: port, NODE_PATH: path.resolve("node_modules") },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
child.on("exit", code => { process.exitCode = code || 0; });
process.on("SIGINT", () => child.kill()); process.on("SIGTERM", () => child.kill());
