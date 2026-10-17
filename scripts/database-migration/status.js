"use strict";
require("dotenv").config({ path: ".env.pg-migration" });
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 10000 });
(async () => {
  try {
    await client.connect();
    const result = await client.query("SELECT schemaname, count(*) AS tables FROM pg_tables WHERE schemaname LIKE 'bafna_migration_%' GROUP BY schemaname");
    console.log(JSON.stringify(result.rows));
    const activity = await client.query("SELECT state, wait_event_type, wait_event, now()-query_start AS elapsed, left(query,160) AS operation FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()");
    console.log(JSON.stringify(activity.rows));
    const columns = await client.query("SELECT count(*) AS ordinal_columns FROM information_schema.columns WHERE table_schema LIKE 'bafna_migration_%' AND column_name='ordinal'");
    console.log(JSON.stringify(columns.rows));
  } catch (error) { console.log(`PostgreSQL status: ${error.code || error.message}`); process.exitCode = 1; }
  finally { await client.end(); }
})();
