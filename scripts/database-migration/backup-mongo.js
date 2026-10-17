"use strict";

require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const dns = require("node:dns");
const { MongoClient, BSON } = require("mongodb");

// Exact BSON snapshots keep IDs, dates, binary values and numeric types intact.
async function backupMongo({ uri = process.env.MONGO_URI, directory } = {}) {
  if (!uri) throw new Error("MONGO_URI is required");
  if (!directory) throw new Error("An unused backup directory is required");
  await fs.mkdir(directory, { recursive: false });
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  let session;
  try {
    await client.connect();
    const db = client.db();
    const collections = (await db.listCollections({}, { nameOnly: false }).toArray())
      .filter(info => !info.name.startsWith("system."));
    if (collections.some(info => info.type !== "collection")) {
      throw new Error("Views need an explicit migration plan; source was left unchanged");
    }
    const manifest = {
      format: "bafna-bson-v1", sourceDatabase: db.databaseName,
      startedAt: new Date().toISOString(), consistentSnapshot: true, collections: [],
    };
    // Capture indexes before the read-only snapshot (Mongo does not permit listIndexes in a transaction).
    const indexes = new Map();
    for (const info of collections) {
      indexes.set(info.name, await db.collection(info.name).listIndexes().toArray());
    }
    session = client.startSession();
    session.startTransaction({ readConcern: { level: "snapshot" }, readPreference: "primary" });
    for (const info of collections.sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = `${Buffer.from(info.name).toString("hex")}.bson`;
      const handle = await fs.open(path.join(directory, filename), "wx");
      const hash = crypto.createHash("sha256");
      let count = 0;
      let bytes = 0;
      try {
        const cursor = db.collection(info.name).find({}, { session, raw: true }).sort({ $natural: 1 });
        for await (const raw of cursor) {
          if (!Buffer.isBuffer(raw)) throw new Error("Mongo driver did not return raw BSON");
          BSON.deserialize(raw, { promoteValues: false }); // Validate every backup record.
          await handle.writeFile(raw);
          hash.update(raw);
          bytes += raw.length;
          count++;
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      manifest.collections.push({
        name: info.name, filename, count, bytes, sha256: hash.digest("hex"),
        options: BSON.EJSON.serialize(info.options || {}, { relaxed: false }),
        indexes: BSON.EJSON.serialize(indexes.get(info.name), { relaxed: false }),
      });
      console.log(`${info.name}: ${count} records (${bytes} bytes)`);
    }
    await session.commitTransaction();
    manifest.completedAt = new Date().toISOString();
    await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    console.log(`Consistent backup complete: ${manifest.collections.length} collections`);
    return manifest;
  } finally {
    if (session?.inTransaction()) await session.abortTransaction();
    await session?.endSession();
    await client.close();
  }
}

if (require.main === module) {
  const directory = process.argv[2];
  backupMongo({ directory }).catch(error => {
    console.error(`Backup failed: ${error.name}; no source data was modified.`);
    process.exitCode = 1;
  });
}
module.exports = { backupMongo };
