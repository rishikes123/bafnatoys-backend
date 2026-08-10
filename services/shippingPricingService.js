const DEFAULT_SHIPPING_SLABS = Object.freeze([
  Object.freeze({ minAmount: 0, shippingCharge: 199 }),
  Object.freeze({ minAmount: 1000, shippingCharge: 299 }),
  Object.freeze({ minAmount: 2000, shippingCharge: 349 }),
]);

const DEFAULT_FREE_SHIPPING_THRESHOLD = 3000;

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizeShippingSlabs = (slabs) => {
  const source = Array.isArray(slabs) && slabs.length > 0
    ? slabs
    : DEFAULT_SHIPPING_SLABS;

  return source
    .map((slab) => ({
      minAmount: toNonNegativeNumber(slab?.minAmount),
      shippingCharge: toNonNegativeNumber(slab?.shippingCharge),
    }))
    .sort((a, b) => a.minAmount - b.minAmount);
};

const normalizeShippingSettings = (settings = {}) => ({
  shippingCharge: toNonNegativeNumber(settings.shippingCharge, 199),
  freeShippingThreshold: toNonNegativeNumber(
    settings.freeShippingThreshold,
    DEFAULT_FREE_SHIPPING_THRESHOLD
  ),
  shippingSlabsEnabled: settings.shippingSlabsEnabled !== false,
  shippingSlabs: normalizeShippingSlabs(settings.shippingSlabs),
});

const calculateShippingCharge = (cartTotal, settings = {}) => {
  const total = toNonNegativeNumber(cartTotal);
  if (total <= 0) return 0;

  const normalized = normalizeShippingSettings(settings);
  if (
    normalized.freeShippingThreshold > 0 &&
    total >= normalized.freeShippingThreshold
  ) {
    return 0;
  }

  if (normalized.shippingSlabsEnabled) {
    const applicableSlab = [...normalized.shippingSlabs]
      .reverse()
      .find((slab) => total >= slab.minAmount);
    if (applicableSlab) return applicableSlab.shippingCharge;
  }

  return normalized.shippingCharge;
};

const validateShippingSettings = (payload = {}) => {
  const enabled = payload.shippingSlabsEnabled !== false;
  const freeThreshold = toNonNegativeNumber(payload.freeShippingThreshold);
  const slabs = normalizeShippingSlabs(payload.shippingSlabs);

  if (!enabled) return normalizeShippingSettings(payload);
  if (!Array.isArray(payload.shippingSlabs) || payload.shippingSlabs.length === 0) {
    throw new Error("At least one shipping slab is required");
  }
  if (slabs[0].minAmount !== 0) {
    throw new Error("First shipping slab must start from 0");
  }

  const uniqueMinimums = new Set(slabs.map((slab) => slab.minAmount));
  if (uniqueMinimums.size !== slabs.length) {
    throw new Error("Shipping slab minimum amounts must be unique");
  }
  if (freeThreshold > 0 && slabs.some((slab) => slab.minAmount >= freeThreshold)) {
    throw new Error("Every shipping slab must start below the free shipping threshold");
  }

  return {
    shippingCharge: toNonNegativeNumber(payload.shippingCharge, slabs[0].shippingCharge),
    freeShippingThreshold: freeThreshold,
    shippingSlabsEnabled: true,
    shippingSlabs: slabs,
  };
};

module.exports = {
  DEFAULT_FREE_SHIPPING_THRESHOLD,
  DEFAULT_SHIPPING_SLABS,
  calculateShippingCharge,
  normalizeShippingSettings,
  validateShippingSettings,
};
