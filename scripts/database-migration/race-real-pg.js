// Asli Railway Postgres par race tests — ek naye khaali schema me, baad me wahi schema drop.
const B = require("node:path").resolve(__dirname, "../..");
require(B + "/node_modules/dotenv").config({ path: B + "/.env.pg-migration" });
const assert = require("assert/strict");
const { Pool } = require(B + "/node_modules/pg");
const { ObjectId } = require(B + "/node_modules/mongodb");
const { PostgresStore } = require(B + "/database/postgres/store");

const schema = `bafna_migration_racetest_${Date.now()}`; // sirf ye schema; kuch aur nahi chhoota
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 120000 });
const results = [];
const step = async (name, fn) => { const s = Date.now(); try { await fn(); results.push(true); console.log("PASS", name, `(${Date.now() - s}ms)`); } catch (e) { results.push(false); console.log("FAIL", name, "-", e.message); } };

(async () => {
  const store = new PostgresStore(pool, { schema });
  await store.initialize();
  // Tunnel ek saath naye connection nahi kholne deta — pool ko pehle ek-ek karke bhar lo
  const held = [];
  for (let i = 0; i < 10; i++) held.push(await pool.connect());
  held.forEach(c => c.release());
  console.log("pool warmed: 10 connections");
  try {
    await step("20 buyers race for last 10 pieces -> exactly 10 succeed, stock ends at 0 (never negative)", async () => {
      const c = store.collection("products");
      const { insertedId } = await c.insertOne({ name: "race", stock: 10 });
      const rs = await Promise.all(Array.from({ length: 20 }, () => c.updateOne({ _id: insertedId, stock: { $gte: 1 } }, { $inc: { stock: -1 } })));
      const ok = rs.filter(r => r.modifiedCount === 1).length;
      const final = (await c.findOne({ _id: insertedId })).stock;
      assert.equal(ok, 10); assert.equal(final, 0);
    });
    await step("10 inserts with the same order number -> 1 saved, 9 Mongo-style E11000 naming orderNumber", async () => {
      const c = store.collection("orders");
      await c.createIndex({ orderNumber: 1 }, { unique: true, name: "orderNumber_1" });
      const rs = await Promise.allSettled(Array.from({ length: 10 }, () => c.insertOne({ _id: new ObjectId(), orderNumber: "ODR9000001" })));
      assert.equal(rs.filter(r => r.status === "fulfilled").length, 1);
      const errs = rs.filter(r => r.status === "rejected").map(r => r.reason);
      assert.equal(errs.length, 9);
      assert(errs.every(e => e.code === 11000 && /orderNumber/.test(e.message)), errs[0]?.message);
    });
    await step("5 parallel finalize locks (created -> processing) -> exactly one wins", async () => {
      const c = store.collection("checkoutattempts");
      const { insertedId } = await c.insertOne({ razorpayOrderId: "order_race", status: "created", recoveryCount: 0 });
      const rs = await Promise.all(Array.from({ length: 5 }, () => c.findOneAndUpdate(
        { _id: insertedId, status: { $ne: "completed" }, $or: [{ status: { $in: ["created", "failed"] } }, { processingStartedAt: null }] },
        { $set: { status: "processing", processingStartedAt: new Date() }, $inc: { recoveryCount: 1 } }, { returnDocument: "after" })));
      const winners = rs.filter(r => r.value && r.value.status === "processing" && r.lastErrorObject.updatedExisting);
      const doc = await c.findOne({ _id: insertedId });
      // $or me processingStartedAt:null hai — pehla jeetne ke baad baaki match nahi karte
      assert.equal(doc.recoveryCount, winners.length);
      assert.equal(winners.length, 1, `winners ${winners.length}`);
    });
    await step("Reads stay fast with pushdown on real PG ($in over 300 ids)", async () => {
      const c = store.collection("reviews");
      const ids = Array.from({ length: 300 }, () => new ObjectId());
      await c.insertMany(ids.slice(0, 50).map(productId => ({ productId, rating: 5 })));
      const s = Date.now();
      const rows = await c.find({ productId: { $in: ids } }).toArray();
      assert.equal(rows.length, 50);
      assert(Date.now() - s < 5000, `took ${Date.now() - s}ms over tunnel`);
    });
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    const left = (await pool.query("SELECT count(*)::int n FROM information_schema.schemata WHERE schema_name=$1", [schema])).rows[0].n;
    console.log(`test schema ${schema} dropped: ${left === 0}`);
    await pool.end();
  }
  console.log(`REAL-PG RACE: ${results.filter(Boolean).length}/${results.length} passed`);
})().catch(e => { console.error("ERROR", e.message); process.exit(1); });
