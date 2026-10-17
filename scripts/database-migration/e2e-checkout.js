// END-TO-END checkout/payment test — poora backend + Postgres driver, database process ke andar (PGlite).
// SURAKSHA: live database ko chhoota nahi (backup ki copy memory me), Razorpay nakli hai (koi paisa nahi),
// aur localhost ke alawa har outbound request BLOCK hai (WhatsApp/Meta/Delhivery/FCM kuch nahi jaata).
const B = require("node:path").resolve(__dirname, "../..");
process.chdir(B);
require(B + "/node_modules/dotenv").config({ path: B + "/.env" });
const crypto = require("crypto");
const http = require("http"), https = require("https");
const assert = require("assert/strict");

/* ---------- 1. Bahar ki saari requests block ---------- */
const blocked = [];
const isLocal = h => /^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(String(h || "").split(":")[0]);
for (const mod of [http, https]) {
  for (const fn of ["request", "get"]) {
    const orig = mod[fn];
    mod[fn] = function (...args) {
      const a = args[0];
      const host = typeof a === "string" ? new URL(a).hostname : a instanceof URL ? a.hostname : a?.hostname || a?.host;
      if (!isLocal(host)) {
        blocked.push(host);
        const req = new http.ClientRequest({ host: "127.0.0.1", port: 9, timeout: 1 });
        process.nextTick(() => req.destroy(new Error(`outbound blocked in test: ${host}`)));
        return req;
      }
      return orig.apply(this, args);
    };
  }
}
const origFetch = global.fetch;
global.fetch = (url, opts) => {
  const host = new URL(String(url?.url || url)).hostname;
  if (!isLocal(host)) { blocked.push(host); return Promise.reject(new Error(`outbound blocked in test: ${host}`)); }
  return origFetch(url, opts);
};

/* ---------- 2. Nakli Razorpay ---------- */
process.env.RAZORPAY_KEY = "rzp_test_fake"; process.env.RAZORPAY_SECRET = "test_secret_only";
process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
const rz = { orders: new Map(), payments: new Map(), n: 0 };
class FakeRazorpay {
  constructor() {
    this.orders = {
      create: async ({ amount, currency, receipt, notes }) => { const o = { id: `order_T${++rz.n}`, entity: "order", amount, amount_paid: 0, currency, receipt, notes, status: "created" }; rz.orders.set(o.id, o); return o; },
      fetch: async id => { const o = rz.orders.get(id); if (!o) throw new Error("order not found"); return { ...o }; },
      fetchPayments: async id => ({ items: [...rz.payments.values()].filter(p => p.order_id === id) }),
    };
    this.payments = {
      fetch: async id => { const p = rz.payments.get(id); if (!p) throw new Error("payment not found"); return { ...p }; },
      refund: async () => ({ id: "rfnd_T", status: "processed" }),
    };
  }
}
const pay = orderId => { const o = rz.orders.get(orderId); o.status = "paid"; o.amount_paid = o.amount; const p = { id: `pay_${orderId}`, order_id: orderId, amount: o.amount, status: "captured", fee: 0, tax: 0, method: "upi" }; rz.payments.set(p.id, p); return p; };
const rzPath = require.resolve("razorpay", { paths: [B] });
require.cache[rzPath] = { id: rzPath, filename: rzPath, loaded: true, exports: FakeRazorpay };

/* ---------- 3. Database: backup ki copy, process ke andar ---------- */
const pg = require(B + "/node_modules/pg");
const { PGlite } = require(B + "/node_modules/@electric-sql/pglite");
const { PostgresStore } = require(B + "/database/postgres/store");
const { importBackup } = require(B + "/scripts/database-migration/backup-files");
const jwt = require(B + "/node_modules/jsonwebtoken");
const db = new PGlite();
let queue = Promise.resolve();
const query = (sql, values) => db.query(sql, values).then(r => ({ ...r, rowCount: r.affectedRows ?? r.rows.length }));
class FakePool { query(sql, values) { return query(typeof sql === "string" ? sql : sql.text, values ?? sql.values); }
  async connect() { const prev = queue; let release; queue = new Promise(r => (release = r)); await prev; return { query, release }; } on() {} async end() {} }

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(["PASS", name]); console.log("PASS", name); } catch (e) { results.push(["FAIL", name, e.message]); console.log("FAIL", name, "-", e.message); } };

(async () => {
  const schema = "e2e";
  const store = new PostgresStore(new FakePool(), { schema });
  await store.initialize();
  await importBackup(store, B + "/migration-backups/natural-order-rehearsal-20261017");
  await query(`INSERT INTO "${schema}"."_migration_meta" (key,value) VALUES ('verification',$1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ dataVerified: true, migrationId: "e2e" })]);
  pg.Pool = FakePool;
  Object.assign(process.env, { PORT: "5005", DB_PROVIDER: "postgres", DATABASE_URL: "postgres://local/e2e", PG_APP_SCHEMA: schema,
    PG_VERIFIED_MIGRATION: "e2e", MIGRATION_READ_ONLY: "false", DISABLE_BACKGROUND_JOBS: "true" });
  require(B + "/server.js");
  for (let i = 0; i < 60; i++) { try { await origFetch("http://localhost:5005/api/test"); break; } catch { await new Promise(r => setTimeout(r, 500)); } }

  const base = "http://localhost:5005/api";
  const adminTok = jwt.sign({ isEnvAdmin: true, username: "e2e", role: "superadmin" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const call = async (method, path, body, token, headers = {}) => {
    const raw = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const r = await origFetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: raw });
    let data; const t = await r.text(); try { data = JSON.parse(t); } catch { data = t; }
    return { status: r.status, data };
  };
  const one = async (sql, v) => (await query(sql, v)).rows;
  const doc = async (coll, id) => (await one(`SELECT document FROM "${schema}"."${coll}" WHERE id=$1`, [JSON.stringify({ $oid: String(id) })]))[0]?.document;
  const countOrders = async () => Number((await one(`SELECT count(*)::int AS n FROM "${schema}".orders`))[0].n);

  // test data: ek customer + kuch in-stock products (backup se)
  const customers = (await one(`SELECT document FROM "${schema}".registrations WHERE (document->>'codEnabled') IS DISTINCT FROM 'false' LIMIT 3`)).map(r => r.document);
  const cust = customers[0]; const custId = cust._id.$oid;
  const custTok = jwt.sign({ id: custId }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const prods = (await one(`SELECT document FROM "${schema}".products WHERE (document->'stock'->>'$numberInt')::int >= 50 OR (document->'stock'->>'$numberDouble')::float >= 50 LIMIT 6`)).map(r => r.document);
  assert(prods.length >= 3, "need in-stock products");
  const pid = p => p._id.$oid;
  const address = { fullName: "E2E Test", phone: "9999999999", street: "1 Test St", area: "Test", city: "Coimbatore", state: "Tamil Nadu", pincode: "641007", shopName: "E2E Test" };
  const item = (p, qty = 2) => ({ productId: pid(p), qty, innerQty: 1, inners: qty, name: p.name, price: 1 });
  const sign = (o, p) => crypto.createHmac("sha256", process.env.RAZORPAY_SECRET).update(`${o}|${p}`).digest("hex");
  const checkout = async (items, mode = "ONLINE", c = custId) => {
    const r = await call("POST", "/payments/create-order", { items, paymentMode: mode, customerId: c, shippingAddress: address });
    assert.equal(r.status, 200, `create-order ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    return r.data;
  };
  const finalize = (o, p) => call("POST", "/payments/finalize", { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p) });

  let ordA;
  await step("1. Online payment: create-order -> pay -> finalize creates order with server totals", async () => {
    const before = await countOrders();
    const rzo = await checkout([item(prods[0], 3), item(prods[1], 2)]);
    const p = pay(rzo.id);
    const r = await finalize(rzo.id, p.id);
    assert.equal(r.status, 201, JSON.stringify(r.data).slice(0, 300));
    ordA = r.data.order;
    assert.match(ordA.orderNumber, /^ODR\d+$/);
    assert.equal(Math.round(ordA.totalAmount ?? ordA.grandTotal ?? ordA.total), Math.round(rzo._serverCalc.grandTotal));
    assert.equal(await countOrders(), before + 1);
    const att = (await one(`SELECT document FROM "${schema}".checkoutattempts WHERE document->>'razorpayOrderId'=$1`, [rzo.id]))[0].document;
    assert.equal(att.status, "completed");
  });

  await step("2. Same payment finalized again returns SAME order (no duplicate)", async () => {
    const o = [...rz.orders.values()][0];
    const before = await countOrders();
    const r = await finalize(o.id, `pay_${o.id}`);
    assert.equal(r.status, 200); assert.equal(r.data.alreadyExists, true);
    assert.equal(String(r.data.order._id), String(ordA._id));
    assert.equal(await countOrders(), before);
  });

  await step("3. Webhook creates order; later browser finalize returns it (no duplicate)", async () => {
    const before = await countOrders();
    const rzo = await checkout([item(prods[2], 1)]);
    const p = pay(rzo.id);
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: p.id, order_id: rzo.id, amount: p.amount, status: "captured" } } } });
    const sig = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
    const w = await call("POST", "/payments/webhook", body, null, { "X-Razorpay-Signature": sig });
    assert.equal(w.status, 200, JSON.stringify(w.data));
    assert.equal(await countOrders(), before + 1);
    const r = await finalize(rzo.id, p.id);
    assert.equal(r.status, 200); assert.equal(r.data.alreadyExists, true);
    assert.equal(await countOrders(), before + 1);
    const bad = await call("POST", "/payments/webhook", body, null, { "X-Razorpay-Signature": "0".repeat(64) });
    assert.equal(bad.status, 400);
  });

  await step("4. COD with advance: advance charged, remaining recorded", async () => {
    const rzo = await checkout([item(prods[3] || prods[0], 2)], "COD");
    const p = pay(rzo.id);
    const r = await finalize(rzo.id, p.id);
    assert.equal(r.status, 201, JSON.stringify(r.data).slice(0, 300));
    const o = r.data.order;
    assert.equal(o.paymentMode || o.paymentMethod, "COD");
    assert.equal(Math.round(o.advancePaid), Math.round(rzo._serverCalc.amountToCharge));
    assert.equal(Math.round(o.advancePaid + o.remainingAmount), Math.round(rzo._serverCalc.grandTotal));
  });

  await step("5. Six checkouts finalized AT THE SAME TIME -> six orders, unique order numbers", async () => {
    const before = await countOrders();
    const rzos = [];
    for (let i = 0; i < 6; i++) rzos.push(await checkout([item(prods[i % prods.length], 1)]));
    const rs = await Promise.all(rzos.map(o => { const p = pay(o.id); return finalize(o.id, p.id); }));
    rs.forEach(r => assert.equal(r.status, 201, JSON.stringify(r.data).slice(0, 200)));
    const nums = rs.map(r => r.data.order.orderNumber);
    assert.equal(new Set(nums).size, 6, `order numbers: ${nums}`);
    assert.equal(await countOrders(), before + 6);
  });

  await step("6. One payment finalized 3x in parallel -> exactly ONE order", async () => {
    const before = await countOrders();
    const rzo = await checkout([item(prods[0], 1)]);
    const p = pay(rzo.id);
    const rs = await Promise.all([finalize(rzo.id, p.id), finalize(rzo.id, p.id), finalize(rzo.id, p.id)]);
    const created = rs.filter(r => r.status === 201).length;
    assert(created <= 1, `created ${created}`);
    assert(rs.every(r => [200, 201, 409].includes(r.status)), rs.map(r => r.status).join());
    // agar sab 409 (lock) aaye to dobara finalize se order ban jana chahiye
    if (created === 0 && !rs.some(r => r.status === 200)) { const again = await finalize(rzo.id, p.id); assert([200, 201].includes(again.status)); }
    assert.equal(await countOrders(), before + 1);
  });

  await step("7. Out-of-stock product is refused BEFORE payment", async () => {
    const p0 = prods[0];
    await query(`UPDATE "${schema}".products SET document = jsonb_set(document,'{stock}','{"$numberInt":"0"}') WHERE id=$1`, [JSON.stringify({ $oid: pid(p0) })]);
    const r = await call("POST", "/payments/create-order", { items: [item(p0, 1)], paymentMode: "ONLINE", customerId: custId, shippingAddress: address });
    assert([400, 409].includes(r.status), `status ${r.status}`);
    await query(`UPDATE "${schema}".products SET document = jsonb_set(document,'{stock}','{"$numberInt":"100"}') WHERE id=$1`, [JSON.stringify({ $oid: pid(p0) })]);
  });

  await step("8. Admin marks delivered -> stock decreases once (not again on repeat)", async () => {
    const pr = ordA.items[0]; const prodId = String(pr.productId?._id || pr.productId);
    const stockOf = async () => { const d = await doc("products", prodId); return Number(d.stock.$numberInt ?? d.stock.$numberDouble ?? d.stock); };
    const s0 = await stockOf();
    for (const st of ["processing", "shipped", "delivered"]) {
      const r = await call("PUT", `/orders/${ordA._id}/status`, { status: st }, adminTok);
      assert.equal(r.status, 200, `${st}: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    }
    const s1 = await stockOf();
    assert.equal(s1, s0 - Number(pr.qty), `stock ${s0} -> ${s1}, qty ${pr.qty}`);
    await call("PUT", `/orders/${ordA._id}/status`, { status: "delivered" }, adminTok);
    assert.equal(await stockOf(), s1, "delivered twice must not reduce stock again");
  });

  await step("9. Customer cancels own new order", async () => {
    const rzo = await checkout([item(prods[1], 1)]);
    const p = pay(rzo.id);
    const o = (await finalize(rzo.id, p.id)).data.order;
    const r = await call("PUT", `/orders/${o._id}/cancel`, {}, custTok);
    assert.equal(r.status, 200, `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    const d = await doc("orders", o._id);
    assert.equal(d.status, "cancelled");
  });

  await step("10. Verified buyer review (delivered order) -> product shows 1 real rating; fake ones ignored", async () => {
    const pr = ordA.items[0]; const prodId = String(pr.productId?._id || pr.productId);
    const r = await call("POST", "/reviews/add", { productId: prodId, userId: custId, rating: 4, shopName: "E2E Buyer" }, custTok);
    assert.equal(r.status, 201, `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    const list = await call("GET", "/products");
    const prod = list.data.find(x => String(x._id) === prodId) || (await call("GET", `/products/${prodId}`)).data;
    const detail = (await call("GET", `/products/${prod.slug || prodId}`)).data;
    assert.equal(detail.reviews, 1); assert.equal(detail.rating, 4);
    const pub = await call("GET", `/reviews/${prodId}`);
    assert.equal(pub.data.length, 1);
  });

  const pass = results.filter(r => r[0] === "PASS").length;
  console.log(`\nE2E: ${pass}/${results.length} passed`);
  console.log(`Outbound requests blocked (would have gone to): ${[...new Set(blocked)].join(", ") || "none"}`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error("HARNESS ERROR", e); process.exit(2); });
