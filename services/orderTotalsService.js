
/**
 * Volume discount ka single source of truth.
 *
 * Ye sirf ORDER BANATE WAQT chalta hai. Order ban jaane ke baad discount
 * fix ho jata hai — admin items hataye ya badle, discount wahi rehta hai
 * (dekho recalculateOrderTotals ka note).
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
 * Order ke items badalne ke baad itemsPrice, total aur remainingAmount
 * dobara calculate karta hai.
 *
 * DISCOUNT ko jaan-bujh kar haath NAHI lagaya jata.
 * Business rule: customer ne apne poore order par discount kamaya tha.
 * Agar hum stock na hone ki wajah se koi item nahi bhej paaye, to wo hamari
 * taraf se kami hai — customer ka kamaya hua discount nahi katega. Bas jo
 * maal nahi gaya uski keemat ghategi.
 *
 * Shipping bhi waise hi rehta hai — wo admin manually set karta hai.
 *
 * @param {Object} order  mongoose order document (saved by the caller)
 */
async function recalculateOrderTotals(order) {
  const itemsPrice = order.items.reduce(
    (sum, item) => sum + (Number(item.qty) || 1) * (Number(item.price) || 0),
    0
  );
  order.itemsPrice = itemsPrice;

  const shipping = Number(order.shippingPrice) || 0;
  const discount = Number(order.discountAmount) || 0; // order par jo pehle se hai
  order.total = Math.max(0, Math.round(itemsPrice + shipping - discount));

  if (order.paymentMode === "COD") {
    order.remainingAmount = Math.max(
      0,
      order.total - (Number(order.advancePaid) || 0)
    );
  }

  return order;
}

module.exports = { calculateDiscountAmount, recalculateOrderTotals };
