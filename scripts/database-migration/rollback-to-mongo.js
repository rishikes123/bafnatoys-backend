"use strict";

/**
 * ROLLBACK: Postgres -> MongoDB (sirf cutover ke baad zarurat pade to).
 *
 * Cutover ke waqt liya gaya final backup ("snapshot") dono databases ki common shuruaat hai.
 * Ye script dekhti hai ki snapshot ke baad Postgres me kya naya bana / badla / hata, aur wahi
 * MongoDB me laagu karti hai. Mongo ka koi record tabhi chhua jaata hai jab woh abhi bhi
 * snapshot jaisa ho — warna use "conflict" me daal kar chhod deti hai (overwrite nahi).
 *
 * Default DRY-RUN hai (kuch nahi likhta). Asli me likhne ke liye --apply.
 *   node scripts/database-migration/rollback-to-mongo.js SNAPSHOT_DIR PG_SCHEMA [--apply]
 * Env: MONGO_URI (target), DATABASE_URL (.env.pg-migration se, Postgres source).
 */

const dns = require("node:dns");
const { MongoClient, BSON } = require("mongodb");
const { readBackup } = require("./backup-files");
const { encode, canonical, idKey, identifier } = require("../../database/postgres/codec");

const RAW = { promoteValues: false, promoteLongs: false, promoteBuffers: false };
const toMongo = ejson => BSON.EJSON.deserialize(ejson, { relaxed: false });

async function planAndApply({ pool, schema, snapshotDir, mongoUri, dbName, apply = false, log = console.log }) {
  identifier(schema);
  const snapshot = await readBackup(snapshotDir);
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const summary = { insert: 0, replace: 0, delete: 0, unchanged: 0, conflicts: [] };
  try {
    const db = dbName ? client.db(dbName) : client.db();
    const { rows: tables } = await pool.query(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname=$1 AND tablename NOT LIKE '\\_%' ESCAPE '\\' ORDER BY tablename", [schema]);
    const names = new Set([...snapshot.collections.map(c => c.name), ...tables.map(t => t.name)]);
    for (const name of [...names].sort()) {
      const snap = new Map((snapshot.collections.find(c => c.name === name)?.documents || []).map(d => { const e = encode(d); return [idKey(d._id), e]; }));
      const pg = new Map();
      if (tables.some(t => t.name === name)) {
        const { rows } = await pool.query(`SELECT id, document FROM ${identifier(schema)}.${identifier(name)}`);
        for (const r of rows) pg.set(r.id, r.document);
      }
      const coll = db.collection(name);
      const mongo = new Map();
      for await (const d of coll.find({}, RAW)) mongo.set(idKey(d._id), encode(d));
      const same = (a, b) => a !== undefined && b !== undefined && canonical(a) === canonical(b);
      const ops = [];
      for (const [id, doc] of pg) {
        const before = snap.get(id), now = mongo.get(id);
        if (before === undefined) {                       // Postgres me naya bana
          if (now === undefined) ops.push(["insert", id, doc]);
          else if (same(now, doc)) summary.unchanged++;
          else summary.conflicts.push(`${name}/${id}: new in Postgres but a different doc exists in Mongo`);
        } else if (!same(before, doc)) {                  // Postgres me badla
          if (same(now, doc)) summary.unchanged++;
          else if (same(now, before)) ops.push(["replace", id, doc]);
          else summary.conflicts.push(`${name}/${id}: changed in both Postgres and Mongo`);
        } else summary.unchanged++;
      }
      for (const [id, before] of snap) {
        if (pg.has(id)) continue;                         // Postgres me hata
        const now = mongo.get(id);
        if (now === undefined) summary.unchanged++;
        else if (same(now, before)) ops.push(["delete", id, before]);
        else summary.conflicts.push(`${name}/${id}: deleted in Postgres but changed in Mongo`);
      }
      if (ops.length) log(`${name}: ${ops.filter(o => o[0] === "insert").length} insert, ${ops.filter(o => o[0] === "replace").length} replace, ${ops.filter(o => o[0] === "delete").length} delete`);
      for (const [op, , doc] of ops) {
        summary[op]++;
        if (!apply) continue;
        const value = toMongo(doc);
        if (op === "insert") await coll.insertOne(value);
        else if (op === "replace") {
          const r = await coll.replaceOne({ _id: value._id }, value);
          if (r.matchedCount !== 1) summary.conflicts.push(`${name}/${idKey(value._id)}: vanished during replace`);
        } else {
          const r = await coll.deleteOne({ _id: value._id });
          if (r.deletedCount !== 1) summary.conflicts.push(`${name}/${idKey(value._id)}: vanished during delete`);
        }
      }
    }
  } finally {
    await client.close();
  }
  log(`${apply ? "APPLIED" : "DRY-RUN (nothing written)"}: ${summary.insert} insert, ${summary.replace} replace, ${summary.delete} delete, ${summary.unchanged} unchanged, ${summary.conflicts.length} conflict(s)`);
  summary.conflicts.forEach(c => log(`  CONFLICT ${c}`));
  return summary;
}

module.exports = { planAndApply };

if (require.main === module) {
  require("dotenv").config();
  require("dotenv").config({ path: ".env.pg-migration", override: true });
  const { Pool } = require("pg");
  const [snapshotDir, schema] = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const apply = process.argv.includes("--apply");
  if (!snapshotDir || !schema) { console.error("Usage: node scripts/database-migration/rollback-to-mongo.js SNAPSHOT_DIR PG_SCHEMA [--apply]"); process.exit(1); }
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 20000 });
  planAndApply({ pool, schema, snapshotDir, mongoUri: process.env.MONGO_URI, apply })
    .then(s => { process.exitCode = s.conflicts.length ? 2 : 0; })
    .catch(e => { console.error("Rollback failed:", e.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
