// One-time Option 1 migration. Apply always uses a saved plan, never current MRP again.
// node scripts/applyD2cPricing.js --plan
// node scripts/applyD2cPricing.js --apply migration-backups/<plan>.json
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const connectDB = require('../config/db');
const mongoose = require('mongoose');
const Product = require('../models/Product');

async function main() {
  if (process.env.MIGRATION_READ_ONLY === 'true') throw new Error('Database is read-only');
  await connectDB();
  const [mode, filename] = process.argv.slice(2);
  if (mode === '--plan') {
    const products = await Product.find({}).sort({ sku: 1 }).lean();
    if (!products.length) throw new Error('No products found');
    const invalid = products.filter(p => !Number.isFinite(p.mrp) || p.mrp <= 0 || !Number.isFinite(p.price));
    if (invalid.length) throw new Error(`Invalid prices: ${invalid.map(p => p.sku).join(', ')}`);
    const changes = products.map(p => ({
      id: String(p._id), sku: p.sku, name: p.name,
      oldMrp: p.mrp, oldPrice: p.price,
      newMrp: Math.round(p.mrp * 2 * 100) / 100,
      newPrice: Math.round(p.mrp * 2 * 0.9),
    }));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const directory = path.resolve(__dirname, '../migration-backups/d2c-pricing');
    fs.mkdirSync(directory, { recursive: true });
    const planPath = path.join(directory, `option1-${stamp}.json`);
    fs.writeFileSync(planPath, JSON.stringify({
      version: 1, createdAt: new Date().toISOString(),
      formula: 'newMrp = currentMrp * 2; newPrice = round(newMrp * 0.9)',
      products, changes,
    }, null, 2), { flag: 'wx' });
    const quote = value => `"${String(value).replace(/"/g, '""')}"`;
    fs.writeFileSync(planPath.replace(/\.json$/, '.csv'), '\uFEFF' + [
      ['SKU', 'Product', 'Old MRP', 'Old Selling Price', 'New MRP', 'New Selling Price'],
      ...changes.map(c => [c.sku, c.name, c.oldMrp, c.oldPrice, c.newMrp, c.newPrice]),
    ].map(row => row.map(quote).join(',')).join('\r\n'), { flag: 'wx' });
    console.log(JSON.stringify({ planPath, count: changes.length, example: changes.find(c => c.sku === 'JB001-A1') }, null, 2));
  } else if (mode === '--apply' && filename) {
    const planPath = path.resolve(filename);
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    if (plan.version !== 1 || !plan.changes?.length) throw new Error('Invalid pricing plan');
    const products = await Product.find({}).select('_id sku mrp price').lean();
    if (products.length !== plan.changes.length) throw new Error('Product count changed; create a fresh plan');
    const byId = new Map(products.map(p => [String(p._id), p]));
    const pending = [];
    for (const c of plan.changes) {
      if (c.newMrp !== Math.round(c.oldMrp * 2 * 100) / 100 || c.newPrice !== Math.round(c.newMrp * 0.9)) throw new Error(`Invalid calculation: ${c.sku}`);
      const product = byId.get(c.id);
      if (!product || product.sku !== c.sku) throw new Error(`Product changed: ${c.sku}`);
      if (product.mrp === c.newMrp && product.price === c.newPrice) continue;
      if (product.mrp !== c.oldMrp || product.price !== c.oldPrice) throw new Error(`Prices changed since backup: ${c.sku}`);
      pending.push({ updateOne: {
        filter: { _id: product._id, mrp: c.oldMrp, price: c.oldPrice },
        update: { $set: { mrp: c.newMrp, price: c.newPrice } },
      } });
    }
    const result = pending.length ? await Product.bulkWrite(pending, { ordered: true }) : { matchedCount: 0, modifiedCount: 0 };
    const after = await Product.find({}).select('_id mrp price').lean();
    const afterById = new Map(after.map(p => [String(p._id), p]));
    const mismatches = plan.changes.filter(c => {
      const actual = afterById.get(c.id);
      return !actual || actual.mrp !== c.newMrp || actual.price !== c.newPrice;
    });
    const report = { verifiedAt: new Date().toISOString(), total: after.length, matched: result.matchedCount, modified: result.modifiedCount, verified: plan.changes.length - mismatches.length, mismatches: mismatches.map(c => c.sku) };
    fs.writeFileSync(`${planPath}.result.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (mismatches.length) throw new Error('Verification failed; inspect backup and result before retrying');
  } else throw new Error('Use --plan or --apply <saved-plan.json>');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
