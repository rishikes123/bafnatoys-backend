"use strict";

const crypto = require("node:crypto");
const { ObjectId } = require("mongodb");
const { Query, Aggregator, update } = require("mingo");
const { encode, decode, canonical, idKey, identifier } = require("./codec");

const QUERY_OPTIONS = { scriptEnabled: false };

// Values whose EJSON form is exact and type-stable, so SQL jsonb equality == Mongo equality.
// Numbers/dates are deliberately excluded (int vs double encodings differ) and stay in Mingo.
const pushable = value => typeof value === "string" || typeof value === "boolean" || value?._bsontype === "ObjectId";

/**
 * Split a Mongo filter into SQL conditions + the rest ("residual") for Mingo.
 * Top-level `field: value` and `field: { $in: [...] }` with pushable values go to SQL
 * (Mingo's $in over ObjectIds is O(n*m) deep-equality and took minutes on reviews).
 * Array fields keep Mongo semantics: a value matches if it equals the field or is an element of it.
 */
const isOperatorObject = value => value && typeof value === "object" && !value._bsontype && !(value instanceof Date) && !Array.isArray(value)
  && Object.keys(value).length > 0 && Object.keys(value).every(op => op.startsWith("$"));

function planFilter(filter = {}) {
  const where = [], values = [], residual = {};
  for (const [key, condition] of Object.entries(filter || {})) {
    if (key.startsWith("$") || key.includes(".")) { residual[key] = condition; continue; }
    // Only these exact shapes are pushed; anything else stays (whole) in Mingo.
    const ops = pushable(condition) ? { $in: [condition] } : isOperatorObject(condition) ? condition : null;
    const ok = ops && Object.entries(ops).every(([op, arg]) =>
      (op === "$in" && Array.isArray(arg) && arg.length && arg.every(pushable))
      || (op === "$exists" && typeof arg === "boolean" && key !== "_id")
      || (op === "$ne" && arg === null && key !== "_id"));
    if (!ok) { residual[key] = condition; continue; }
    if (key === "_id") { // only $in reaches here for _id (see `ok` above)
      values.push(ops.$in.map(idKey));
      where.push(`id = ANY($${values.length}::text[])`);
      continue;
    }
    values.push(key); const field = values.length;
    for (const [op, arg] of Object.entries(ops)) {
      if (op === "$in") {
        values.push(arg.map(value => JSON.stringify(encode(value)))); const options = values.length;
        where.push(`(document -> $${field} = ANY($${options}::jsonb[]) OR (jsonb_typeof(document -> $${field}) = 'array' AND EXISTS (SELECT 1 FROM unnest($${options}::jsonb[]) AS wanted(value) WHERE document -> $${field} @> jsonb_build_array(wanted.value))))`);
      } else if (op === "$exists") {
        where.push(`${arg ? "" : "NOT "}jsonb_exists(document, $${field})`);
      } else {
        // {$ne: null}: field present, not null, and (if array) no null element — Mongo semantics.
        where.push(`(jsonb_exists(document, $${field}) AND document -> $${field} <> 'null'::jsonb AND NOT (jsonb_typeof(document -> $${field}) = 'array' AND document -> $${field} @> '[null]'::jsonb))`);
      }
    }
  }
  return { where, values, residual };
}

class Cursor {
  constructor(load, options = {}) { this.load = load; this.options = { ...options }; this.position = 0; }
  sort(sort) { this.options.sort = sort; return this; }
  limit(limit) { this.options.limit = limit; return this; }
  skip(skip) { this.options.skip = skip; return this; }
  project(projection) { this.options.projection = projection; return this; }
  async toArray() {
    this.result ||= this.load(this.options);
    return this.result;
  }
  async next() { return (await this.toArray())[this.position++] ?? null; }
  async close() { this.position = Number.MAX_SAFE_INTEGER; }
  async *[Symbol.asyncIterator]() { let value; while ((value = await this.next()) !== null) yield value; }
}

function select(documents, filter = {}, options = {}) {
  let cursor = new Query(filter, QUERY_OPTIONS).find(documents, options.projection || {});
  if (options.sort) cursor = cursor.sort(options.sort);
  if (options.skip) cursor = cursor.skip(options.skip);
  if (options.limit) cursor = cursor.limit(Math.abs(options.limit));
  return cursor.all();
}

class PostgresStore {
  constructor(pool, { schema = "bafna", readOnly = false } = {}) {
    identifier(schema);
    this.pool = pool; this.schema = schema; this.readOnly = readOnly;
    this.pendingTables = new Map();
    this.ttlIndexes = new Map();
  }
  table(name) { return `${identifier(this.schema)}.${identifier(name)}`; }
  async initialize() {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${identifier(this.schema)}`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table("_migration_meta")} (key text PRIMARY KEY, value jsonb NOT NULL)`);
  }
  async ensureCollection(name) {
    if (!this.pendingTables.has(name)) {
      const pending = this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table(name)} (
        id text PRIMARY KEY, document jsonb NOT NULL, ordinal bigserial NOT NULL, inserted_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT document_is_object CHECK (jsonb_typeof(document) = 'object'))`)
        .then(() => this.pool.query(`ALTER TABLE ${this.table(name)} ADD COLUMN IF NOT EXISTS ordinal bigserial`))
        .then(() => this.pool.query(`CREATE INDEX IF NOT EXISTS ${identifier(`gin_${crypto.createHash("sha256").update(name).digest("hex").slice(0, 20)}`)} ON ${this.table(name)} USING GIN (document)`));
      this.pendingTables.set(name, pending);
      pending.catch(() => this.pendingTables.delete(name));
    }
    await this.pendingTables.get(name);
  }
  async collectionNames(client = this.pool) {
    const { rows } = await client.query("SELECT tablename AS name FROM pg_tables WHERE schemaname=$1 AND tablename NOT LIKE '\\_%' ESCAPE '\\' ORDER BY tablename", [this.schema]);
    return rows.map(row => row.name);
  }
  async read(name, filter = {}, client = this.pool) {
    return (await this.query(name, filter, client)).docs;
  }
  /** Rows matching the SQL-pushable part of `filter`; caller applies `residual` with Mingo. */
  async query(name, filter = {}, client = this.pool) {
    await this.ensureCollection(name);
    const { where, values, residual } = planFilter(filter);
    const { rows } = await client.query(`SELECT document FROM ${this.table(name)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ordinal, id`, values);
    if (!this.ttlIndexes.has(name)) {
      this.ttlIndexes.set(name, (await this.indexes(name, client)).filter(index => Number.isFinite(index.expireAfterSeconds)));
    }
    // Mongo TTL collections must not authenticate an expired OTP. Retain stored records for audit,
    // but exclude expired values from application reads just as Mongo's TTL cleanup does.
    const docs = rows.map(row => decode(row.document)).filter(doc => this.ttlIndexes.get(name).every(index => {
      const field = Object.keys(index.key)[0];
      const value = field.split(".").reduce((part, key) => part?.[key], doc);
      return !(value instanceof Date) || value.getTime() + index.expireAfterSeconds * 1000 > Date.now();
    }));
    return { docs, residual };
  }
  async write(name, action) {
    if (this.readOnly) throw new Error("Database is in migration read-only mode");
    await this.ensureCollection(name);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Includes insert/upsert races; every writer to a collection follows this lock protocol.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${this.schema}.${name}`]);
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        // Mongo-shaped E11000: app code (e.g. orderNumber retry) checks the index/field name in the message.
        let index = { name: "_id_", key: { _id: 1 } };
        if (!/_pkey$/.test(error.constraint || "")) {
          const found = (await this.indexes(name, client).catch(() => [])).find(ix =>
            `idx_${crypto.createHash("sha256").update(`${name}:${ix.name}`).digest("hex").slice(0, 24)}` === error.constraint);
          if (found) index = found;
        }
        const duplicate = new Error(`E11000 duplicate key error collection: ${this.schema}.${name} index: ${index.name} dup key: ${JSON.stringify(Object.keys(index.key))}`);
        duplicate.name = "MongoServerError"; duplicate.code = 11000;
        duplicate.keyPattern = index.key;
        duplicate.index = index.name;
        throw duplicate;
      }
      throw error;
    } finally { client.release(); }
  }
  async put(client, name, doc, { replace = false } = {}) {
    if (doc._id == null) doc._id = new ObjectId();
    await client.query(`INSERT INTO ${this.table(name)} (id, document) VALUES ($1,$2::jsonb)${replace ? " ON CONFLICT (id) DO UPDATE SET document=EXCLUDED.document" : ""}`, [idKey(doc._id), JSON.stringify(encode(doc))]);
  }
  async indexes(name, client = this.pool) {
    // Use the caller's connection: inside write() the lock-holder must never wait for a second pool connection.
    const { rows } = await client.query(`SELECT value FROM ${this.table("_migration_meta")} WHERE key=$1`, [`indexes:${name}`]);
    return rows[0]?.value || [{ name: "_id_", key: { _id: 1 }, unique: true }];
  }
  async createIndex(name, keys, options = {}) {
    await this.ensureCollection(name);
    if (options.collation || options.partialFilterExpression) throw new Error("Index collation/partial filters require an explicit SQL migration");
    const fields = Object.keys(keys);
    if (!fields.length || fields.some(field => !/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(field))) throw new Error("Unsupported index fields");
    const indexName = options.name || fields.map(field => `${field}_${keys[field]}`).join("_");
    const safeName = `idx_${crypto.createHash("sha256").update(`${name}:${indexName}`).digest("hex").slice(0, 24)}`;
    const expressions = fields.map(field => {
      const parts = field.split(".").map(part => `'${part}'`).join(",");
      return `(COALESCE(document #> ARRAY[${parts}], 'null'::jsonb))`;
    });
    const sparse = options.sparse ? ` WHERE ${fields.map(field => `(document #> ARRAY[${field.split(".").map(part => `'${part}'`).join(",")}]) IS NOT NULL`).join(" OR ")}` : "";
    if (indexName !== "_id_") {
      await this.pool.query(`CREATE ${options.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${identifier(safeName)} ON ${this.table(name)} (${expressions.join(",")})${sparse}`);
    }
    const indexes = await this.indexes(name);
    if (!indexes.some(index => index.name === indexName)) {
      indexes.push({ key: keys, ...options, name: indexName });
      await this.pool.query(`INSERT INTO ${this.table("_migration_meta")} (key,value) VALUES ($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [`indexes:${name}`, JSON.stringify(indexes)]);
    }
    this.ttlIndexes.delete(name);
    return indexName;
  }
  collection(name) { identifier(name); return new PostgresCollection(this, name); }
}

class PostgresCollection {
  constructor(store, name) { this.store = store; this.name = name; this.collectionName = name; }
  find(filter = {}, options = {}) {
    return new Cursor(async opts => {
      const { docs, residual } = await this.store.query(this.name, filter);
      return select(docs, residual, opts);
    }, options);
  }
  async findOne(filter = {}, options = {}) { return (await this.find(filter, { ...options, limit: 1 }).toArray())[0] ?? null; }
  async countDocuments(filter = {}) { return (await this.find(filter).toArray()).length; }
  async estimatedDocumentCount() { return this.countDocuments(); }
  async distinct(field, filter = {}) {
    const docs = await this.find(filter).toArray();
    const rows = new Aggregator([{ $project: { v: `$${field}` } }, { $unwind: "$v" }, { $group: { _id: "$v" } }], QUERY_OPTIONS).run(docs);
    return rows.map(row => row._id);
  }
  aggregate(pipeline = [], options = {}) {
    return new Cursor(async () => {
      const collections = new Map();
      const collectLookups = stages => { for (const stage of stages) {
        if (stage.$out || stage.$merge) throw new Error("Aggregation write stages are not supported");
        if (stage.$lookup) {
          identifier(stage.$lookup.from);
          collections.set(stage.$lookup.from, null);
          if (stage.$lookup.pipeline) collectLookups(stage.$lookup.pipeline);
        }
        if (stage.$facet) Object.values(stage.$facet).forEach(collectLookups);
      } };
      collectLookups(pipeline);
      // Leading $match is answered by SQL; only its residual (if any) runs in Mingo.
      let stages = pipeline, docs;
      if (pipeline[0]?.$match) {
        const { docs: matched, residual } = await this.store.query(this.name, pipeline[0].$match);
        docs = matched;
        stages = Object.keys(residual).length ? [{ $match: residual }, ...pipeline.slice(1)] : pipeline.slice(1);
      } else {
        docs = await this.store.read(this.name);
      }
      for (const name of collections.keys()) collections.set(name, await this.store.read(name));
      return new Aggregator(stages, { ...QUERY_OPTIONS, ...options, collectionResolver: name => {
        if (!collections.has(name)) throw new Error("Unresolved aggregation collection");
        return collections.get(name);
      } }).run(docs);
    });
  }
  async insertOne(doc) {
    return this.store.write(this.name, async client => {
      await this.store.put(client, this.name, doc);
      return { acknowledged: true, insertedId: doc._id };
    });
  }
  async insertMany(docs) {
    return this.store.write(this.name, async client => {
      const insertedIds = {};
      for (let i = 0; i < docs.length; i++) {
        await this.store.put(client, this.name, docs[i]); insertedIds[i] = docs[i]._id;
      }
      return { acknowledged: true, insertedCount: docs.length, insertedIds };
    });
  }
  async change(filter, changes, options = {}, { many = false, remove = false, replacement = false } = {}) {
    if (options.session) throw new Error("External Mongo sessions cannot be used by the PostgreSQL adapter");
    return this.store.write(this.name, async client => {
      const { docs: candidates, residual } = await this.store.query(this.name, filter, client);
      let docs = select(candidates, residual, { sort: options.sort });
      if (!many) docs = docs.slice(0, 1);
      const before = docs[0] ? decode(encode(docs[0])) : null;
      const result = { acknowledged: true, matchedCount: docs.length, modifiedCount: 0, deletedCount: 0, upsertedCount: 0, upsertedId: null, before, after: null };
      if (!docs.length && options.upsert && !remove) {
        const seed = {};
        for (const [key, value] of Object.entries(filter)) {
          if (!key.startsWith("$") && (value == null || typeof value !== "object" || value._bsontype || value instanceof Date)) {
            update(seed, { $set: { [key]: value } });
          }
        }
        if (changes.$setOnInsert) update(seed, { $set: changes.$setOnInsert });
        seed._id ??= new ObjectId(); docs = [seed];
        result.upsertedCount = 1; result.upsertedId = seed._id;
      }
      for (let doc of docs) {
        if (remove) {
          await client.query(`DELETE FROM ${this.store.table(this.name)} WHERE id=$1`, [idKey(doc._id)]);
          result.deletedCount++; continue;
        }
        const oldId = doc._id;
        const oldValue = canonical(encode(doc));
        if (replacement) doc = { ...changes, _id: changes._id ?? oldId };
        else {
          const { $setOnInsert, ...modifier } = changes;
          update(doc, Object.keys(modifier).some(key => key.startsWith("$")) ? modifier : { $set: modifier }, options.arrayFilters, undefined, { cloneMode: "none", queryOptions: QUERY_OPTIONS });
        }
        if (idKey(doc._id) !== idKey(oldId)) throw new Error("The _id field is immutable");
        await this.store.put(client, this.name, doc, { replace: !result.upsertedCount });
        if (!result.upsertedCount && canonical(encode(doc)) !== oldValue) result.modifiedCount++;
        result.after ??= doc;
      }
      return result;
    });
  }
  async updateOne(filter, changes, options) { return this.change(filter, changes, options); }
  async updateMany(filter, changes, options) { return this.change(filter, changes, options, { many: true }); }
  async replaceOne(filter, changes, options) { return this.change(filter, changes, options, { replacement: true }); }
  async deleteOne(filter, options) { return this.change(filter, {}, options, { remove: true }); }
  async deleteMany(filter, options) { return this.change(filter, {}, options, { remove: true, many: true }); }
  async findOneAndUpdate(filter, changes, options = {}) {
    const result = await this.change(filter, changes, options);
    const value = options.returnDocument === "after" || options.returnOriginal === false ? result.after : result.before;
    return { value, ok: 1, lastErrorObject: { n: result.matchedCount || result.upsertedCount, updatedExisting: !!result.matchedCount, ...(result.upsertedId ? { upserted: result.upsertedId } : {}) } };
  }
  async findOneAndDelete(filter, options = {}) {
    const result = await this.change(filter, {}, options, { remove: true });
    return { value: result.before, ok: 1, lastErrorObject: { n: result.deletedCount } };
  }
  async bulkWrite(operations, options = {}) {
    const result = { acknowledged: true, insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0, upsertedIds: {} };
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]; let row;
      if (op.insertOne) { await this.insertOne(op.insertOne.document); result.insertedCount++; continue; }
      if (op.updateOne) row = await this.updateOne(op.updateOne.filter, op.updateOne.update, op.updateOne);
      else if (op.updateMany) row = await this.updateMany(op.updateMany.filter, op.updateMany.update, op.updateMany);
      else if (op.deleteOne) row = await this.deleteOne(op.deleteOne.filter);
      else if (op.deleteMany) row = await this.deleteMany(op.deleteMany.filter);
      else if (op.replaceOne) row = await this.replaceOne(op.replaceOne.filter, op.replaceOne.replacement, op.replaceOne);
      else throw new Error("Unsupported bulk operation");
      for (const key of ["matchedCount", "modifiedCount", "deletedCount", "upsertedCount"]) result[key] += row[key] || 0;
      if (row.upsertedId) result.upsertedIds[i] = row.upsertedId;
    }
    return result;
  }
  async createIndex(keys, options) { return this.store.createIndex(this.name, keys, options); }
  listIndexes() { return new Cursor(() => this.store.indexes(this.name)); }
  async indexes() { return this.store.indexes(this.name); }
  async indexInformation() { return Object.fromEntries((await this.indexes()).map(index => [index.name, Object.entries(index.key)])); }
}

module.exports = { PostgresStore, Cursor, select, planFilter, QUERY_OPTIONS };
