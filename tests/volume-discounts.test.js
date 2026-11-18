const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ShippingSettings = require('../models/ShippingSettings');
const { calculateDiscountAmount } = require('../services/orderTotalsService');

const rules = [
  { minAmount: 1000, discountPercentage: 5 },
  { minAmount: 2000, discountPercentage: 10 },
];

test('discounts default to enabled for existing settings and stop when disabled', () => {
  assert.equal(calculateDiscountAmount(2500, { discountRules: rules }), 250);
  assert.equal(calculateDiscountAmount(2500, { discountRules: rules, volumeDiscountsEnabled: true }), 250);
  assert.equal(calculateDiscountAmount(2500, { discountRules: rules, volumeDiscountsEnabled: false }), 0);
  assert.equal(calculateDiscountAmount(500, { discountRules: rules }), 0);
  assert.equal(calculateDiscountAmount(2500, null), 0);
  assert.equal(new ShippingSettings().volumeDiscountsEnabled, true);
});

test('saving OFF hides public rules, retains admin rules, and ON restores them', async () => {
  let saved = { discountRules: rules };
  const handlers = {};
  const authorize = () => {};
  const router = {
    get(path, ...callbacks) { handlers[`GET ${path}`] = callbacks; },
    put(path, ...callbacks) { handlers[`PUT ${path}`] = callbacks; },
  };
  const model = {
    async findOne() { return saved; },
    async findOneAndUpdate(filter, update) {
      saved = { ...saved, ...update.$set };
      return saved;
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../routes/discountRoutes'), 'utf8'), {
    module: { exports: {} },
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === '../models/ShippingSettings') return model;
      if (name === '../middleware/authMiddleware') return { adminProtect: authorize, isAdmin: authorize };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const invoke = async (route, body) => {
    let result;
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { result = value; } };
    await handlers[route].at(-1)({ body }, response);
    return { data: result, status: response.statusCode };
  };
  assert.equal(handlers['GET /admin'].length, 3);
  assert.equal(handlers['PUT /'].length, 3);
  assert.deepEqual((await invoke('GET /')).data, rules);
  await invoke('PUT /', { rules, enabled: false });
  assert.equal((await invoke('GET /')).data.length, 0);
  const admin = (await invoke('GET /admin')).data;
  assert.equal(admin.enabled, false);
  assert.deepEqual(admin.rules, rules);
  assert.equal(calculateDiscountAmount(2500, saved), 0);
  await invoke('PUT /', { rules });
  assert.equal(saved.volumeDiscountsEnabled, false);
  await invoke('PUT /', { rules, enabled: true });
  assert.deepEqual((await invoke('GET /')).data, rules);
  assert.equal(calculateDiscountAmount(2500, saved), 250);
  assert.equal((await invoke('PUT /', { rules, enabled: 'false' })).status, 400);
});
