const Setting = require("../models/settingModel");
const Registration = require("../models/Registration");

/**
 * COD / advance ka faisla ek hi jagah.
 *
 * Global setting (Settings -> COD) upar hai, par har customer ke apne
 * override bhi ho sakte hain:
 *   codEnabled = false  -> is customer ko COD milega hi nahi
 *   noAdvance  = true   -> COD par advance nahi lena
 *
 * Pehle ye flags sirf admin panel me save hote the, kahin lagte nahi the —
 * isliye "NO ADV" wale customer ko bhi checkout advance maangta tha.
 */
async function resolveCodPolicy(customerId) {
  const codSetting = await Setting.findOne({ key: "cod" }).lean();
  const data = codSetting?.data || {};

  let codEnabled = data.enabled !== false;
  let advanceAmount = Number(data.advanceAmount) || 0;
  const advanceType = data.advanceType === "percentage" ? "percentage" : "flat";
  let noAdvance = false;
  let isSpecial = false;

  if (customerId) {
    const customer = await Registration.findById(customerId)
      .select("codEnabled noAdvance isSpecial")
      .lean()
      .catch(() => null);

    if (customer) {
      isSpecial = Boolean(customer.isSpecial);
      // Customer ka override sirf chhoot de sakta hai, sakhti nahi
      if (customer.codEnabled === false) codEnabled = false;
      if (customer.noAdvance === true) noAdvance = true;
    }
  }

  return {
    codEnabled,
    advanceType,
    advanceAmount: noAdvance ? 0 : advanceAmount,
    noAdvance,
    isSpecial,
  };
}

/**
 * Is order par kitna advance banta hai.
 * @param {Object} policy       resolveCodPolicy ka result
 * @param {Number} grandTotal   order ka total
 */
function advanceForTotal(policy, grandTotal) {
  if (!policy || policy.noAdvance) return 0;

  let advance = Number(policy.advanceAmount) || 0;
  if (policy.advanceType === "percentage") {
    advance = Math.floor((Number(grandTotal) * advance) / 100);
  }
  return Math.min(Math.max(0, advance), Math.max(0, Number(grandTotal) || 0));
}

module.exports = { resolveCodPolicy, advanceForTotal };
