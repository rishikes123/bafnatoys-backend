"use strict";

const mongoose = require("mongoose");
const { Pool } = require("pg");
const NativeCollection = require("mongoose/lib/drivers/node-mongodb-native/collection");
const { PostgresStore, Cursor } = require("./store");

class PostgresConnection extends mongoose.Connection {
  async createClient(uri, options = {}) {
    if (!/^postgres(?:ql)?:\/\//.test(uri || "")) throw new Error("DATABASE_URL must be a PostgreSQL URL");
    this._connectionString = uri;
    this.readyState = 2;
    const parsed = new URL(uri);
    this.host = parsed.hostname;
    this.name = parsed.pathname.slice(1);
    this.config.autoIndex = false; // Existing indexes are recreated and checked by the migration.
    this.config.autoCreate = false;
    this.client = options.pgPool || new Pool({
      connectionString: uri,
      max: Number(process.env.PG_POOL_SIZE || 10),
      connectionTimeoutMillis: 15000,
      statement_timeout: 30000,
    });
    this.client.on?.("error", () => this.emit("error", new Error("PostgreSQL connection failed")));
    const store = new PostgresStore(this.client, {
      schema: options.pgSchema || process.env.PG_APP_SCHEMA || "bafna",
      readOnly: options.readOnly ?? process.env.MIGRATION_READ_ONLY === "true",
    });
    this.pgStore = store;
    try {
      await store.initialize();
      if (!options.allowUnverifiedMigration) {
        const { rows } = await this.client.query(`SELECT value FROM ${store.table("_migration_meta")} WHERE key='verification'`);
        const proof = rows[0]?.value;
        if (!proof?.dataVerified || !process.env.PG_VERIFIED_MIGRATION || proof.migrationId !== process.env.PG_VERIFIED_MIGRATION) {
          throw new Error("PostgreSQL cutover refused: a verified migration receipt is required");
        }
      }
      this.db = {
        collection: name => store.collection(name),
        createCollection: async name => { await store.ensureCollection(name); return store.collection(name); },
        listCollections: () => new Cursor(async () => (await store.collectionNames()).map(name => ({ name, type: "collection" }))),
      };
      this.onOpen();
      return this;
    } catch (error) {
      await this.client.end();
      this.readyState = 0;
      throw error;
    }
  }
  async doClose() { await this.client?.end(); return this; }
  async startSession() { throw new Error("MongoDB transaction sessions are not supported; PostgreSQL collection writes are atomic"); }
}

module.exports = { Connection: PostgresConnection, Collection: NativeCollection };
