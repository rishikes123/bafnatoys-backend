"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { BSON, ObjectId } = require("mongodb");
const { PGlite } = require("@electric-sql/pglite");
const { PostgresStore } = require("../database/postgres/store");
const { canonical, encode } = require("../database/postgres/codec");
const { importBackup, verifyBackup, readBackup } = require("../scripts/database-migration/backup-files");

let database, pool, store;
before(async () => {
  database = new PGlite();
  let queue = Promise.resolve();
  pool = {
    query: (sql, values) => database.query(sql, values),
    connect: async () => {
      const previous = queue; let release;
      queue = new Promise(resolve => { release = resolve; }); await previous;
      return { query: pool.query, release };
    },
    end: async () => {},
  };
  store = new PostgresStore(pool, { schema: "test_migration" });
  await store.initialize();
});
after(async () => database?.close());

test("BSON IDs, dates, binary and numeric types survive PostgreSQL JSONB", async () => {
  const doc = { _id: new ObjectId(), date: new Date("2026-01-02T03:04:05Z"), n: new BSON.Long("9223372036854775807"), binary: new BSON.Binary(Buffer.from([0, 1, 255])), nested: { text: "हिंदी", values: [null, true, 1.5] } };
  const collection = store.collection("typed_values");
  await collection.insertOne(doc);
  const { rows } = await pool.query(`SELECT document FROM ${store.table("typed_values")}`);
  assert.equal(canonical(rows[0].document), canonical(encode(doc)));
  const read = await collection.findOne({ _id: new ObjectId(doc._id.toHexString()) });
  assert.equal(String(read._id), String(doc._id)); assert(read.date instanceof Date);
});

test("filter, sort, projection, nested array matching and missing/null semantics", async () => {
  const collection = store.collection("queries");
  const user = new ObjectId();
  await collection.insertMany([
    { n: 3, user, items: [{ qty: 2 }], password: "hidden" },
    { n: 1, user, items: [], nullable: null },
    { n: 2, items: [] },
  ]);
  const rows = await collection.find({ user: { $in: [new ObjectId(String(user))] }, n: { $gte: 1 } }, { sort: { n: -1 }, projection: { password: 0 }, limit: 1 }).toArray();
  assert.equal(rows.length, 1); assert.equal(rows[0].n, 3); assert.equal(rows[0].password, undefined);
  assert.equal(await collection.countDocuments({ "items.qty": 2 }), 1);
  assert.equal(await collection.countDocuments({ nullable: null }), 3);
  assert.equal(await collection.countDocuments({ nullable: { $exists: true } }), 1);
});

test("atomic stock updates cannot oversell under concurrent requests", async () => {
  const collection = store.collection("stock");
  const { insertedId } = await collection.insertOne({ stock: 5 });
  const results = await Promise.all(Array.from({ length: 12 }, () => collection.updateOne({ _id: insertedId, stock: { $gte: 1 } }, { $inc: { stock: -1 } })));
  assert.equal(results.reduce((sum, result) => sum + result.modifiedCount, 0), 5);
  assert.equal((await collection.findOne({ _id: insertedId })).stock, 0);
});

test("upserts preserve setOnInsert values and findOneAndUpdate return semantics", async () => {
  const collection = store.collection("upserts");
  const first = await collection.findOneAndUpdate({ key: "shipping" }, { $set: { value: 10 }, $setOnInsert: { initial: "kept" } }, { upsert: true, returnDocument: "after" });
  assert.equal(first.value.initial, "kept"); assert.equal(first.lastErrorObject.updatedExisting, false);
  const before = await collection.findOneAndUpdate({ key: "shipping" }, { $set: { value: 20 }, $setOnInsert: { initial: "wrong" } });
  assert.equal(before.value.value, 10);
  assert.equal((await collection.findOne({ key: "shipping" })).initial, "kept");
  assert.equal((await collection.findOneAndDelete({ key: "shipping" })).value.value, 20);
});

test("unique and sparse indexes reject duplicates and retain missing fields", async () => {
  const collection = store.collection("unique_keys");
  await collection.createIndex({ paymentId: 1 }, { unique: true, sparse: true });
  await collection.insertMany([{ a: 1 }, { a: 2 }, { paymentId: "pay_original" }]);
  await assert.rejects(() => collection.insertOne({ paymentId: "pay_original" }), error => error.code === 11000);
  assert.equal(await collection.countDocuments(), 3);
});

test("aggregation uses ObjectId references for product lookup and rating groups", async () => {
  const product = new ObjectId(); const user = new ObjectId();
  await store.collection("lookup_products").insertOne({ _id: product, name: "Car", images: ["image.webp"] });
  const reviews = store.collection("lookup_reviews");
  await reviews.insertMany([{ productId: product, userId: user, rating: 5 }, { productId: product, userId: user, rating: 3 }, { productId: product, rating: 1 }]);
  const rows = await reviews.aggregate([
    { $match: { productId: { $in: [product] }, userId: { $exists: true, $ne: null } } },
    { $group: { _id: "$productId", rating: { $avg: "$rating" }, count: { $sum: 1 } } },
    { $lookup: { from: "lookup_products", localField: "_id", foreignField: "_id", as: "product" } },
    { $addFields: { name: { $arrayElemAt: ["$product.name", 0] } } },
  ]).toArray();
  assert.equal(rows[0].rating, 4); assert.equal(rows[0].count, 2); assert.equal(rows[0].name, "Car");
});

test("TTL reads reject expired OTPs without deleting stored backup records", async () => {
  const collection = store.collection("expiry");
  await collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 600 });
  await collection.insertMany([{ phone: "expired", createdAt: new Date(Date.now() - 700000) }, { phone: "valid", createdAt: new Date() }]);
  assert.equal(await collection.findOne({ phone: "expired" }), null);
  assert.equal((await collection.findOne({ phone: "valid" })).phone, "valid");
  assert.equal((await pool.query(`SELECT count(*) AS n FROM ${store.table("expiry")}`)).rows[0].n, 2);
});

test("migration read-only guard blocks database writes", async () => {
  const readOnly = new PostgresStore(pool, { schema: "test_migration", readOnly: true });
  await assert.rejects(() => readOnly.collection("stock").insertOne({ stock: 10 }), /read-only/);
});

test("real Mongoose driver preserves hooks, save versioning and populate", async () => {
  const Mongoose = require("mongoose").Mongoose;
  const mongoose = new Mongoose();
  mongoose.setDriver(require("../database/postgres/driver"));
  await mongoose.connect("postgresql://local/test", { pgPool: pool, pgSchema: "mongoose_driver", allowUnverifiedMigration: true });
  const categorySchema = new mongoose.Schema({ name: { type: String, required: true } });
  const itemSchema = new mongoose.Schema({ name: String, category: { type: mongoose.Schema.Types.ObjectId, ref: "TestCategory" }, stock: Number, history: [String] }, { timestamps: true, optimisticConcurrency: true });
  itemSchema.pre("save", function(next) { this.name = this.name.trim(); next(); });
  const Category = mongoose.model("TestCategory", categorySchema);
  const Item = mongoose.model("TestItem", itemSchema);
  const category = await Category.create({ name: "Cars" });
  const item = await Item.create({ name: " Car ", category: category._id, stock: 2, history: [] });
  assert.equal(item.name, "Car");
  const loaded = await Item.findById(item._id).populate("category").lean();
  assert.equal(loaded.category.name, "Cars"); assert(loaded.createdAt instanceof Date);
  item.history.push("changed"); await item.save();
  assert.deepEqual((await Item.findById(item._id).lean()).history, ["changed"]);
  const updated = await Item.findByIdAndUpdate(item._id, { $inc: { stock: -1 } }, { new: true });
  assert.equal(updated.stock, 1);
  assert.equal((await Item.findByIdAndDelete(item._id)).name, "Car");
  await mongoose.disconnect();
});

test("BSON backup restores every field/type and refuses overwrite or damaged files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bafna-migration-test-"));
  const doc = { _id: new ObjectId(), total: new BSON.Double(149.5), original: { unknownField: "preserved" }, bytes: new BSON.Binary(Buffer.from([4, 5, 6])) };
  const bytes = BSON.serialize(doc); const filename = "74657374.bson";
  await fs.writeFile(path.join(directory, filename), bytes);
  const manifest = { format: "bafna-bson-v1", consistentSnapshot: true, completedAt: new Date().toISOString(), collections: [{ name: "restored", filename, count: 1, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), indexes: [] }] };
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  const target = new PostgresStore(pool, { schema: "backup_restore" });
  const receipt = await importBackup(target, directory);
  assert.equal(receipt.dataVerified, true);
  await verifyBackup(target, directory);
  await assert.rejects(() => importBackup(target, directory), /new and empty/);
  await fs.writeFile(path.join(directory, filename), bytes.subarray(0, bytes.length - 1));
  await assert.rejects(() => readBackup(directory), /checksum/);
});

test("actual shop models retain login hashes, order totals, customer/product references and payment locks", async () => {
  const mongoose = require("mongoose");
  mongoose.setDriver(require("../database/postgres/driver"));
  await mongoose.connect("postgresql://local/test", { pgPool: pool, pgSchema: "real_shop_models", allowUnverifiedMigration: true });
  const modelFiles = await fs.readdir(path.join(__dirname, "../models"));
  for (const filename of modelFiles.filter(name => name.endsWith(".js"))) require(path.join(__dirname, "../models", filename));
  const { Registration, Category, Product, Order, CheckoutAttempt, Admin, Visitor } = mongoose.models;
  const customer = await Registration.create({ shopName: "Migration fixture", address: "Test address", otpMobile: "migration-fixture-only" });
  const category = await Category.create({ name: "Fixture Cars", image: "fixture.webp", imageId: "fixture" });
  const product = await Product.create({ name: "Fixture Car", sku: "MIGRATION-FIXTURE-001", price: 149.5, mrp: 299, stock: 5, category: category._id });
  assert.equal(product.slug, "fixture-car");
  const shippingAddress = { fullName: "Fixture", phone: "0000000000", street: "Test", city: "Test", state: "Test", pincode: "000000" };
  const order = await Order.create({ customerId: customer._id, total: 149.5, advancePaid: 49.5, items: [{ productId: product._id, name: product.name, qty: 1, innerQty: 1, inners: 1, price: 149.5 }], shippingAddress });
  assert.equal(order.remainingAmount, 100); assert.match(order.orderNumber, /^ODR/); assert(order.trackingToken);
  const read = await Order.findById(order._id).populate("customerId").populate({ path: "items.productId", populate: { path: "category" } }).lean();
  assert.equal(read.customerId.shopName, "Migration fixture"); assert.equal(read.items[0].productId.category.name, "Fixture Cars");
  order.paymentAuditHistory.push({ action: "verified", paymentId: "pay_fixture", newAmount: 49.5 });
  await order.save(); assert.equal((await Order.findById(order._id)).paymentAuditHistory.length, 1);
  const attempt = await CheckoutAttempt.create({ razorpayOrderId: "order_fixture", customerId: customer._id, items: [{ productId: String(product._id), qty: 1 }], shippingAddress, paymentMode: "ONLINE", calculation: { itemsTotal: 149.5, shippingCharge: 0, discountAmount: 0, grandTotal: 149.5, amountToCharge: 149.5 } });
  const locks = await Promise.all([1, 2].map(() => CheckoutAttempt.findOneAndUpdate({ _id: attempt._id, status: "created" }, { $set: { status: "processing" }, $inc: { recoveryCount: 1 } }, { new: true })));
  assert.equal(locks.filter(Boolean).length, 1); assert.equal(locks.find(Boolean).recoveryCount, 1);
  const admin = await Admin.create({ username: "migration-fixture-admin", password: "FixturePassword123!" });
  assert(await (await Admin.findById(admin._id)).matchPassword("FixturePassword123!"));
  const visitor = await Visitor.create({ date: "2099-01-01", states: new Map([["Tamil Nadu", 2]]), pageViews: new Map([["fixture-car", 1]]) });
  assert.equal((await Visitor.findById(visitor._id)).states.get("Tamil Nadu"), 2);
  await mongoose.disconnect();
});

test("unverified PostgreSQL targets refuse application startup", async () => {
  const mongoose = new (require("mongoose").Mongoose)();
  mongoose.setDriver(require("../database/postgres/driver"));
  await assert.rejects(() => mongoose.connect("postgresql://local/test", { pgPool: pool, pgSchema: "not_verified" }), /verified migration receipt/);
});

test("SQL pushdown returns exactly what Mingo returns (ids, $in, arrays, booleans, mixed)", async () => {
  const { select } = require("../database/postgres/store");
  const collection = store.collection("pushdown_parity");
  const a = new ObjectId(), b = new ObjectId(), c = new ObjectId();
  const docs = [
    { _id: new ObjectId(), productId: a, userId: a, status: "delivered", featured: true, tags: ["x", "y"], refs: [a, b], n: 1 },
    { _id: new ObjectId(), productId: b, status: "pending", featured: false, tags: "x", refs: [c], n: 2 },
    { _id: new ObjectId(), productId: c, userId: null, status: "delivered", tags: [], n: 3 },
    { _id: new ObjectId(), productId: "a-string-id", status: "Delivered", featured: true, n: 4 },
    { _id: "custom-string-id", productId: a, tags: ["y"], n: 5 },
  ];
  await collection.insertMany(docs.map(d => ({ ...d })));
  const all = await store.read("pushdown_parity"); // baseline: every row, filtered only by Mingo
  const filters = [
    { productId: a },
    { productId: { $in: [a, c] } },
    { productId: { $in: [new ObjectId(String(b)), "a-string-id"] } },
    { status: "delivered" },
    { status: { $in: ["Delivered", "pending"] } },
    { featured: true },
    { featured: false },
    { tags: "x" },
    { tags: { $in: ["y"] } },
    { refs: b },
    { refs: { $in: [c, new ObjectId()] } },
    { _id: docs[1]._id },
    { _id: { $in: [docs[0]._id, "custom-string-id"] } },
    { productId: { $in: [a, b] }, userId: { $exists: true, $ne: null } },
    { productId: a, n: { $gte: 2 } },
    { productId: new ObjectId() },
    { productId: { $in: [] } },
    { "refs.0": a },
    { $or: [{ status: "pending" }, { featured: true }] },
    { userId: { $exists: true } },
    { userId: { $exists: false } },
    { userId: { $ne: null } },
    { userId: { $exists: true, $ne: null } },
    { productId: { $in: [a, b, c] }, userId: { $exists: true, $ne: null } },
    { featured: { $exists: true }, status: "delivered" },
    { refs: { $ne: null } },
    { nothing: { $ne: null } },
    { status: { $ne: "pending" } },
    { _id: { $in: [docs[2]._id] }, status: "delivered" },
  ];
  await collection.insertOne({ _id: "null-array", refs: [null, a] });
  all.push(...(await store.read("pushdown_parity", { _id: "null-array" })));
  for (const filter of filters) {
    const expected = select(all, filter).map(d => String(d._id)).sort();
    const actual = (await collection.find(filter).toArray()).map(d => String(d._id)).sort();
    assert.deepEqual(actual, expected, JSON.stringify(filter));
    const counted = await collection.countDocuments(filter);
    assert.equal(counted, expected.length);
  }
  const grouped = await collection.aggregate([{ $match: { productId: { $in: [a, b] } } }, { $group: { _id: "$productId", n: { $sum: 1 } } }]).toArray();
  assert.deepEqual(grouped.map(g => `${g._id}:${g.n}`).sort(), [`${a}:2`, `${b}:1`].sort());
  // writes through the pushdown path hit exactly the matching rows
  const res = await collection.updateMany({ productId: { $in: [a] } }, { $set: { touched: true } });
  assert.equal(res.matchedCount, 2);
  assert.equal(await collection.countDocuments({ touched: true }), 2);
});

test("duplicate unique key errors look like Mongo E11000 and name the field (orderNumber retry relies on it)", async () => {
  const collection = store.collection("orders_dup");
  await collection.createIndex({ orderNumber: 1 }, { unique: true, name: "orderNumber_1" });
  await collection.insertOne({ orderNumber: "ODR1001001" });
  await assert.rejects(collection.insertOne({ orderNumber: "ODR1001001" }), error => {
    assert.equal(error.code, 11000);
    assert.match(error.message, /orderNumber/);
    assert.deepEqual(error.keyPattern, { orderNumber: 1 });
    return true;
  });
  const { insertedId } = await collection.insertOne({ orderNumber: "ODR1001002" });
  await assert.rejects(collection.insertOne({ _id: insertedId, orderNumber: "ODR9" }), error => error.code === 11000 && /_id_/.test(error.message));
});
