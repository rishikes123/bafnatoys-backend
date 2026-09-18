const ShippingSettings = require("../models/ShippingSettings");

/**
 * Volume discount ka single source of truth.
 *
 * Yahi logic order banate waqt bhi chalta hai aur admin ke items badalne par
 * bhi — dono jagah ek hi rule rahe.
 */
function calculateDiscountAmount(itemsTotal, shippingSettings) {
  const discountRules = shippingSettings?.discountRules || [];
  const sortedRules = [...discountRules].sort((a, b) => b.minAmount - a.minAmount);
  const applicableRule = sortedRules.find((rule) => itemsTotal >= rule.minAmount);
  return applicableRule
    ? Math.floor((itemsTotal * applicableRule.discountPercentage) / 100)
    : 0;
}

/**
 * Order ke items badalne ke baad itemsPrice, discountAmount, total aur
 * remainingAmount dobara calculate karta hai.
 *
 * Business rule: discount hamesha us maal par milta hai jo actually ja raha
 * hai. Item hatne par uska discount bhi hatega — warna purana (bada) discount
 * atka reh jata hai aur customer ko banti se zyada chhoot mil jati hai.
 *
 * Shipping ko haath nahi lagata — wo admin manually set karta hai.
 *
 * @param {Object} order  mongoose order document (saved by the caller)
 */
async function recalculateOrderTotals(order) {
  const itemsPrice = order.items.reduce(
    (sum, item) => sum + (Number(item.qty) || 1) * (Number(item.price) || 0),
    0
  );
  order.itemsPrice = itemsPrice;

  const shippingSettings = await ShippingSettings.findOne().lean();
  order.discountAmount = calculateDiscountAmount(itemsPrice, shippingSettings);

  const shipping = Number(order.shippingPrice) || 0;
  order.total = Math.max(
    0,
    Math.round(itemsPrice + shipping - order.discountAmount)
  );

  if (order.paymentMode === "COD") {
    order.remainingAmount = Math.max(
      0,
      order.total - (Number(order.advancePaid) || 0)
    );
  }

  return order;
}

module.exports = { calculateDiscountAmount, recalculateOrderTotals };
