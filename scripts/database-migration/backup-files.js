"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { BSON } = require("mongodb");
const { encode, canonical, idKey } = require("../../database/postgres/codec");

function readBson(buffer) {
  const documents = [];
  for (let offset = 0; offset < buffer.length;) {
    if (offset + 4 > buffer.length) throw new Error("Truncated BSON record");
    const size = buffer.readInt32LE(offset);
    if (size < 5 || offset + size > buffer.length) throw new Error("Invalid BSON record length");
    documents.push(BSON.deserialize(buffer.subarray(offset, offset + size), { promoteValues: false }));
    offset += size;
  }
  return documents;
}

async function readBackup(directory) {
  const manifestBytes = await fs.readFile(path.join(directory, "manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.format !== "bafna-bson-v1" || !manifest.consistentSnapshot || !manifest.completedAt) throw new Error("Backup is incomplete or inconsistent");
  const collections = [];
  for (const collection of manifest.collections) {
    if (!/^[a-f0-9]+\.bson$/.test(collection.filename)) throw new Error("Invalid backup filename");
    const bytes = await fs.readFile(path.join(directory, collection.filename));
    if (bytes.length !== collection.bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== collection.sha256) throw new Error(`Backup checksum failed: ${collection.name}`);
    const documents = readBson(bytes);
    if (documents.length !== collection.count) throw new Error(`Backup count mismatch: ${collection.name}`);
    collections.push({ ...collection, documents });
  }
  return { manifest, collections, migrationId: crypto.createHash("sha256").update(manifestBytes).digest("hex") };
}

async function importBackup(store, directory) {
  // Validate every file before touching the target schema.
  const backup = await readBackup(directory);
  await store.initialize();
  const names = await store.collectionNames();
  if (names.length) throw new Error("Import refused: target schema must be new and empty");
  for (const collection of backup.collections) await store.ensureCollection(collection.name);
  const client = await store.pool.connect();
  try {
    await client.query("BEGIN");
    for (const collection of backup.collections) {
      for (let index = 0; index < collection.documents.length; index += 250) {
        const batch = collection.documents.slice(index, index + 250);
        await client.query(`INSERT INTO ${store.table(collection.name)} (id,document) SELECT * FROM UNNEST($1::text[], $2::jsonb[])`, [batch.map(doc => idKey(doc._id)), batch.map(doc => JSON.stringify(encode(doc)))]);
      }
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  for (const collection of backup.collections) {
    const indexes = BSON.EJSON.deserialize(collection.indexes, { relaxed: true });
    for (const index of indexes) {
      const { key, v, ns, ...options } = index;
      await store.createIndex(collection.name, key, options);
    }
    console.log(`Restored ${collection.name}: ${collection.count} records; ${indexes.length} indexes`);
  }
  return verifyBackup(store, directory);
}

async function verifyBackup(store, directory) {
  const backup = await readBackup(directory);
  const expectedNames = backup.collections.map(collection => collection.name).sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify((await store.collectionNames()).sort())) throw new Error("Target collection inventory differs from backup");
  const report = [];
  for (const collection of backup.collections) {
    const { rows } = await store.pool.query(`SELECT id,document FROM ${store.table(collection.name)}`);
    if (rows.length !== collection.count) throw new Error(`Count verification failed: ${collection.name}`);
    const target = new Map(rows.map(row => [row.id, canonical(row.document)]));
    for (const document of collection.documents) {
      if (target.get(idKey(document._id)) !== canonical(encode(document))) throw new Error(`Field/type verification failed: ${collection.name}`);
    }
    report.push({ collection: collection.name, count: rows.length, allFieldsAndTypesMatch: true });
  }
  const receipt = { migrationId: backup.migrationId, dataVerified: true, verifiedAt: new Date().toISOString(), collections: report };
  await store.pool.query(`INSERT INTO ${store.table("_migration_meta")} (key,value) VALUES ('verification',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(receipt)]);
  return receipt;
}

async function syncBackup(store, previousDirectory, nextDirectory) {
  // Only update a target that still matches the entire previous snapshot. This prevents
  // overwriting any new PostgreSQL orders or unrelated data if a switch already happened.
  const previous = await readBackup(previousDirectory);
  for (const collection of previous.collections) await store.ensureCollection(collection.name);
  await verifyBackup(store, previousDirectory);
  const next = await readBackup(nextDirectory);
  const oldNames = previous.collections.map(row => row.name).sort();
  const newNames = next.collections.map(row => row.name).sort();
  if (JSON.stringify(oldNames) !== JSON.stringify(newNames)) throw new Error("Collection inventory changed; rehearse a fresh schema before cutover");
  const changes = [];
  for (const collection of next.collections) {
    const old = previous.collections.find(row => row.name === collection.name);
    if (canonical(old.indexes) !== canonical(collection.indexes)) throw new Error(`Index definitions changed: ${collection.name}`);
    const oldDocs = new Map(old.documents.map(doc => [idKey(doc._id), encode(doc)]));
    const newDocs = new Map(collection.documents.map(doc => [idKey(doc._id), encode(doc)]));
    for (const [id, doc] of newDocs) {
      const before = oldDocs.get(id);
      if (!before || canonical(before) !== canonical(doc)) changes.push({ collection: collection.name, id, before, after: doc });
    }
    for (const [id, before] of oldDocs) if (!newDocs.has(id)) changes.push({ collection: collection.name, id, before });
  }
  const client = await store.pool.connect();
  try {
    await client.query("BEGIN");
    for (const change of changes) {
      let result;
      if (!change.before) {
        result = await client.query(`INSERT INTO ${store.table(change.collection)} (id,document) VALUES ($1,$2::jsonb)`, [change.id, JSON.stringify(change.after)]);
      } else if (!change.after) {
        result = await client.query(`DELETE FROM ${store.table(change.collection)} WHERE id=$1 AND document=$2::jsonb`, [change.id, JSON.stringify(change.before)]);
      } else {
        result = await client.query(`UPDATE ${store.table(change.collection)} SET document=$3::jsonb WHERE id=$1 AND document=$2::jsonb`, [change.id, JSON.stringify(change.before), JSON.stringify(change.after)]);
      }
      if (result.rowCount !== 1) throw new Error("Target changed concurrently; refusing final sync");
    }
    // Preserve Mongo's natural order for existing routes with no explicit sort.
    for (const collection of next.collections) {
      const ids = collection.documents.map(doc => idKey(doc._id));
      const ordinals = ids.map((_, index) => index + 1);
      await client.query(`UPDATE ${store.table(collection.name)} AS target SET ordinal=source.position FROM UNNEST($1::text[],$2::bigint[]) AS source(id,position) WHERE target.id=source.id`, [ids, ordinals]);
      await client.query("SELECT setval(pg_get_serial_sequence($1,'ordinal'),$2,false)", [`${store.schema}.${collection.name}`, ids.length + 1]);
    }
    await client.query(`DELETE FROM ${store.table("_migration_meta")} WHERE key='verification'`);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  console.log(`Final sync applied ${changes.length} changed records; original MongoDB untouched`);
  return verifyBackup(store, nextDirectory);
}

module.exports = { readBson, readBackup, importBackup, verifyBackup, syncBackup };
